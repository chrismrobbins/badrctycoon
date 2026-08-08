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

/**
 * The CONTINUOUS rotation, in quarter turns. Fractional during a turn.
 *
 * Two numbers, because the renderer has two kinds of thing to rotate and they
 * cannot rotate the same way:
 *
 *   rotationAngle -- the map plane. Ground, positions and depth are computed
 *     from this, so the park sweeps round smoothly instead of snapping.
 *   rotation      -- which baked sprite to use, 0..3. A structure is a
 *     pre-rendered bitmap that exists at exactly four angles and has no
 *     in-between image, so it takes the NEAREST one and swaps at the halfway
 *     point, where the motion of everything else hides the change.
 *
 * That split is the whole trick: continuous where it can be, quantised where
 * the art forces it, and the swap timed to be least visible.
 */
export let rotationAngle = 0;

// Rotation matrix for the current angle, recomputed only when it changes --
// the ground pass calls rotateTile() four times per tile, and a 35x35 park
// would otherwise be ~5,000 sin/cos per frame.
let rotCos = 1;
let rotSin = 0;

export function setRotationAngle(a: number): void {
  rotationAngle = a;
  const t = a * (Math.PI / 2);
  rotCos = Math.cos(t);
  rotSin = Math.sin(t);
  // Nearest baked angle. Math.round puts the swap at the 45-degree midpoint.
  rotation = ((Math.round(a) % 4) + 4) % 4;
}

export function setRotation(r: number): void {
  setRotationAngle(((r % 4) + 4) % 4);
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
export function rotateTile(x: number, y: number, grid = gridSize): { x: number; y: number } {
  if (rotSin === 0 && rotCos === 1) return { x, y };
  const c = (grid - 1) / 2;
  const dx = x - c;
  const dy = y - c;
  // Clockwise on screen, matching which way the Blender models were turned.
  return { x: c + dx * rotCos + dy * rotSin, y: c - dx * rotSin + dy * rotCos };
}

/** Inverse of rotateTile. */
export function unrotateTile(x: number, y: number, grid = gridSize): { x: number; y: number } {
  if (rotSin === 0 && rotCos === 1) return { x, y };
  const c = (grid - 1) / 2;
  const dx = x - c;
  const dy = y - c;
  return { x: c + dx * rotCos - dy * rotSin, y: c + dx * rotSin + dy * rotCos };
}

/**
 * The four screen-space corners of a rectangular block of tiles.
 *
 * The ground used to be drawn as a fixed 64x32 diamond per tile, which is only
 * correct at the four square-on angles. Rotation is an affine map of the tile
 * lattice, so projecting the corners keeps every quad tiling seamlessly at any
 * angle -- and at angle 0 it reproduces exactly the diamond it replaced.
 */
export function blockCorners(ax: number, ay: number, sz = 1): { x: number; y: number }[] {
  const h = 0.5;
  return [
    toScreen(ax - h, ay - h),
    toScreen(ax + sz - 1 + h, ay - h),
    toScreen(ax + sz - 1 + h, ay + sz - 1 + h),
    toScreen(ax - h, ay + sz - 1 + h),
  ];
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
  if (rotationAngle !== 0) {
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
  const fx = (adjX / (TILE_W / 2) + adjY / (TILE_H / 2)) / 2;
  const fy = (adjY / (TILE_H / 2) - adjX / (TILE_W / 2)) / 2;
  // Un-rotate FIRST, round after. Rounding to a tile before un-rotating
  // quantises in the wrong space and drifts by a tile at fractional angles.
  if (rotationAngle === 0) return { x: Math.round(fx), y: Math.round(fy) };
  const u = unrotateTile(fx, fy);
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
