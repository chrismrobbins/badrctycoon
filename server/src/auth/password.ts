/**
 * Argon2id via argon2-wasm-edge, not @node-rs/argon2.
 *
 * @node-rs/argon2 is a native (napi-rs) binary -- it cannot load in a
 * Workers isolate, which has no native-addon support even under
 * nodejs_compat (that flag shims Node *APIs*, not arbitrary compiled
 * binaries).
 *
 * The first WASM library tried here (hash-wasm) doesn't work on Workers
 * either, for a different reason: it calls `WebAssembly.compile()` on a
 * bundled byte buffer at runtime, and Workers' isolate disallows dynamic
 * WASM codegen the same way a strict CSP disallows `eval` --
 * confirmed by actually running it, not just reading about it (see the PR
 * this landed in). argon2-wasm-edge solves that by using Wrangler's
 * *static* `.wasm` import support (worker.ts's `import ... from
 * '.../argon2.wasm'` below) -- the module is compiled once at deploy time,
 * not synthesized from bytes on every cold start.
 *
 * Staying on Argon2id rather than falling back to PBKDF2 matters here
 * specifically because docs/API-CONTRACT.md already explains why PBKDF2 was
 * the arcade's compromise: "the arcade used PBKDF2 only because Workers
 * crypto offered nothing better." Now that this really is Workers, a WASM
 * Argon2id means that compromise still doesn't have to be made.
 */

import { argon2id, argon2Verify, setWASMModules } from 'argon2-wasm-edge';
// @ts-expect-error -- no ambient type for a .wasm import; Wrangler's bundler
// resolves this to a precompiled WebAssembly.Module, matching setWASMModules'
// declared parameter type.
import argon2WASM from 'argon2-wasm-edge/wasm/argon2.wasm';
// @ts-expect-error -- see above.
import blake2bWASM from 'argon2-wasm-edge/wasm/blake2b.wasm';

// OWASP's current Argon2id baseline: m=19MiB, t=2, p=1. Workers' CPU-time
// budget is the binding constraint here (10ms free tier, up to 30ms+ paid),
// not the security ceiling -- this is deliberately modest compared to what
// @node-rs/argon2's defaults used on Node, where CPU time was never billed
// per-request.
const MEMORY_SIZE_KIB = 19 * 1024;
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

let ready: Promise<void> | undefined;
function ensureReady(): Promise<void> {
  ready ??= setWASMModules({ argon2WASM, blake2bWASM });
  return ready;
}

export async function hashPassword(password: string): Promise<string> {
  await ensureReady();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return argon2id({
    password,
    salt,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    memorySize: MEMORY_SIZE_KIB,
    hashLength: HASH_LENGTH,
    outputType: 'encoded', // PHC string ($argon2id$v=19$m=...,t=...,p=...$salt$hash) -- self-describing, like @node-rs/argon2's hash()
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  await ensureReady();
  return argon2Verify({ hash, password });
}

/**
 * A hash of a password nobody will ever type, spent on every login for a
 * username that doesn't exist (or has no password_hash -- an OAuth-only
 * account). Without this, "no such user" returns faster than "wrong
 * password" and the gap is a username-enumeration oracle.
 *
 * Computed lazily and cached rather than at module scope: Workers don't run
 * top-level await the way Node does, and there's no benefit to paying the
 * hash cost before the first request that actually needs it.
 */
let dummyHash: Promise<string> | undefined;

export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('this-costs-the-same-as-a-real-check');
  return dummyHash.then((hash) => verifyPassword(hash, password));
}
