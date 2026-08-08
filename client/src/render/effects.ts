import type { GameState, RideQueue } from '../core/state';
import { BUILD_DATA, RIDE_TYPES, SHOP_TYPES, TYPE_LABEL } from '../content';
import { blockCenter, padHalf } from './iso';
import { simClock } from './clock';

/** Smoke puffs + bouncing alert over a broken-down ride. */
export function drawBreakdownSmoke(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const t = simClock * 0.001;
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.5 + i * 0.33) % 1;
    const sx = cx + Math.sin(t + i * 2) * 4;
    const sy = cy - 30 - ph * 25;
    ctx.beginPath();
    ctx.arc(sx, sy, 4 + ph * 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(100, 116, 139, ${0.5 * (1 - ph)})`;
    ctx.fill();
  }
  // Bouncing alert
  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', cx, cy - 62 + Math.sin(t * 4) * 2);
}

// ── Rain overlay (screen-space) ──
// rainAlpha/rainDrops are private to this effect -- nothing outside
// drawRainFX ever touched the originals either.
let rainAlpha = 0;
let rainDrops: { x: number; y: number; s: number }[] = [];

export function drawRainFX(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, weather: GameState['weather']): void {
  const target = weather === 'rain' ? 0.5 : 0;
  rainAlpha += (target - rainAlpha) * 0.03;
  if (rainAlpha < 0.02) {
    rainDrops.length = 0;
    return;
  }
  while (rainDrops.length < 110) {
    rainDrops.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, s: 6 + Math.random() * 8 });
  }
  ctx.strokeStyle = `rgba(147, 184, 216, ${rainAlpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const d of rainDrops) {
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - 2, d.y + d.s);
    d.y += d.s;
    d.x -= 1.5;
    if (d.y > canvas.height) {
      d.y = -10;
      d.x = Math.random() * (canvas.width + 40);
    }
  }
  ctx.stroke();
}

// ── Hover tooltip for rides & shops (screen-space) ──

export function drawTooltip(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvas: HTMLCanvasElement,
  hoveredCell: { x: number; y: number },
  mouseX: number,
  mouseY: number,
): void {
  const { x, y } = hoveredCell;
  if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) return;
  const cell = state.map[x]?.[y];
  if (!cell || (!RIDE_TYPES.has(cell) && !SHOP_TYPES.has(cell))) return;
  const a = state.anchorOf[`${x},${y}`] || { ax: x, ay: y };
  const aKey = `${a.ax},${a.ay}`;
  const lines = [(state.rideNames[aKey] || TYPE_LABEL[cell] || cell).toUpperCase()];
  if (RIDE_TYPES.has(cell)) {
    const q: RideQueue | undefined = state.rideQueues[aKey];
    if (q) lines.push(q.broken ? 'BROKEN — mechanic en route' : `Queue: ${q.queue}  |  Riding: ${q.ridersOnBoard}`);
  } else {
    const sd = BUILD_DATA[cell];
    lines.push(`Shop — $${sd.price} per sale`);
  }
  lines.push('click to inspect');
  const w = 176,
    h = 12 + lines.length * 14;
  let tx = mouseX + 14,
    ty = mouseY - h - 8;
  if (tx + w > canvas.width) tx = mouseX - w - 14;
  if (ty < 0) ty = mouseY + 16;
  ctx.fillStyle = 'rgba(15,23,42,0.88)';
  ctx.beginPath();
  ctx.roundRect(tx, ty, w, h, 6);
  ctx.fill();
  ctx.textAlign = 'left';
  lines.forEach((ln, i) => {
    ctx.fillStyle = i === 0 ? '#93c5fd' : ln.startsWith('BROKEN') ? '#f87171' : ln === 'click to inspect' ? '#64748b' : '#e2e8f0';
    ctx.font = i === 0 ? 'bold 10px monospace' : '9px monospace';
    ctx.fillText(ln, tx + 9, ty + 16 + i * 14);
  });
}

/** Queue visualization — small dots orbiting a busy ride's pad. */
export function drawRideQueue(ctx: CanvasRenderingContext2D, ax: number, ay: number, queueCount: number, sz: number): void {
  if (queueCount <= 0) return;
  const n = sz || 1;
  const center = blockCenter(ax, ay, n);
  const ph = padHalf(n);
  const dots = Math.min(queueCount, 14);
  for (let i = 0; i < dots; i++) {
    const angle = (i / dots) * Math.PI * 2;
    const r = 8 + (i % 3) * 3;
    const qx = center.x + Math.cos(angle) * (ph.w * 0.72 + r);
    const qy = center.y + Math.sin(angle) * (ph.h * 0.72 + r);
    ctx.beginPath();
    ctx.arc(qx, qy - 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();
  }
}
