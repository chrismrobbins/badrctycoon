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

/** A deck/slab covering the pad, inset by `k` (0..1), with optional height
 *  so it reads as a raised platform with a visible front edge. */
export function drawIsoDeck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  k: number,
  topFill: string,
  sideFill: string,
  lift: number,
): void {
  const w = PAD_W * k,
    h = PAD_H * k;
  const L = lift || 0;
  if (L > 0) {
    // Front-facing sides (south-west and south-east faces)
    ctx.fillStyle = sideFill;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - L);
    ctx.lineTo(cx, cy + h - L);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - w, cy);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + w, cy - L);
    ctx.lineTo(cx, cy + h - L);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx + w, cy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - h - L);
  ctx.lineTo(cx + w, cy - L);
  ctx.lineTo(cx, cy + h - L);
  ctx.lineTo(cx - w, cy - L);
  ctx.closePath();
  ctx.fillStyle = topFill;
  ctx.fill();
}

/** Deterministic pseudo-random 0..1 from a screen position -- used for
 *  variant selection and jitter that must stay stable frame to frame
 *  without a per-object RNG seed (tree species, litter scatter, ...). */
export function tileHash(cx: number, cy: number): number {
  const n = Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** Perimeter fence posts + rail around the pad — instantly sells "this
 *  whole block is the ride." */
export function drawPadFence(ctx: CanvasRenderingContext2D, cx: number, cy: number, k: number, postColor: string, railColor: string): void {
  const w = PAD_W * k,
    h = PAD_H * k;
  const corners: [number, number][] = [
    [0, -h],
    [w, 0],
    [0, h],
    [-w, 0],
  ];
  ctx.strokeStyle = railColor;
  ctx.lineWidth = 1.5;
  for (let e = 0; e < 4; e++) {
    const a = corners[e],
      b = corners[(e + 1) % 4];
    for (let s = 0; s < 4; s++) {
      const t0 = s / 4,
        t1 = (s + 1) / 4;
      const x0 = cx + a[0] + (b[0] - a[0]) * t0,
        y0 = cy + a[1] + (b[1] - a[1]) * t0;
      const x1 = cx + a[0] + (b[0] - a[0]) * t1,
        y1 = cy + a[1] + (b[1] - a[1]) * t1;
      ctx.beginPath();
      ctx.moveTo(x0, y0 - 6);
      ctx.lineTo(x1, y1 - 6);
      ctx.stroke();
      ctx.fillStyle = postColor;
      ctx.fillRect(x0 - 0.75, y0 - 7, 1.5, 7);
    }
  }
}
