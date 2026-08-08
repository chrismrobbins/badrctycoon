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

**Phases 0–5 done; phase 6 partial.** Typecheck clean, 61 tests (55 pass with no backend
running locally, all 61 pass with `npm run worker:dev` up).

| Phase | | |
|---|---|---|
| 0 | ✅ | Vite + TypeScript + Tailwind v4, Playwright suite, monolith frozen in `legacy/` |
| 1 | ✅ | Game extracted from the marketing page; 50 inline handlers → delegated dispatch |
| 2 | ✅ | One `GameState`; save is `JSON.stringify(S)`; migrations that never reject |
| 3 | ✅ | Content registry — nine hand-synced tables collapsed to one |
| 4 | ✅ | Full split: `sim/`, `ui/`, `render/` all out of `main.ts`. Every draw function is `ctx`-explicit; `sim/` is headless (checked by `npm run lint`, not real ESLint -- see ARCHITECTURE §8 for why) |
| 5 | ✅ | One fixed-timestep clock; pause and frame-rate bugs fixed |
| 6 | ◐ | Migration chain landed with phase 2. Litter-leak-on-bulldoze fixed; redundant `anchorOf` in the save still open |
| 7–8 | | Postgres + API, accounts and up to 12 saved parks per player -- **done, see Backend below** |

Bugs fixed along the way: reloading no longer empties a busy park; a version bump no longer
destroys saves; pausing actually pauses (a paused park used to keep earning shop revenue);
the simulation no longer runs faster on a 144 Hz monitor; the Finance tab reconciles after a
demolish or undo; un-researched rides are greyed out again; bulldozing a path no longer leaks
its litter entry into the save forever.

`client/src/main.ts` is down to ~1,560 lines -- the composition root now, not the monolith.
See [ARCHITECTURE.md](docs/ARCHITECTURE.md) §8 for the phase 4 postmortem, or
**[docs/PHASE4-HANDOFF.md](docs/PHASE4-HANDOFF.md)** for the traps found doing it and what's
left before touching `client/` again.

## Backend

**Done, and live at badrctycoon.com.** `server/` is a Cloudflare Workers API (Hono) over
Postgres (Supabase, via Hyperdrive) -- accounts, cloud saves (up to 12 named parks per
player), and a public leaderboard. The game still runs entirely in the browser and saves to
`localStorage` first; signing in adds cloud saves, it was never a gate.

**Touching the server? Start at [docs/BACKEND-HANDOFF.md](docs/BACKEND-HANDOFF.md)** -- how
it was built, how it actually runs, and the traps (native/WASM code doesn't run in a Workers
isolate; Supabase's direct connection is IPv6-only). [docs/API-CONTRACT.md](docs/API-CONTRACT.md)
is the spec: endpoints, the save blob shape, optimistic concurrency, and the invariants the
server checks rather than trusts. `core/`, `content/`, `sim/` and `save/migrations` are proven
Node-importable (`tests/portability.spec.ts`) and actually imported at the edge in production
under `nodejs_compat` -- the server reuses them rather than restating the cost table and the
ledger rules.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — evaluation of the monolith, target module
  layout, trust model, and the phased migration plan
- [`server/migrations/001_init.sql`](server/migrations/001_init.sql) — Postgres schema for
  users, sessions, save slots, leaderboards
- `legacy/park-builder.html` — **not committed yet.** Drop the original file here; it stays as
  the frozen reference to diff against during the port

## Graphics

**Every attraction sprite, plus the guests and staff, are baked in Blender** rather than drawn with canvas paths — the same
trick RollerCoaster Tycoon used. It fits because the game's 2:1 dimetric projection is one an
orthographic camera reproduces *exactly*: at rot X 60° / Z 45° the ground squash is
`sin 30° = 0.5`, so a 1×1 Blender unit lands precisely on the 64×32 tile. Verified by rendering
a bare tile and measuring it (63.5 × 32 px, centred), not by eye.

```bash
blender --background --python scripts/blender/attractions.py   # 20 models -> frames + .blend
node scripts/blender/pack-strip.mjs                            # -> sheets + generated-strips.ts
```

| Path | What it is |
|---|---|
| [`scripts/blender/attractions.py`](scripts/blender/attractions.py) | **Source of truth** — geometry, palette, per-frame motion, and the MANIFEST of frame sizes |
| [`scripts/blender/kit.py`](scripts/blender/kit.py) | Shared camera/lighting/primitives — the part that must stay identical so everything lands on one grid |
| `scripts/blender/blend/*.blend` | Openable Blender files, one per model. **Regenerated from the `.py`** — inspect them, don't edit them |
| `client/public/sprites/*.png` | The packed sheets the game loads. Build artifacts |
| [`client/src/render/atlas.ts`](client/src/render/atlas.ts) | Loads a sheet and blits it; owns the fallback and phase rules |
| `client/src/render/sprites/generated-strips.ts` | Generated frame/variant/size table — never hand-edit |

**Sheet layout**: columns are animation frames, rows are `tileHash` variants (three tree
species, benches with and without a resting guest). Stored at 2× because zoom clamps to 1.8.

**People** don't sit on a tile, so they use `loadSheet()` — the lower-level accessor `loadStrip()`
is built on — and address cells directly, 6 walk frames across:

- **Guests**: `shirtColour × 4 + facing` (28 rows). Balloons and the happiness indicator stay
  canvas — they're per-guest state.
- **Staff**: `outfit × 4 + facing` (24 rows). Janitors get a green polo, cap and a push broom
  that sweeps as they walk; mechanics get hi-vis overalls, a hard hat and a wrench. Entertainers
  get **four** costumes — clown, jester, mascot, ringmaster — assigned per hire from a hash of
  the worker's name, so a costume is stable across saves without adding a field to `Staff`, and
  a park doesn't fill up with identical clowns.

The colour, outfit and direction lists in [guestsprite.ts](client/src/render/guestsprite.ts) and
[staffsprite.ts](client/src/render/staffsprite.ts) must stay in the same order as their sources
(`Guest`'s palette in `main.ts`, `STAFF_OUTFITS` in the Blender script, `DIRS` in `sim/guests.ts`).
**That ordering is the whole contract** — insert an outfit in the middle and janitors become
clowns with no error. Append, never insert.

**Portraits.** The guest inspector and the staff list show the character's real sprite, cropped
out of the same cached PNG via CSS `background-position`
([portrait.ts](client/src/render/portrait.ts)) — no canvas, no second copy of the art, no extra
bytes. The crop is needed because a cell is mostly padding: the figure's feet sit at the cell
centre, which is the anchor the renderer needs but leaves a ~20px person adrift in a 64px box.

Three rules the pipeline enforces so this can't rot:

- **Every strip keeps its original vector function as a fallback.** A slow load or a 404 degrades
  to the art that shipped before, never a hole in the park.
- **Night lights are not baked.** [main.ts](client/src/main.ts) already tints the whole scene, so
  baked sprites darken on their own — but lit windows and chasing bulbs are *emissive* and must
  be drawn on top. Those live in the `drawXNight()` functions, which the vector originals still
  call, so the fallback path is unchanged. Anything reading `GameState` (the trash can's overflow
  indicator) stays canvas for the same reason.
- **Clipping is a hard error.** The frame box is set per attraction by hand; get it wrong and
  Blender silently renders a coaster with its lift hill sliced off. `pack-strip.mjs` refuses to
  pack a sheet whose artwork touches the frame edge — it caught two of nineteen on the first pass.

`tests/sprites.spec.ts` imports the generated table and fails if any PNG's real dimensions
disagree with it, which is the failure a screenshot test sails straight past.

**Cost: 0.87 MB of sheets** (22 sheets, including guests and staff) against a ~140 KB JS bundle. Sheets are packed to a 256-colour
palette: these are flat-shaded renders of a handful of materials, so quantising is near-lossless
(measured mean error 1–2/255, indistinguishable side by side) for ~25% of the bytes — 2.9 MB
truecolour became 0.75 MB. **128 colours is not safe**: it visibly dithers the large flat
gradients on the ride pads. Because the palette did the work, no sprite had to give up animation
frames to pay for it.

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
