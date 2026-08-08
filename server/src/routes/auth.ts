import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../types';
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
import { apiError } from '../errors';

// Mirrors the CHECK constraint in server/migrations/001_init.sql so a bad
// username is a 400 with a useful message, not a raw constraint violation
// (docs/API-CONTRACT.md §3).
const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;
const DISPLAY_NAME_MAX = 40;
// Not in the contract -- our call. 8 chars is a floor, not a strength meter.
const PASSWORD_MIN = 8;

const LOGIN_WINDOW_S = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
const REGISTER_WINDOW_S = 60 * 60;
const REGISTER_MAX_ATTEMPTS = 5;

export const authRoutes = new Hono<AppEnv>();

/** Cloudflare's documented client-IP header for Workers -- there is no raw
 *  socket to read the way Fastify's request.ip did on Node. */
function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

async function readJsonBody<T>(c: { req: { json(): Promise<unknown> } }): Promise<T> {
  try {
    return ((await c.req.json()) ?? {}) as T;
  } catch {
    return {} as T;
  }
}

interface RegisterBody {
  username?: string;
  password?: string;
  displayName?: string;
  email?: string;
}

authRoutes.post('/api/auth/register', async (c) => {
  const ip = clientIp(c);
  const { success } = await c.env.RL_AUTH_IP.limit({ key: `register:${ip}` });
  if (!success) throw apiError(429, 'rate_limited', 'Too many requests. Try again shortly.');

  const { username, password, displayName, email } = await readJsonBody<RegisterBody>(c);

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
  if (await isRateLimited(c.env.AUTH_ATTEMPTS, rlKey, REGISTER_MAX_ATTEMPTS)) {
    throw apiError(429, 'rate_limited', 'Too many attempts for this username. Try again later.');
  }
  await recordAttempt(c.env.AUTH_ATTEMPTS, rlKey, REGISTER_WINDOW_S);

  const passwordHash = await hashPassword(password);
  const db = c.get('db');

  let userId: string;
  try {
    const { rows } = await db.query<{ id: string }>(
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

  const token = await createSession(db, userId, { userAgent: c.req.header('user-agent'), ip });
  setSessionCookie(c, token);
  await clearAttempts(c.env.AUTH_ATTEMPTS, rlKey);

  return c.json(
    { user: { id: userId, username, displayName: trimmedDisplayName, isAdmin: false } },
    201,
  );
});

interface LoginBody {
  username?: string;
  password?: string;
}

authRoutes.post('/api/auth/login', async (c) => {
  const ip = clientIp(c);
  const { success } = await c.env.RL_AUTH_IP.limit({ key: `login:${ip}` });
  if (!success) throw apiError(429, 'rate_limited', 'Too many requests. Try again shortly.');

  const { username, password } = await readJsonBody<LoginBody>(c);
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw apiError(400, 'invalid_credentials', 'Username and password are required.');
  }

  const rlKey = `login:${username.toLowerCase()}`;
  if (await isRateLimited(c.env.AUTH_ATTEMPTS, rlKey, LOGIN_MAX_ATTEMPTS)) {
    throw apiError(429, 'rate_limited', 'Too many attempts for this account. Try again later.');
  }

  const db = c.get('db');
  const { rows } = await db.query<{
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
    await recordAttempt(c.env.AUTH_ATTEMPTS, rlKey, LOGIN_WINDOW_S);
    throw apiError(401, 'invalid_credentials', 'Incorrect username or password.');
  }

  await clearAttempts(c.env.AUTH_ATTEMPTS, rlKey);
  await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);

  const token = await createSession(db, user.id, { userAgent: c.req.header('user-agent'), ip });
  setSessionCookie(c, token);

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      isAdmin: user.is_admin,
    },
  });
});

authRoutes.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await revokeSession(c.get('db'), token);
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.get('/api/auth/me', async (c) => {
  const user = await getSessionUser(c);
  if (!user) throw apiError(401, 'unauthenticated', 'Not signed in.');
  return c.json({ user });
});

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string; constraint?: string }).code === '23505' &&
    (err as { constraint?: string }).constraint === constraint
  );
}
