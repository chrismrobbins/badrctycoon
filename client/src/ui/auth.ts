/**
 * The login form, slot picker, and conflict dialog -- step 8 of
 * docs/BACKEND-HANDOFF.md's build order. save/sync.ts's engine has no driver
 * without this; it is the last piece between "server works" and "players can
 * use it."
 *
 * Deliberately dependency-injected rather than reaching into main.ts's
 * globals (S, updateUI(), ...): this module knows nothing about the game
 * beyond the GameState shape, and main.ts knows nothing about this module
 * beyond the four callbacks in AuthUIOptions. That is what keeps this the
 * "single place any DOM control reaches game code" boundary the phase-4 note
 * in main.ts's dispatch table describes, applied to the one feature area
 * that gets to start there instead of migrating there later.
 *
 * Signing in is additive, never a gate (ARCHITECTURE §5-6): every view here
 * is reachable only through an explicit "Account" button, and closing the
 * panel with no account at all leaves the local park exactly as playable as
 * it was before this file existed.
 */

import type { Api, User, SlotMeta } from '../net/client';
import { ApiError } from '../net/client';
import { createSyncEngine, type SyncEngine, type SyncStatus, type ConflictInfo } from '../save/sync';
import type { GameState } from '../core/state';

export interface AuthUIOptions {
  api: Api;
  getState(): GameState;
  applyState(state: GameState): void;
  getPlaytimeMs(): number;
  /** Called after this module replaces the live park (loading a slot, or
   *  takeRemote() resolving a conflict) so the caller can re-render whatever
   *  it renders from GameState -- this module has no opinion on how. */
  onExternalStateChange?(): void;
  /** Called with a slot's already-stored playtimeMs whenever attaching to an
   *  existing slot, so a device that's behind (a fresh install, or one that
   *  hasn't saved this particular slot before) doesn't submit a playtimeMs
   *  that looks like time travel against what another device already saved.
   *  See save/playtime.ts's ensureAtLeast() -- the intended implementation. */
  ensurePlaytimeAtLeast?(ms: number): void;
}

export interface AuthUI {
  readonly sync: SyncEngine;
  open(): void;
  close(): void;
}

type View = 'auth' | 'slots' | 'park';

const LAST_SLOT_KEY = 'c2c_last_slot_v1';

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

export function mountAuthUI(root: HTMLElement, opts: AuthUIOptions): AuthUI {
  const { api } = opts;

  let view: View = 'auth';
  let user: User | null = null;
  let slots: SlotMeta[] = [];
  let error: string | null = null;
  let busy = false;
  let conflict: ConflictInfo | null = null;
  let authMode: 'login' | 'register' = 'login';

  const sync = createSyncEngine({
    api,
    getState: opts.getState,
    applyState: (state) => {
      opts.applyState(state);
      opts.onExternalStateChange?.();
    },
    getPlaytimeMs: opts.getPlaytimeMs,
    events: {
      onStatus: () => render(),
      onConflict: (info) => { conflict = info; render(); },
    },
  });

  async function withBusy(fn: () => Promise<void>) {
    busy = true; error = null; render();
    try {
      await fn();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Something went wrong.';
    } finally {
      busy = false; render();
    }
  }

  async function refreshSlots() {
    slots = await api.listSlots();
  }

  async function attachToSlot(meta: SlotMeta, state?: GameState) {
    if (state) {
      opts.applyState(state);
      opts.onExternalStateChange?.();
    }
    opts.ensurePlaytimeAtLeast?.(meta.playtimeMs);
    sync.attach(meta.slot, meta.parkName, meta.revision);
    try { localStorage.setItem(LAST_SLOT_KEY, String(meta.slot)); } catch { /* private mode */ }
    view = 'park';
  }

  /** Resume the slot from the last session, if this device remembers one and
   *  it still exists. Falls back to the slot picker silently otherwise --
   *  never blocks play on this succeeding. */
  async function tryAutoResume(): Promise<boolean> {
    let remembered: number | null = null;
    try {
      const raw = localStorage.getItem(LAST_SLOT_KEY);
      remembered = raw ? Number(raw) : null;
    } catch { /* private mode */ }
    if (!remembered || !Number.isInteger(remembered)) return false;

    try {
      const { meta, state } = await api.loadSlot(remembered);
      await attachToSlot(meta, state);
      return true;
    } catch {
      return false; // deleted, or something else -- the picker is the fallback
    }
  }

  async function boot() {
    // No server reachable at all (not just "no account") must be exactly as
    // playable as being signed out -- ARCHITECTURE §5-6, BACKEND-HANDOFF.md
    // §1. net/client.ts's me() only swallows a 401 itself; a network failure
    // (ApiError.isOffline) is rethrown, since most callers do want to know
    // the difference. Here, the difference doesn't matter: either way there
    // is no session to resume, so this falls back to the same signed-out
    // view rather than surfacing a boot-time error over what the player
    // sees first.
    try {
      user = await api.me();
    } catch {
      user = null;
    }
    if (!user) { view = 'auth'; render(); return; }

    try {
      await refreshSlots();
      if (!(await tryAutoResume())) view = 'slots';
    } catch {
      // Session looked valid but the server went away mid-boot -- same
      // fallback. The next real interaction (opening the panel) will
      // re-establish whether it's really back.
      view = 'auth';
    }
    render();
  }
  void boot();

  // ── Rendering ──────────────────────────────────────────────────────────

  function render() {
    root.innerHTML = `
      <div class="mgmt-backdrop" data-close></div>
      <div class="mgmt-center">
        <div class="mgmt-panel" style="max-width:26rem;">
          <div class="mgmt-head">
            <h2 class="mgmt-title"><i class="fas fa-user-circle" style="color:#3b82f6;margin-right:0.5rem;"></i>Account</h2>
            <button class="acct-close" data-close><i class="fas fa-times"></i></button>
          </div>
          <div class="custom-scroll" style="padding:1rem 1.5rem 1.5rem;">
            ${conflict ? conflictHtml(conflict) : viewHtml()}
          </div>
        </div>
      </div>
    `;
    bind();
  }

  function statusBadge(status: SyncStatus): string {
    const map: Record<SyncStatus, [string, string]> = {
      'local-only': ['#94a3b8', 'Local only'],
      synced: ['#16a34a', 'Synced'],
      dirty: ['#f59e0b', 'Unsaved changes'],
      syncing: ['#3b82f6', 'Saving…'],
      offline: ['#94a3b8', 'Offline — will retry'],
      conflict: ['#ef4444', 'Conflict'],
      error: ['#ef4444', 'Error'],
    };
    const [color, label] = map[status];
    return `<span style="color:${color};font-weight:700;font-size:11px;">● ${label}</span>`;
  }

  function errorHtml(): string {
    return error ? `<div style="color:#ef4444;font-size:11px;font-weight:700;margin-bottom:0.5rem;">${escapeHtml(error)}</div>` : '';
  }

  function conflictHtml(c: ConflictInfo): string {
    // Wording matches docs/BACKEND-HANDOFF.md §5's own example almost
    // verbatim: "this park was also saved on another device, Day 42, 3
    // minutes ago" -- written for the player who is about to lose one copy.
    return `
      <p style="font-size:12px;margin-bottom:0.75rem;">
        This park was also saved on another device — <b>Day ${c.remote.day}</b>,
        ${escapeHtml(relativeTime(c.remote.updatedAt))}. Only one copy can win.
      </p>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        <button class="m-btn blue" data-authact="keep-local">
          Keep mine (Day ${c.localDay}, "${escapeHtml(c.localParkName)}")
        </button>
        <button class="m-btn" style="background:rgba(148,163,184,0.15);color:#475569;" data-authact="take-remote">
          Use theirs (Day ${c.remote.day}, "${escapeHtml(c.remote.parkName)}")
        </button>
      </div>
      ${errorHtml()}
    `;
  }

  function viewHtml(): string {
    if (view === 'park') return parkViewHtml();
    if (view === 'slots') return slotsViewHtml();
    return authViewHtml();
  }

  function authViewHtml(): string {
    const isLogin = authMode === 'login';
    return `
      <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
        <button class="m-btn ${isLogin ? 'blue' : ''}" style="${isLogin ? '' : 'background:rgba(148,163,184,0.12);color:#64748b;'}" data-authact="mode-login">Sign in</button>
        <button class="m-btn ${!isLogin ? 'blue' : ''}" style="${!isLogin ? '' : 'background:rgba(148,163,184,0.12);color:#64748b;'}" data-authact="mode-register">Create account</button>
      </div>
      <form data-form="${authMode}" style="display:flex;flex-direction:column;gap:0.5rem;">
        <input name="username" placeholder="Username" autocomplete="username" required
               style="padding:0.5rem 0.75rem;border-radius:0.5rem;border:1px solid rgba(148,163,184,0.3);background:transparent;font-size:12px;">
        <input name="password" type="password" placeholder="Password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required
               style="padding:0.5rem 0.75rem;border-radius:0.5rem;border:1px solid rgba(148,163,184,0.3);background:transparent;font-size:12px;">
        ${errorHtml()}
        <button class="m-btn blue" type="submit" ${busy ? 'disabled' : ''}>
          ${busy ? 'Working…' : isLogin ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p style="font-size:10px;color:#94a3b8;margin-top:0.75rem;">
        Playing without an account works exactly as before — this only adds cloud saves.
      </p>
    `;
  }

  function slotsViewHtml(): string {
    const rows = slots.length
      ? slots.map((s) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.5rem;border-radius:0.5rem;background:rgba(148,163,184,0.08);">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.parkName)}</div>
              <div style="font-size:10px;color:#94a3b8;">Slot ${s.slot} · Day ${s.day} · $${Math.round(s.funds).toLocaleString()} · ${escapeHtml(relativeTime(s.updatedAt))}</div>
            </div>
            <div style="display:flex;gap:0.25rem;flex-shrink:0;">
              <button class="m-btn blue" data-authact="load-slot" data-slot="${s.slot}">Load</button>
              <button class="m-btn red" data-authact="delete-slot" data-slot="${s.slot}">Delete</button>
            </div>
          </div>
        `).join('')
      : `<p style="font-size:11px;color:#94a3b8;">No saved parks yet.</p>`;

    const usedSlots = new Set(slots.map((s) => s.slot));
    const nextFree = Array.from({ length: 12 }, (_, i) => i + 1).find((n) => !usedSlots.has(n));

    return `
      <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:0.5rem;">
        Signed in as ${escapeHtml(user?.displayName ?? '')}
      </p>
      <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1rem;">${rows}</div>
      ${nextFree
        ? `
          <form data-form="new-slot" style="display:flex;gap:0.5rem;margin-bottom:1rem;">
            <input name="parkName" placeholder="New park name" maxlength="48" required
                   style="flex:1;min-width:0;padding:0.5rem 0.75rem;border-radius:0.5rem;border:1px solid rgba(148,163,184,0.3);background:transparent;font-size:12px;">
            <button class="m-btn green" type="submit" ${busy ? 'disabled' : ''}>Save current park</button>
          </form>
        `
        : `<p style="font-size:10px;color:#94a3b8;margin-bottom:1rem;">All 12 slots are full — delete one to save a new park.</p>`
      }
      ${errorHtml()}
      <button class="m-btn" style="background:rgba(148,163,184,0.15);color:#475569;" data-authact="logout">Sign out</button>
    `;
  }

  function parkViewHtml(): string {
    return `
      <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:0.5rem;">
        Signed in as ${escapeHtml(user?.displayName ?? '')}
      </p>
      <div style="margin-bottom:1rem;">${statusBadge(sync.status)}</div>
      ${errorHtml()}
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        <button class="m-btn blue" data-authact="save-now" ${busy || sync.status === 'syncing' ? 'disabled' : ''}>Save now</button>
        <button class="m-btn" style="background:rgba(148,163,184,0.15);color:#475569;" data-authact="switch-park">Switch park</button>
        <button class="m-btn" style="background:rgba(148,163,184,0.15);color:#475569;" data-authact="logout">Sign out</button>
      </div>
    `;
  }

  // ── Event binding ──────────────────────────────────────────────────────

  function bind() {
    root.querySelectorAll<HTMLElement>('[data-close]').forEach((el) => {
      el.addEventListener('click', close);
    });

    root.querySelector('[data-authact="mode-login"]')?.addEventListener('click', () => { authMode = 'login'; error = null; render(); });
    root.querySelector('[data-authact="mode-register"]')?.addEventListener('click', () => { authMode = 'register'; error = null; render(); });

    root.querySelector('form[data-form="login"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      void withBusy(async () => {
        user = await api.login({ username: String(f.get('username')), password: String(f.get('password')) });
        await refreshSlots();
        if (!(await tryAutoResume())) view = 'slots';
      });
    });

    root.querySelector('form[data-form="register"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      void withBusy(async () => {
        user = await api.register({ username: String(f.get('username')), password: String(f.get('password')) });
        await refreshSlots();
        view = 'slots';
      });
    });

    root.querySelector('form[data-form="new-slot"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      const usedSlots = new Set(slots.map((s) => s.slot));
      const nextFree = Array.from({ length: 12 }, (_, i) => i + 1).find((n) => !usedSlots.has(n));
      if (!nextFree) return;
      void withBusy(async () => {
        const meta = await api.saveSlot(nextFree, {
          parkName: String(f.get('parkName')),
          playtimeMs: opts.getPlaytimeMs(),
          baseRevision: 0,
          state: opts.getState(),
        });
        await attachToSlot(meta);
      });
    });

    root.querySelectorAll<HTMLElement>('[data-authact="load-slot"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = Number(btn.dataset.slot);
        if (!confirm('Load this park? Your current local park will be replaced (it stays saved locally, but stops being the active one).')) return;
        void withBusy(async () => {
          const { meta, state } = await api.loadSlot(slot);
          await attachToSlot(meta, state);
        });
      });
    });

    root.querySelectorAll<HTMLElement>('[data-authact="delete-slot"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = Number(btn.dataset.slot);
        if (!confirm('Delete this saved park? This cannot be undone.')) return;
        void withBusy(async () => {
          await api.deleteSlot(slot);
          await refreshSlots();
        });
      });
    });

    root.querySelector('[data-authact="save-now"]')?.addEventListener('click', () => {
      sync.markDirty();
      void sync.pushNow();
    });

    root.querySelector('[data-authact="switch-park"]')?.addEventListener('click', () => {
      sync.detach();
      try { localStorage.removeItem(LAST_SLOT_KEY); } catch { /* private mode */ }
      // `slots` was last fetched at sign-in (or last time this view was
      // shown) -- stale if a slot was created or deleted since. Without this
      // refresh, a park just saved for the first time would vanish from its
      // own picker until the next full sign-in.
      void withBusy(async () => {
        await refreshSlots();
        view = 'slots';
      });
    });

    root.querySelector('[data-authact="logout"]')?.addEventListener('click', () => {
      void withBusy(async () => {
        await api.logout();
        sync.detach();
        try { localStorage.removeItem(LAST_SLOT_KEY); } catch { /* private mode */ }
        user = null;
        view = 'auth';
      });
    });

    root.querySelector('[data-authact="keep-local"]')?.addEventListener('click', () => {
      conflict = null;
      void withBusy(() => sync.keepLocal());
    });
    root.querySelector('[data-authact="take-remote"]')?.addEventListener('click', () => {
      void withBusy(async () => {
        await sync.takeRemote();
        conflict = null;
      });
    });
  }

  function open() {
    root.classList.remove('hidden');
    render();
  }
  function close() {
    root.classList.add('hidden');
  }

  return { sync, open, close };
}
