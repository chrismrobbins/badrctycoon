import { drawIsoDeck, setPad, PAD_W, PAD_H } from '../iso';
import { simClock, isNight } from '../clock';

interface KioskColors {
  deck: string;
  deckSide: string;
  wall: string;
  wallDark: string;
  counterTop: string;
  counter: string;
  awning: string;
  awningAlt: string;
  uniform?: string;
  hat?: string;
}

/** Shared kiosk shell — gives every shop the same solid iso construction
 *  (deck, side wall, body, counter, scalloped awning, server) so details are
 *  all that differ between them. Returns the ground line (`gy`) so callers
 *  can position their own extras relative to it. */
function drawKiosk(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: KioskColors): number {
  setPad(1);
  drawIsoDeck(ctx, cx, cy, 0.98, c.deck, c.deckSide, 4);
  setPad(2);
  const gy = cy - 4;

  // Side wall for isometric depth
  ctx.fillStyle = c.wallDark;
  ctx.beginPath();
  ctx.moveTo(cx + 15, gy - 28);
  ctx.lineTo(cx + 22, gy - 34);
  ctx.lineTo(cx + 22, gy - 12);
  ctx.lineTo(cx + 15, gy - 6);
  ctx.closePath();
  ctx.fill();

  // Body + interior shadow
  ctx.fillStyle = c.wall;
  ctx.fillRect(cx - 15, gy - 28, 30, 22);
  ctx.fillStyle = 'rgba(15,23,42,0.35)';
  ctx.fillRect(cx - 12, gy - 25, 24, 11);

  // Server behind the counter
  ctx.fillStyle = c.uniform || '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(cx - 3.5, gy - 21, 7, 8, 2);
  ctx.fill();
  ctx.fillStyle = '#fcd9b6';
  ctx.beginPath();
  ctx.arc(cx, gy - 23, 2.6, 0, Math.PI * 2);
  ctx.fill();
  if (c.hat) {
    ctx.fillStyle = c.hat;
    ctx.beginPath();
    ctx.roundRect(cx - 3, gy - 26.5, 6, 2.6, 1);
    ctx.fill();
  }

  // Counter slab + front face
  ctx.fillStyle = c.counterTop;
  ctx.fillRect(cx - 18, gy - 14, 36, 3);
  ctx.fillStyle = c.counter;
  ctx.fillRect(cx - 16, gy - 11, 32, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(cx - 16, gy - 6, 32, 1.5);

  // Scalloped striped awning
  ctx.fillStyle = c.awning;
  ctx.beginPath();
  ctx.moveTo(cx - 21, gy - 15);
  ctx.lineTo(cx - 16, gy - 30);
  ctx.lineTo(cx + 16, gy - 30);
  ctx.lineTo(cx + 21, gy - 15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c.awningAlt;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 7.4 - 2, gy - 30);
    ctx.lineTo(cx + i * 7.4 + 1.6, gy - 30);
    ctx.lineTo(cx + i * 8.6 + 2, gy - 15);
    ctx.lineTo(cx + i * 8.6 - 2.4, gy - 15);
    ctx.closePath();
    ctx.fill();
  }
  // Scalloped hem
  ctx.fillStyle = c.awning;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx + i * 5.2, gy - 15, 2.6, 0, Math.PI);
    ctx.fill();
  }
  return gy;
}

export function drawFoodStall(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const gy = drawKiosk(ctx, cx, cy, {
    deck: '#a16207',
    deckSide: '#713f12',
    wall: '#b45309',
    wallDark: '#7c2d12',
    counterTop: '#fde68a',
    counter: '#92400e',
    awning: '#dc2626',
    awningAlt: '#fef2f2',
    uniform: '#f8fafc',
    hat: '#ffffff',
  });
  // Menu board
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.roundRect(cx - 13, gy - 25, 11, 9, 1);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  for (let i = 0; i < 3; i++) ctx.fillRect(cx - 11.5, gy - 23 + i * 2.4, 7 - i, 1);
  // Griddle with sizzling burgers + heat wisp
  ctx.fillStyle = '#27272a';
  ctx.fillRect(cx + 1, gy - 16.5, 11, 2.5);
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.arc(cx + 4, gy - 17, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 9, gy - 17, 1.6, 0, Math.PI * 2);
  ctx.fill();
  const t = simClock * 0.002;
  ctx.strokeStyle = 'rgba(226,232,240,0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 2; i++) {
    const ph = (t * 0.4 + i * 0.5) % 1;
    ctx.beginPath();
    ctx.moveTo(cx + 4 + i * 5, gy - 18);
    ctx.quadraticCurveTo(cx + 6 + i * 5 + Math.sin(t * 3 + i) * 2, gy - 22 - ph * 6, cx + 4 + i * 5, gy - 26 - ph * 6);
    ctx.globalAlpha = 1 - ph;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Rooftop burger sign
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.ellipse(cx, gy - 33, 6, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.ellipse(cx, gy - 35, 6, 3.4, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(cx - 5.5, gy - 33.4, 11, 1.2);
  ctx.fillStyle = '#fef3c7';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx - 3 + i * 3, gy - 36.5, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawDrinkStall(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const gy = drawKiosk(ctx, cx, cy, {
    deck: '#0369a1',
    deckSide: '#075985',
    wall: '#0284c7',
    wallDark: '#0c4a6e',
    counterTop: '#e0f2fe',
    counter: '#075985',
    awning: '#0ea5e9',
    awningAlt: '#f0f9ff',
    uniform: '#bae6fd',
    hat: '#0ea5e9',
  });
  // Soda fountain taps
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(cx - 13, gy - 24, 10, 8);
  ctx.fillStyle = '#334155';
  for (let i = 0; i < 3; i++) ctx.fillRect(cx - 11.5 + i * 3, gy - 18, 1.4, 2.4);
  // Cup pyramid on the counter
  const cupCols = ['#f8fafc', '#f8fafc', '#f8fafc'];
  cupCols.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx + 3 + i * 4, gy - 14);
    ctx.lineTo(cx + 6.4 + i * 4, gy - 14);
    ctx.lineTo(cx + 5.8 + i * 4, gy - 19);
    ctx.lineTo(cx + 3.6 + i * 4, gy - 19);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cx + 4.4 + i * 4, gy - 21.5, 0.9, 2.6);
  });
  // Ice cooler
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(cx - 16, gy - 5, 8, 4, 1);
  ctx.fill();
  ctx.fillStyle = '#7dd3fc';
  ctx.fillRect(cx - 15, gy - 4.5, 6, 1);
  // Giant cup sign with bubbles
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(cx - 5, gy - 32);
  ctx.lineTo(cx + 5, gy - 32);
  ctx.lineTo(cx + 3.6, gy - 43);
  ctx.lineTo(cx - 3.6, gy - 43);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(cx - 4.4, gy - 40, 8.8, 7);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(cx + 1.5, gy - 48, 1.6, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  const bt = simClock * 0.003;
  for (let i = 0; i < 3; i++) {
    const bp = (bt + i * 0.33) % 1;
    ctx.beginPath();
    ctx.arc(cx - 2 + i * 2, gy - 33 - bp * 6, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawRestroom(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  setPad(1);
  drawIsoDeck(ctx, cx, cy, 0.98, '#64748b', '#3f4a5a', 4);
  setPad(2);
  const gy = cy - 4;
  // Side wall
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(cx + 14, gy - 26);
  ctx.lineTo(cx + 21, gy - 32);
  ctx.lineTo(cx + 21, gy - 8);
  ctx.lineTo(cx + 14, gy - 2);
  ctx.closePath();
  ctx.fill();
  // Brick front wall
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx - 14, gy - 26, 28, 24);
  ctx.strokeStyle = 'rgba(71,85,105,0.4)';
  ctx.lineWidth = 0.75;
  for (let r = 0; r < 6; r++) {
    const ry = gy - 24 + r * 4;
    ctx.beginPath();
    ctx.moveTo(cx - 14, ry);
    ctx.lineTo(cx + 14, ry);
    ctx.stroke();
    for (let b = 0; b < 4; b++) {
      const bx = cx - 14 + b * 7 + (r % 2 ? 3.5 : 0);
      ctx.beginPath();
      ctx.moveTo(bx, ry);
      ctx.lineTo(bx, ry + 4);
      ctx.stroke();
    }
  }
  // Overhanging roof + vent pipe
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(cx - 18, gy - 26);
  ctx.lineTo(cx, gy - 36);
  ctx.lineTo(cx + 22, gy - 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.fillRect(cx - 18, gy - 27, 40, 2);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx + 7, gy - 42, 2.6, 8);
  ctx.beginPath();
  ctx.ellipse(cx + 8.3, gy - 42, 2.6, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Two doorways with pictogram signs
  ([[-7, '#3b82f6'], [7, '#ec4899']] as [number, string][]).forEach(([ox, col]) => {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx + ox - 4.5, gy - 18, 9, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cx + ox - 3.5, gy - 17, 7, 15);
    // Sign plate + figure
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(cx + ox - 3.5, gy - 24, 7, 5, 1);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + ox, gy - 22.4, 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx + ox - 0.9, gy - 21.2, 1.8, 2.4);
    // Door handle
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(cx + ox + (ox > 0 ? -3 : 2), gy - 11, 1.2, 1.2);
  });
  // WC placard
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(cx - 8, gy - 33, 16, 6, 1);
  ctx.fill();
  ctx.fillStyle = '#e0f2fe';
  ctx.font = 'bold 6px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RESTROOM', cx, gy - 28.5);
  if (isNight) drawRestroomNight(ctx, cx, cy);
}

export function drawBalloonStand(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  setPad(1);
  drawIsoDeck(ctx, cx, cy, 0.98, '#9f1239', '#6b0f2a', 4);
  setPad(2);
  const gy = cy - 4;
  const t = simClock * 0.002;

  // Vendor cart with wheels and a striped skirt
  ctx.fillStyle = '#881337';
  ctx.beginPath();
  ctx.roundRect(cx - 11, gy - 13, 22, 11, 2);
  ctx.fill();
  ctx.fillStyle = '#be123c';
  for (let i = 0; i < 5; i++) ctx.fillRect(cx - 10 + i * 4.4, gy - 12, 2.2, 9);
  ctx.fillStyle = '#fecdd3';
  ctx.fillRect(cx - 12, gy - 15, 24, 2.5);
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(cx - 7, gy - 1.5, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 7, gy - 1.5, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(cx - 7, gy - 1.5, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 7, gy - 1.5, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Vendor standing beside the cart
  ctx.fillStyle = '#f43f5e';
  ctx.beginPath();
  ctx.roundRect(cx - 16, gy - 16, 6, 9, 2);
  ctx.fill();
  ctx.fillStyle = '#fcd9b6';
  ctx.beginPath();
  ctx.arc(cx - 13, gy - 18.5, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e11d48';
  ctx.beginPath();
  ctx.roundRect(cx - 16, gy - 21.5, 6, 2.6, 1);
  ctx.fill();

  // Balloon bouquet on strings from the cart post
  ctx.fillStyle = '#78716c';
  ctx.fillRect(cx + 9, gy - 30, 1.5, 17);
  const cols = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#ec4899', '#f97316'];
  for (let i = 0; i < 7; i++) {
    const ang = -0.9 + (i / 6) * 1.8;
    const dist = 12 + (i % 3) * 5;
    const bx = cx + 9.7 + Math.sin(ang + Math.sin(t + i) * 0.06) * dist;
    const by = gy - 32 - Math.cos(ang) * dist + Math.sin(t * 1.2 + i) * 1.6;
    ctx.strokeStyle = 'rgba(203,213,225,0.55)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + 9.7, gy - 30);
    ctx.quadraticCurveTo((cx + 9.7 + bx) / 2 + 2, (gy - 30 + by) / 2, bx, by + 4.2);
    ctx.stroke();
    // Balloon with highlight and knot
    ctx.fillStyle = cols[i];
    ctx.beginPath();
    ctx.ellipse(bx, by, 3.6, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(bx - 1.2, by - 1.6, 1.1, 1.5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cols[i];
    ctx.beginPath();
    ctx.moveTo(bx - 1, by + 4.2);
    ctx.lineTo(bx + 1, by + 4.2);
    ctx.lineTo(bx, by + 5.6);
    ctx.closePath();
    ctx.fill();
  }
}

// ── Go-Karts (2×2) ──

export function drawGoKarts(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // The track IS the pad — asphalt diamond covering the whole block
  drawIsoDeck(ctx, cx, cy, 0.96, '#2f3947', '#1f262f', 3);

  const gy = cy - 3;
  // Track ring drawn in the pad's isometric proportions (2:1)
  const RX = PAD_W * 0.78,
    RY = PAD_H * 0.78;
  const IX = PAD_W * 0.4,
    IY = PAD_H * 0.4;

  // Asphalt ring with an infield hole
  ctx.beginPath();
  ctx.ellipse(cx, gy, RX, RY, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, gy, IX, IY, 0, 0, Math.PI * 2, true);
  ctx.fillStyle = '#3f4854';
  ctx.fill('evenodd');
  // Rubber-marked racing line
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(15,23,42,0.45)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(cx, gy, (RX + IX) / 2, (RY + IY) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Center dashes
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = 'rgba(229,231,235,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, gy, (RX + IX) / 2, (RY + IY) / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Red/white kerbing, outer and inner
  const kerb = (rx: number, ry: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2,
        a1 = ((i + 0.5) / n) * Math.PI * 2;
      ctx.strokeStyle = i % 2 ? '#f8fafc' : '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, gy, rx, ry, 0, a0, a1);
      ctx.stroke();
    }
  };
  kerb(RX, RY, 24);
  kerb(IX, IY, 16);

  // Grass infield with tire stacks and a hay bale
  ctx.fillStyle = '#14532d';
  ctx.beginPath();
  ctx.ellipse(cx, gy, IX - 2, IY - 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#166534';
  ctx.beginPath();
  ctx.ellipse(cx - 4, gy - 2, IX * 0.5, IY * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ([[-8, -2], [7, 2], [1, -4]] as [number, number][]).forEach(([ox, oy]) => {
    ctx.beginPath();
    ctx.ellipse(cx + ox, gy + oy, 4, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#d4a72c';
  ctx.beginPath();
  ctx.roundRect(cx - 3, gy + 4, 8, 4, 1);
  ctx.fill();

  // Start/finish gantry straddling the front straight
  const gantryY = gy + RY - 4;
  ctx.fillStyle = '#475569';
  ctx.fillRect(cx - 30, gantryY - 30, 3, 30);
  ctx.fillRect(cx + 27, gantryY - 30, 3, 30);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(cx - 30, gantryY - 34, 60, 5);
  for (let fx = 0; fx < 15; fx++) {
    for (let fy = 0; fy < 2; fy++) {
      ctx.fillStyle = (fx + fy) % 2 === 0 ? '#0f172a' : '#f8fafc';
      ctx.fillRect(cx - 30 + fx * 4, gantryY - 34 + fy * 2.5, 4, 2.5);
    }
  }
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 7px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GO-KARTS', cx, gantryY - 37);
  // Start/finish line painted on the asphalt
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#f8fafc' : '#334155';
    ctx.fillRect(cx - 6 + (i % 2) * 3, gy + IY + (i / 6) * (RY - IY), 3, 2.5);
  }

  // 5 karts racing, sorted so near-side ones draw last
  const t = simClock * 0.0012;
  const kcolors = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7'];
  const karts: { a: number; i: number; y: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const a = t * (1 + i * 0.05) + i * 1.28;
    karts.push({ a, i, y: Math.sin(a) });
  }
  karts.sort((p, q) => p.y - q.y);
  for (const k of karts) {
    const lane = k.i % 2 ? 0.93 : 0.72;
    const kx = cx + Math.cos(k.a) * (((RX + IX) / 2) * (lane * 1.06));
    const ky = gy + Math.sin(k.a) * (((RY + IY) / 2) * (lane * 1.06));
    if (isNight) {
      const dx = -Math.sin(k.a),
        dy = Math.cos(k.a) * 0.5;
      const g = ctx.createRadialGradient(kx, ky, 0, kx + dx * 16, ky + dy * 16, 16);
      g.addColorStop(0, 'rgba(254,240,138,0.4)');
      g.addColorStop(1, 'rgba(254,240,138,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(kx + dx * 9, ky + dy * 9, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shadow + tires
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(kx, ky + 3, 7, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(kx - 5, ky + 2, 2.2, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(kx + 5, ky + 2, 2.2, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Chassis + nose cone
    ctx.fillStyle = kcolors[k.i];
    ctx.beginPath();
    ctx.roundRect(kx - 7, ky - 4, 14, 7, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(kx - 6, ky - 3.5, 12, 1.5);
    // Driver: seat, torso, helmet with visor
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(kx - 3, ky - 8, 6, 5, 2);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(kx, ky - 8.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(kx, ky - 8, 2.6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.fill();
    // Rear wing
    ctx.fillStyle = '#334155';
    ctx.fillRect(kx - 4, ky - 6, 8, 1.5);
  }
}

/** Night-only lights for drawRestroom. Split out so the baked sprite
 *  (render/atlas.ts) can blit the day structure and still add these on
 *  top -- main.ts tints the scene at night, but emissive detail has to be
 *  drawn, not dimmed. drawRestroom() still calls it, so the vector fallback
 *  is unchanged. */
export function drawRestroomNight(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const gy = cy - 4;
  ctx.fillStyle = '#4ade80';
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#22c55e';
  ctx.beginPath();
  ctx.arc(cx, gy - 30, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  }
