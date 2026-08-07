/**
 * Typed client for the API in docs/API-CONTRACT.md.
 *
 * Written against the contract before the server exists, deliberately: it forces
 * the contract to be concrete, and gives the backend a reference implementation
 * of its own consumer. It has never run against a real server -- only the mock in
 * tests/sync.spec.ts -- so treat the first integration as a review of both sides.
 *
 * Every method either returns the documented success shape or throws ApiError.
 * Callers should branch on `err.code`, not on message text.
 */

import type { GameState } from '../core/state';

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export interface SlotMeta {
  slot: number;
  parkName: string;
  saveVersion: number;
  day: number;
  funds: number;
  parkValue: number;
  rating: number;
  guests: number;
  playtimeMs: number;
  revision: number;
  updatedAt: string;
}

export interface SavePayload {
  parkName: string;
  playtimeMs: number;
  /** Revision this edit was based on. 0 for a slot that does not exist yet. */
  baseRevision: number;
  state: GameState;
}

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  value: number;
}

export type LeaderboardMetric = 'park_value' | 'guests_peak' | 'day_reached';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Present on 409: the slot as the server currently has it. */
  readonly conflict?: SlotMeta;

  constructor(status: number, code: string, message: string, conflict?: SlotMeta) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.conflict = conflict;
  }

  /** Someone else (another tab, another device) wrote this slot first. */
  get isConflict(): boolean { return this.status === 409; }
  /** Not signed in, or the session expired. */
  get isUnauthenticated(): boolean { return this.status === 401; }
  /** The request never reached the server. Distinct from a server error --
   *  the caller can keep playing offline instead of surfacing a failure. */
  get isOffline(): boolean { return this.code === 'network_unreachable'; }
}

export interface ApiOptions {
  /** Same-origin by default; set for a separately hosted API. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createApi(opts: ApiOptions = {}) {
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}/api${path}`, {
        method,
        // Session is an httpOnly cookie, so it must ride along cross-origin too.
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiError(0, 'network_unreachable', 'Could not reach the server.', undefined);
    }

    if (res.status === 204) return undefined as T;

    // A proxy or a crash can return HTML with a 5xx; do not let JSON.parse
    // failure masquerade as a protocol error.
    let payload: any = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }

    if (!res.ok) {
      const code = payload?.error?.code ?? `http_${res.status}`;
      const message = payload?.error?.message ?? `Request failed (${res.status}).`;
      throw new ApiError(res.status, code, message, payload?.meta ?? payload?.current);
    }

    return payload as T;
  }

  return {
    // ── Auth ──
    async me(): Promise<User | null> {
      try {
        return (await request<{ user: User }>('GET', '/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.isUnauthenticated) return null;
        throw e;
      }
    },

    register(input: { username: string; password: string; displayName?: string; email?: string }) {
      return request<{ user: User }>('POST', '/auth/register', input).then((r) => r.user);
    },

    login(input: { username: string; password: string }) {
      return request<{ user: User }>('POST', '/auth/login', input).then((r) => r.user);
    },

    logout() {
      return request<void>('POST', '/auth/logout');
    },

    // ── Saves ──
    listSlots() {
      return request<{ slots: SlotMeta[] }>('GET', '/slots').then((r) => r.slots);
    },

    loadSlot(slot: number) {
      return request<{ meta: SlotMeta; state: GameState }>('GET', `/slots/${slot}`);
    },

    /** Throws ApiError with isConflict === true and `.conflict` populated on 409. */
    saveSlot(slot: number, payload: SavePayload) {
      return request<{ meta: SlotMeta }>('PUT', `/slots/${slot}`, payload).then((r) => r.meta);
    },

    deleteSlot(slot: number) {
      return request<void>('DELETE', `/slots/${slot}`);
    },

    // ── Leaderboard ──
    leaderboard(metric: LeaderboardMetric = 'park_value', limit = 50) {
      return request<{ rows: LeaderboardRow[] }>(
        'GET', `/leaderboard?metric=${encodeURIComponent(metric)}&limit=${limit}`,
      ).then((r) => r.rows);
    },
  };
}

export type Api = ReturnType<typeof createApi>;
