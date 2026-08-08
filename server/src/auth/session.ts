/**
 * Opaque random session tokens. The DB stores only sha256(token)
 * (docs/API-CONTRACT.md §3: "a database leak must not be a session leak") --
 * the raw token exists only in the cookie and briefly in memory here.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db';
import { env } from '../env';
import { apiError } from '../errors';

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

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}

/** Looks up the user for a request's session cookie. Null if there is none,
 *  it's expired, or it was revoked -- callers turn that into a 401. */
export async function getSessionUser(request: FastifyRequest): Promise<SessionUser | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const { rows } = await pool.query<
    SessionUser & { session_id: string; last_used_at: Date | null }
  >(
    `SELECT u.id, u.username, u.display_name AS "displayName", u.is_admin AS "isAdmin",
            s.id AS session_id, s.last_used_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;

  const stale =
    !row.last_used_at || Date.now() - row.last_used_at.getTime() > LAST_USED_THROTTLE_MS;
  if (stale) {
    // Best-effort; a lost update here just means last_used_at lags slightly.
    void pool.query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [row.session_id]);
  }

  return { id: row.id, username: row.username, displayName: row.displayName, isAdmin: row.isAdmin };
}

/** Like getSessionUser, but throws the standard 401 instead of returning null
 *  -- what every route that isn't public wants. */
export async function requireUser(request: FastifyRequest): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw apiError(401, 'unauthenticated', 'Sign in required.');
  return user;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd, // browsers require https for Secure outside localhost; dev runs on http
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
