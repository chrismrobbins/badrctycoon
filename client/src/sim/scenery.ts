import type { GameState } from '../core/state';
import { BUILD_DATA, SCENERY_TYPES } from '../content';
import { isNightAt } from './time';

/**
 * Excitement/rating bonus a ride or shop gets from scenery within a 3-tile
 * radius of its footprint, plus each piece's night bonus after dark. Read by
 * the ride inspector panel and by the awards check (totalExcitement).
 */
export function getSceneryBonusAt(state: GameState, ax: number, ay: number): number {
  let bonus = 0;
  const radius = 3;
  const data = BUILD_DATA[state.map[ax]?.[ay]];
  const sz = data ? data.size : 1;
  const night = isNightAt(state.gameTime);
  for (let ox = -radius; ox < sz + radius; ox++) {
    for (let oy = -radius; oy < sz + radius; oy++) {
      const cx = ax + ox, cy = ay + oy;
      if (cx < 0 || cx >= state.gridSize || cy < 0 || cy >= state.gridSize) continue;
      const cell = state.map[cx][cy];
      if (cell && SCENERY_TYPES.has(cell)) {
        const sd = BUILD_DATA[cell];
        bonus += sd.sceneryBonus;
        if (night && sd.nightBonus) bonus += sd.nightBonus;
      }
    }
  }
  return bonus;
}
