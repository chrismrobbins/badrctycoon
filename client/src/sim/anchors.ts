/**
 * Anchor derivation — ARCHITECTURE.md §3.6, the half that stayed open.
 *
 * A multi-tile attraction occupies an n×n block, and every tile of it needs to
 * know which tile is the anchor (the one that owns the ride's queue, name and
 * sprite). That lookup used to be a `Record<string, Anchor>` PERSISTED in the
 * save: pure duplication of what `map` already says, and — worse — a second
 * copy that could disagree with it. Any code path that edited `map` without
 * editing `anchorOf` in the same breath left the two out of step permanently,
 * exactly like the `rating`/`builtValue` accumulators §3.5 removed.
 *
 * It is now derived. `anchorOf` survives on `GameState` as a lookup table, but
 * it is a CACHE with a single writer (this file), stripped at save and rebuilt
 * from `map` on load and after every mutation. Nothing else may assign to it.
 *
 * WHY A ROW-MAJOR SCAN IS UNAMBIGUOUS
 *
 * Footprints only ever extend down-right from their anchor, and blocks never
 * overlap. That is not quite enough on its own: two 2×2 haunted houses side by
 * side at (0,0) and (2,0) cover one solid 4×2 rectangle of identical tiles, and
 * looking at any single tile cannot tell you which house it belongs to.
 *
 * Scanning row-major fixes that. The first not-yet-claimed tile encountered
 * MUST be an anchor — nothing above it or to its left is unclaimed, so no other
 * block could reach it. Claim its whole n×n footprint and continue. That
 * decomposes the rectangle into (0,0) and (2,0) exactly, and generalises to any
 * legal arrangement.
 *
 * The scan is O(tiles), runs on build/demolish/undo/load rather than per frame,
 * and is trivial next to a single render pass.
 */

import type { GameState, Anchor } from '../core/state';
import { BUILD_DATA } from '../content';

/**
 * Rebuild `state.anchorOf` from `state.map`.
 *
 * The ONLY writer. Call it after anything that changes the map; do not patch
 * individual entries, which is the drift this exists to prevent.
 */
export function rebuildAnchors(state: GameState): void {
  const out: Record<string, Anchor> = {};
  const size = state.gridSize;
  const claimed: boolean[] = new Array(size * size).fill(false);

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (claimed[x * size + y]) continue;
      const cell = state.map[x]?.[y];
      if (!cell) continue;
      const sz = BUILD_DATA[cell]?.size || 1;
      if (sz <= 1) continue; // 1×1 tiles are their own anchor; storing that is noise

      // First unclaimed tile of a multi-tile type is necessarily its anchor.
      for (let dx = 0; dx < sz; dx++) {
        for (let dy = 0; dy < sz; dy++) {
          const tx = x + dx;
          const ty = y + dy;
          // Guard the edges: a save truncated or hand-edited could leave a
          // footprint hanging off the grid, and we would rather map the tiles
          // that do exist than throw on load.
          if (tx >= size || ty >= size) continue;
          if (state.map[tx]?.[ty] !== cell) continue;
          claimed[tx * size + ty] = true;
          out[`${tx},${ty}`] = { ax: x, ay: y };
        }
      }
    }
  }

  state.anchorOf = out;
}

/**
 * The anchor tile for (x, y) — itself when the tile isn't part of a block.
 *
 * Prefer this to reaching into `anchorOf` directly: it encodes the "a 1×1 is
 * its own anchor" rule that every call site otherwise has to remember, and it
 * keeps the table's absence from meaning something different at each one.
 */
export function anchorAt(state: GameState, x: number, y: number): Anchor {
  return state.anchorOf[`${x},${y}`] || { ax: x, ay: y };
}

/** True when (x, y) is the anchor of whatever occupies it. */
export function isAnchor(state: GameState, x: number, y: number): boolean {
  const a = state.anchorOf[`${x},${y}`];
  return !a || (a.ax === x && a.ay === y);
}
