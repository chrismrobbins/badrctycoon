/**
 * Award predicates and the two totals they're built from.
 *
 * Metadata (label, icon, rating) lives in content/awards.ts because
 * parkRating() and the server both need the rating as data. The predicates
 * live here because they read live simulation state.
 */
import type { GameState } from '../core/state';
import { AWARDS, type AwardDef } from '../content/awards';
import { BUILD_DATA } from '../content';
import { parkValue } from './park';
import { getSceneryBonusAt } from './scenery';

export function countType(state: GameState, types: string[]): number {
  let n = 0;
  for (let x = 0; x < state.gridSize; x++)
    for (let y = 0; y < state.gridSize; y++)
      if (types.includes(state.map[x][y])) n++;
  return n;
}

export function totalExcitement(state: GameState): number {
  let t = 0;
  for (const key in state.rideQueues) {
    const [ax, ay] = key.split(',').map(Number);
    const type = state.map[ax]?.[ay];
    if (type && BUILD_DATA[type]) t += BUILD_DATA[type].excitement + getSceneryBonusAt(state, ax, ay);
  }
  return t;
}

const AWARD_TESTS: Record<string, (state: GameState) => boolean> = {
  clean: (s) => s.cleanliness >= 92 && s.guests >= 15,
  value: (s) => s.admissionPrice <= 10 && s.parkHappiness >= 70 && s.guests >= 20,
  thrill: (s) => totalExcitement(s) >= 400,
  safe: (s) =>
    Object.values(s.rideQueues).length >= 4 &&
    Object.values(s.rideQueues).every((q) => (q.breakdowns || 0) === 0),
  staffed: (s) => s.staff.length >= 4 && s.guests >= 25 && s.cleanliness >= 80,
  beauty: (s) => countType(s, ['tree', 'flowerbed', 'fountain']) >= 20,
  tycoon: (s) => parkValue(s) >= 100000,
};

export const AWARD_DEFS: (AwardDef & { test: (state: GameState) => boolean })[] = AWARDS.map((a) => ({
  ...a,
  test: AWARD_TESTS[a.id],
}));

// An award with no predicate can never be won, and one with no metadata scores
// zero rating. Fail at startup rather than either.
{
  const missing = AWARDS.filter((a) => !AWARD_TESTS[a.id]).map((a) => a.id);
  const orphans = Object.keys(AWARD_TESTS).filter((id) => !AWARDS.some((a) => a.id === id));
  if (missing.length) throw new Error(`[awards] no test for: ${missing.join(', ')}`);
  if (orphans.length) throw new Error(`[awards] test with no definition: ${orphans.join(', ')}`);
}

/**
 * Checks every not-yet-won award against current state and records any newly
 * won ones on state.awardsWon. Returns the ones just won so the caller can
 * handle the side effects (event log, fireworks, sound) that belong to
 * ui/render, not sim.
 */
export function evaluateAwards(state: GameState): AwardDef[] {
  const won: AwardDef[] = [];
  for (const a of AWARD_DEFS) {
    if (state.awardsWon.some((w) => w.id === a.id)) continue;
    let passed = false;
    try {
      passed = a.test(state);
    } catch {
      passed = false;
    }
    if (passed) {
      state.awardsWon.push({ id: a.id, day: state.dayCount });
      won.push(a);
    }
  }
  return won;
}
