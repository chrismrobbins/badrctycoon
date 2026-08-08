/**
 * Per-username rate limiting for login and registration.
 *
 * docs/API-CONTRACT.md §3: "Rate-limit register and login per IP and per
 * username." The IP half is @fastify/rate-limit, registered per-route in
 * routes/auth.ts. This is the username half: an attacker spreading a
 * credential-stuffing run across many IPs still hits the same username, and
 * @fastify/rate-limit's default per-IP keying would never see that pattern.
 *
 * In-memory, so it resets on restart and does not share state across
 * instances -- fine for a single Node process. If this ever runs behind a
 * load balancer with more than one instance, move the counters to Postgres or
 * Redis; the interface below would not need to change.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Sweep occasionally so `windows` doesn't grow unboundedly over a long-lived
// process. Not on every call -- that would defeat the point of an O(1) check.
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

/** True if `key` has already hit `max` attempts within its current window. */
export function isRateLimited(key: string, max: number): boolean {
  const w = windows.get(key);
  return w !== undefined && w.resetAt > Date.now() && w.count >= max;
}

/** Call once per real attempt (after the isRateLimited check passes). */
export function recordAttempt(key: string, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  w.count += 1;
}

/** On success, forgive the window so a legitimate user isn't punished for
 *  earlier typos. */
export function clearAttempts(key: string): void {
  windows.delete(key);
}
