/** Tile half-width/height for the isometric projection. Every draw
 *  coordinate in render/ is authored against these. */
export const TILE_W = 64;
export const TILE_H = 32;

/**
 * World-space pixel position of a map tile's center -- before the camera
 * transform (pan/zoom) is applied. render()'s main loop applies that
 * transform once via a canvas `translate`/`scale`, so every draw function
 * works in this untransformed space; toMap() below inverts the full
 * transform (including pan/zoom) for hit-testing mouse clicks.
 */
export function toScreen(mapX: number, mapY: number): { x: number; y: number } {
  const x = (mapX - mapY) * (TILE_W / 2);
  const y = (mapX + mapY) * (TILE_H / 2);
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
 *  coords, accounting for zoom/pan. Used for click hit-testing. */
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
  const mapX = Math.round((adjX / (TILE_W / 2) + adjY / (TILE_H / 2)) / 2);
  const mapY = Math.round((adjY / (TILE_H / 2) - adjX / (TILE_W / 2)) / 2);
  return { x: mapX, y: mapY };
}
