# Backend handoff

**Start here if you're picking up the server.** Written for Chris and whoever/whatever
is pairing with him.

---

## 1. The job

Build `server/` — a Node API over Postgres giving BadRCTycoon accounts, cloud saves
(up to 12 named parks per player), and a leaderboard.

The game currently runs entirely in the browser and saves to `localStorage`. It must
**keep working with no account at all** — signing in adds cloud saves, it is not a
gate. Nothing you build should be able to stop someone playing.

The interface is already specified and the client half is already written against it.
Your job is the server side of a contract that exists, not a greenfield design.

## 2. Start here (about five minutes)

```bash
git clone https://github.com/chrismrobbins/badrctycoon.git
cd badrctycoon
npm install
npx playwright install chromium

npm run dev        # http://localhost:5173 — the game, playable now
npm test           # 54 tests, all passing
npm run typecheck  # clean
```

Requires Node 20+ (developed on 24). If `npm test` is not green on a fresh clone,
stop and say so — everything below assumes that baseline.

## 3. The three documents

| Doc | What it is | When you need it |
|---|---|---|
| **[API-CONTRACT.md](API-CONTRACT.md)** | The spec. Endpoints, payload shapes, concurrency, the validation table. | Constantly. This is the source of truth. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why the client looks like it does, and the reasoning behind the trust model (§5) and save design (§6). | Once, up front. Skim §5 and §6 properly. |
| This file | Orientation, build order, traps. | Now. |

If this file and API-CONTRACT.md ever disagree, **the contract wins** — and please
fix this one.

## 4. Reuse these; do not reimplement them

The cost of every attraction, the rules for what a park is worth, and the save
migration chain all already exist as pure TypeScript. The server imports them.

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

### ⚠ The one real trap

Those modules use extensionless and directory imports (`from '../content'`) because
the client is bundled by Vite. **Plain Node cannot load them:**

```
ERR_UNSUPPORTED_DIR_IMPORT
```

Use a loader that resolves bundler-style. `tsx` is verified working — this exact
probe was run against the real modules:

```
$ npx tsx probe.mts
version      : 8
parkValue    : 10050
parkRating   : 5
reconciles   : true
migrate(v5)  : 99
```

So: `tsx watch src/index.ts` in dev, and `tsup`/`esbuild` to bundle for production.
Do **not** spend an afternoon fighting `node --experimental-strip-types`; it will not
resolve those imports.

## 5. Suggested order

Each step is independently shippable and has a clear finish line.

**1 — Run the schema.**
`server/migrations/001_init.sql` has never touched a live database. Expect to fix
something. It needs the `citext` extension and Postgres 14+.
*Done when:* it applies cleanly to an empty database, twice, from scratch.

**2 — Server skeleton + health check.**
Framework is your call (§7). Wire `tsx watch`, a `pg` Pool, and `GET /api/health`.
*Done when:* it starts, reaches Postgres, and imports one shared module successfully.

**3 — Auth.**
Register, login, logout, me. Argon2id (`@node-rs/argon2`). Sessions are opaque random
tokens in an `httpOnly; Secure; SameSite=Lax` cookie, and the DB stores **only**
`sha256(token)` — a database leak must not be a session leak.
*Done when:* a session survives a restart and a revoked one is rejected.

**4 — Slots, without validation.**
`GET /api/slots`, `GET|PUT|DELETE /api/slots/:slot`. Get the revision compare-and-set
right here (contract §5) — it is the part most likely to be subtly wrong. Do the CAS
in SQL, not in application code.
*Done when:* two concurrent PUTs with the same `baseRevision` produce exactly one
success and one 409.

**5 — Validation.**
The 11-point table in contract §6, using the imported modules. Checks 6, 7 and 10 —
the ledger invariant, park value, and rating — are the load-bearing ones and are all
exact equalities.
*Done when:* a save with `funds` tampered by hand is rejected with
`422 books_do_not_balance`.

**6 — Wire up the client.**
`net/client.ts` and `save/sync.ts` already exist and are tested against a fake server.
Point them at yours. **This is where you find out what the contract got wrong** —
expect at least one ambiguity, and fix the doc when you do.
*Done when:* a park saved in one browser loads in another.

**7 — Leaderboard, beacon, history pruning.**
Note there is deliberately **no score-submission endpoint** — scores are derived
server-side from a validated save. A client that cannot submit a score cannot fake
one.

**8 — `client/src/ui/auth.ts`.**
The login form, slot picker and conflict dialog. The sync engine has no driver
without it. Either side can build this; it is the last thing between "server works"
and "players can use it".

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
- **Save blobs are `jsonb`, capped at 2 MB in the API** — not by a CHECK constraint,
  because `pg_column_size()` is `STABLE` and CHECK needs `IMMUTABLE`.
- **`rating` and `builtValue` are not stored.** They are computed from the map. This
  is what lets you validate them exactly rather than as an upper bound.

## 7. Decisions that are yours

- **Hosting.** Genuinely open, and reversible — it is ordinary Node either way.
  *Azure Database for PostgreSQL Flexible Server + Container Apps* is the
  org-aligned option and costs more. *Neon + Fly.io* is cheapest and fastest to
  stand up, with Postgres that scales to zero and branch-per-PR. Pick what you want
  to operate.
- **Framework.** Fastify, Express, Hono — no strong opinion. Fastify has the better
  schema-validation story for the 11 checks.
- **Migration tooling.** The SQL is hand-written and numbered. Adopt something
  (`node-pg-migrate`, `dbmate`) or keep it manual.
- **Session length.** The schema has `expires_at`; 30 days matches what the arcade
  did.
- **Slot count.** Currently capped at 12 by a CHECK constraint.

## 8. Repo conventions

- **Same repo, `server/` directory.** Branch and open a PR rather than pushing
  `main` — Beau is still working in `client/`.
- **TypeScript is deliberately loose** (`strict: false`) because the ported monolith
  had to compile on day one. `server/` is new code with no such excuse — turn strict
  on for it.
- **Commit messages explain *why*.** Look at `git log` for the register. If you fix
  something the docs got wrong, say so in the message.
- **A save-format change means a migration.** Bump `SAVE_VERSION` in
  `core/state.ts` and add a block to the ladder in `save/migrations.ts`. **A
  migration never rejects** — it upgrades or fills a default. The original code
  rejected any save that wasn't exactly v5 and destroyed the player's park doing it;
  `tests/save.spec.ts` exists to stop that recurring.
- Keep `npm test` green. If a test is wrong, fix the test and say why in the commit.

## 9. A starting prompt

Something like this, pasted into a fresh Claude Code session in the repo root:

> I'm building the backend for this game. Read `docs/BACKEND-HANDOFF.md` first, then
> `docs/API-CONTRACT.md` — that's the spec I'm implementing, and it was written
> before the server existed, so flag anything ambiguous or wrong rather than guessing.
>
> The client is done and its pure modules (`core/state`, `content/`, `sim/park`,
> `sim/finance`, `save/migrations`) are meant to be imported by the server rather
> than reimplemented — `tests/portability.spec.ts` shows how, and note the
> `ERR_UNSUPPORTED_DIR_IMPORT` trap documented in the handoff.
>
> Start with step 1: get `server/migrations/001_init.sql` applying cleanly to a local
> Postgres. It has never been run. Then we'll do the server skeleton.

## 10. Questions to send back

If any of these are wrong, the handoff is wrong:

- Is Postgres 14+ what you'll actually deploy against?
- Do you want the leaderboard public, or accounts-only?
- Should `GET /api/slots/:slot` return the blob, or would you rather it were a
  separate endpoint so the slot list and the load are clearly different costs?
- Anything in the validation table (contract §6) you think is impractical?
