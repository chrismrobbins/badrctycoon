/**
 * Pre-rendered sprite strips: Blender-baked frames blitted in place of a
 * hand-written canvas draw function.
 *
 * The source of an individual strip is its Blender script under
 * scripts/blender/ -- e.g. scripts/blender/carousel.py -- packed into
 * client/public/sprites/<name>.png by scripts/blender/pack-strip.mjs. The PNG
 * is a build artifact; regenerate it, don't hand-edit it.
 *
 * Three things this module is careful about, all of which bit during the
 * carousel pilot:
 *
 * 1. LOADING IS ASYNC, RENDERING IS NOT. render() runs every frame from the
 *    first tick; the PNG lands some tens of ms later. Every strip therefore
 *    carries a `fallback` -- the original vector draw function -- and draw()
 *    silently uses it until `ready` flips. The park is never blank and never
 *    pops a missing-tile hole, and if the PNG 404s in production the game
 *    degrades to exactly the art it shipped with before.
 *
 * 2. STRIPS ARE PACKED AT 2x. The renderer clamps zoom to [0.4, 1.8]
 *    (main.ts), so a 1x strip would soften noticeably when zoomed in. Frames
 *    are stored at twice the logical size and drawn down into the logical box.
 *
 * 3. ANIMATION PHASE COMES FROM simClock, NOT wall time. simClock freezes
 *    while the game is paused (render/clock.ts), so a paused carousel stops
 *    turning -- matching every other animated sprite, and matching the vector
 *    version this replaces.
 */

import { simClock } from './clock';

export interface StripSpec {
  /** URL of the packed strip, served out of client/public/. */
  src: string;
  /** Number of frames laid out left-to-right. */
  frames: number;
  /** Logical draw size in world px -- what the sprite occupies on the map. */
  w: number;
  h: number;
  /** Anchor within the logical box that lands on the tile centre. */
  anchorX: number;
  anchorY: number;
  /** Multiple of the logical size the PNG is actually stored at. */
  packScale: number;
  /** Simulated ms for one full animation loop. */
  msPerLoop: number;
  /** Drawn until the PNG is available -- the art this strip replaces. */
  fallback: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void;
}

export interface Strip {
  readonly ready: boolean;
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number): void;
}

export function loadStrip(spec: StripSpec): Strip {
  let img: HTMLImageElement | null = null;
  let ready = false;

  // Guarded so importing render/ outside a browser (a Node-side smoke import,
  // a future SSR pass) degrades to the vector art instead of throwing on
  // `new Image()`. sim/ is the module tree that's *required* to be headless,
  // but there's no reason to make render/ gratuitously un-importable.
  if (typeof Image !== 'undefined') {
    img = new Image();
    img.onload = () => {
      ready = true;
    };
    // A 404 or decode failure is not fatal: `ready` stays false forever and
    // every draw keeps using the fallback.
    img.onerror = () => {
      console.warn(`[atlas] ${spec.src} failed to load; using vector fallback`);
    };
    img.src = spec.src;
  }

  const fw = spec.w * spec.packScale;
  const fh = spec.h * spec.packScale;

  return {
    get ready() {
      return ready;
    },
    draw(ctx, cx, cy) {
      if (!ready || !img) {
        spec.fallback(ctx, cx, cy);
        return;
      }
      // Modulo before the multiply keeps this exact for arbitrarily large
      // simClock values rather than drifting once the float gets big.
      const phase = (simClock % spec.msPerLoop) / spec.msPerLoop;
      const frame = Math.floor(phase * spec.frames) % spec.frames;
      ctx.drawImage(
        img,
        frame * fw, 0, fw, fh,
        cx - spec.anchorX, cy - spec.anchorY, spec.w, spec.h,
      );
    },
  };
}
