/**
 * One pg Client per request, not a module-level Pool.
 *
 * On Node, one long-lived Pool made sense -- the process stays up. On
 * Workers, Hyperdrive already maintains the real connection pool on
 * Cloudflare's side (close to the database, reused across isolates); a
 * fresh, lightweight Client per request is the documented, recommended
 * pattern, closed via ctx.waitUntil() after the response is sent rather than
 * blocking on it.
 */

import { Client } from 'pg';
import type { Env } from './worker';

export async function createDbClient(env: Env): Promise<Client> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  return client;
}
