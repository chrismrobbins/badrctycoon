import { drawIsoDeck, drawPadFence, PAD_W, PAD_H } from '../iso';
import { simClock, isNight } from '../clock';

interface TrackPoint {
  x: number;
  y: number;
}
/** Track profile, sampled once and reused -- private to drawCoaster, same
 *  "computed lazily, cached forever" pattern as the original module-level
 *  `let coasterPath`. */
let coasterPath: TrackPoint[] | null = null;

export function drawCarousel(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // 1×1 rides get the same treatment as the big ones: their own raised,
  // fenced pad sized to a single tile (half-extents TILE_W/2 × TILE_H/2).
  drawIsoDeck(ctx, cx, cy, 0.98, '#b45309', '#7c2d12', 4);
  drawPadFence(ctx, cx, cy - 4, 0.98, '#fcd34d', 'rgba(252,211,77,0.45)');
  const gy = cy - 4;

  // Rotating platform
  ctx.beginPath();
  ctx.ellipse(cx, gy - 3, 25, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#92400e';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, gy - 6, 24, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fbbf24';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, gy - 6, 24, 9, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#fef3c7';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Platform sunburst
  const t = simClock * 0.001;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const a = t + (i * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(cx, gy - 6);
    ctx.lineTo(cx + Math.cos(a) * 23, gy - 6 + Math.sin(a) * 8.5);
    ctx.stroke();
  }
  // Center column
  ctx.fillStyle = '#78350f';
  ctx.fillRect(cx - 3, gy - 42, 6, 36);
  ctx.fillStyle = '#fde68a';
  ctx.fillRect(cx - 1, gy - 42, 2, 36);

  // Horses — far side first so near ones overlap correctly
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => Math.sin(t + (a * Math.PI) / 3) - Math.sin(t + (b * Math.PI) / 3));
  for (const i of order) {
    const angle = t + i * (Math.PI / 3);
    const px = cx + Math.cos(angle) * 19;
    const py = gy - 7 + Math.sin(angle) * 7;
    const bob = Math.sin(t * 5 + i * 1.7) * 2.5;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py - 28);
    ctx.lineTo(px, py + bob + 5);
    ctx.stroke();
    const hc = ['#f472b6', '#60a5fa', '#facc15', '#4ade80', '#c084fc', '#fb923c'][i];
    // Horse body / haunch / neck / head / legs / tail
    ctx.fillStyle = hc;
    ctx.beginPath();
    ctx.ellipse(px, py + bob - 4, 6.5, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(px + 3.5, py + bob - 10, 3.6, 7, 1.6);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(px + 3, py + bob - 12.5, 5.5, 3.4, 1.6);
    ctx.fill();
    ctx.fillRect(px - 5, py + bob - 1, 1.8, 5);
    ctx.fillRect(px + 2.6, py + bob - 1, 1.8, 5);
    ctx.strokeStyle = hc;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px - 6, py + bob - 5);
    ctx.lineTo(px - 9, py + bob - 1);
    ctx.stroke();
    // Saddle + tiny rider
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(px - 2.5, py + bob - 7.5, 5, 2);
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(px, py + bob - 11, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Striped canopy with scalloped valance
  ctx.beginPath();
  ctx.moveTo(cx, gy - 56);
  ctx.lineTo(cx - 30, gy - 30);
  ctx.lineTo(cx + 30, gy - 30);
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx - 30, 0, cx + 30, 0);
  for (let s = 0; s <= 8; s++) grad.addColorStop(s / 8, s % 2 === 0 ? '#ef4444' : '#ffffff');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, gy - 30, 30, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.fillStyle = '#fca5a5';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 30, gy - 29 + Math.sin(a) * 10, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Gold finial + flag
  ctx.beginPath();
  ctx.arc(cx, gy - 58, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#fde047';
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(cx, gy - 62);
  ctx.lineTo(cx + 8, gy - 59);
  ctx.lineTo(cx, gy - 56);
  ctx.closePath();
  ctx.fill();

  // Canopy bulbs at night
  if (isNight) {
    for (let i = 0; i < 14; i++) {
      const a = t * 2 + (i * Math.PI) / 7;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 30, gy - 29 + Math.sin(a) * 10, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? '#fef08a' : '#f0abfc';
      ctx.shadowBlur = 6;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

export function drawTeaCups(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  drawIsoDeck(ctx, cx, cy, 0.98, '#9d174d', '#6b0f36', 4);
  drawPadFence(ctx, cx, cy - 4, 0.98, '#f9a8d4', 'rgba(249,168,212,0.45)');
  const gy = cy - 4;
  const t = simClock * 0.001;

  // Spinning platter with pinwheel pattern
  ctx.beginPath();
  ctx.ellipse(cx, gy - 3, 24, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#be185d';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, gy - 6, 23, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ec4899';
  ctx.fill();
  // Pinwheel wedges — elliptical so they stay flush with the platter
  ctx.fillStyle = 'rgba(253,242,248,0.3)';
  for (let i = 0; i < 6; i++) {
    const a = t * 0.6 + (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, gy - 6);
    ctx.ellipse(cx, gy - 6, 23, 9, 0, a, a + 0.42);
    ctx.closePath();
    ctx.fill();
  }
  // Center hub cap
  ctx.beginPath();
  ctx.ellipse(cx, gy - 7, 5, 2.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fbcfe8';
  ctx.fill();

  // Cups — sorted so near-side draws last
  const cups = [0, 1, 2, 3, 4].map((i) => ({ i, a: t + i * ((Math.PI * 2) / 5) }));
  cups.sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
  for (const c of cups) {
    const px = cx + Math.cos(c.a) * 14;
    const py = gy - 7 + Math.sin(c.a) * 5.5;
    const col = ['#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316'][c.i];
    // Saucer
    ctx.beginPath();
    ctx.ellipse(px, py + 2, 9, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fdf2f8';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px, py + 2, 9, 4, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#f9a8d4';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Tapered cup body with a highlight
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(px - 6.5, py - 7);
    ctx.lineTo(px + 6.5, py - 7);
    ctx.quadraticCurveTo(px + 5, py + 2, px, py + 2);
    ctx.quadraticCurveTo(px - 5, py + 2, px - 6.5, py - 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(px - 3, py - 3.5, 1.6, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Rim + interior
    ctx.beginPath();
    ctx.ellipse(px, py - 7, 6.5, 2.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px, py - 7, 5, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,23,42,0.3)';
    ctx.fill();
    // Riders peeking over the rim
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(px - 2, py - 8.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + 2, py - 8.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // Handle whips around as the cup spins on its own axis
    const ha = t * 4 + c.i * 2;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(px + Math.cos(ha) * 7.5, py - 3 + Math.sin(ha) * 2.5, 2.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Pole-mounted deck lights at night
  if (isNight) {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.4;
      const lx = cx + Math.cos(a) * 26,
        ly = gy - 2 + Math.sin(a) * 11;
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(lx - 0.6, ly - 12, 1.2, 12);
      ctx.fillStyle = '#fef08a';
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#fde047';
      ctx.beginPath();
      ctx.arc(lx, ly - 13, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

export function drawBumperCars(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  drawIsoDeck(ctx, cx, cy, 0.98, '#475569', '#2b3547', 4);
  const gy = cy - 4;
  const t = simClock * 0.002;

  // Polished arena floor with reflective sheen
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(cx, gy - 4, 26, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  const shine = ctx.createLinearGradient(cx - 26, gy - 12, cx + 26, gy + 4);
  shine.addColorStop(0, 'rgba(148,163,184,0.28)');
  shine.addColorStop(0.5, 'rgba(148,163,184,0.05)');
  shine.addColorStop(1, 'rgba(148,163,184,0.22)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(cx, gy - 4, 25, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // Padded perimeter wall
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, gy - 4, 26, 11, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.ellipse(cx, gy - 4, 26, 11, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Cars, depth-sorted, with skid marks
  const cars = [
    { c: '#ef4444', x: Math.sin(t) * 15, y: Math.cos(t * 1.2) * 6 },
    { c: '#3b82f6', x: Math.cos(t * 0.8) * 13, y: Math.sin(t * 1.5) * 6 },
    { c: '#eab308', x: Math.cos(t * 1.1) * 17, y: Math.sin(t * 0.9) * 7 },
    { c: '#22c55e', x: Math.sin(t * 1.3 + 2) * 11, y: Math.cos(t * 0.7) * 5 },
  ].sort((a, b) => a.y - b.y);
  for (const car of cars) {
    const px = cx + car.x,
      py = gy - 6 + car.y;
    // Power antenna to the ceiling grid
    ctx.strokeStyle = 'rgba(148,163,184,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 3, py - 3);
    ctx.lineTo(px + 5, py - 24);
    ctx.stroke();
    // Rubber bumper skirt
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(px, py + 1.5, 7.5, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.ellipse(px, py + 0.5, 6.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shell + windshield
    ctx.fillStyle = car.c;
    ctx.beginPath();
    ctx.roundRect(px - 5, py - 5, 10, 6, [4, 4, 2, 2]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.roundRect(px - 3.5, py - 4.5, 7, 2, 1);
    ctx.fill();
    // Driver: torso + head
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(px - 2, py - 8, 4, 4, 1.5);
    ctx.fill();
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(px, py - 9, 2, 0, Math.PI * 2);
    ctx.fill();
    // Contact spark
    if (Math.sin(t * 30 + px) > 0.8) {
      ctx.fillStyle = '#fef08a';
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#fde047';
      ctx.beginPath();
      ctx.arc(px + 5, py - 24, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Canopy posts + electrified ceiling grid
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2.5;
  [-24, 24].forEach((ox) => {
    ctx.beginPath();
    ctx.moveTo(cx + ox, gy - 8);
    ctx.lineTo(cx + ox, gy - 30);
    ctx.stroke();
  });
  ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
  ctx.beginPath();
  ctx.ellipse(cx, gy - 30, 27, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.45)';
  ctx.lineWidth = 0.75;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 8, gy - 33);
    ctx.lineTo(cx + i * 8, gy - 27);
    ctx.stroke();
  }
  // Marquee at night
  if (isNight) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.fillStyle = Math.floor(t * 2 + i) % 2 ? '#38bdf8' : '#fb7185';
      ctx.shadowBlur = 6;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 27, gy - 30 + Math.sin(a) * 9, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

export function drawDropTower(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  drawIsoDeck(ctx, cx, cy, 0.98, '#52525b', '#33333a', 4);
  drawPadFence(ctx, cx, cy - 4, 0.98, '#facc15', 'rgba(250,204,21,0.4)');
  const gy = cy - 4;
  const topY = gy - 96;

  // Concrete base block
  ctx.fillStyle = '#3f3f46';
  ctx.beginPath();
  ctx.ellipse(cx, gy - 4, 15, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Three-column lattice tower with proper truss
  const colX = [-6, 0, 6];
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2.2;
  colX.forEach((ox) => {
    ctx.beginPath();
    ctx.moveTo(cx + ox, gy - 6);
    ctx.lineTo(cx + ox, topY);
    ctx.stroke();
  });
  ctx.strokeStyle = 'rgba(100,116,139,0.9)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const y0 = gy - 6 - i * 9,
      y1 = y0 - 9;
    ctx.beginPath();
    ctx.moveTo(cx - 6, y0);
    ctx.lineTo(cx + 6, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 6, y0);
    ctx.lineTo(cx - 6, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 6, y1);
    ctx.lineTo(cx + 6, y1);
    ctx.stroke();
  }
  // Top house + beacon
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.roundRect(cx - 9, topY - 8, 18, 9, 2);
  ctx.fill();
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(cx - 9, topY - 1, 18, 2);
  if (Math.sin(simClock * 0.005) > 0) {
    ctx.fillStyle = '#fca5a5';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, topY - 11, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Drop cycle: climb, hang, plummet, settle
  const cycle = 6000;
  const t = (simClock % cycle) / cycle;
  let ringY = 0;
  if (t < 0.5) ringY = t * 2;
  else if (t < 0.6) ringY = 1;
  else if (t < 0.65) ringY = 1 - (t - 0.6) * 20;
  else ringY = 0;
  const actualY = gy - 12 - ringY * 74;
  const dropping = t >= 0.6 && t < 0.66;

  // Hoist cables
  ctx.strokeStyle = 'rgba(203,213,225,0.6)';
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(cx - 4, topY);
  ctx.lineTo(cx - 4, actualY - 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 4, topY);
  ctx.lineTo(cx + 4, actualY - 4);
  ctx.stroke();

  // Gondola ring with outward-facing seats
  ctx.fillStyle = '#a16207';
  ctx.beginPath();
  ctx.ellipse(cx, actualY + 2, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.ellipse(cx, actualY, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const rx = cx - 12 + i * 6;
    const ry = actualY - 1 + Math.abs(i - 2) * 0.4;
    // Seat back + harness
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(rx - 2.4, ry - 5, 4.8, 6, 1.5);
    ctx.fill();
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(rx, ry - 6, 1.9, 0, Math.PI * 2);
    ctx.fill();
    // Arms fly up on the drop
    ctx.strokeStyle = '#fcd9b6';
    ctx.lineWidth = 1;
    const armY = dropping ? -11 : -7;
    ctx.beginPath();
    ctx.moveTo(rx - 1.8, ry - 4);
    ctx.lineTo(rx - 3, ry + armY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx + 1.8, ry - 4);
    ctx.lineTo(rx + 3, ry + armY);
    ctx.stroke();
  }
  // Motion blur streaks while plummeting
  if (dropping) {
    ctx.strokeStyle = 'rgba(250,204,21,0.4)';
    ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 7, actualY - 6);
      ctx.lineTo(cx + i * 7, actualY - 26);
      ctx.stroke();
    }
  }

  // Tower lights at night
  if (isNight) {
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = Math.floor(simClock * 0.004 + i) % 2 ? '#fef08a' : '#7dd3fc';
      ctx.shadowBlur = 5;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(cx - 7.5, gy - 14 - i * 10, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 7.5, gy - 14 - i * 10, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

// ── 2×2 Ride Renderers (drawn at center of 2×2 block) ──

export function drawSwingingShip(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // Raised deck across the whole pad + safety fence
  drawIsoDeck(ctx, cx, cy, 0.9, '#3f4c60', '#2b3547', 5);
  drawPadFence(ctx, cx, cy - 5, 0.9, '#94a3b8', 'rgba(148,163,184,0.5)');

  // Ground line sits on the deck top; frame spans the pad's full width
  const gy = cy - 5;
  const apex = gy - 74;

  // Solid tapered A-frame legs, splayed to the pad corners
  const legGrad = ctx.createLinearGradient(cx - 56, 0, cx + 56, 0);
  legGrad.addColorStop(0, '#475569');
  legGrad.addColorStop(0.5, '#94a3b8');
  legGrad.addColorStop(1, '#475569');
  ctx.fillStyle = legGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 56, gy + 4);
  ctx.lineTo(cx - 4, apex);
  ctx.lineTo(cx + 4, apex);
  ctx.lineTo(cx - 44, gy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 56, gy + 4);
  ctx.lineTo(cx + 4, apex);
  ctx.lineTo(cx - 4, apex);
  ctx.lineTo(cx + 44, gy + 4);
  ctx.closePath();
  ctx.fill();
  // Rear legs (offset back for isometric depth)
  ctx.fillStyle = 'rgba(51,65,85,0.85)';
  ctx.beginPath();
  ctx.moveTo(cx - 40, gy - 12);
  ctx.lineTo(cx - 3, apex - 3);
  ctx.lineTo(cx + 2, apex - 3);
  ctx.lineTo(cx - 32, gy - 12);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 40, gy - 12);
  ctx.lineTo(cx + 3, apex - 3);
  ctx.lineTo(cx - 2, apex - 3);
  ctx.lineTo(cx + 32, gy - 12);
  ctx.closePath();
  ctx.fill();
  // Footings on the deck
  ctx.fillStyle = '#334155';
  ctx.fillRect(cx - 58, gy + 2, 16, 5);
  ctx.fillRect(cx + 42, gy + 2, 16, 5);
  // Cross beams
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx - 36, gy - 32, 72, 4);
  ctx.fillStyle = '#64748b';
  ctx.fillRect(cx - 22, gy - 52, 44, 3);

  const t = simClock * 0.002;
  const angle = (Math.sin(t) * Math.PI) / 2.9;
  ctx.save();
  ctx.translate(cx, apex);
  ctx.rotate(angle);
  // Twin swing arms
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-5, 52);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(5, 52);
  ctx.stroke();
  // Hull — wide enough to read at pad scale
  const hullGrad = ctx.createLinearGradient(0, 48, 0, 82);
  hullGrad.addColorStop(0, '#f59e0b');
  hullGrad.addColorStop(0.45, '#d97706');
  hullGrad.addColorStop(1, '#78350f');
  ctx.fillStyle = hullGrad;
  ctx.beginPath();
  ctx.moveTo(-44, 48);
  ctx.quadraticCurveTo(-38, 80, 0, 82);
  ctx.quadraticCurveTo(38, 80, 44, 48);
  ctx.quadraticCurveTo(24, 60, 0, 61);
  ctx.quadraticCurveTo(-24, 60, -44, 48);
  ctx.closePath();
  ctx.fill();
  // Gunwale + hull planking
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-44, 48);
  ctx.quadraticCurveTo(0, 63, 44, 48);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,53,15,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-38, 62);
  ctx.quadraticCurveTo(0, 74, 38, 62);
  ctx.stroke();
  // Riders
  for (let i = -3; i <= 3; i++) {
    const ry = 52 + Math.abs(i) * 1.2;
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(i * 11, ry, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#eab308'][i + 3];
    ctx.fillRect(i * 11 - 2.6, ry + 2, 5.2, 5);
    // Arms up
    ctx.strokeStyle = '#fcd9b6';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(i * 11 - 2, ry + 2);
    ctx.lineTo(i * 11 - 4, ry - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * 11 + 2, ry + 2);
    ctx.lineTo(i * 11 + 4, ry - 4);
    ctx.stroke();
  }
  // Dragon figureheads
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(-44, 48);
  ctx.lineTo(-54, 36);
  ctx.lineTo(-40, 52);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(44, 48);
  ctx.lineTo(54, 36);
  ctx.lineTo(40, 52);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Pivot hub
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(cx, apex, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, apex, 5.5, 0, Math.PI * 2);
  ctx.stroke();

  // String lights along the A-frame at night
  if (isNight) {
    for (let i = 0; i <= 7; i++) {
      const k = i / 7;
      ctx.fillStyle = i % 2 ? '#fef08a' : '#7dd3fc';
      ctx.shadowBlur = 4;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(cx - 52 + k * 48, gy + 2 - k * 74, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 52 - k * 48, gy + 2 - k * 74, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

export function drawHauntedHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // Dead-earth yard covering the pad, with an iron fence
  drawIsoDeck(ctx, cx, cy, 0.94, '#2a2438', '#1b1726', 3);
  drawPadFence(ctx, cx, cy - 3, 0.94, '#0f172a', 'rgba(15,23,42,0.75)');
  // Scraggly graveyard bits on the front corners of the pad
  ctx.fillStyle = '#3f3a52';
  ctx.beginPath();
  ctx.roundRect(cx - 40, cy + 4, 7, 9, [3, 3, 0, 0]);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx + 33, cy + 6, 6, 8, [3, 3, 0, 0]);
  ctx.fill();

  const gy = cy - 3; // ground line on the yard
  const bw = 44; // half-width of the house — fills the pad
  const wallTop = gy - 52;

  // Side wall (isometric depth face)
  ctx.fillStyle = '#131a2b';
  ctx.beginPath();
  ctx.moveTo(cx + bw, wallTop);
  ctx.lineTo(cx + bw + 10, wallTop - 8);
  ctx.lineTo(cx + bw + 10, gy - 14);
  ctx.lineTo(cx + bw, gy - 6);
  ctx.closePath();
  ctx.fill();

  // Front facade with vertical siding
  const wallGrad = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
  wallGrad.addColorStop(0, '#161f33');
  wallGrad.addColorStop(0.5, '#25304a');
  wallGrad.addColorStop(1, '#161f33');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(cx - bw, wallTop, bw * 2, gy - wallTop - 4);
  ctx.strokeStyle = 'rgba(8,12,22,0.5)';
  ctx.lineWidth = 1;
  for (let i = -bw + 6; i < bw; i += 9) {
    ctx.beginPath();
    ctx.moveTo(cx + i, wallTop);
    ctx.lineTo(cx + i, gy - 4);
    ctx.stroke();
  }

  // Sagging gable roof, overhanging the walls
  ctx.fillStyle = '#0b1120';
  ctx.beginPath();
  ctx.moveTo(cx - bw - 8, wallTop + 2);
  ctx.quadraticCurveTo(cx - 20, wallTop - 26, cx, wallTop - 34);
  ctx.quadraticCurveTo(cx + 20, wallTop - 26, cx + bw + 8, wallTop + 2);
  ctx.closePath();
  ctx.fill();
  // Roof shingle rows
  ctx.strokeStyle = 'rgba(71,85,105,0.35)';
  ctx.lineWidth = 1;
  for (let r = 1; r <= 3; r++) {
    const ry = wallTop + 2 - r * 7;
    ctx.beginPath();
    ctx.moveTo(cx - bw - 8 + r * 8, ry);
    ctx.quadraticCurveTo(cx, ry - 12, cx + bw + 8 - r * 8, ry);
    ctx.stroke();
  }

  // Twin towers rising from the pad corners
  [-1, 1].forEach((s) => {
    const tx = cx + s * (bw - 10);
    ctx.fillStyle = '#1b2438';
    ctx.fillRect(tx - 8, wallTop - 30, 16, 42);
    ctx.fillStyle = '#0b1120';
    ctx.beginPath();
    ctx.moveTo(tx - 11, wallTop - 30);
    ctx.lineTo(tx, wallTop - 56);
    ctx.lineTo(tx + 11, wallTop - 30);
    ctx.closePath();
    ctx.fill();
    // Weathervane
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx, wallTop - 56);
    ctx.lineTo(tx, wallTop - 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx - 3, wallTop - 62);
    ctx.lineTo(tx + 3, wallTop - 62);
    ctx.stroke();
  });

  // Flickering windows
  const flick = (o: number, sp: number) => Math.sin(simClock * sp + o) > -0.2;
  const litWin = (wx: number, wy: number, w: number, h: number, o: number, sp: number) => {
    const on = flick(o, sp);
    ctx.fillStyle = on ? '#fbbf24' : '#111827';
    ctx.fillRect(wx, wy, w, h);
    if (on) {
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#f59e0b';
      ctx.fillRect(wx, wy, w, h);
      ctx.restore();
    }
    // Cross mullions
    ctx.strokeStyle = '#0b1120';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx + w / 2, wy);
    ctx.lineTo(wx + w / 2, wy + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wx, wy + h / 2);
    ctx.lineTo(wx + w, wy + h / 2);
    ctx.stroke();
  };
  litWin(cx - 34, wallTop + 10, 12, 14, 0, 0.005);
  litWin(cx + 22, wallTop + 10, 12, 14, 1.4, 0.004);
  litWin(cx - 8, wallTop + 8, 16, 12, 2.6, 0.006);
  litWin(cx + (bw - 10) - 4, wallTop - 22, 8, 10, 3.3, 0.005);
  litWin(cx - (bw - 10) - 4, wallTop - 22, 8, 10, 0.8, 0.0045);

  // Arched entrance with a spilling green glow
  ctx.fillStyle = '#050810';
  ctx.beginPath();
  ctx.moveTo(cx - 13, gy - 4);
  ctx.lineTo(cx - 13, gy - 26);
  ctx.quadraticCurveTo(cx, gy - 42, cx + 13, gy - 26);
  ctx.lineTo(cx + 13, gy - 4);
  ctx.closePath();
  ctx.fill();
  const doorGlow = ctx.createLinearGradient(cx, gy - 26, cx, gy - 4);
  doorGlow.addColorStop(0, 'rgba(34,197,94,0)');
  doorGlow.addColorStop(1, 'rgba(74,222,128,0.4)');
  ctx.fillStyle = doorGlow;
  ctx.beginPath();
  ctx.moveTo(cx - 13, gy - 4);
  ctx.lineTo(cx - 13, gy - 26);
  ctx.quadraticCurveTo(cx, gy - 42, cx + 13, gy - 26);
  ctx.lineTo(cx + 13, gy - 4);
  ctx.closePath();
  ctx.fill();
  // Entry steps down to the yard
  ctx.fillStyle = '#3f3a52';
  ctx.fillRect(cx - 15, gy - 4, 30, 3);
  ctx.fillRect(cx - 18, gy - 1, 36, 3);

  // Sign board
  ctx.fillStyle = '#0b1120';
  ctx.beginPath();
  ctx.roundRect(cx - 26, wallTop - 12, 52, 12, 2);
  ctx.fill();
  ctx.strokeStyle = '#7f1d1d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cx - 26, wallTop - 12, 52, 12, 2);
  ctx.stroke();
  ctx.fillStyle = '#dc2626';
  ctx.font = 'bold 9px "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.fillText('HAUNTED', cx, wallTop - 3);

  // Bats at night
  if (isNight) {
    const bt = simClock * 0.003;
    for (let i = 0; i < 6; i++) {
      const bx = cx + Math.sin(bt + i * 1.7) * 48;
      const by = wallTop - 44 + Math.cos(bt * 0.7 + i * 1.3) * 16;
      const flap = 2 + Math.sin(bt * 6 + i) * 2;
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - 6, by - flap);
      ctx.lineTo(bx - 2, by + 1.5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + 6, by - flap);
      ctx.lineTo(bx + 2, by + 1.5);
      ctx.fill();
    }
    // Eerie mist pooling in the yard
    const mist = ctx.createLinearGradient(cx, gy - 12, cx, gy + 12);
    mist.addColorStop(0, 'rgba(74,222,128,0)');
    mist.addColorStop(1, 'rgba(74,222,128,0.13)');
    ctx.fillStyle = mist;
    ctx.beginPath();
    ctx.ellipse(cx, gy + 6, PAD_W * 0.9, PAD_H * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawFerrisWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // Concrete pad + fence covering the full block
  drawIsoDeck(ctx, cx, cy, 0.92, '#3b4759', '#28313f', 4);
  drawPadFence(ctx, cx, cy - 4, 0.92, '#93c5fd', 'rgba(147,197,253,0.45)');

  const gy = cy - 4;
  const wheelR = 56;
  const hubY = gy - 66;
  const t = simClock * 0.0005;

  // Boarding platform under the wheel (front of the pad)
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(cx, gy - 4, 30, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.ellipse(cx, gy - 6, 28, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rear A-frame legs first (depth), then front pair
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - 34, gy - 14);
  ctx.lineTo(cx, hubY);
  ctx.lineTo(cx + 34, gy - 14);
  ctx.stroke();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx - 46, gy + 4);
  ctx.lineTo(cx, hubY);
  ctx.lineTo(cx + 46, gy + 4);
  ctx.stroke();
  // Leg cross-braces
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 30, gy - 22);
  ctx.lineTo(cx + 30, gy - 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 18, gy - 44);
  ctx.lineTo(cx + 18, gy - 44);
  ctx.stroke();
  // Footings
  ctx.fillStyle = '#475569';
  ctx.fillRect(cx - 51, gy + 2, 14, 5);
  ctx.fillRect(cx + 37, gy + 2, 14, 5);

  // Double rim with cross-bracing between
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, hubY, wheelR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, hubY, wheelR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, hubY, wheelR - 9, 0, Math.PI * 2);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Zigzag truss between the rims
  ctx.strokeStyle = 'rgba(147,197,253,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 ? wheelR : wheelR - 9;
    const px = cx + Math.cos(a) * r,
      py = hubY + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke();

  // Spokes + gondolas (12 cabins)
  const colors = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4', '#f43f5e', '#a3e635', '#38bdf8', '#fbbf24'];
  for (let i = 0; i < 12; i++) {
    const angle = t + i * ((Math.PI * 2) / 12);
    const sx = cx + Math.cos(angle) * (wheelR - 9);
    const sy = hubY + Math.sin(angle) * (wheelR - 9);
    ctx.beginPath();
    ctx.moveTo(cx, hubY);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = 'rgba(203,213,225,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const gx = cx + Math.cos(angle) * wheelR;
    const gyy = hubY + Math.sin(angle) * wheelR;
    // Hanger — gondolas always hang level
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx, gyy);
    ctx.lineTo(gx, gyy + 4);
    ctx.stroke();
    // Cabin with canopy, body, and passengers
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.roundRect(gx - 7.5, gyy + 4, 15, 5, [3, 3, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(gx - 7, gyy + 8, 14, 7, [0, 0, 4, 4]);
    ctx.fill();
    ctx.fillStyle = 'rgba(15,23,42,0.35)';
    ctx.fillRect(gx - 5, gyy + 9.5, 10, 3.5);
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(gx - 2.5, gyy + 10.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(gx + 2.5, gyy + 10.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hub with spinner detail
  ctx.beginPath();
  ctx.arc(cx, hubY, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#f87171';
  ctx.fill();
  ctx.strokeStyle = '#b91c1c';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const a = t * 6 + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(cx, hubY);
    ctx.lineTo(cx + Math.cos(a) * 7, hubY + Math.sin(a) * 7);
    ctx.stroke();
  }

  // Night lights chasing the rim + spoke tips
  if (isNight) {
    for (let i = 0; i < 28; i++) {
      const la = (i / 28) * Math.PI * 2;
      const lit = Math.floor(simClock * 0.004 + i * 0.5) % 3 !== 0;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(la) * wheelR, hubY + Math.sin(la) * wheelR, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = lit ? (i % 2 ? '#fef08a' : '#f0abfc') : 'rgba(148,163,184,0.4)';
      if (lit) {
        ctx.shadowBlur = 6;
        ctx.shadowColor = ctx.fillStyle;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

export function drawCoaster(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // Gravel pad + perimeter fence across the whole block
  drawIsoDeck(ctx, cx, cy, 0.94, '#3a4557', '#27303d', 4);
  drawPadFence(ctx, cx, cy - 4, 0.94, '#f87171', 'rgba(248,113,113,0.4)');

  const gy = cy - 4;

  // Track profile, sampled once and reused. Spans the pad's full width.
  if (!coasterPath) {
    const pts: TrackPoint[] = [];
    const seg = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, n: number) => {
      for (let i = 0; i <= n; i++) {
        const u = i / n,
          v = 1 - u;
        pts.push({ x: v * v * x0 + 2 * v * u * x1 + u * u * x2, y: v * v * y0 + 2 * v * u * y1 + u * u * y2 });
      }
    };
    seg(-58, 2, -52, -104, -14, -28, 26); // lift hill
    seg(-14, -28, 4, 10, 20, -20, 16); // valley dip
    seg(20, -20, 38, -62, 58, 2, 22); // airtime hill → station
    coasterPath = pts;
  }
  const path = coasterPath;

  // Lattice support towers from track down to the pad
  for (let i = 3; i < path.length - 3; i += 6) {
    const p = path[i];
    if (p.y > -10) continue;
    const topY = gy + p.y + 2,
      botY = gy + 2;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + p.x - 3, topY);
    ctx.lineTo(cx + p.x - 4, botY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + p.x + 3, topY);
    ctx.lineTo(cx + p.x + 4, botY);
    ctx.stroke();
    // Zigzag bracing
    ctx.strokeStyle = 'rgba(71,85,105,0.8)';
    ctx.lineWidth = 1;
    const rungs = Math.max(2, Math.floor((botY - topY) / 9));
    for (let r = 0; r < rungs; r++) {
      const y0 = topY + (botY - topY) * (r / rungs);
      const y1 = topY + (botY - topY) * ((r + 1) / rungs);
      ctx.beginPath();
      ctx.moveTo(cx + p.x - 3.5, y0);
      ctx.lineTo(cx + p.x + 3.5, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + p.x + 3.5, y0);
      ctx.lineTo(cx + p.x - 3.5, y1);
      ctx.stroke();
    }
    // Footing
    ctx.fillStyle = '#475569';
    ctx.fillRect(cx + p.x - 6, botY - 1, 12, 3);
  }

  // Track: dark spine, ties, twin bright rails
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#7f1d1d';
  ctx.lineWidth = 6;
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(cx + p.x, gy + p.y) : ctx.moveTo(cx + p.x, gy + p.y)));
  ctx.stroke();
  ctx.strokeStyle = '#fca5a5';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < path.length; i += 2) {
    const p = path[i];
    ctx.beginPath();
    ctx.moveTo(cx + p.x - 3, gy + p.y + 2.5);
    ctx.lineTo(cx + p.x + 3, gy + p.y - 3.5);
    ctx.stroke();
  }
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(cx + p.x, gy + p.y - 3) : ctx.moveTo(cx + p.x, gy + p.y - 3)));
  ctx.stroke();
  ctx.strokeStyle = '#fecaca';
  ctx.lineWidth = 1;
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(cx + p.x, gy + p.y - 4.5) : ctx.moveTo(cx + p.x, gy + p.y - 4.5)));
  ctx.stroke();

  // Chain-lift dogs on the climb
  ctx.strokeStyle = 'rgba(226,232,240,0.5)';
  ctx.lineWidth = 1;
  for (let i = 2; i < 24; i += 3) {
    const p = path[i];
    ctx.beginPath();
    ctx.moveTo(cx + p.x - 1, gy + p.y + 1);
    ctx.lineTo(cx + p.x + 1, gy + p.y - 1);
    ctx.stroke();
  }

  // Station house on the pad's front-right, with platform
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(cx + 30, gy - 22, 30, 20);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(cx + 30, gy - 2, 34, 4);
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(cx + 26, gy - 22);
  ctx.lineTo(cx + 45, gy - 34);
  ctx.lineTo(cx + 64, gy - 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(cx + 36, gy - 16, 7, 9);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(cx + 48, gy - 16, 8, 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 6px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('COASTER', cx + 45, gy - 24);

  // Train — 4 linked cars riding the real track, tilting with the slope
  const T = (simClock % 4600) / 4600;
  const idx = Math.floor(T * (path.length - 1));
  for (let c = 3; c >= 0; c--) {
    const i = Math.max(0, idx - c * 3);
    const p = path[i];
    const pn = path[Math.min(path.length - 1, i + 1)];
    const ang = Math.atan2(pn.y - p.y, pn.x - p.x);
    ctx.save();
    ctx.translate(cx + p.x, gy + p.y - 6);
    ctx.rotate(ang);
    ctx.fillStyle = c === 0 ? '#60a5fa' : '#2563eb';
    ctx.beginPath();
    ctx.roundRect(-6, -4.5, 12, 7, 2);
    ctx.fill();
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(-6, 1, 12, 2);
    // Riders with arms up
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(-2, -6, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(2.5, -6, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fcd9b6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2, -7);
    ctx.lineTo(-3, -10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2.5, -7);
    ctx.lineTo(3.5, -10);
    ctx.stroke();
    ctx.restore();
  }

  // Track bulbs at night
  if (isNight) {
    for (let i = 0; i < path.length; i += 6) {
      const p = path[i];
      ctx.fillStyle = Math.floor(simClock * 0.003 + i) % 2 ? '#fef08a' : '#fb7185';
      ctx.shadowBlur = 5;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(cx + p.x, gy + p.y - 7, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
