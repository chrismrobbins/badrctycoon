/**
 * The baked guest sprite.
 *
 * Guests were the last thing in the park still drawn as flat vector shapes --
 * a 3px coloured dot -- against twenty pre-rendered attractions. The model is
 * scripts/blender/attractions.py's build_guest().
 *
 * SHEET LAYOUT: columns are the 6 walk-cycle frames; rows are
 * `colourIndex * 4 + directionIndex`. Both lists are ordered to match their
 * sources exactly, and that ordering is the contract between this file and
 * the Blender script:
 *
 *   COLORS  -- main.ts's Guest constructor palette
 *   DIRS    -- sim/guests.ts's DIRS, which is what a guest actually walks
 *
 * Change either list in one place and the guests all face the wrong way or
 * wear the wrong shirt, with no error. Hence resolveColor() taking the guest's
 * own colour string rather than an index: the guest keeps its identity in the
 * save, and a colour that somehow isn't in the list falls back to row 0
 * instead of blitting off the end of the sheet.
 */

import { loadSheet } from './atlas';
import { STRIPS } from './sprites/generated-strips';

/** Must match main.ts's Guest constructor palette, in order. */
const COLORS = ['#ef4444', '#3b82f6', '#eab308', '#ec4899', '#8b5cf6', '#10b981', '#f97316'];

/** Must match sim/guests.ts's DIRS, in order. */
const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** Simulated ms for one full stride. Fast enough to read as walking at the
 *  guest's actual movement speed, slow enough not to scurry. */
const MS_PER_STRIDE = 700;

const g = STRIPS.guest;
const sheet = g ? loadSheet('guest', g) : null;

export const guestSpriteReady = (): boolean => !!sheet?.ready;

function colorRow(color: string): number {
  const i = COLORS.indexOf(color);
  return i < 0 ? 0 : i;
}

/** Nearest of the four walk directions to the guest's current heading. */
function dirRow(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < DIRS.length; i++) {
    // Compare against the unit direction; no need to normalise dx/dy since
    // the same divisor applies to every candidate.
    const dot = DIRS[i][0] * dx + DIRS[i][1] * dy;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

/**
 * Draw a guest at screen position (cx, cy), which is its feet.
 *
 * `phase` is the guest's own animation offset -- passing simClock alone would
 * march an entire park in lockstep, which reads as a formation rather than a
 * crowd.
 */
export function drawGuestSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  dx: number,
  dy: number,
  phase: number,
): boolean {
  if (!sheet?.ready || !g) return false;
  const frame = Math.floor(((phase % MS_PER_STRIDE) / MS_PER_STRIDE) * g.frames);
  sheet.drawCell(ctx, cx, cy, frame, colorRow(color) * DIRS.length + dirRow(dx, dy));
  return true;
}

/** Height of the sprite box, so callers can place things above the head. */
export const GUEST_SPRITE_H = g ? g.h : 0;
