/**
 * Portraits: showing a character's actual sprite inside a DOM panel.
 *
 * The guest inspector used to show a coloured dot next to the name, and the
 * staff list a Font Awesome glyph. Both were standing in for art that didn't
 * exist -- now it does, and a card that shows you the person you clicked
 * beats one that shows you a swatch.
 *
 * These are CSS background crops of the same PNG the renderer blits, not a
 * second copy of the art and not a canvas: the browser has the sheet cached
 * already, so a portrait costs one <span> and no extra bytes.
 *
 * Why crop: a sheet cell is mostly empty space. The model's feet sit at the
 * frame centre (that's the blit anchor the renderer needs) and the figure is
 * only ~20px tall in a 64-72px box, so showing the whole cell would render a
 * tiny person adrift in padding. CROPS below frame just the figure.
 */

import { STRIPS, PACK_SCALE, type GeneratedStrip } from './sprites/generated-strips';

interface Crop {
  /** Region of one logical cell containing the figure, in logical px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Tuned against the models in scripts/blender/attractions.py: the figure
 * stands with its feet at the cell's vertical centre and reaches ~21px up
 * (guests) or ~27px (staff, whose hats and mascot ears are taller).
 */
const CROPS: Record<string, Crop> = {
  guest: { x: 12, y: 6, w: 24, h: 32 },
  staff: { x: 14, y: 4, w: 28, h: 38 },
};

/** Frame and facing used for a portrait: mid-stride reads as alive, and
 *  facing index 1 is the one that turns the figure toward the viewer. */
const PORTRAIT_FRAME = 0;
const PORTRAIT_FACING = 1;

/**
 * Inline style for a <span> showing one cell of a sheet.
 *
 * `zoom` is CSS px per logical px. At 2 the crop is displayed at the sheet's
 * native resolution, which is the sharpest it can be.
 */
export function portraitStyle(id: string, row: number, zoom = 2): string {
  const g: GeneratedStrip | undefined = STRIPS[id];
  const crop = CROPS[id];
  if (!g || !crop) return 'display:none;';

  // background-size is the whole sheet scaled so 1 logical px = `zoom` CSS px.
  const sheetW = g.frames * g.w * zoom;
  const sheetH = g.variants * g.h * zoom;
  const offX = (PORTRAIT_FRAME * g.w + crop.x) * zoom;
  const offY = (row * g.h + crop.y) * zoom;

  return [
    'display:inline-block',
    `width:${crop.w * zoom}px`,
    `height:${crop.h * zoom}px`,
    `background-image:url(/sprites/${id}.png)`,
    `background-size:${sheetW}px ${sheetH}px`,
    `background-position:-${offX}px -${offY}px`,
    'background-repeat:no-repeat',
    'flex:none',
  ].join(';');
}

/** Portrait of a guest, given their shirt colour index (see guestsprite.ts). */
export function guestPortraitStyle(colorRow: number, zoom = 2): string {
  return portraitStyle('guest', colorRow * 4 + PORTRAIT_FACING, zoom);
}

/** Portrait of a worker, given their outfit index (see staffsprite.ts). */
export function staffPortraitStyle(outfit: number, zoom = 2): string {
  return portraitStyle('staff', outfit * 4 + PORTRAIT_FACING, zoom);
}

/** PACK_SCALE is re-exported so callers can reason about crispness: a zoom
 *  above this is upscaling a bitmap. */
export { PACK_SCALE };
