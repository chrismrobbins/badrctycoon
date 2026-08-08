/**
 * Pre-rendered sprite sheets: Blender-baked frames blitted in place of a
 * hand-written canvas draw function.
 *
 * Geometry lives in scripts/blender/attractions.py; the sheets are packed by
 * scripts/blender/pack-strip.mjs into client/public/sprites/ and described by
 * the generated table in sprites/generated-strips.ts. The PNGs are build
 * artifacts -- regenerate them, don't hand-edit them.
 *
 * SHEET LAYOUT: columns are animation frames, rows are tileHash variants.
 * Frame f of variant v sits at (f * frameW, v * frameH). Sheets are stored at
 * PACK_SCALE (2x) the logical size and drawn down into it.
 *
 * Four things this module is careful about, each of which bit during the
 * conversion:
 *
 * 1. LOADING IS ASYNC, RENDERING IS NOT. render() runs every frame from the
 *    first tick; the PNG lands tens of ms later. Every strip carries a
 *    `fallback` -- the original vector draw function -- used until `ready`
 *    flips. The park is never blank, and if a sheet 404s in production the
 *    game degrades to exactly the art it shipped with before.
 *
 * 2. THE FALLBACK ALREADY DRAWS NIGHT. `overlay` is applied ONLY on the baked
 *    path. Calling it alongside the fallback would double-draw every lit
 *    window and bulb.
 *
 * 3. ANIMATION PHASE COMES FROM simClock, NOT wall time, so sprites freeze
 *    when the game is paused -- matching the vector art they replace.
 *    `msPerLoop` is set per sprite to the period of the animation it took
 *    over, so nothing changes speed.
 *
 * 4. VARIANTS USE THE SAME tileHash THE VECTOR ART USED, so a given tile
 *    keeps the same tree species / occupied bench it had before.
 */

import { simClock } from './clock';
import { tileHash } from './iso';
import type { GameState } from '../core/state';
import { PACK_SCALE, type GeneratedStrip } from './sprites/generated-strips';

export type DrawFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, state?: GameState) => void;

export interface StripOptions {
  /** Simulated ms for one full animation loop. Match the vector original. */
  msPerLoop: number;
  /** Drawn until the sheet is available -- the art this strip replaces. */
  fallback: DrawFn;
  /**
   * Canvas drawn on top of the blit: night lights, and anything reading
   * GameState. NOT called on the fallback path, which already includes it.
   */
  overlay?: DrawFn;
}

export interface Strip {
  readonly ready: boolean;
  draw: DrawFn;
}

export interface Sheet {
  readonly ready: boolean;
  /**
   * Blit one cell, centred on (cx, cy). `col` is the animation frame and
   * `row` the variant; both are taken modulo the sheet's real dimensions, so
   * a caller computing a row from game state can't read off the end of the
   * image and blit blank pixels.
   */
  drawCell(ctx: CanvasRenderingContext2D, cx: number, cy: number, col: number, row: number): void;
}

/**
 * Lower-level accessor: a sheet addressed by explicit (col, row).
 *
 * loadStrip() below is this plus a policy for picking those two numbers from
 * simClock and tileHash, which is right for anything sitting on a tile. Guests
 * are not on a tile -- their row is shirt colour x facing, chosen per guest --
 * so they use this directly.
 */
export function loadSheet(id: string, g: GeneratedStrip): Sheet {
  let img: HTMLImageElement | null = null;
  let ready = false;

  if (typeof Image !== 'undefined') {
    img = new Image();
    img.onload = () => {
      ready = true;
    };
    img.onerror = () => {
      console.warn(`[atlas] /sprites/${id}.png failed to load`);
    };
    img.src = `/sprites/${id}.png`;
  }

  const fw = g.w * PACK_SCALE;
  const fh = g.h * PACK_SCALE;

  return {
    get ready() {
      return ready;
    },
    drawCell(ctx, cx, cy, col, row) {
      if (!ready || !img) return;
      const c = ((col % g.frames) + g.frames) % g.frames;
      const r = ((row % g.variants) + g.variants) % g.variants;
      ctx.drawImage(img, c * fw, r * fh, fw, fh, cx - g.w / 2, cy - g.h / 2, g.w, g.h);
    },
  };
}

export function loadStrip(id: string, g: GeneratedStrip, opts: StripOptions): Strip {
  let img: HTMLImageElement | null = null;
  let ready = false;

  // Guarded so importing render/ outside a browser degrades to the vector art
  // instead of throwing on `new Image()`. sim/ is the tree that MUST stay
  // headless, but there's no reason to make render/ gratuitously unimportable.
  if (typeof Image !== 'undefined') {
    img = new Image();
    img.onload = () => {
      ready = true;
    };
    img.onerror = () => {
      console.warn(`[atlas] /sprites/${id}.png failed to load; using vector fallback`);
    };
    img.src = `/sprites/${id}.png`;
  }

  const fw = g.w * PACK_SCALE;
  const fh = g.h * PACK_SCALE;
  const halfW = g.w / 2;
  const halfH = g.h / 2;

  return {
    get ready() {
      return ready;
    },
    draw(ctx, cx, cy, state) {
      if (!ready || !img) {
        opts.fallback(ctx, cx, cy, state);
        return;
      }

      // Modulo before the multiply, so this stays exact once simClock is
      // large rather than losing precision in the product.
      const frame =
        g.frames > 1
          ? Math.floor(((simClock % opts.msPerLoop) / opts.msPerLoop) * g.frames) % g.frames
          : 0;

      // Same hash the vector art used, so a tile keeps the species/pose it
      // had before the swap. Clamped because tileHash can return exactly 1.
      const variant =
        g.variants > 1 ? Math.min(g.variants - 1, Math.floor(tileHash(cx, cy) * g.variants)) : 0;

      ctx.drawImage(
        img,
        frame * fw, variant * fh, fw, fh,
        cx - halfW, cy - halfH, g.w, g.h,
      );

      opts.overlay?.(ctx, cx, cy, state);
    },
  };
}
