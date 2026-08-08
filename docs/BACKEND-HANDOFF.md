# Backend handoff

**Done, and live at badrctycoon.com.** This file was "start here if you're picking
up the server"; it's now "how it was built, how it actually runs, and what to know
before touching it again." Written for Chris and whoever/whatever is pairing with
him.

---

## 1. What got built

`server/` is a Cloudflare Workers API (Hono) over Postgres (Supabase, via
Hyperdrive), giving BadRCTycoon accounts, cloud saves (up to 12 named parks per
player), and a leaderboard.

The game still runs entirely in the browser and saves to `localStorage` first. It
kept working with no account at all through the whole build — signing in adds cloud
saves, it was never a gate.

The interface was specified before the server existed
([API-CONTRACT.md](API-CONTRACT.md)); the server was built against that contract,
and the contract survived contact with a real implementation with only minor
amendments — see that document's own notes on where.

## 2. Start here (about five minutes)

```bash
git clone https://github.com/chrismrobbins/badrctycoon.git
cd badrctycoon
npm install
npx playwright install chromium

npm run dev         # http://localhost:5173 — the game, playable now, no backend needed
npm test            # green with no backend running; more tests run (and pass) if one is
npm run typecheck   # clean
```

For the backend itself:

```bash
npm run worker:dev   # wrangler dev — runs the whole API + serves the built client, one origin
npm run deploy       # builds the client, then wrangler deploy
```

`wrangler dev` needs something it can reach as Postgres. Point it at a local one
without touching `wrangler.jsonc`:

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://user:pass@localhost:5432/dbname"
npm run worker:dev
```

Requires Node 20+ (developed on 24). If `npm test` is not green on a fresh clone —
green meaning some tests may *skip* (no local backend running), never *fail* — stop
and say so.

## 3. The three documents

| Doc | What it is | When you need it |
|---|---|---|
| **[API-CONTRACT.md](API-CONTRACT.md)** | The spec. Endpoints, payload shapes, concurrency, the validation table. | Constantly. This is the source of truth. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why the client looks like it does, and the reasoning behind the trust model (§5) and save design (§6). | Once, up front. Skim §5 and §6 properly. |
| This file | Orientation, what was built and why, traps. | Now. |

If this file and API-CONTRACT.md ever disagree, **the contract wins** — and please
fix this one.

## 4. Reuse these; do not reimplement them

The cost of every attraction, the rules for what a park is worth, and the save
migration chain all already exist as pure TypeScript. The server imports them —
proven not just Node-importable but actually imported at the edge, in production,
under `nodejs_compat`, which turned out to be the harder claim.

```ts
client/src/core/state.ts        // GameState, SAVE_VERSION, STARTING_FUNDS, emptyLedger
client/src/content/             // BUILD_DATA, RIDE_TYPES — costs, ratings, footprints
client/src/content/awards.ts    // award ids and their rating values
client/src/sim/park.ts          // builtValue(), parkValue(), parkRating()
client/src/sim/finance.ts       // expectedFunds(), ledgerReconciles()
client/src/save/migrations.ts   // migrate()
```

A second copy of the cost table living on the server, drifting from the client's, is
precisely the failure mode the content registry was built to eliminate. Don't
recreate it.

`tests/portability.spec.ts` runs in Node with no DOM, imports all of the above, and
fails if anyone gives them a browser dependency. It is your safety net — keep it
passing.

### ⚠ Two real traps, both found by running the thing, not reading about it

**Native code and dynamically-compiled WASM don't run in a Workers isolate.**
`@node-rs/argon2` (a native napi-rs binary) is a non-starter under Workers
regardless of `nodejs_compat` — that flag shims Node *APIs*, not arbitrary compiled
binaries. The first WASM fallback tried (`hash-wasm`) looked like the fix and
wasn't: it calls `WebAssembly.compile()` on a bundled byte buffer at *runtime*, and
Workers' isolate disallows dynamic WASM codegen the same way a strict CSP disallows
`eval`. Confirmed by actually deploying it and reading the error, not by reading
docs:

```
CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder
```

`argon2-wasm-edge` (`server/src/auth/password.ts`) is what actually works — it uses
Wrangler's *static* `.wasm` import support (`import argon2WASM from
'argon2-wasm-edge/wasm/argon2.wasm'`), compiled once at deploy time instead of
synthesized from bytes on every cold start. If a future dependency needs WASM,
check for this exact pattern before assuming it'll just work.

**Supabase's direct Postgres connection is IPv6-only on the free tier, and your
machine might not be able to reach it even though Cloudflare can.** `wrangler
hyperdrive create` and the deployed Worker connect fine — Cloudflare's own
infrastructure has full IPv6 egress — but a plain local `psql` to the same
connection string can fail with `No route to host` on a network without IPv6
egress. Don't burn time debugging that as a credentials problem. For one-time DDL
(running a migration), Supabase's own SQL Editor sidesteps it entirely; for
anything that needs to run repeatedly from a machine without IPv6, Supabase's
Session Pooler is the IPv4-compatible fallback — not the Transaction pooler, which
doesn't support prepared statements, and `pg` relies on those.

## 5. What was built, in order

Each step below shipped independently, in this order. Kept for whoever needs to
understand *why* something is shaped the way it is, or has to touch one piece
without breaking the others.

**1 — Schema.** `server/migrations/001_init.sql` had never touched a live database
when this started. Applied cleanly to an empty DB, twice, from scratch, then for
real against Supabase via its SQL Editor (see the IPv6 trap above for why not
directly).

**2 — Server skeleton + health check.** Hono, not Fastify (§6) — Fastify doesn't
run on Workers at all; it's built on Node's `http.Server`, and Workers respond to
`fetch`, not a listening socket. `GET /api/health` reaches Postgres (via
Hyperdrive) and imports a shared client module — both proven before anything else
was built on top.

**3 — Auth.** Register, login, logout, me. Argon2id, though see the trap above for
what that actually took on Workers. Sessions are opaque random tokens in an
`httpOnly; Secure; SameSite=Lax` cookie (`Secure` derived from the actual request
protocol, not an env flag — matters for `wrangler dev` over plain http); the DB
stores only `sha256(token)`.

**4 — Slots, without validation.** The CAS (contract §5) turned out to be exactly
as easy to get subtly wrong as advertised, though the implementation held up:
proven with a genuinely concurrent two-request race against the same slot, not
just sequential calls — one 200, one 409, every time.

**5 — Validation.** The 11-point table (contract §6). One fixture per check, run
against a live database. Found and fixed a real ambiguity in checks 7/10 doing
this — see API-CONTRACT.md §6's note on it.

**6 — Wired up the client.** `tests/server-integration.spec.ts` points the real
`net/client.ts` / `save/sync.ts` at a real server. This is exactly where the
contract's promised ambiguity showed up (checks 7/10), and separately where
`createGameState()` not being what a real client actually saves (the map starts as
`[]`) turned up too.

**7 — Leaderboard, beacon, history pruning.** Leaderboard is public — see §10, this
was one of the open questions, now answered. `save_history` pruning is a Cron
Trigger (hourly), not the `setInterval` an ordinary Node server would use — Workers
don't stay alive between requests, so nothing would ever have fired.

**8 — `client/src/ui/auth.ts`.** Login form, slot picker, conflict dialog. Found
three real bugs by testing the actual UI in real browsers rather than trusting the
design: `net/client.ts`'s `me()` rethrowing on a network failure and crashing the
whole game boot when the backend was unreachable; the slot picker not refreshing
after creating a new slot; and a genuinely interesting one — a second device
attaching to a slot another device had played for hours would look like it was
time-traveling on its first save, since playtime was tracked purely per-device. All
three fixed; see `client/src/save/playtime.ts` and `server/src/routes/slots.ts` for
the actual reasoning, and `tests/ui-auth.spec.ts`'s two-real-browser-context test
for how the third one was even findable.

**9 — Moved to Cloudflare Workers.** Not one of the original 8 steps — everything
through step 8 assumed an ordinary Node host. Chris wanted the site live and free;
Cloudflare Workers + Hyperdrive + Supabase's free tiers get there at $0/month, but
Fastify, `@node-rs/argon2`, and the in-memory rate limiter all needed real
replacements, not config changes (§6, and the traps above).

## 6. Decisions already made

Please don't re-litigate these without a reason — the reasoning is in
ARCHITECTURE.md and some of it is non-obvious.

- **Trust model B: validate invariants on write.** Not a dumb blob store, not
  server-authoritative replay. Contract §6 and ARCHITECTURE §5.
- **No score-submission endpoint.** Removes a whole cheating surface.
- **Never last-write-wins.** A 409 must reach the player with both versions
  described. Two browser tabs are enough to lose a park.
- **The beacon endpoint answers 204 unconditionally**, including on conflict. The
  page is usually gone before a response lands.
- **Single-game.** An earlier draft carried a `games` table and `game_id` everywhere
  for an arcade that this game is not joining. A "slot" is a saved *park*; the two
  were easy to confuse. If a second title ever shares these accounts, adding
  `game_id` back is a ten-line migration with a constant default.
- **Save blobs are `jsonb`, capped at 2 MB at the API** — Hono's `bodyLimit`
  middleware, not a CHECK constraint, because `pg_column_size()` is `STABLE` and
  CHECK needs `IMMUTABLE`.
- **`rating` and `builtValue` are not stored.** They are computed from the map. This
  is what lets the server validate them exactly rather than as an upper bound.
- **Framework: Hono, on Cloudflare Workers.** Not Fastify — doesn't run there at
  all (§5 step 2). Not Express, for the same reason: also shaped around Node's
  `http` module.
- **Hosting: Cloudflare Workers + Hyperdrive + Supabase.** Free at this scale.
  Moved here from "decisions that are yours" below — it's decided and live.
- **Rate limiting is two mechanisms, not one.** Cloudflare's built-in Rate
  Limiting binding for the per-IP backstop (its window caps at 60 seconds);
  Cloudflare KV for the per-username 15/60-minute windows the built-in binding
  can't express. KV is eventually consistent (~60s global propagation) — an
  accepted tradeoff for throttling, not treated as a hard security boundary.
  `server/src/auth/rateLimit.ts` has the full reasoning.
- **One `pg.Client` per request, not a `Pool`.** Hyperdrive already pools on
  Cloudflare's side; a fresh `Client` per request, closed via `ctx.waitUntil()`
  after the response, is Cloudflare's documented pattern for Workers.
- **Session length: 30 days.**
- **Slot count: 12**, via a CHECK constraint.

## 7. Decisions that are yours

Much shorter than it used to be — most of what was open here got decided by
necessity once the Workers move happened.

- **Migration tooling.** Still hand-written, numbered SQL, applied manually (via
  Supabase's SQL Editor for now, since IPv6 blocks `psql` from most local
  machines — see the trap above). Adopting something (`node-pg-migrate`, `dbmate`)
  is still open.
- **`www.badrctycoon.com`.** Optional — only the root domain has a Custom Domain
  attached as of this writing. Same two-click process in the Worker's Domains tab
  if wanted.
- **Multiple Worker instances / scaling past the free tier.** The KV-based rate
  limiter and the Cron-triggered pruning job are both written assuming they don't
  need to coordinate across instances. Fine at hobby scale; worth a look if this
  ever needs more than Cloudflare's free tier provides.

## 8. Repo conventions

- **Same repo, `server/` directory, plus `wrangler.jsonc` at the root.** Branch and
  open a PR rather than pushing `main` — Beau is still working in `client/`.
- **TypeScript is deliberately loose** (`strict: false`) in the root config,
  because the ported monolith had to compile on day one. `server/tsconfig.json`
  turns strict on for everything under `server/src` — including the shared client
  modules it pulls in, which already pass cleanly.
- **Commit messages explain *why*.** Look at `git log` for the register. If you fix
  something the docs got wrong, say so in the message.
- **A save-format change means a migration.** Bump `SAVE_VERSION` in
  `core/state.ts` and add a block to the ladder in `save/migrations.ts`. **A
  migration never rejects** — it upgrades or fills a default. The original code
  rejected any save that wasn't exactly v5 and destroyed the player's park doing it;
  `tests/save.spec.ts` exists to stop that recurring.
- **Keep `npm test` green in both states** — with no backend running (the
  server-dependent cases in `tests/server-integration.spec.ts` and
  `tests/ui-auth.spec.ts` skip cleanly, everything else passes) and with one
  running via `npm run worker:dev` (everything passes, nothing skips). If a test
  is wrong, fix the test and say why in the commit.

## 9. If you're the next person touching this

The 8-step build order (§5) and the starting prompt that used to live here did
their job — the server's built. What's actually left, if anyone picks this up
next:

- `www.badrctycoon.com` (§7).
- Migration tooling (§7), if hand-run SQL ever gets uncomfortable.
- `ARCHITECTURE.md` hasn't had the same docs pass this file and API-CONTRACT.md
  just got — it may still describe an ordinary-Node assumption in places.
- Whatever's actually next for the game itself. This file was always about the
  backend, and the backend is done.

## 10. Questions sent back, and their answers

These used to be open. Answers, for the record:

- **Is Postgres 14+ what you'll actually deploy against?** Moot — ended up on
  Supabase's managed Postgres rather than a self-hosted version choice.
- **Do you want the leaderboard public, or accounts-only?** Public. Confirmed
  directly rather than guessed — no auth on `GET /api/leaderboard`.
- **Should `GET /api/slots/:slot` return the blob, or a separate endpoint?** Kept
  as specified — one endpoint returns both `meta` and `state` together. Never came
  up as a real cost problem in practice.
- **Anything in the validation table impractical?** No — all 11 checks shipped as
  specified. The one real subtlety found: checks 8/9 (day/playtime monotonic) need
  to be skipped when the request is already stale on revision, or a client that's
  merely out of date gets a confusing 422 instead of the 409 that's actually
  happening. Documented in `server/src/routes/slots.ts`.
