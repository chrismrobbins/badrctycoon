# API Contract — backend handoff

For whoever builds `server/`. The client side of phases 0–5 is done and committed;
this is what it expects from the API, and what the API must not take on trust.

Read [ARCHITECTURE.md](ARCHITECTURE.md) §5–§6 first for the reasoning. This
document is the interface.

---

## 1. What already exists

| Thing | Where | State |
|---|---|---|
| Postgres schema | [`server/migrations/001_init.sql`](../server/migrations/001_init.sql) | Written, **not run against a live database yet** |
| Save format | `client/src/core/state.ts` → `GameState` | Done, versioned, migrating |
| Migration chain | `client/src/save/migrations.ts` | Done |
| Ledger invariant | `client/src/sim/finance.ts` | Done |
| Content registry | `client/src/content/` | Done |
| HTTP client / sync | — | **Not built.** Client is localStorage-only |
| Auth UI | — | **Not built** |

The schema has never been executed. Expect to fix something on first `psql -f`.

## 2. Modules the server can import

These are pure, DOM-free, and Node-importable. `tests/portability.spec.ts` runs in
Node with no DOM and fails if anyone breaks that, so it is safe to depend on:

```ts
client/src/core/state.ts        // GameState, SAVE_VERSION, STARTING_FUNDS, emptyLedger
client/src/content/             // BUILD_DATA, RIDE_TYPES, costs, ratings, footprints
client/src/sim/finance.ts       // expectedFunds(), ledgerReconciles()
client/src/sim/park.ts          // builtValue(), parkValue(), parkRating()
client/src/content/awards.ts    // award ids and their rating values
client/src/save/migrations.ts   // migrate()
```

**Not** importable: `client/src/save/schema.ts` touches `localStorage` (inside
function bodies only — importing is fine, calling `loadFromLocalStorage` is not),
and `client/src/main.ts` is the browser app.

Reuse these rather than reimplementing. A second copy of the cost table on the
server is exactly the class of duplication phase 3 removed.

## 3. Endpoints

All JSON. All under `/api`. Session is an `httpOnly; Secure; SameSite=Lax` cookie.

### Auth

```
POST   /api/auth/register   { username, password, displayName?, email? }  -> 201 { user }
POST   /api/auth/login      { username, password }                        -> 200 { user }
POST   /api/auth/logout                                                   -> 204
GET    /api/auth/me                                                       -> 200 { user } | 401
```

`user` is `{ id, username, displayName, isAdmin }`. Never return `password_hash`.

- **Argon2id**, not PBKDF2. The arcade used PBKDF2 only because Workers crypto
  offered nothing better; on Node there is no reason to.
- Store `sha256(token)` in `sessions.token_hash`, never the token. A database
  leak must not be a session leak.
- Rate-limit register and login per IP **and** per username.
- Username rules are already enforced by a CHECK constraint:
  `^[A-Za-z0-9_-]{3,24}$`. Mirror them in the API so the error is a 400 with a
  useful message rather than a constraint violation.

### Saves

```
GET    /api/slots              -> 200 { slots: SlotMeta[] }
GET    /api/slots/:slot        -> 200 { meta: SlotMeta, state: GameState }
PUT    /api/slots/:slot        -> 200 { meta: SlotMeta } | 409 | 400
DELETE /api/slots/:slot        -> 204
```

**A "slot" is a saved park.** Each user gets up to 12, each with its own name,
blob, headline stats, revision and history — that is the save/load-game feature.
`slot` is `1..12`, enforced by `save_slots_slot_range`.

Not to be confused with the `game_id` an earlier draft carried: that was for
several *different titles* sharing one login (the arcade), and came out because
this game is standalone. It never had anything to do with how many parks a player
can keep.

```ts
interface SlotMeta {
  slot: number;          // 1..12
  parkName: string;
  saveVersion: number;
  day: number;
  funds: number;
  parkValue: number;
  rating: number;
  guests: number;
  playtimeMs: number;
  revision: number;      // optimistic concurrency token
  updatedAt: string;     // ISO 8601
}
```

`GET /api/slots` must **not** read `save_blobs`. That is why those columns are
denormalised onto `save_slots`; the load screen and leaderboard should never
parse a 200 KB blob.

**PUT body:**

```ts
{
  parkName: string;      // 1..48 chars
  playtimeMs: number;
  baseRevision: number;  // the revision the client edited from; 0 for a new slot
  state: GameState;      // the whole save; see §4
}
```

### Leaderboard

```
GET /api/leaderboard?metric=park_value&limit=50
```

Metrics: `park_value`, `guests_peak`, `day_reached`.

**There is deliberately no score-submission endpoint.** Scores are derived
server-side from a validated save on PUT and upserted into `scores` only when the
new value beats the stored one. A client that cannot submit a score directly
cannot fake one directly.

## 4. The save blob

`state` is exactly what `JSON.stringify(gameState)` produces — the same bytes the
client writes to localStorage today. It goes into `save_blobs.state` as `jsonb`.

Do not reshape it on the way in. If the format needs to change, add a migration to
`client/src/save/migrations.ts` and bump `SAVE_VERSION`; both sides then agree.

Expected size is 100–200 KB for a full 35×35 park with guests. **Reject over 2 MB**
(`MAX_SAVE_BYTES` in `save/schema.ts`) at the API — the CHECK constraint that used
to enforce this was removed because `pg_column_size()` is `STABLE` and Postgres
only accepts `IMMUTABLE` expressions in CHECK.

## 5. Concurrency

Every slot carries an integer `revision`, incremented by the server on each
successful write.

1. Client sends the `baseRevision` it edited from.
2. If `baseRevision !== slots.revision`, respond **409** with the current
   `SlotMeta` in the body. Do not write.
3. The client shows a conflict prompt — "this park was also saved on another
   device, Day 42, 3 minutes ago" — and the player picks.

**Never last-write-wins silently.** Two browser tabs are enough to lose a park.

Do the compare-and-set in SQL so it is atomic:

```sql
UPDATE save_slots SET revision = revision + 1, ...
 WHERE id = $1 AND revision = $2
RETURNING revision;
```

Zero rows returned means conflict.

Also write the previous blob to `save_history` on each successful PUT, and prune
to the most recent N per slot on a schedule (not in a trigger).

## 6. Validation — what not to trust

We chose **trust model B**: validate invariants on write. See ARCHITECTURE §5.
Every number below arrives from a browser and none of it is trustworthy.

Run these on PUT, in order, before touching the database:

| # | Check | On failure |
|---|---|---|
| 1 | Body ≤ 2 MB | `413` |
| 2 | `migrate(state)` returns non-null | `400 invalid_save` |
| 3 | `state.version <= SAVE_VERSION` | `400 save_from_newer_client` |
| 4 | `gridSize` ∈ {15, 19, 23, 27, 31, 35}; `map` dimensions match `gridSize` | `400` |
| 5 | Every non-null map cell is a known id (`BUILD_DATA`) or `'entrance'` | `400` |
| 6 | `ledgerReconciles(state)` — `funds === 10000 + Σincome − Σexpense` | `422 books_do_not_balance` |
| 7 | `parkValue === parkValue(state)` from `sim/park.ts` | `422` |
| 8 | `day >= stored.day` (monotonic per slot) | `422 time_travel` |
| 9 | `playtimeMs >= stored.playtimeMs`, and `day` plausible against it | `422` |
| 10 | `rating === parkRating(state)` from `sim/park.ts` | `422` |
| 11 | `parkName` and every value in `state.rideNames` ≤ 48 / 28 chars, control characters stripped | `400` |

Checks 6 and 7 are the load-bearing ones: together they mean funds and park value
have to be *consistent with the park you built*, not merely asserted.

`tests/portability.spec.ts` exercises checks 6, 7 and 10 against the real modules,
including the multi-tile and gate cases — start from there.

**On checks 7 and 10:** as of save v8, `rating` and `builtValue` are no longer
stored at all. They are computed from the map by `sim/park.ts` — import
`parkValue()` and `parkRating()` and compare against the `SlotMeta` the client
sent. Exact equality, no tolerance needed. `sim/park.ts` already folds multi-tile
structures back to their anchor so a 2×2 ride counts once, and skips the gate.

An earlier version of this document said check 10 could only be an upper bound,
because `rating` was an accumulator that awards also wrote to. That is fixed.

**Ride names are user input.** They are safe in the client today — every render
path uses `textContent`, `.value` or canvas — but a leaderboard puts *another
user's* park name in the DOM, which crosses the line. Sanitise on write and have
the client render with `textContent`, never `innerHTML`.

## 7. Errors

```json
{ "error": { "code": "books_do_not_balance", "message": "funds do not follow from the ledger" } }
```

Stable machine-readable `code`; `message` is for humans and may change. Use
`400` for malformed input, `401` unauthenticated, `403` not yours, `404` missing,
`409` revision conflict, `413` too large, `422` failed a game invariant,
`429` rate limited.

## 8. What the client still needs

Not built — whoever does the backend should expect to add these, or hand back a
spec for them:

- `client/src/net/client.ts` — fetch wrapper, credentials, error mapping
- `client/src/save/sync.ts` — local-first: keep autosaving to IndexedDB, push on
  manual save, on `visibilitychange → hidden` via `sendBeacon`, and every 60 s
  while dirty
- `client/src/ui/auth.ts` — login/register, slot picker, the 409 conflict prompt

The game must stay fully playable logged out. Accounts add cloud saves; they are
not a gate.

## 9. Decisions still open

- **Hosting.** Azure Database for PostgreSQL Flexible Server + Container Apps is
  the org-aligned answer; Neon + Fly is the cheap one. Either way the API is
  ordinary Node, so it is reversible.
- **Slot count.** Schema currently caps at 12 (`save_slots_slot_range`).
- **Guest persistence.** Guests are in the blob from v6 and are most of its size.
  If blobs get uncomfortable, dropping them is a migration, not a redesign.
- **A second title sharing these accounts.** Not planned -- the game is
  standalone. If it ever happens, adding `game_id` back to save_slots, scores and
  achievements is a ~10-line migration with a constant default.
