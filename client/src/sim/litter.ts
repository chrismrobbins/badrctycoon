import type { GameState } from '../core/state';

/**
 * NOTE: dropLitter() still calls Math.random() directly. Seeded RNG (see
 * ARCHITECTURE.md §8) is deliberately deferred -- it only matters if trust
 * model C (server-authoritative replay) is ever adopted, and nothing depends
 * on it today. Flag this file when that lands.
 */

export function litterAt(state: GameState, x: number, y: number): number {
  return state.litter[`${x},${y}`] || 0;
}

export function dropLitter(state: GameState, x: number, y: number): void {
  // A trash can within 2 tiles almost always prevents littering.
  for (let ox = -2; ox <= 2; ox++) {
    for (let oy = -2; oy <= 2; oy++) {
      if (state.map[x + ox]?.[y + oy] === 'trashcan' && Math.random() < 0.9) return;
    }
  }
  const k = `${x},${y}`;
  state.litter[k] = Math.min(3, (state.litter[k] || 0) + 1);
}

export function recomputeCleanliness(state: GameState): void {
  let paths = 0;
  let dirty = 0;
  for (let x = 0; x < state.gridSize; x++) {
    for (let y = 0; y < state.gridSize; y++) {
      if (state.map[x][y] === 'path') {
        paths++;
        dirty += litterAt(state, x, y);
      }
    }
  }
  state.cleanliness = paths ? Math.max(0, 100 - (dirty / paths) * 55) : 100;
}
