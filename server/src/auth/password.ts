/** Argon2id, not PBKDF2 (docs/API-CONTRACT.md §3: the arcade used PBKDF2 only
 *  because Workers crypto offered nothing better; on Node there is no reason to). */

import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password);
}

/**
 * A hash of a password nobody will ever type, spent on every login for a
 * username that doesn't exist (or has no password_hash -- an OAuth-only
 * account). Without this, "no such user" returns faster than "wrong password"
 * and the gap is a username-enumeration oracle.
 */
const DUMMY_HASH = await hashPassword('this-costs-the-same-as-a-real-check');

export function verifyAgainstDummy(password: string): Promise<boolean> {
  return verifyPassword(DUMMY_HASH, password);
}
