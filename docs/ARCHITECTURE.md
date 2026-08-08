# BadRCTycoon — Architecture Evaluation & Target Design

Evaluation of `park-builder.html` (single-file build, ~3.9k lines) and the plan to take it
to a modular client, a Postgres-backed API, accounts, and cloud saves.

---

## 1. What we have today

One HTML file containing three unrelated concerns:

| Concern | Roughly | Notes |
|---|---|---|
| Caf2Code marketing chrome | nav, Solutions mega-menu, contact/RFP modal, ZoomInfo tracker | Belongs to the corporate site, not the game |
| Hand-written CSS | management modal, side panels, meters | Written by hand *because* `css/style.css` is a pre-compiled Tailwind build that lacks the needed utilities |
| The game | one inline `<script>`, ~2.9k lines | State, simulation, canvas renderer, DOM UI, and persistence all interleaved |

The game itself is genuinely good — the isometric renderer, depth sorting, the pad/footprint
system, BFS staff routing, and the economy are all solid work. **The problem is not quality,
it is that nothing has a boundary.** Everything below follows from that.

---

## 2. The scalability problem, concretely

### 2.1 Adding one ride touches 10 places

To add a 2×2 ride today you edit, in order:

1. `BUILD_DATA` — cost, size, rating, capacity, cycleTime, excitement, nightBonus
2. `RIDE_TYPES` — the `Set`
3. `TYPE_LABEL` — display name
4. `RIDE_ACCENT` — pad border colour
5. `NAME_POOL` — the joke names
6. `RESEARCH_ORDER` — unlock position
7. The palette `<button onclick="setTool('…')">` in the HTML
8. A new `drawX(cx, cy)` function
9. The `else if (cell === '…')` chain in `render()` **pass 2, size > 1 branch**
10. Optionally `HOTKEY_TOOLS`, and `MINI_COLORS` for non-rides

A new **shop** adds an eleventh: the hardcoded need chain in `Guest.update()`
(`sd.shop === 'hunger' | 'thirst' | 'bladder' | 'balloon'`). A shop satisfying a *new* need
means editing guest AI.

There are 21 attraction types spread across 8 parallel lookup tables that must stay in sync
by hand, plus two separate `if/else` dispatch chains in the renderer. Nothing enforces that
an entry in one exists in the others — a missing `TYPE_LABEL` degrades silently to the raw id.

**This is the highest-leverage fix in the whole codebase.** See §4.1.

### 2.2 ~40 mutable module-level globals

`map`, `anchorOf`, `funds`, `guests`, `visualGuests`, `rating`, `parkHappiness`, `builtValue`,
`shopSales`, `dayCount`, `gameSpeed`, `objectiveIndex`, `gameTime`, `weather`, `litter`,
`staff`, `admissionPrice`, `loanBalance`, `marketing`, `awardsWon`, `research`, `ledger`,
`dayLedger`, `rideQueues`, `rideNames`, `shopStats`, `cleanliness`, `undoStack`, camera state,
inspector state, audio state, fireworks state…

Consequences: there is no object to serialize, so `saveGame()` hand-enumerates fields and has
already drifted (§3.1); nothing is testable in isolation; and the simulation can never run
headless, which rules out server-side validation.

### 2.3 Simulation is welded to the render loop

- `guest.update()` is called inside `render()`, once per `requestAnimationFrame` frame.
- `updateStaff()` is also called from `render()`, `gameSpeed` times per frame.
- Economy runs on a separate `setInterval(…, 1500)`.

Three different clocks. Two of them are the display refresh rate. Guests and staff literally
move **2.4× faster on a 144 Hz monitor than on 60 Hz**, and the economy does not, so the
balance of the game changes with your display.

### 2.4 Renderer allocates per frame

`render()` rebuilds a `drawables` array of `{d, fn}` closures for every occupied cell, every
guest, and every staff member, then sorts it — every frame. On a fully expanded 35×35 park
that is a four-figure count of short-lived closures 60 times a second, plus per-frame
`createLinearGradient` / `createRadialGradient` calls inside several `draw*` functions.

### 2.5 `Date.now()` is the animation clock in ~30 draw functions

Wall-clock time drives every carousel rotation, coaster train, flag wave and light chase.
Animations therefore cannot be paused, and rendering is not reproducible — which forecloses
screenshot tests and deterministic replay.

---

## 3. Bugs found while reading (these matter for the DB work)

These are worth listing because each one is a symptom the refactor should structurally
prevent, and several become *much* worse once a server is involved.

### 3.1 Save/load is lossy and version-fragile

`saveGame()` persists 25 named fields. It does **not** persist: `visualGuests`, `guests`,
`isParkOpen`, `parkHappiness`, `weather`, `gameSpeed`, camera (`zoom`/`panX`/`panY`), or live
`rideQueues` state. Reload a busy park and every guest vanishes, happiness snaps back to 50,
and attendance rebuilds from zero.

Worse, `loadGame()` opens with:

```js
if (!s || s.v !== 5 || !Array.isArray(s.map)) return false;
```

Any save that is not exactly v5 is discarded, a fresh park is created over the top, and the
12-second autosave interval overwrites the old save moments later. **Bumping the version
number silently destroys every existing player's park.** (The storage key is also still
`c2c_park_v4` while the payload says `v: 5`.)

A versioned migration chain that never rejects is a hard prerequisite for cloud saves.

### 3.2 Pausing the game does not pause the game

`setSpeed(0)` stops `economyTick` and `updateStaff`, but `visualGuests.forEach(g => g.update())`
in `render()` has no `gameSpeed` guard. While "paused", guests keep walking, keep queueing,
keep dropping litter, and keep buying — `earn(sd.price, 'shops')` still fires. **A paused park
still makes money.**

### 3.3 Four money paths bypass the ledger

`earn()` / `spend()` maintain `ledger` and `dayLedger`. But these mutate `funds` directly:

- `buildInCell()` bulldozer, anchored branch — `funds += refund`
- `buildInCell()` bulldozer, single-tile branch — `funds += refund`
- `undoLast()` build-undo — `funds += e.cost`
- `undoLast()` demolish-restore — `funds -= e.refund`

So the Finance tab's all-time totals drift permanently the first time you demolish or undo,
and `income − expense` stops reconciling against `funds`.

### 3.4 A dead bulldozer branch with different refund rules

`buildInCell()` writes `anchorOf` for **every** placed tile including 1×1s and paths, so the
"simple single-tile without anchor" branch is effectively unreachable for normally-built
tiles. It is only reachable for tiles restored by `undoLast()` (which sets `anchorOf` only
when `cells.length > 1`). Those two branches refund differently — the live one refunds 50% of
a path ($5), the dead one refunds paths not at all. Undo a demolish, then bulldoze, and you
get a different outcome than bulldozing directly.

### 3.5 Derived values tracked as accumulators — FIXED (save v8)

`rating` and `builtValue` were `+=`/`-=` counters, not functions of the map, and `rating`
also absorbed award bonuses — so it was not derivable from the park at all. Any missed code
path drifted them permanently, and the server had nothing to check a claimed rating against.

Both are gone from `GameState` as of save v8. `sim/park.ts` computes them from the map
(`builtValue()`, `parkValue()`, `parkRating()`), award rating values moved to
`content/awards.ts` as data, and the v8 migration drops the stored figures rather than
trusting them — they had already drifted in any park where something was demolished.

This is what upgraded API-CONTRACT checks 7 and 10 from "upper bound" to exact equality.

### 3.6 Save bloat and leaks

- `anchorOf` is persisted with one entry per occupied tile — for a full 35×35 park that is
  ~1,200 `{"ax":n,"ay":n}` objects, tens of KB, all of it derivable from `map` + footprints.
- `litter["x,y"]` entries are never deleted when the underlying path is bulldozed. They stop
  affecting cleanliness (which only counts path tiles) but persist in the save forever.

### 3.7 Minimap boots in a state that contradicts its own button

`minimapOn` initialises to `true` and startup runs
`document.getElementById('btn-minimap').classList.add('text-blue-500')`, so the button renders
as *on* — but `#minimap-wrap` ships with `class="side-panel glass hidden"` and nothing clears
it. The first click sets `minimapOn = false` and calls `toggle('hidden', !minimapOn)`, which
re-hides an already-hidden panel. **It takes two clicks to reveal the minimap**, and the
button lies about its state until then.

The general shape — UI state duplicated between a JS variable and a class on an element, with
no single owner — is what phase 2's state object and phase 4's UI modules exist to remove.

### 3.8 Latent XSS on ride names

Ride names are free text (`maxlength="28"`, no other validation). Today they only ever reach
`.value`, `.textContent`, or the canvas, so nothing is exploitable. But `statRow()`, `bar()`
and `renderMgmt()` all build `innerHTML`, and a leaderboard or shared-park feature will put a
*another user's* park name into the DOM. Sanitise at the API boundary and render with
`textContent` before that ships.

---

## 4. Target architecture

Two design goals, in priority order:

1. **Adding content is a one-file change.**
2. **The simulation is a pure, headless, deterministic module** the server can also run.

### 4.1 Content registry (do this first)

Collapse the 8 parallel tables and 2 dispatch chains into one declarative module per
attraction:

```js
// client/src/content/rides/ferris-wheel.js
import { defineAttraction } from '../define.js';
import { drawFerrisWheel } from '../../render/sprites/ferris-wheel.js';

export default defineAttraction({
  id: 'ferriswheel',
  label: 'Ferris Wheel',
  category: 'ride',          // 'path' | 'scenery' | 'ride' | 'shop'
  footprint: 2,              // NxN
  cost: 2500,
  rating: 200,
  ride: { capacity: 16, cycleTime: 4, excitement: 45, nightBonus: 0 },
  research: { order: 6 },    // absent = unlocked from the start
  ui: { icon: 'fa-life-ring', accent: '#3b82f6' },
  names: ['Slow Refresh', 'The Sprint Wheel', 'Roundtable', 'Data Cycle'],
  draw: drawFerrisWheel,
});
```

Shops declare which need they serve as data, which removes the hardcoded chain from
`Guest.update()`:

```js
// client/src/content/shops/food-stall.js
shop: { satisfies: 'hunger', threshold: 60, resetTo: 10, price: 8, litters: true },
```

```js
// client/src/content/needs.js — needs become data too
export const NEEDS = [
  { id: 'hunger',  growth: 0.015, painAbove: 85, painRate: 0.020 },
  { id: 'thirst',  growth: 0.020, painAbove: 85, painRate: 0.025 },
  { id: 'bladder', growth: 0.012, painAbove: 90, painRate: 0.030 },
];
```

`content/index.js` then derives everything the rest of the app reads:
`byId()`, `byCategory('ride')`, `researchOrder()`, `paletteGroups()`, `minimapColour()`,
`isUnlocked()`. `defineAttraction()` validates the shape at import time, so a malformed entry
fails loudly at startup instead of degrading silently.

The renderer's two `else if` chains become `content.byId(cell).draw(cx, cy, ctx, view)`.
The build palette is generated from the registry rather than hand-written in HTML.

**Result: adding a ride is one new file plus one import.**

### 4.2 Module layout

```
badrctycoon/
├─ client/
│  ├─ index.html                  game only — no marketing chrome
│  └─ src/
│     ├─ main.js                  bootstrap: wires sim + renderer + UI
│     ├─ core/
│     │  ├─ state.js              createGameState() — the one serializable object
│     │  ├─ loop.js               fixed-timestep accumulator
│     │  ├─ events.js             emitter; sim never touches the DOM
│     │  ├─ rng.js                seeded PRNG (replaces every Math.random in sim)
│     │  └─ grid.js               tileKey(), anchorAt(), neighbours()
│     ├─ content/                 §4.1 — needs.js, define.js, index.js, rides/, shops/, scenery/
│     ├─ sim/                     economy, guests, staff, rides, litter, finance,
│     │                           research, marketing, awards, objectives  (pure, no DOM)
│     ├─ render/                  renderer, camera, iso primitives, weather,
│     │                           fireworks, minimap, sprites/<one per attraction>
│     ├─ ui/                      palette, statusbar, management/, inspectors, eventlog, auth
│     ├─ save/                    schema.js, migrations.js, local.js, sync.js
│     ├─ net/                     api client, token handling
│     └─ audio/
├─ server/
│  ├─ migrations/                 001_init.sql, …
│  └─ src/                        routes/, db/, lib/
├─ shared/
│  └─ save-schema.js              imported by BOTH client and server
└─ legacy/
   └─ park-builder.html           frozen reference during the port
```

`sim/` must never import from `render/` or `ui/`, and must never reference `document`,
`window`, `Date.now()`, or `Math.random()`. Enforce it with an ESLint `no-restricted-imports`
/ `no-restricted-globals` rule on that directory — that single rule is what keeps the
simulation portable to the server.

### 4.3 Fixed-timestep loop

```js
const TICK_MS = 1000 / 30;
let acc = 0, last = performance.now();

function frame(now) {
  acc += Math.min(now - last, 250);   // clamp so a backgrounded tab can't fast-forward
  last = now;
  while (acc >= TICK_MS) {
    for (let i = 0; i < state.speed; i++) sim.tick(state, TICK_MS);
    acc -= TICK_MS;
  }
  renderer.draw(state, acc / TICK_MS); // alpha for interpolation
  requestAnimationFrame(frame);
}
```

Fixes §2.3 and §3.2 together: one clock, `speed === 0` genuinely stops everything, and
behaviour is identical at 60 Hz and 144 Hz. Animation phase comes from `state.tickCount`, not
`Date.now()`, so rendering becomes reproducible.

### 4.4 Build step — **decided: Vite + TypeScript**

The arcade precedent (plain files, no build) was right for 12 self-contained games of one file
each. This is one game that becomes ~40 modules, and the bug classes above — stringly-typed
`"x,y"` keys, save-shape drift, parallel tables out of sync — are precisely what a type
checker catches for free.

TypeScript starts **loose** (`strict: false`, implicit `any` allowed) so the ported monolith
compiles from day one, and is tightened per-module as phases 3–4 split it. Turning on `strict`
for a 4,500-line file up front would stall the port on hundreds of annotations that the split
is about to invalidate anyway.

### 4.5 CSS — **decided: real Tailwind build**

The ~500 lines of hand-rolled CSS in the monolith exist for one reason, stated in its own
comments: `css/style.css` on the corporate site is a **pre-compiled** Tailwind build, so any
utility not already used elsewhere on that site (`pointer-events-auto`, `md:grid-cols-2`,
`left-80`, arbitrary values like `dark:bg-[#0b0f17]`) simply does not exist.

A JIT Tailwind build in this repo removes that constraint entirely. Most of the hand-rolled
CSS — `.m-row`, `.m-tile`, `.mgmt-tab`, `.panel-head`, `.side-panel` and friends — should be
**deleted rather than ported**, replaced by the utilities they were imitating. What genuinely
stays is the small amount that isn't expressible as utilities: the `@keyframes`, the canvas
sizing, and the `::-webkit-scrollbar` rules.

---

## 5. Trust model — decide this before the API is written

Every number the client would submit (`funds`, `rating`, `park_value`, `day`) is currently
client-asserted, and `rating` isn't even derivable from the map (§3.5).

| Option | Effort | Leaderboard integrity |
|---|---|---|
| **A.** Server is a dumb blob store | Low | Trivially cheatable |
| **B.** Server validates invariants on write | Medium | Stops casual tampering |
| **C.** Server replays a command log | High | Authoritative |

**Decided: B now, structured so C stays reachable.** Option B means the server imports
`shared/` and checks, on every save: `park_value === funds + Σ(cost of placed attractions)`;
`day` is monotonic per slot; `rating` is within tolerance of `Σ(ratings from map) + Σ(awards
won)`; playtime is plausible against day count; blob size is under 2 MB. Cheap, and it makes
`rating` and `builtValue` *derived* rather than accumulated, which fixes §3.5 as a side effect.

Option C only becomes possible once §4.3 (fixed timestep) and the seeded RNG are done — which
is why they are in the plan even though nothing needs them today.

---

## 6. Accounts, saves, and sync

### 6.1 Auth

- Argon2id password hashing (`@node-rs/argon2`). The arcade used PBKDF2 because Workers crypto
  offered nothing better; on Node there is no reason to.
- Sessions as opaque random tokens in `httpOnly; Secure; SameSite=Lax` cookies. **Store only
  `sha256(token)` in the DB** so a database leak is not a session leak.
- `auth_identities` table from day one so Google/GitHub sign-in is a row, not a migration.
- Rate-limit login and registration per IP and per username.

### 6.2 Save slots

Local-first. The game stays fully playable logged out, exactly as it is now.

- Autosave to IndexedDB continuously (as today, but with a real schema).
- Push to the server on manual save, on `visibilitychange` → hidden via `sendBeacon`, and
  every 60 s while dirty.
- Each slot carries a server-assigned integer `revision`. The client sends the revision it
  based its edit on; a stale write returns `409` plus the current slot header.
- **On conflict, never clobber.** Show "This park was also saved on another device — Day 42,
  3 minutes ago" and let the player pick. Silent last-write-wins loses parks.

### 6.3 Blob storage

Estimated save size for a full 35×35 park with guests persisted: **100–200 KB** of JSON.

Store as `jsonb` in a table separate from the slot metadata, with headline stats
(`day`, `funds`, `park_value`, `rating`, `guests`) denormalised onto `save_slots`. The load
screen and the leaderboard then never read the blob. Postgres TOASTs and compresses anything
over ~2 KB automatically, so `jsonb` costs little over `bytea` and stays queryable
(`state->'research'->'unlocked'`) for analytics and migrations.

Schema: [`server/migrations/001_init.sql`](../server/migrations/001_init.sql).

### 6.4 Many parks, one account — and this game stands alone

**A player keeps up to 12 named parks.** That is `save_slots`: one row per park, each with its
own name, blob, headline stats, revision and history, keyed `UNIQUE (user_id, slot)`. This is
the save/load-game feature, and it is the reason the slot metadata is denormalised — a load
screen listing twelve parks must not parse twelve 200 KB blobs.

An earlier draft of this document also assumed the game would join the Caf2Code arcade, and
carried a `games` table plus a `game_id` on every game-scoped table so several *titles* could
share one login. **It is standalone, so that came out.** The two ideas are easy to confuse and
are unrelated: `slot` is how many parks one player keeps, `game_id` was how many different
games shared an account.

That earlier draft also claimed adding `game_id` later would be a painful backfill. That was
wrong, and it is worth recording why: a backfill is only painful when the value cannot be
inferred. Here every existing row would take the same constant, so it is a ten-line migration
if a second title ever appears.

Standalone also means the game does not need to be embeddable — no `mount(container)` export,
no host shell. `client/index.html` is the whole application.

---

## 7. Hosting

You are a Microsoft-stack shop, so the org-aligned answer is **Azure Database for PostgreSQL
Flexible Server** (Burstable B1ms is fine) + **Azure Container Apps** for the API +
**Azure Static Web Apps** for the client.

The cheaper hobby answer is **Neon** (serverless Postgres, scales to zero, branch-per-PR) with
the API on Fly.io or Railway. If you want to stay on Cloudflare like the arcade, Workers can
reach Postgres through Hyperdrive — but Workers' runtime constraints are what pushed that
project to PBKDF2 in the first place, and a plain Node API avoids re-litigating those.

Either way the API is ordinary Node, so the choice is reversible.

---

## 8. Migration plan

Each phase ships independently and is revertable. No big-bang rewrite.

| Phase | Work | Ships |
|---|---|---|
| **0** ✅ | `legacy/park-builder.html` frozen as reference. Vite + TypeScript + Tailwind v4 toolchain. Playwright smoke suite (8 tests). | Baseline you can refactor against safely |
| **1** ✅ | Split the file. Marketing chrome out; `<script>` → `client/src/main.ts` as one module; 50 inline `onclick=` handlers → delegated `data-act` dispatch. **No game-logic changes.** | Game runs standalone |
| **2** ✅ | `core/state.ts`. All persisted globals into one object; 430 references rewritten from compiler positions. | Save/load is `JSON.stringify(S)` |
| **3** ✅ | Content registry (§4.1). Nine tables + two dispatch chains + the palette markup collapsed. | Adding a ride = 1 file + 1 sprite |
| **4** ✅ | Full split: `sim/` (finance, park, litter, staff, guests, rides, economy, objectives, awards, scenery, time), `ui/` (eventlog, statusbar, objectives, management, inspectors, palette, auth), `render/` (camera, iso, clock, sprites/<id>.ts for every attraction, effects, entities, fireworks, minimap). `main.ts`: 4,718 → ~1,560 lines. The `no-restricted-imports`/`no-restricted-globals` boundary rule on `sim/` shipped as `scripts/check-sim-boundary.mjs` instead of real ESLint -- typescript-eslint hard-refuses to run on TypeScript 7 (tracked at their issue #10940); see that script's header for the full story. `render()`, `handleInteraction`, and `buildInCell` stay in `main.ts` deliberately -- they're the composition root wiring the extracted pieces together, per §4.2's own target layout, not code still tangled. | Adding a ride is one file plus one sprite; `sim/` imports clean in Node with no DOM |
| **5** ✅ | Fixed-timestep loop. Fixes §2.3, §2.5, §3.2. Seeded RNG deliberately deferred. | Frame-rate independence, pause works |
| **6** ◐ | Migration chain that never rejects landed early, with phase 2. §3.6: the litter leak (bulldozing never deleted a path's `litter` entry) is fixed. Redundant `anchorOf` persistence is still open -- deliberately deferred past phase 4 despite being derivable from `map` + content, because removing it from `GameState` (matching the `rating`/`builtValue` precedent in §3.5) means updating ~15+ read sites across `sim/staff.ts`, `sim/rides.ts`, `sim/guests.ts`, and `main.ts`, not just the save boundary. | Saves survive version bumps |
| **7** | Postgres + API. Auth, slots, sync, conflict UI. See [API-CONTRACT.md](API-CONTRACT.md). | Cloud saves |
| **8** | Leaderboards, achievements, multi-park slot picker. | Platform |

Phases 2 and 3 are where the "modular and scalable" ask is actually paid off. Phase 6 must
land before phase 7 — putting a lossy, version-fragile save format behind a network boundary
turns §3.1 from a local annoyance into support tickets.

Bugs from §3 are worth fixing in the phase that structurally prevents them (ledger bypass in
phase 4 when `finance.js` owns `funds`; pause in phase 5) rather than patched into the
monolith first.

### What phases 0–1 actually produced

```
client/index.html          390 lines   game only; zero inline handlers
client/src/main.ts       4,510 lines   the monolith, moved not rewritten
client/src/styles/app.css  187 lines   Tailwind v4 + ported CSS (deleted in phase 4)
tests/smoke.spec.ts          8 tests   all passing
```

The type checker found 288 errors on first run, which collapsed to zero under about a dozen
edits — three undeclared class shapes (`Guest`, `FireworkShell`, `FireworkParticle`), the
`getElementById` → `HTMLCanvasElement` casts, three helpers with non-optional trailing
parameters, and two track profiles memoized onto the draw functions themselves
(`drawCoaster.path = …`, now module-level `let`s).

One of those was a real latent bug rather than a missing annotation. In `drawRestroom()`:

```js
[[-7, '#3b82f6'], [7, '#ec4899']].forEach(([ox, col]) => { … ox > 0 … })
```

The mixed array widens to `(string | number)[][]`, so `ox` is `string | number` and `ox > 0`
is comparing a possible string. It happens to work because `ox` is always a number in
practice, but it is exactly the stringly-typed-data class of defect §4.4 predicted types would
catch, found on day one.

`main.ts` is still one 4,510-line file with ~40 module-level `let`s — phase 1 deliberately
moved code without reshaping it, so that a regression here is attributable to the move alone.
Phase 2 is where that file starts to shrink.

### Where phases 2–5 got to

```
client/src/core/state.ts        GameState + createGameState()
client/src/content/             define, needs, scenery, shops, rides, staff, marketing, index
client/src/save/                schema.ts, migrations.ts
client/src/sim/                 finance, park, litter, staff, guests, rides, economy,
                                 objectives, awards, scenery, time -- headless, no DOM
client/src/ui/                  eventlog, statusbar, objectives, management, inspectors,
                                 palette, auth
client/src/render/              camera, iso, clock, effects, entities, fireworks, minimap,
                                 sprites/ (one file per attraction category + the SPRITES table)
client/src/main.ts              ~1,560 lines: the composition root -- render()'s per-frame
                                 orchestration, handleInteraction/buildInCell, boot sequence
scripts/check-sim-boundary.mjs  the sim/ headlessness check (see below for why not ESLint)
tests/                          61 tests across the suite (55 pass locally; 6 more pass too
                                 with `npm run worker:dev` running)
```

**Phase 4 is done.** See [PHASE4-HANDOFF.md](PHASE4-HANDOFF.md) for the traps found doing it,
what's deliberately still open, and the exact state to pick up from. `sim/`, `ui/`, and
`render/` are all split out. What actually happened,
in order, differs a little from the plan above:

- `sim/` came out first, in the order guests/staff (the two the plan called out as the big
  ones, both closing over module state) followed by the rest -- litter, rides, objectives,
  economy (which absorbed research and marketing rather than getting separate files; they
  were small enough to live inside `economy.ts`'s `runDailyBooks()`), awards.
- `ui/` came out in dependency order: the fully self-contained pieces (eventlog, statusbar,
  objectives) first, then management (the single biggest function in the file), then
  inspectors and palette. `auth.ts` already existed from phase 7.
- `render/` came out last, camera/iso/clock first (the shared primitives every sprite needs),
  then every sprite file, then the smaller systems (effects, entities, fireworks, minimap).
  The blocker the plan called out -- ~36 draw functions closing over a module-level `ctx` --
  is gone: every one of them takes `ctx` explicitly now.
- The ESLint `no-restricted-imports` / `no-restricted-globals` boundary rule on `sim/` did
  **not** ship as ESLint. `typescript-eslint` (8.66.0, latest published) unconditionally
  refuses to run against TypeScript 7 -- not a peer-dependency warning, a hard throw at
  require-time (tracked at their issue #10940). The fallback -- skip typescript-eslint and
  walk the AST with the `typescript` package's own compiler API -- doesn't work either: TS 7
  restructured the package so `require('typescript')` exposes only `{ version,
  versionMajorMinor }`; the classic API lives under explicitly-`unstable` subpaths with no
  stability guarantee. `scripts/check-sim-boundary.mjs` does the same two checks (import
  specifiers, a handful of bare global identifiers) via plain text scanning instead --
  cruder, but with zero fragile dependency surface. `npm run lint` runs it.
- `render()`, `handleInteraction`, and `buildInCell` were deliberately **not** extracted.
  Fully parameterizing `render()` alone would mean threading something like 15 arguments
  (camera state, `currentTool`, `hoveredCell`, `inspectedGuest`, the `SPRITES` table, ...)
  through one function for little real gain -- it already calls clean, `ctx`-explicit
  building blocks from `render/`. At that point `main.ts` is acting as the composition root
  §4.2's own target layout describes ("`main.js`: bootstrap, wires sim + renderer + UI"), not
  code that's still tangled.
- ~~Make `rating` and `builtValue` derived rather than accumulated (§3.5).~~ Done — see
  `sim/park.ts`. This was pulled forward out of phase 4 because the server wants it before
  the validator is written.
- ~~Litter leak (§3.6)~~ Done, landed alongside phase 4 rather than waiting for phase 6:
  bulldozing a path now deletes its `litter` entry instead of leaking it in the save forever.

Deferred with reasons rather than forgotten:

- **Seeded RNG** (was phase 5). It only matters for server-authoritative replay, and we chose
  trust model B. It gets cheaper now that `sim/` is isolated, and nothing depends on it yet.
  `Math.random()` is still called directly throughout `sim/litter.ts`, `sim/rides.ts`,
  `sim/staff.ts`, `sim/guests.ts`, and `sim/economy.ts` -- each says so in a comment. This is
  also why `check-sim-boundary.mjs` doesn't flag `Math.random()` yet, unlike the ESLint rule
  §4.2 originally called for; add that once seeded RNG lands.
- **Redundant `anchorOf`** (§3.6, the other half). Still open, staying in phase 6 on purpose:
  it's derivable from `map` + content (verified: footprints only ever extend down-right from
  their anchor, so a deterministic scan reconstructs it exactly), but removing it from
  `GameState` the way `rating`/`builtValue` were fixed means updating ~15+ read sites across
  `sim/staff.ts`, `sim/rides.ts`, `sim/guests.ts`, and `main.ts` -- a real redesign, not a
  bug fix.
