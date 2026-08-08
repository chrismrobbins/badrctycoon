import type { GameState } from '../core/state';
import { parkRating, parkValue } from './park';
import * as Fin from './finance';

export interface Objective {
  text: string;
  reward: number;
  check: (state: GameState) => boolean;
}

export const OBJECTIVES: Objective[] = [
  { text: 'Connect a path to the entrance', reward: 250, check: (s) => s.isParkOpen },
  { text: 'Build your first ride', reward: 500, check: (s) => Object.keys(s.rideQueues).length > 0 },
  { text: 'Reach 20 guests', reward: 750, check: (s) => s.guests >= 20 },
  { text: 'Reach a park rating of 500', reward: 1000, check: (s) => parkRating(s) >= 500 },
  { text: 'Sell 25 items at your shops', reward: 1000, check: (s) => s.shopSales >= 25 },
  { text: '75% happiness with 30+ guests', reward: 1500, check: (s) => s.parkHappiness >= 75 && s.guests >= 30 },
  { text: 'Reach $30,000 park value', reward: 2500, check: (s) => parkValue(s) >= 30000 },
  { text: 'Host 100 guests at once', reward: 5000, check: (s) => s.guests >= 100 },
];

/**
 * Advances state.objectiveIndex past every objective that's now satisfied
 * (in order -- objectives are a ladder, not independent), booking each
 * reward through sim/finance.ts. Returns the ones just completed so the
 * caller can handle the event-log/fireworks/save side effects, which are
 * ui/render/persistence concerns, not sim.
 */
export function checkObjectives(state: GameState): Objective[] {
  const completed: Objective[] = [];
  while (state.objectiveIndex < OBJECTIVES.length && OBJECTIVES[state.objectiveIndex].check(state)) {
    const o = OBJECTIVES[state.objectiveIndex];
    Fin.earn(state, o.reward, 'objectives');
    state.objectiveIndex++;
    completed.push(o);
  }
  return completed;
}
