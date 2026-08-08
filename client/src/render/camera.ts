/** Tile half-width/height for the isometric projection. Every draw
 *  coordinate in render/ is authored against these. */
export const TILE_W = 64;
export const TILE_H = 32;

/**
 * Camera rotation, in quarter turns (0..3).
 *
 * A true 3D camera orbit is not available to a 2:1 dimetric sprite renderer,
 * so "spinning the park" is done the way isometric games have always done it:
 * the map is rotated a quarter turn under a fixed camera, and each structure
 * is drawn from a sprite baked at the matching angle.
 *
 * Exported as a mutable `let` with exactly one writer (setRotation, called
 * from main.ts's input handlers) -- the same single-owner pattern as
 * render/clock.ts's simClock and render/iso.ts's PAD_W/PAD_H.
 *
 * IMPORTANT: rotation changes what a screen pixel means, so anything that
 * converts between map and screen space MUST go through rotateTile()/
 * toScreen()/toMap() rather than doing the arithmetic itself. The depth sort
 * in main.ts's render() is the subtle one -- painter's-algorithm order is
 * `rx + ry` in ROTATED space, and using raw x + y silently draws structures
 * through each other at rotations 1-3.
 */
export let rotation = 0;

export function setRotation(r: number): void {
  rotation = ((r % 4) + 4) % 4;
}

/**
 * The grid's size, needed because rotation happens about the grid CENTRE.
 *
 * Held here rather than threaded through toScreen()/toMap() at ~20 call sites:
 * those calls are spread across main.ts, iso.ts, entities.ts, minimap.ts and
 * the sprite modules, and a signature change would have meant touching all of
 * them for a value that is the same everywhere. Single writer (setGridSize,
 * from main.ts at boot and on land expansion), same pattern as simClock.
 */
export let gridSize = 15;

export function setGridSize(n: number): void {
  gridSize = n;
}

/**
 * Rotate a map coordinate about the centre of an N x N grid.
 *
 * Works on fractional coordinates too, which multi-tile blocks need: their
 * centre lands on a half-tile whenever the footprint is even.
 *
 * Rotating about the grid centre (rather than the origin) is what keeps the
 * park in roughly the same place on screen as it spins -- rotating about the
 * origin would fling it off into a corner.
 */
export function rotateTile(x: number, y: number, grid = gridSize, r = rotation): { x: number; y: number } {
  const c = (grid - 1) / 2;
  switch (((r % 4) + 4) % 4) {
    case 1:
      return { x: y, y: 2 * c - x };
    case 2:
      return { x: 2 * c - x, y: 2 * c - y };
    case 3:
      return { x: 2 * c - y, y: x };
    default:
      return { x, y };
  }
}

/** Inverse of rotateTile -- a rotation by -r. */
export function unrotateTile(x: number, y: number, grid = gridSize, r = rotation): { x: number; y: number } {
  return rotateTile(x, y, grid, -r);
}

/**
 * World-space pixel position of a map tile's center -- before the camera
 * transform (pan/zoom) is applied. render()'s main loop applies that
 * transform once via a canvas `translate`/`scale`, so every draw function
 * works in this untransformed space; toMap() below inverts the full
 * transform (including pan/zoom) for hit-testing mouse clicks.
 *
 * Pass `gridSize` to have the map rotation applied. The no-grid overload is
 * kept for the handful of callers drawing in already-rotated space.
 */
export function toScreen(mapX: number, mapY: number): { x: number; y: number } {
  let mx = mapX;
  let my = mapY;
  if (rotation !== 0) {
    const r = rotateTile(mapX, mapY, gridSize);
    mx = r.x;
    my = r.y;
  }
  const x = (mx - my) * (TILE_W / 2);
  const y = (mx + my) * (TILE_H / 2);
  return { x, y };
}

/** Screen-space origin of the map's (0,0) corner, given the current pan.
 *  Camera state (pan/zoom) stays owned by main.ts's mouse/wheel/touch
 *  handlers -- interaction code that hasn't moved yet -- so it's threaded
 *  through as explicit arguments rather than living here. */
export function camOffset(canvas: HTMLCanvasElement, panX: number, panY: number): { x: number; y: number } {
  return { x: canvas.width / 2 + panX, y: canvas.height / 4 + 50 + panY };
}

/** Inverse of toScreen() + the camera transform: raw screen px -> grid
 *  coords, accounting for zoom/pan and rotation. Used for click hit-testing. */
export function toMap(
  screenX: number,
  screenY: number,
  canvas: HTMLCanvasElement,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  const o = camOffset(canvas, panX, panY);
  const adjX = (screenX - o.x) / zoom;
  const adjY = (screenY - o.y) / zoom;
  // The inverse transform maps each tile's diamond onto a unit SQUARE
  // centered on its integer coords, so round (not floor) is the exact
  // hit test — floor only resolved the bottom quadrant correctly and
  // shifted the other three a tile back.
  const rx = Math.round((adjX / (TILE_W / 2) + adjY / (TILE_H / 2)) / 2);
  const ry = Math.round((adjY / (TILE_H / 2) - adjX / (TILE_W / 2)) / 2);
  if (rotation === 0) return { x: rx, y: ry };
  // Un-rotate back into map space. Rounding again guards the half-tile that
  // an even grid centre introduces.
  const u = unrotateTile(rx, ry);
  return { x: Math.round(u.x), y: Math.round(u.y) };
}

/**
 * Painter's-algorithm depth for a tile, under the current rotation.
 *
 * This is the number render() sorts by. Getting it from raw x + y is the
 * classic rotation bug: everything still draws, but structures behind you
 * paint over structures in front at rotations 1-3.
 */
export function depthOf(mapX: number, mapY: number): number {
  const r = rotateTile(mapX, mapY, gridSize);
  return r.x + r.y;
}
