import { STAFF_KINDS } from '../content';
import type { Staff } from '../sim/staff';
import { litterAt } from '../sim/litter';
import type { GameState } from '../core/state';
import { toScreen, TILE_W, TILE_H } from './camera';
import { tileHash } from './iso';
import { simClock } from './clock';

/** Drawn per-worker so staff can join the scene's depth sort. */
export function drawStaffOne(ctx: CanvasRenderingContext2D, w: Staff): void {
  const k = STAFF_KINDS[w.kind];
  const mx = w.x + (w.tx - w.x) * w.progress;
  const my = w.y + (w.ty - w.y) * w.progress;
  const p = toScreen(mx, my);
  const bob = Math.sin(w.progress * Math.PI) * 3;
  const yy = p.y - 5 - bob;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 3.5, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Uniform body + head + cap
  ctx.fillStyle = k.color;
  ctx.beginPath();
  ctx.roundRect(p.x - 2.6, yy - 3, 5.2, 6.5, 2);
  ctx.fill();
  ctx.fillStyle = '#fcd9b6';
  ctx.beginPath();
  ctx.arc(p.x, yy - 5, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = k.color;
  ctx.beginPath();
  ctx.roundRect(p.x - 2.6, yy - 7.6, 5.2, 2.2, 1);
  ctx.fill();
  // Tool of the trade
  ctx.strokeStyle = '#78716c';
  ctx.lineWidth = 1;
  if (w.kind === 'janitor') {
    const sw = Math.sin(simClock * 0.008 + w.swing) * 2;
    ctx.beginPath();
    ctx.moveTo(p.x + 2, yy - 2);
    ctx.lineTo(p.x + 5 + sw, yy + 4);
    ctx.stroke();
    ctx.fillStyle = '#eab308';
    ctx.fillRect(p.x + 4 + sw, yy + 3.5, 3, 1.6);
  } else if (w.kind === 'mechanic') {
    ctx.beginPath();
    ctx.moveTo(p.x + 2.5, yy - 1);
    ctx.lineTo(p.x + 5, yy - 4);
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(p.x + 5.4, yy - 4.4, 1.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Entertainer holds a balloon and sparkles
    ctx.strokeStyle = 'rgba(203,213,225,0.6)';
    ctx.beginPath();
    ctx.moveTo(p.x + 2.5, yy - 2);
    ctx.lineTo(p.x + 5, yy - 9);
    ctx.stroke();
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(p.x + 5.2, yy - 11, 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (Math.sin(simClock * 0.006 + w.swing) > 0.7) {
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(p.x - 4, yy - 8, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Scattered litter on a path tile — cups, wrappers, cans -- drawn where the
 *  tile's own sprite would be, at screen position (sx, sy). */
export function drawLitterAt(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number, sx: number, sy: number): void {
  const n = litterAt(state, x, y);
  if (!n) return;
  for (let i = 0; i < n * 2; i++) {
    const h = tileHash(sx + i * 31, sy - i * 17);
    const ox = (h - 0.5) * TILE_W * 0.7;
    const oy = (tileHash(sx - i * 13, sy + i * 29) - 0.5) * TILE_H * 0.7;
    const kind = Math.floor(h * 3);
    if (kind === 0) {
      // crumpled cup
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.ellipse(sx + ox, sy + oy, 2.2, 1.4, h * 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 1) {
      // wrapper
      ctx.fillStyle = '#fca5a5';
      ctx.beginPath();
      ctx.moveTo(sx + ox - 2, sy + oy);
      ctx.lineTo(sx + ox, sy + oy - 1.6);
      ctx.lineTo(sx + ox + 2, sy + oy);
      ctx.lineTo(sx + ox, sy + oy + 1.2);
      ctx.closePath();
      ctx.fill();
    } else {
      // squashed can
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(sx + ox - 1.6, sy + oy - 1, 3.2, 2);
    }
  }
}
