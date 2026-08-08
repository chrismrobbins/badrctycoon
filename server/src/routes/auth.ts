import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hashPassword, verifyPassword, verifyAgainstDummy } from '../auth/password';
import {
  createSession,
  revokeSession,
  getSessionUser,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from '../auth/session';
import { isRateLimited, recordAttempt, clearAttempts } from '../auth/rateLimit';
import { pool } from '../db';
import { apiError } from '../errors';

// Mirrors the CHECK constraint in server/migrations/001_init.sql so a bad
// username is a 400 with a useful message, not a raw constraint violation
// (docs/API-CONTRACT.md §3).
const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;
const DISPLAY_NAME_MAX = 40;
// Not in the contract -- our call (handoff §7 lists this kind of thing as ours
// to decide). 8 chars is a floor, not a strength meter; nothing here blocks a
// weak-but-long password.
const PASSWORD_MIN = 8;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 5;

function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { username?: string; password?: string; displayName?: string; email?: string };
  }>(
    '/api/auth/register',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { username, password, displayName, email } = request.body ?? {};

      if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
        throw apiError(400, 'invalid_username', '3-24 characters: letters, digits, _ or -.');
      }
      if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
        throw apiError(400, 'weak_password', `Password must be at least ${PASSWORD_MIN} characters.`);
      }
      const trimmedDisplayName = (displayName ?? username).trim();
      if (trimmedDisplayName.length < 1 || trimmedDisplayName.length > DISPLAY_NAME_MAX) {
        throw apiError(400, 'invalid_display_name', `1-${DISPLAY_NAME_MAX} characters.`);
      }
      if (email !== undefined && (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email))) {
        throw apiError(400, 'invalid_email', 'Not a recognisable email address.');
      }

      const rlKey = `register:${username.toLowerCase()}`;
      if (isRateLimited(rlKey, REGISTER_MAX_ATTEMPTS)) {
        throw apiError(429, 'rate_limited', 'Too many attempts for this username. Try again later.');
      }
      recordAttempt(rlKey, REGISTER_WINDOW_MS);

      const passwordHash = await hashPassword(password);

      let userId: string;
      try {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO users (username, email, password_hash, display_name)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [username, email ?? null, passwordHash, trimmedDisplayName],
        );
        userId = rows[0]!.id;
      } catch (err) {
        // 23505 = unique_violation. citext makes "Chris" and "chris" collide.
        if (isUniqueViolation(err, 'users_username_key')) {
          throw apiError(409, 'username_taken', 'That username is already in use.');
        }
        if (isUniqueViolation(err, 'users_email_key')) {
          throw apiError(409, 'email_taken', 'That email is already in use.');
        }
        throw err;
      }

      const token = await createSession(userId, {
        userAgent: request.headers['user-agent'],
        ip: clientIp(request),
      });
      setSessionCookie(reply, token);
      clearAttempts(rlKey);

      reply.code(201);
      return { user: { id: userId, username, displayName: trimmedDisplayName, isAdmin: false } };
    },
  );

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { username, password } = request.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string') {
        throw apiError(400, 'invalid_credentials', 'Username and password are required.');
      }

      const rlKey = `login:${username.toLowerCase()}`;
      if (isRateLimited(rlKey, LOGIN_MAX_ATTEMPTS)) {
        throw apiError(429, 'rate_limited', 'Too many attempts for this account. Try again later.');
      }

      const { rows } = await pool.query<{
        id: string;
        username: string;
        display_name: string;
        is_admin: boolean;
        password_hash: string | null;
      }>(
        `SELECT id, username, display_name, is_admin, password_hash FROM users WHERE username = $1`,
        [username],
      );
      const user = rows[0];

      // Always do *a* verify, even for a nonexistent user or an OAuth-only
      // account with no password_hash, so "no such user" and "wrong password"
      // take the same time (auth/password.ts).
      const ok = user?.password_hash
        ? await verifyPassword(user.password_hash, password)
        : await verifyAgainstDummy(password);

      if (!user || !ok) {
        recordAttempt(rlKey, LOGIN_WINDOW_MS);
        throw apiError(401, 'invalid_credentials', 'Incorrect username or password.');
      }

      clearAttempts(rlKey);
      await pool.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);

      const token = await createSession(user.id, {
        userAgent: request.headers['user-agent'],
        ip: clientIp(request),
      });
      setSessionCookie(reply, token);

      return {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          isAdmin: user.is_admin,
        },
      };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(token);
    clearSessionCookie(reply);
    reply.code(204);
  });

  app.get('/api/auth/me', async (request) => {
    const user = await getSessionUser(request);
    if (!user) throw apiError(401, 'unauthenticated', 'Not signed in.');
    return { user };
  });
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string; constraint?: string }).code === '23505' &&
    (err as { constraint?: string }).constraint === constraint
  );
}
