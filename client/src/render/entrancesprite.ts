/**
 * The baked park entrance.
 *
 * Model: scripts/blender/attractions.py's build_entrance(). One row per camera
 * angle, no animation frames.
 *
 * This one earns its place for a reason the other sprites don't: in a fresh
 * park the grass and the perimeter fence are perfectly symmetric, so the gate
 * is the ONLY thing on screen that shows which way the park is facing. While
 * it was flat vector art it slid to a different corner on every rotation
 * without ever turning, which made the whole rotate feature read as "the map
 * moved sideways" rather than "the map turned" -- reported as exactly that.
 *
 * Known gap: the vector gate twinkled its arch bulbs at night (the `isNight`
 * block inside drawEntrance). That is not baked, and the entrance is not in
 * the SPRITES table, so it has no overlay hook. The gate is lit-looking but
 * static after dark.
 */

import { loadSheet } from './atlas';
import { rotation } from './camera';
import { STRIPS } from './sprites/generated-strips';

const g = STRIPS.entrance;
const sheet = g ? loadSheet('entrance', g) : null;

/**
 * Draw the gate centred on the entrance tile. Returns false if the sheet
 * hasn't decoded yet, so the caller can fall back to the vector art.
 */
export function drawEntranceSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number): boolean {
  if (!sheet?.ready || !g) return false;
  // rot is 4 here, so the row IS the camera angle.
  sheet.drawCell(ctx, cx, cy, 0, g.rot > 1 ? rotation : 0);
  return true;
}
