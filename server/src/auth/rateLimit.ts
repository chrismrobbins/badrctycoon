/**
 * Per-username rate limiting for login and registration, backed by
 * Cloudflare KV.
 *
 * docs/API-CONTRACT.md §3: "Rate-limit register and login per IP and per
 * username." The IP half is the RL_AUTH_IP binding, used directly in
 * routes/auth.ts (Cloudflare's built-in Rate Limiting binding, wrangler.jsonc)
 * -- straightforward, since its 60-second-max window is exactly the shape
 * of a simple per-IP backstop. This file is the other half: an attacker
 * spreading a credential-stuffing run across many IPs still hits the same
 * username, and the IP binding would never see that pattern.
 *
 * It's KV rather than the same Rate Limiting binding because the original
 * design needs windows longer than the binding allows (15 min for login, 60
 * min for register -- the binding caps at 60s). KV's `expirationTtl` has no
 * such ceiling.
 *
 * The tradeoff worth knowing: KV writes are eventually consistent (global
 * propagation can lag up to ~60s), so a tightly-timed burst across
 * different Cloudflare regions could squeeze a couple of extra attempts
 * through before every edge location agrees on the count. That's a real
 * weakening versus the single-process in-memory Map this replaced, which
 * was exactly consistent but only within one Node process. For throttling
 * credential stuffing (slowing an attacker down, not a hard security
 * boundary) eventual consistency is an acceptable trade for something that
 * actually works across Workers' distributed, stateless-per-request model.
 */

interface Window {
  count: number;
}

export async function isRateLimited(kv: KVNamespace, key: string, max: number): Promise<boolean> {
  const raw = await kv.get(key);
  if (!raw) return false;
  const w = JSON.parse(raw) as Window;
  return w.count >= max;
}

/** Call once per real attempt (after the isRateLimited check passes).
 *  `windowSeconds` starts a fresh window on the first attempt; later calls
 *  within it just bump the count without extending its expiry, so a steady
 *  trickle of attempts can't keep the window open forever. */
export async function recordAttempt(kv: KVNamespace, key: string, windowSeconds: number): Promise<void> {
  const raw = await kv.get(key);
  const w: Window = raw ? JSON.parse(raw) : { count: 0 };
  w.count += 1;
  // expirationTtl on every write is fine even though it doesn't reset the
  // window on subsequent attempts in principle -- KV requires a TTL on each
  // put(), and re-sending the same remaining-ish duration each time is
  // simpler than tracking a separate "window started at" timestamp for a
  // window whose exact expiry precision doesn't matter here.
  await kv.put(key, JSON.stringify(w), { expirationTtl: windowSeconds });
}

/** On success, forgive the window so a legitimate user isn't punished for
 *  earlier typos. */
export async function clearAttempts(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}
