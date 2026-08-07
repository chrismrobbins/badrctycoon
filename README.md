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

**Phases 0–1 done.** The game runs standalone at `client/` on Vite + TypeScript + Tailwind v4,
with the marketing chrome removed and all 50 inline `onclick=` handlers replaced by delegated
`data-act` dispatch. Typecheck is clean and 8 smoke tests pass.

`client/src/main.ts` is still the monolith — 4,510 lines, ~40 module-level `let`s. Phase 1
moved it without reshaping it on purpose, so any regression is attributable to the move.
Phase 2 (one state object) is next.

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
