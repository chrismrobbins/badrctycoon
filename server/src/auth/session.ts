/**
 * Opaque random session tokens. The DB stores only sha256(token)
 * (docs/API-CONTRACT.md §3: "a database leak must not be a session leak") --
 * the raw token exists only in the cookie and briefly in memory here.
 */

import type { Client } from 'pg';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { apiError } from '../errors';
import type { AppEnv } from '../types';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days -- matches the arcade (handoff §7)
// Only bump last_used_at this often; every request would be a write per request.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

async function hashToken(token: string): Promise<Buffer> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Buffer.from(digest);
}

export async function createSession(
  db: Client,
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Buffer.from(bytes).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, await hashToken(token), expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );
  return token;
}

export async function revokeSession(db: Client, token: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [await hashToken(token)],
  );
}

/** Looks up the user for a request's session cookie. Null if there is none,
 *  it's expired, or it was revoked -- callers turn that into a 401. */
export async function getSessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const db = c.get('db');

  const { rows } = await db.query<
    SessionUser & { session_id: string; last_used_at: Date | null }
  >(
    `SELECT u.id, u.username, u.display_name AS "displayName", u.is_admin AS "isAdmin",
            s.id AS session_id, s.last_used_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [await hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;

  const stale =
    !row.last_used_at || Date.now() - row.last_used_at.getTime() > LAST_USED_THROTTLE_MS;
  if (stale) {
    // Best-effort; a lost update here just means last_used_at lags slightly.
    // Not awaited inline -- c.executionCtx.waitUntil lets it finish after
    // the response is sent rather than adding its latency to every request.
    c.executionCtx.waitUntil(
      db.query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [row.session_id]).then(
        () => {},
        () => {},
      ),
    );
  }

  return { id: row.id, username: row.username, displayName: row.displayName, isAdmin: row.isAdmin };
}

/** Like getSessionUser, but throws the standard 401 instead of returning null
 *  -- what every route that isn't public wants. */
export async function requireUser(c: Context<AppEnv>): Promise<SessionUser> {
  const user = await getSessionUser(c);
  if (!user) throw apiError(401, 'unauthenticated', 'Sign in required.');
  return user;
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    // Derived from the actual request, not a NODE_ENV flag that could drift
    // from reality: browsers reject a Secure cookie set over plain http
    // anyway, so this only ever matters for local http dev, where it needs
    // to be false for the cookie to be usable in an actual browser at all.
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
