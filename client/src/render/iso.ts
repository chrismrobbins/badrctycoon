import { TILE_W, TILE_H, toScreen } from './camera';

/** Diamond footprint of a single tile, centered on (x, y) in world-space px. */
export function drawPoly(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, borderColor: string | null = null): void {
  ctx.beginPath();
  ctx.moveTo(x, y - TILE_H / 2);
  ctx.lineTo(x + TILE_W / 2, y);
  ctx.lineTo(x, y + TILE_H / 2);
  ctx.lineTo(x - TILE_W / 2, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Center of an n×n block, and its diamond half-extents. */
export function blockCenter(ax: number, ay: number, sz: number): { x: number; y: number } {
  return toScreen(ax + (sz - 1) / 2, ay + (sz - 1) / 2);
}
export function padHalf(sz: number): { w: number; h: number } {
  return { w: (TILE_W * sz) / 2, h: (TILE_H * sz) / 2 };
}

/** Diamond footprint of an n×n block (multi-tile base pad). */
export function drawPolyN(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  sz: number,
  color: string,
  borderColor: string | null = null,
): void {
  const c = blockCenter(ax, ay, sz);
  const { w, h } = padHalf(sz);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - h); // top
  ctx.lineTo(c.x + w, c.y); // right
  ctx.lineTo(c.x, c.y + h); // bottom
  ctx.lineTo(c.x - w, c.y); // left
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Soft ambient-occlusion ellipse under objects — cheap depth for everything. */
export function drawGroundShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, w, w * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();
}

// ── Multi-tile footprint state ──
// An n×n pad is a diamond reaching TILE_W*n/2 horizontally and TILE_H*n/2
// vertically from its center. Rides are authored against these so
// structures genuinely occupy their block instead of floating on it.
// PAD_W/PAD_H track the block currently being drawn -- set once via setPad()
// before a multi-tile sprite's draw functions run, then read by many of
// them. Exported as a mutable pair (single writer, setPad) rather than
// threaded through every helper as a parameter, same pattern as
// ui/management.ts's mgmtTab.
export let PAD_W = TILE_W; // half-width of the current pad diamond
export let PAD_H = TILE_H; // half-height
export function setPad(sz: number): void {
  const p = padHalf(sz);
  PAD_W = p.w;
  PAD_H = p.h;
}
