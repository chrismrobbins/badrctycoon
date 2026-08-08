/** Bindings and per-request context shared by worker.ts and every route
 *  module -- kept separate from worker.ts itself so route files importing it
 *  don't create a circular import with the file that registers them. */

import type { Client } from 'pg';

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE: Hyperdrive;
  /** Per-username login/register throttling -- see auth/rateLimit.ts. */
  AUTH_ATTEMPTS: KVNamespace;
  /** Per-IP backstop on auth endpoints; the built-in binding's window caps
   *  at 60s, which is why the per-username limiter above needs KV instead. */
  RL_AUTH_IP: RateLimit;
}

export interface Variables {
  /** Attached by worker.ts's db middleware; every route pulls its
   *  connection from here rather than touching Hyperdrive directly. */
  db: Client;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
