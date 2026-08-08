/**
 * Render-only timing state -- read by nearly every sprite draw function for
 * animation phase and day/night tinting, written by exactly one place each.
 * Exported as mutable pairs with a setter, same "single writer" pattern as
 * render/iso.ts's PAD_W/PAD_H.
 */

/** Simulated milliseconds. Frozen while paused, so animations pause with the
 *  game and the same tick always renders the same frame. main.ts's
 *  fixed-timestep loop is the sole writer, via advanceSimClock(). */
export let simClock = 0;
export function advanceSimClock(ms: number): void {
  simClock += ms;
}

/** Whether it's currently night, for lighting/tinting. Derived from
 *  state.gameTime in ui/statusbar.ts's updateStatusBar(); main.ts's
 *  updateUI() wrapper is the sole writer, via setIsNight(). */
export let isNight = false;
export function setIsNight(v: boolean): void {
  isNight = v;
}
