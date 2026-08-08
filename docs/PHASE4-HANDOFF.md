# Phase 4 handoff

**Done.** This file is "how phase 4 actually went, what it left behind, and what to
know before touching client/ again." Written for whoever/whatever picks this up
next — a different Claude session, Beau, or Chris a week from now having
forgotten the details.

If this file and [ARCHITECTURE.md](ARCHITECTURE.md) §8 ever disagree, **§8 wins**
— it's the one with the phase table — and please fix this one.

---

## 1. What got done

`client/src/main.ts` was a 4,718-line monolith holding sim, render, and UI code
tangled together. It's now **1,567 lines** — the composition root that wires
everything below together, not the everything itself.

Split out, in this order:

- **`sim/`** — `finance.ts` (already existed), `park.ts` (already existed),
  `awards.ts`, `scenery.ts`, `time.ts`, `litter.ts`, `staff.ts`, `objectives.ts`,
  `rides.ts`, `guests.ts`, `economy.ts`. Headless — no DOM, no `window`,
  imports clean in plain Node (`tests/portability.spec.ts` and
  `scripts/check-sim-boundary.mjs` both guard this, see §4 and §5).
- **`ui/`** — `eventlog.ts`, `statusbar.ts`, `objectives.ts`, `management.ts`,
  `inspectors.ts`, `palette.ts` (`auth.ts` already existed from phase 7).
- **`render/`** — `camera.ts`, `iso.ts`, `clock.ts`, `effects.ts`, `entities.ts`,
  `fireworks.ts`, `minimap.ts`, `sprites/` (one file per attraction category —
  `scenery.ts`, `rides.ts`, `shops.ts`, `megacoaster.ts` — plus `sprites/index.ts`
  for the `SPRITES` id→draw-function table).

Every one of the ~30 canvas draw functions now takes `ctx: CanvasRenderingContext2D`
explicitly instead of closing over a module-level canvas context — the specific
thing ARCHITECTURE.md §4.2 called the blocker for this whole phase.

**23 commits, all on `main`, all pushed.** `git log --oneline 4630987..HEAD` is
the full list if you want the play-by-play; every commit message explains the
"why," not just the "what," including how each batch was verified.

## 2. Start here (about five minutes)

```bash
git pull                # you want 264aa13 or later at the tip
npm install
npm run dev              # http://localhost:5173 — the game
npm test                 # 55 pass with no backend running, 6 more pass with one
npm run build             # tsc --noEmit && vite build
npm run lint              # scripts/check-sim-boundary.mjs — see §5, this is NOT eslint
```

If `npm test` fails outright (not just the 6 backend-dependent skips), or
`npm run build` doesn't typecheck clean, something regressed after this handoff
was written — don't assume it's pre-existing, `main` was green at 264aa13.

## 3. The documents

| Doc | What it is | When you need it |
|---|---|---|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** §8 | The phase table and the detailed "what actually happened in phase 4" writeup. | Once, up front. |
| This file | Traps found by actually running the thing, and exactly what's left. | Now. |
| [BACKEND-HANDOFF.md](BACKEND-HANDOFF.md) | Same idea, for the server (done, separately, in an earlier session). | If you're touching `server/`. |

## 4. Reuse these; do not reimplement them

Same spirit as BACKEND-HANDOFF.md §4: a second copy of any of this is exactly the
drift the split was for.

```ts
client/src/sim/economy.ts       // perceivedValue(), economyTick(), runDailyBooks(), DAILY_INTEREST
client/src/sim/park.ts          // builtValue(), parkValue(), parkRating() -- pre-existing
client/src/sim/finance.ts       // earn/spend/unearn/unspend -- pre-existing, only writer of funds
client/src/sim/guests.ts        // createGuest(), updateGuest() -- the Guest *class* (color/name/
                                 // draw()) is still main.ts; this is its sim-owned half
client/src/render/camera.ts     // toScreen/camOffset/toMap, TILE_W/TILE_H
client/src/render/iso.ts        // drawPoly/drawPolyN/drawIsoDeck/drawPadFence, PAD_W/PAD_H, tileHash
client/src/render/clock.ts      // simClock/isNight -- read directly, single writer each (see §6)
client/src/render/sprites/      // one draw function per attraction, all take ctx explicitly
```

`tests/portability.spec.ts` (Node, no DOM) and `scripts/check-sim-boundary.mjs`
are the two things that fail if `sim/` reaches for the DOM again. Keep both
green.

## 5. Traps, found by running the thing rather than reading about it

**`typescript-eslint` cannot run on this project's TypeScript version.**
`package.json` pins `typescript@^7.0.2`. `typescript-eslint` 8.66.0 (latest
published as of this writing) throws `"typescript-eslint does not support
TS 7.0"` at *require time* — not a peer-dependency warning, a hard crash.
`npm install --legacy-peer-deps` does not route around it; the guard is in
their own code, tracked at
[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940).
The fallback plan — skip typescript-eslint, walk the AST with the `typescript`
package's own compiler API — also doesn't work: TS 7 restructured the package
so `require('typescript')` exposes only `{ version, versionMajorMinor }`; the
classic `createSourceFile`/`forEachChild` API most tooling is built on now
lives under explicitly-`unstable/ast/*` subpaths with no stability guarantee.
`scripts/check-sim-boundary.mjs` does the same two checks (import specifiers,
a handful of bare global identifiers) via plain text scanning instead. `npm
run lint` runs it — read its own header comment before assuming this is
solved differently now; check the linked issue for whether typescript-eslint
has shipped TS 7 support before trying to swap back to real ESLint.

**`strictNullChecks: false` breaks `if (!x.ok)` narrowing on discriminated
unions.** This tsconfig is deliberately loose (see its own comments — a
ratchet order is planned: `noImplicitAny` → `strictNullChecks` → `strict`).
One real consequence: `type Result = { ok: true; ... } | { ok: false; reason:
... }`, then `if (!result.ok) { result.reason }` fails to narrow and TS
reports `reason` doesn't exist — but `if (result.ok === false) { result.reason
}` narrows correctly. Confirmed with an isolated repro before believing it;
it's a real TS behavior under this specific flag combination, not a fluke.
Search `sim/staff.ts`'s `HireResult` for the pattern already in use.

**`drawTrashCan`'s signature is `(ctx, cx, cy, state?)`, not `(ctx, state, cx,
cy)`.** It's the one sprite function that needs `GameState` (for the litter
overflow indicator), and the uniform `SpriteFn` type every other sprite
satisfies is `(ctx, cx, cy, state?) => void` — state trailing and optional so
everything else can just ignore the extra argument `render()` always passes.
If you add a sprite that needs more context than `(ctx, cx, cy)`, follow this
shape rather than inventing a new one.

**The minimap's "starts on but looks off" bug (ARCHITECTURE.md §3.7) — FIXED
since this was written**, and the description below is kept because it explains
what was wrong. `minimapOn` now initialises `false` to match the markup.
`minimapOn` initializes `true` but `#minimap-wrap` ships with the `hidden`
class already on it in the HTML, so it takes two toggles to actually show.
Don't "fix" this by accident while touching `render/minimap.ts` without
meaning to. It was fixed the second way (`minimapOn` initialised to match the
markup). Note that `tests/smoke.spec.ts` had been *asserting the bug* — click
once expects hidden, click twice expects visible — so a green suite was holding
it in place; that test was corrected at the same time.

**RESOLVED — the Blender loose end became the art pipeline.** This section used
to say a Blender MCP server had been registered (`claude mcp add blender --
uvx blender-mcp`) for "a 3D-asset pipeline question that never got resumed",
that it wasn't clear what it was for, and to ask Chris before touching it.
That question got answered: **every sprite in the game is now pre-rendered in
Blender**, which works because the game's 2:1 dimetric projection is one an
orthographic camera reproduces exactly. See
[ARCHITECTURE.md §9](ARCHITECTURE.md#9-rendering--the-baked-sprite-pipeline)
for the design and the README's Graphics section for how to run it. Nothing
here is a live question any more.

(Still true and worth keeping: a **new Claude Code session must start** before
the Blender MCP tools become visible, if the server was registered while a
session was already running.)

## 6. Decisions already made

Please don't re-litigate these without a reason.

- **`render()`, `handleInteraction`, and `buildInCell` stay in `main.ts`.**
  Not an oversight — `render()` alone would need ~15 parameters (camera state,
  `currentTool`, `hoveredCell`, `inspectedGuest`, the `SPRITES` table, ...) to
  fully extract, for little real gain: it already calls clean, `ctx`-explicit
  building blocks from `render/`. At that point `main.ts` acting as the
  composition root matches ARCHITECTURE.md §4.2's own target layout
  ("`main.js`: bootstrap, wires sim + renderer + UI") rather than being code
  that's still tangled.
- **`simClock`/`isNight` live in `render/clock.ts`**, exported as mutable
  `let`s with exactly one writer each (`advanceSimClock()` from the
  fixed-timestep loop, `setIsNight()` from `updateUI()`) — both still in
  `main.ts`. Same shape as `render/iso.ts`'s `PAD_W`/`PAD_H` and
  `ui/management.ts`'s `mgmtTab`: single canonical owner, direct read-only
  import everywhere else.
- **`fireworksActive`/`fireworksTimer` deliberately stay in `main.ts`**, not
  `render/clock.ts` — they're written from three places
  (`evaluateAwards`/`checkObjectives`/`economyTick`'s wrappers) that haven't
  moved. `render/fireworks.ts`'s `updateFireworks()` takes the current value
  as a parameter rather than owning it.
- **Seeded RNG is still deferred** (was phase 5, ARCHITECTURE.md §8 already
  called this out before phase 4 started). `Math.random()` is called directly
  throughout `sim/litter.ts`, `sim/rides.ts`, `sim/staff.ts`, `sim/guests.ts`,
  `sim/economy.ts` — each says so in a comment. `scripts/check-sim-boundary.mjs`
  deliberately does not flag it yet; add that check when seeded RNG lands, not
  before (it would fail on all five files today for a thing nothing depends
  on yet).
- **`anchorOf` save bloat (ARCHITECTURE.md §3.6, the harder half) is
  deliberately still open, staying in phase 6.** It's derivable from `map` +
  content (verified: footprints only ever extend down-right from their
  anchor, so a deterministic scan reconstructs it exactly) but removing it
  from `GameState` — matching how `rating`/`builtValue` were fixed in §3.5 —
  means updating ~15+ read sites across `sim/staff.ts`, `sim/rides.ts`,
  `sim/guests.ts`, and `main.ts`. A real redesign, not a bug fix; asked
  Chris directly rather than guessing, and he chose to defer it. The litter
  leak (the other half of §3.6 — bulldozing never deleted a path's `litter`
  entry) **is** fixed.
- **Worked directly on `main`, not a branch/PR.** This deviates from
  BACKEND-HANDOFF.md §8's stated repo convention ("branch and open a PR --
  Beau is still working in `client/`"). Chris chose this explicitly when
  asked. **If Beau has local uncommitted or unpushed changes to `client/`,
  they will need to merge carefully against 23 commits that touched nearly
  every file under `client/src/`** — this is exactly the collision the
  branch-and-PR convention exists to avoid, and it didn't happen this time
  because Chris made the call knowing that.

## 7. If you're the next person touching this

- **Phase 6, the rest of it:** the `anchorOf` redesign above, plus whatever
  migration-tooling questions ARCHITECTURE.md §7 still leaves open.
- **The ESLint situation**: check whether typescript-eslint has shipped TS 7
  support before assuming `scripts/check-sim-boundary.mjs` needs to stay
  forever. It was a fallback, not a preference.
- **Seeded RNG**, if trust model C (server-authoritative replay) ever becomes
  worth it. Not needed for anything currently planned.
- **Everything else** — this file was only ever about phase 4, and phase 4 is
  done. Whatever's actually next for the game is a separate conversation.

## 8. Exact state as of this handoff

```
HEAD: 264aa13  docs: mark phase 4 done, catch up README's stale backend status
Branch: main, pushed, working tree clean
main.ts: 1,567 lines (was 4,718 before this session)
npm test: 55 passed, 6 skipped (server-integration tests, need `npm run worker:dev`)
npm run build: clean
npm run lint: clean (scripts/check-sim-boundary.mjs, 11 files scanned)
```
