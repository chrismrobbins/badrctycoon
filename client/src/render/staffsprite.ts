/**
 * The baked staff sprites.
 *
 * Model: scripts/blender/attractions.py's build_staff(). Six outfits, four
 * facings each, six walk frames -- rows are `outfitIndex * 4 + facing`.
 *
 * OUTFIT ORDER IS A CONTRACT with STAFF_OUTFITS in that script. Inserting an
 * outfit in the middle silently re-costumes the whole park (janitors become
 * clowns, and nothing errors), so append rather than insert, and change both
 * files together.
 *
 * Janitors and mechanics get one workwear outfit each. Entertainers get four,
 * chosen per worker from a hash of their name: a park full of identical clowns
 * is worse than no clowns. The hash means the costume is stable across saves
 * and reloads without adding a field to Staff -- `name` is already persisted,
 * and sim/staff.ts stays unaware that costumes exist at all.
 */

import { loadSheet } from './atlas';
import { rotation } from './camera';
import { STRIPS } from './sprites/generated-strips';
import type { StaffKindId } from '../content';

/** Must match STAFF_OUTFITS in scripts/blender/attractions.py, in order. */
const OUTFITS = ['janitor', 'mechanic', 'clown', 'jester', 'mascot', 'ringmaster'] as const;

/** Entertainer costumes, as indices into OUTFITS. */
const ENTERTAINER_OUTFITS = [2, 3, 4, 5];

/** Must match sim/guests.ts's DIRS, in order -- staff walk the same grid. */
const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

const MS_PER_STRIDE = 700;

const g = STRIPS.staff;
const sheet = g ? loadSheet('staff', g) : null;

/** Stable small hash of a name, so a worker keeps their costume forever. */
function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function outfitIndex(kind: StaffKindId, name: string): number {
  if (kind === 'janitor') return 0;
  if (kind === 'mechanic') return 1;
  return ENTERTAINER_OUTFITS[nameHash(name) % ENTERTAINER_OUTFITS.length];
}

/**
 * Facing index, adjusted for the camera rotation.
 *
 * People need NO extra renders to support map rotation, unlike the buildings:
 * their four facings are already the four 90-degree steps, so viewing a figure
 * facing direction f from a camera rotated by r is identical to viewing a
 * figure facing (f - r) from the unrotated camera. Turning the sheet index is
 * exactly equivalent to re-rendering it, and free.
 */
function dirRow(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 1; // idle: face front-ish rather than away
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < DIRS.length; i++) {
    const dot = DIRS[i][0] * dx + DIRS[i][1] * dy;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return ((best - rotation) % 4 + 4) % 4;
}

/** Row of the sheet for a given worker and heading. */
export function staffRow(kind: StaffKindId, name: string, dx: number, dy: number): number {
  return outfitIndex(kind, name) * DIRS.length + dirRow(dx, dy);
}

/**
 * Draw a worker at screen position (cx, cy) -- their feet.
 * Returns false if the sheet hasn't decoded, so callers can fall back.
 */
export function drawStaffSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  kind: StaffKindId,
  name: string,
  dx: number,
  dy: number,
  phase: number,
): boolean {
  if (!sheet?.ready || !g) return false;
  const frame = Math.floor(((phase % MS_PER_STRIDE) / MS_PER_STRIDE) * g.frames);
  sheet.drawCell(ctx, cx, cy, frame, staffRow(kind, name, dx, dy));
  return true;
}
