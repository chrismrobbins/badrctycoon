/**
 * Local-first cloud saves.
 *
 * The rules, in priority order:
 *
 *   1. **The game is playable logged out.** Accounts add cloud saves; they are
 *      not a gate. Every path here degrades to local-only rather than blocking.
 *   2. **Local storage is always written first.** The network is best-effort. A
 *      failed push must never cost the player progress.
 *   3. **Never silently clobber.** A 409 surfaces to the player with both
 *      versions described. Two browser tabs are enough to lose a park otherwise.
 *
 * Not wired into main.ts yet -- there is no server and no auth UI. This is the
 * engine; ui/auth.ts will drive it. See ARCHITECTURE §8.
 */

import type { GameState } from '../core/state';
import { ApiError, type Api, type SlotMeta } from '../net/client';
import { saveToLocalStorage, summarize } from './schema';

export type SyncStatus =
  | 'local-only'   // not signed in; localStorage is the only copy
  | 'synced'       // server has this exact revision
  | 'dirty'        // local changes not yet pushed
  | 'syncing'
  | 'offline'      // signed in, but the last push could not reach the server
  | 'conflict'     // the server moved on; the player must choose
  | 'error';

export interface ConflictInfo {
  /** What the server has. */
  remote: SlotMeta;
  /** What we were about to write. */
  localDay: number;
  localParkName: string;
}

export interface SyncEvents {
  onStatus?(status: SyncStatus, detail?: string): void;
  /** Resolve by calling keepLocal() or takeRemote() on the engine. */
  onConflict?(info: ConflictInfo): void;
}

export interface SyncOptions {
  api: Api;
  getState(): GameState;
  /** Replace the live park, e.g. after the player chooses the server's copy. */
  applyState(state: GameState): void;
  getPlaytimeMs(): number;
  events?: SyncEvents;
  /** How often to push while dirty. */
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;

export function createSyncEngine(opts: SyncOptions) {
  const { api, getState, applyState, getPlaytimeMs } = opts;
  const events = opts.events ?? {};
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  let slot: number | null = null;
  let parkName = 'My Park';
  /** Server revision this session is based on. 0 means "slot does not exist". */
  let baseRevision = 0;
  let dirty = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let status: SyncStatus = 'local-only';
  let pendingConflict: ConflictInfo | null = null;

  function setStatus(next: SyncStatus, detail?: string) {
    if (status === next && !detail) return;
    status = next;
    events.onStatus?.(next, detail);
  }

  /** Always write locally, then flag the network copy as behind. */
  function markDirty() {
    saveToLocalStorage(getState());
    if (slot === null) { setStatus('local-only'); return; }
    dirty = true;
    if (status !== 'syncing' && status !== 'conflict') setStatus('dirty');
  }

  async function push(): Promise<void> {
    if (slot === null || !dirty) return;
    // A conflict is unresolved until the player picks; pushing again would just
    // 409 forever and hammer the server.
    if (pendingConflict) return;
    if (inFlight) return inFlight;

    const state = getState();
    const s = summarize(state);
    setStatus('syncing');

    inFlight = (async () => {
      try {
        const meta = await api.saveSlot(slot!, {
          parkName,
          playtimeMs: getPlaytimeMs(),
          baseRevision,
          state,
        });
        baseRevision = meta.revision;
        dirty = false;
        setStatus('synced');
      } catch (e) {
        if (!(e instanceof ApiError)) { setStatus('error', String(e)); return; }

        if (e.isConflict && e.conflict) {
          pendingConflict = { remote: e.conflict, localDay: s.day, localParkName: parkName };
          setStatus('conflict');
          events.onConflict?.(pendingConflict);
          return;
        }
        if (e.isOffline) { setStatus('offline'); return; }
        if (e.isUnauthenticated) { slot = null; setStatus('local-only', 'session expired'); return; }
        setStatus('error', e.message);
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return {
    get status() { return status; },
    get slot() { return slot; },
    get isDirty() { return dirty; },
    get conflict() { return pendingConflict; },

    /** Call after signing in and choosing a park. `revision` comes from the
     *  SlotMeta the load returned; 0 for a brand-new slot. */
    attach(toSlot: number, name: string, revision: number) {
      slot = toSlot;
      parkName = name;
      baseRevision = revision;
      dirty = false;
      pendingConflict = null;
      setStatus('synced');
    },

    /** Sign-out, or the player going back to a local-only park. */
    detach() {
      slot = null;
      dirty = false;
      pendingConflict = null;
      setStatus('local-only');
    },

    rename(name: string) {
      parkName = name;
      markDirty();
    },

    markDirty,
    pushNow: push,

    /** Keep playing this park; overwrite the server's copy on the next push. */
    async keepLocal() {
      if (!pendingConflict) return;
      baseRevision = pendingConflict.remote.revision; // rebase onto what is there
      pendingConflict = null;
      dirty = true;
      await push();
    },

    /** Discard local changes and load the server's copy. */
    async takeRemote() {
      if (!pendingConflict || slot === null) return;
      const { meta, state } = await api.loadSlot(slot);
      applyState(state);
      saveToLocalStorage(state);
      baseRevision = meta.revision;
      parkName = meta.parkName;
      pendingConflict = null;
      dirty = false;
      setStatus('synced');
    },

    start() {
      if (timer) return;
      timer = setInterval(() => { void push(); }, intervalMs);

      // Push on tab-hide rather than beforeunload: mobile browsers frequently
      // skip beforeunload entirely, and hidden is the last reliable signal.
      document.addEventListener('visibilitychange', onHide);
    },

    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      document.removeEventListener('visibilitychange', onHide);
    },
  };

  function onHide() {
    if (document.visibilityState !== 'hidden' || slot === null || !dirty) return;
    // The page may not survive long enough to await a fetch. sendBeacon is
    // fire-and-forget and survives unload; the server sees the same PUT body.
    const payload = JSON.stringify({
      parkName,
      playtimeMs: getPlaytimeMs(),
      baseRevision,
      state: getState(),
    });
    const blob = new Blob([payload], { type: 'application/json' });
    // Beacons are POSTs. The API accepts POST /api/slots/:slot/beacon as an
    // alias for PUT for exactly this reason -- see API-CONTRACT.md.
    const ok = navigator.sendBeacon(`/api/slots/${slot}/beacon`, blob);
    if (!ok) void push();
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
