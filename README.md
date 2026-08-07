# Bad RC Tycoon

An isometric theme-park management game — currently a single 3.9k-line HTML file, being taken
apart into a modular client with a Postgres-backed API, accounts, and cloud saves.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build
npm test           # Playwright smoke suite
```

## Status

**Phases 0–3 and 5 done; phase 4 partial.** Typecheck clean, 40 tests passing.

| Phase | | |
|---|---|---|
| 0 | ✅ | Vite + TypeScript + Tailwind v4, Playwright suite, monolith frozen in `legacy/` |
| 1 | ✅ | Game extracted from the marketing page; 50 inline handlers → delegated dispatch |
| 2 | ✅ | One `GameState`; save is `JSON.stringify(S)`; migrations that never reject |
| 3 | ✅ | Content registry — nine hand-synced tables collapsed to one |
| 4 | ◐ | `sim/finance.ts` out and the ledger fixed; `render/`, `ui/` and the rest of `sim/` still in `main.ts` |
| 5 | ✅ | One fixed-timestep clock; pause and frame-rate bugs fixed |
| 6–8 | | Save-size cleanup, Postgres + API, accounts and up to 12 saved parks per player |

Bugs fixed along the way: reloading no longer empties a busy park; a version bump no longer
destroys saves; pausing actually pauses (a paused park used to keep earning shop revenue);
the simulation no longer runs faster on a 144 Hz monitor; the Finance tab reconciles after a
demolish or undo; un-researched rides are greyed out again.

`client/src/main.ts` is still ~4,400 lines. See [ARCHITECTURE.md](docs/ARCHITECTURE.md)
§8 for exactly what phase 4 has left.

## Backend

Server not started. The **client half is built**: `net/client.ts` (typed API client) and
`save/sync.ts` (local-first sync with 409 conflict handling), both written to the contract and
tested against a fake server in `tests/sync.spec.ts`. Neither has talked to a real server yet.
Missing on this side: `ui/auth.ts` — the login form, slot picker and conflict dialog that would
drive the engine.

**Picking up the server? Start at [docs/BACKEND-HANDOFF.md](docs/BACKEND-HANDOFF.md)** --
orientation, build order and traps. [docs/API-CONTRACT.md](docs/API-CONTRACT.md) is the spec: endpoints, the save
blob shape, optimistic concurrency, and the invariants the server must check rather than
trust. `core/`, `content/`, `sim/finance` and `save/migrations` are proven Node-importable
(`tests/portability.spec.ts`), so the server should reuse them instead of restating the
cost table and the ledger rules.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — evaluation of the monolith, target module
  layout, trust model, and the phased migration plan
- [`server/migrations/001_init.sql`](server/migrations/001_init.sql) — Postgres schema for
  users, sessions, save slots, leaderboards
- `legacy/park-builder.html` — **not committed yet.** Drop the original file here; it stays as
  the frozen reference to diff against during the port

## Where this is going

```
client/     game only, no marketing chrome; ES modules
  src/content/    one file per attraction — the registry that replaces 8 parallel tables
  src/sim/        pure, headless, deterministic; no DOM, no Date.now, no Math.random
  src/render/     canvas renderer, one sprite module per attraction
  src/ui/         DOM panels, driven by events from sim
  src/save/       versioned schema + migration chain
server/     Node API over Postgres
shared/     save schema, imported by both sides
legacy/     the original monolith
```

The two changes that pay off the "modular and scalable" ask are the **content registry**
(adding a ride goes from 10 edit sites to 1) and **one state object** (which makes save/load
correct by construction). Everything else follows from those. See §8 of the architecture doc
for the phase order.

## Decisions

| Decision | Choice |
|---|---|
| Client toolchain | Vite + TypeScript (starts loose, tightened per module as it splits) |
| CSS | Real Tailwind build in-repo, replacing the corporate site's precompiled `css/style.css` |
| Inline `onclick` handlers | Converted to `addEventListener` during phase 1 |
| Server trust model | Validate invariants on write (see ARCHITECTURE §5) |

## Before the first line of the port

`loadGame()` rejects any save whose version isn't exactly `5` and immediately overwrites it
with a new park. Bumping the save version today destroys every existing player's park, so the
migration chain (phase 6) has to land before cloud saves do (phase 7).
