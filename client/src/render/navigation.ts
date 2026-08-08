/**
 * Keyboard camera movement.
 *
 * Getting around the park used to require a middle click, a right click, or
 * Shift+drag -- none of which a player discovers -- and there was no keyboard
 * movement at all. This module is the held-key bookkeeping and the speed
 * policy for WASD/arrow panning.
 *
 * It deliberately does NOT own panX/panY/zoom. render/camera.ts's comment
 * calls out that camera state stays with main.ts's input handlers and is
 * threaded through as explicit arguments; keeping to that means this is a pure
 * helper returning a delta, not a second source of truth for where the camera
 * is.
 *
 * WHY THE DELTA IS COMPUTED PER FRAME RATHER THAN PER KEY EVENT
 * A keydown handler fires once and then repeats at the OS key-repeat rate,
 * which is both delayed and machine-dependent -- held-key panning would stall
 * for half a second and then travel at a different speed on every computer.
 * The handler only records which keys are down; panDelta() is called from the
 * frame loop and scales by that frame's wall-clock delta.
 */

/** Wider than the old [0.4, 1.8]. 0.28 fits a large park on screen; 3.2 is
 *  close enough to read a guest's shirt. Sheets are packed at 2x, so past ~2.0
 *  the art is upscaling -- fine for a deliberate look-closer, which is why the
 *  default stays 1. */
export const MIN_ZOOM = 0.28;
export const MAX_ZOOM = 3.2;

/** Screen px per second at zoom 1 -- about two thirds of a 720p viewport. */
const PAN_SPEED = 900;

/**
 * Screen-space pan direction per key. Positive panX moves the camera origin
 * right, which slides the world right, so "move view left" (A) is +1.
 */
const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, 1],
  arrowup: [0, 1],
  s: [0, -1],
  arrowdown: [0, -1],
  a: [1, 0],
  arrowleft: [1, 0],
  d: [-1, 0],
  arrowright: [-1, 0],
};

const held = new Set<string>();

export function isPanKey(k: string): boolean {
  return k in PAN_KEYS;
}

/** Returns true if the key was consumed, so callers can preventDefault
 *  (arrow keys otherwise scroll the page). */
export function panKeyDown(k: string): boolean {
  if (!(k in PAN_KEYS)) return false;
  held.add(k);
  return true;
}

export function panKeyUp(k: string): boolean {
  return held.delete(k);
}

/** Drop every held key. Without this, tabbing away mid-pan loses the keyup and
 *  the park drifts forever once you come back. */
export function clearHeldKeys(): void {
  held.clear();
}

export function isPanning(): boolean {
  return held.size > 0;
}

/**
 * Screen-space pan delta for one frame.
 *
 * `wallMs` is REAL elapsed time, not sim time: the camera must keep moving
 * while the game is paused. Speed divides by zoom because zoomed in, a screen
 * pixel is a smaller slice of the park, and a fixed pixel rate feels like
 * wading through treacle.
 */
export function panDelta(wallMs: number, zoom: number): { dx: number; dy: number } {
  if (!held.size) return { dx: 0, dy: 0 };
  let dx = 0;
  let dy = 0;
  for (const k of held) {
    const d = PAN_KEYS[k];
    dx += d[0];
    dy += d[1];
  }
  if (!dx && !dy) return { dx: 0, dy: 0 };
  // Normalise so a diagonal isn't 1.41x faster than a straight line.
  const len = Math.hypot(dx, dy);
  const v = (PAN_SPEED * wallMs) / 1000 / Math.max(0.01, zoom);
  return { dx: (dx / len) * v, dy: (dy / len) * v };
}
