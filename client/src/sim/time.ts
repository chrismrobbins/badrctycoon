/**
 * Whether a given game-time hour counts as "night" for sim bonuses and
 * rendering. Single formula both draw on so they can't drift apart — main.ts's
 * `isNight` module variable is set to `isNightAt(S.gameTime)` in updateUI(),
 * and every night-bonus check in sim/ calls this directly instead of reading
 * that variable.
 */
export function isNightAt(gameTime: number): boolean {
  const hour = gameTime % 24;
  return hour >= 19 || hour < 6;
}
