/**
 * Values derived from the park itself.
 *
 * `rating` and `builtValue` used to be accumulators — `+=` on build, `-=` on
 * demolish, `+=` again when an award was won. Two problems with that:
 *
 *   1. Any code path that forgot to adjust them drifted the number permanently,
 *      and several did (ARCHITECTURE §3.3, §3.5).
 *   2. The server could not check them. A client asserting "my park is worth
 *      $2,000,000" could not be contradicted, because there was nothing to
 *      recompute the claim against.
 *
 * They are functions of the map now, so both problems go away: drift is
 * impossible, and the server recomputes exactly these numbers and rejects a
 * mismatch (API-CONTRACT.md checks 7 and 10).
 *
 * Cost is O(gridSize²) — at most 1,225 cells — called a handful of times per
 * 1.5s economy tick. Cache it if that ever shows up in a profile; it does not
 * today.
 */

import { BUILD_DATA } from '../content';
import { AWARD_BY_ID } from '../content/awards';
import type { GameState } from '../core/state';

/**
 * Walk every placed attraction exactly once.
 *
 * Multi-tile structures occupy several cells but must only count once, so cells
 * are folded back to their anchor via `anchorOf`. The park gate is not an
 * attraction and is skipped.
 */
function eachPlaced(state: GameState, visit: (id: string) => void): void {
  const counted = new Set<string>();
  for (let x = 0; x < state.gridSize; x++) {
    for (let y = 0; y < state.gridSize; y++) {
      const cell = state.map[x]?.[y];
      if (!cell || cell === 'entrance') continue;
      const a = state.anchorOf[`${x},${y}`];
      const key = a ? `${a.ax},${a.ay}` : `${x},${y}`;
      if (counted.has(key)) continue;
      counted.add(key);
      visit(cell);
    }
  }
}

/** Total construction cost of everything standing. */
export function builtValue(state: GameState): number {
  let total = 0;
  eachPlaced(state, (id) => { total += BUILD_DATA[id]?.cost ?? 0; });
  return total;
}

/** Rating contributed by the buildings themselves. */
export function mapRating(state: GameState): number {
  let total = 0;
  eachPlaced(state, (id) => { total += BUILD_DATA[id]?.rating ?? 0; });
  return total;
}

/** Rating contributed by awards won. Unknown ids score zero rather than throw,
 *  so a save referencing a removed award still loads. */
export function awardRating(state: GameState): number {
  return state.awardsWon.reduce((sum, w) => sum + (AWARD_BY_ID[w.id]?.rating ?? 0), 0);
}

/** The park rating shown in the status bar. */
export function parkRating(state: GameState): number {
  return mapRating(state) + awardRating(state);
}

/** Cash plus everything built. */
export function parkValue(state: GameState): number {
  return state.funds + builtValue(state);
}
