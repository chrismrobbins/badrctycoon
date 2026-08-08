import { drawIsoDeck, drawPadFence } from '../iso';
import { simClock, isNight } from '../clock';

interface TrackPoint {
  x: number;
  y: number;
}

// Track profile + its loop's center/radius, memoized once and reused --
// private to this file, same pattern as rides.ts's coasterPath.
let megaCoasterPath: TrackPoint[] | null = null;
let megaCoasterLoop: { c: TrackPoint; r: number } | null = null;

/** Builds (once) and returns the mega coaster's track profile.
 *  Hoisted out of drawMegaCoaster() because drawMegaCoasterNight() needs the
 *  same points for its bulb chase, and in the baked path drawMegaCoaster()
 *  never runs -- so the lazy memo would have stayed null. */
function megaTrack(): TrackPoint[] {
  // Track: lift hill → drop → vertical loop → airtime hill → brake run
  if (!megaCoasterPath) {
    const pts: TrackPoint[] = [];
    const q = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, n: number) => {
      for (let i = 1; i <= n; i++) {
        const u = i / n,
          v = 1 - u;
        pts.push({ x: v * v * x0 + 2 * v * u * x1 + u * u * x2, y: v * v * y0 + 2 * v * u * y1 + u * u * y2 });
      }
    };
    pts.push({ x: -120, y: 6 });
    q(-120, 6, -114, -110, -86, -152, 26); // lift hill
    q(-86, -152, -62, -164, -44, -62, 18); // first drop
    q(-44, -62, -24, -8, 0, -10, 12); // into the loop bottom
    // Vertical loop, center (0,-52) r 42, swept from the bottom
    const LC = { x: 0, y: -52 },
      LR = 42;
    for (let i = 1; i <= 32; i++) {
      const a = Math.PI / 2 + (i / 32) * Math.PI * 2;
      pts.push({ x: LC.x + Math.cos(a) * LR, y: LC.y + Math.sin(a) * LR });
    }
    q(0, -10, 26, -8, 48, -56, 16); // airtime hill up
    q(48, -56, 68, -96, 90, -42, 18); // crest and down
    q(90, -42, 108, -14, 120, 6, 12); // brake run into station
    megaCoasterPath = pts;
    megaCoasterLoop = { c: LC, r: LR };
  }
  return megaCoasterPath!;
}


/** MEGA COASTER (4×4) — the park's headliner: lift hill, drop, vertical
 *  loop, airtime hill, brake run. */
export function drawMegaCoaster(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  drawIsoDeck(ctx, cx, cy, 0.96, '#39424f', '#252c36', 5);
  drawPadFence(ctx, cx, cy - 5, 0.96, '#fb7185', 'rgba(251,113,133,0.4)');
  const gy = cy - 5;

  const path = megaTrack();
  const loop = megaCoasterLoop!;

  // Lattice support towers (skip the loop's own span — it self-supports)
  for (let i = 2; i < path.length - 2; i += 5) {
    const p = path[i];
    if (p.y > -14) continue;
    const inLoop = Math.hypot(p.x - loop.c.x, p.y - loop.c.y) < loop.r + 6;
    if (inLoop) continue;
    const topY = gy + p.y + 2,
      botY = gy + 3;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + p.x - 4, topY);
    ctx.lineTo(cx + p.x - 5, botY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + p.x + 4, topY);
    ctx.lineTo(cx + p.x + 5, botY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(71,85,105,0.85)';
    ctx.lineWidth = 1;
    const rungs = Math.max(2, Math.floor((botY - topY) / 11));
    for (let r = 0; r < rungs; r++) {
      const y0 = topY + (botY - topY) * (r / rungs),
        y1 = topY + (botY - topY) * ((r + 1) / rungs);
      ctx.beginPath();
      ctx.moveTo(cx + p.x - 4.5, y0);
      ctx.lineTo(cx + p.x + 4.5, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + p.x + 4.5, y0);
      ctx.lineTo(cx + p.x - 4.5, y1);
      ctx.stroke();
    }
    ctx.fillStyle = '#475569';
    ctx.fillRect(cx + p.x - 7, botY - 1, 14, 4);
  }
  // The loop's support spine
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + loop.c.x, gy + loop.c.y + loop.r);
  ctx.lineTo(cx + loop.c.x, gy + 3);
  ctx.stroke();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 16, gy + 3);
  ctx.lineTo(cx + loop.c.x, gy + loop.c.y + 18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 16, gy + 3);
  ctx.lineTo(cx + loop.c.x, gy + loop.c.y + 18);
  ctx.stroke();

  // Track: spine, ties, twin rails
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#831843';
  ctx.lineWidth = 7;
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(cx + p.x, gy + p.y) : ctx.moveTo(cx + p.x, gy + p.y)));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(253,164,175,0.9)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < path.length; i += 2) {
    const p = path[i];
    ctx.beginPath();
    ctx.moveTo(cx + p.x - 3.5, gy + p.y + 3);
    ctx.lineTo(cx + p.x + 3.5, gy + p.y - 4);
    ctx.stroke();
  }
  ctx.strokeStyle = '#f43f5e';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(cx + p.x, gy + p.y - 3.5) : ctx.moveTo(cx + p.x, gy + p.y - 3.5)));
  ctx.stroke();
  ctx.strokeStyle = '#fecdd3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(cx + p.x, gy + p.y - 5) : ctx.moveTo(cx + p.x, gy + p.y - 5)));
  ctx.stroke();

  // Chain lift on the climb
  ctx.strokeStyle = 'rgba(226,232,240,0.55)';
  ctx.lineWidth = 1;
  for (let i = 2; i < 26; i += 3) {
    const p = path[i];
    ctx.beginPath();
    ctx.moveTo(cx + p.x - 1.5, gy + p.y + 1);
    ctx.lineTo(cx + p.x + 1.5, gy + p.y - 1.5);
    ctx.stroke();
  }

  // Station building + covered queue house on the pad's front-right
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(cx + 84, gy - 28, 40, 26);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(cx + 80, gy - 2, 48, 5);
  ctx.fillStyle = '#e11d48';
  ctx.beginPath();
  ctx.moveTo(cx + 78, gy - 28);
  ctx.lineTo(cx + 104, gy - 44);
  ctx.lineTo(cx + 130, gy - 28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(cx + 92, gy - 21, 8, 11);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(cx + 106, gy - 21, 10, 19);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MEGA COASTER', cx + 104, gy - 32);
  // Switchback queue rails
  ctx.strokeStyle = 'rgba(148,163,184,0.55)';
  ctx.lineWidth = 1;
  for (let r = 0; r < 3; r++) {
    ctx.beginPath();
    ctx.moveTo(cx + 60, gy + 4 + r * 5);
    ctx.lineTo(cx + 82, gy + 4 + r * 5);
    ctx.stroke();
  }

  // Train — 5 cars on the real track, banking through the loop
  const T = (simClock % 7000) / 7000;
  const idx = Math.floor(T * (path.length - 1));
  for (let c = 4; c >= 0; c--) {
    const i = Math.max(0, idx - c * 3);
    const p = path[i],
      pn = path[Math.min(path.length - 1, i + 1)];
    const ang = Math.atan2(pn.y - p.y, pn.x - p.x);
    ctx.save();
    ctx.translate(cx + p.x, gy + p.y - 7);
    ctx.rotate(ang);
    ctx.fillStyle = c === 0 ? '#fb7185' : '#e11d48';
    ctx.beginPath();
    ctx.roundRect(-7, -5, 14, 8, 2.5);
    ctx.fill();
    ctx.fillStyle = '#881337';
    ctx.fillRect(-7, 1.5, 14, 2);
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(-2.5, -6.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(2.5, -6.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fcd9b6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2.5, -7.5);
    ctx.lineTo(-4, -11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2.5, -7.5);
    ctx.lineTo(4, -11);
    ctx.stroke();
    ctx.restore();
  }

  // Night bulbs along the whole layout
  if (isNight) drawMegaCoasterNight(ctx, cx, cy);
}

/** Night-only lights for drawMegaCoaster. Split out so the baked sprite
 *  (render/atlas.ts) can blit the day structure and still add these on
 *  top -- main.ts tints the scene at night, but emissive detail has to be
 *  drawn, not dimmed. drawMegaCoaster() still calls it, so the vector fallback
 *  is unchanged. */
export function drawMegaCoasterNight(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const path = megaTrack();
  const gy = cy - 5;
  for (let i = 0; i < path.length; i += 5) {
    const p = path[i];
    ctx.fillStyle = Math.floor(simClock * 0.003 + i) % 2 ? '#fef08a' : '#fb7185';
    ctx.shadowBlur = 6;
    ctx.shadowColor = ctx.fillStyle;
    ctx.beginPath();
    ctx.arc(cx + p.x, gy + p.y - 8, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  }
