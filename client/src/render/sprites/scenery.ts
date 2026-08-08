import type { GameState } from '../../core/state';
import { toScreen } from '../camera';
import { drawPoly, drawGroundShadow, drawIsoDeck, padHalf, setPad, tileHash } from '../iso';
import { simClock, isNight } from '../clock';

/** The park entrance — a fixed 3-tile gate, drawn once at its centre tile.
 *  Straight out of the RCT playbook: paved plaza, twin ticket kiosks with
 *  attendants, turnstiles, a big arch carrying the park name, and flags. */
export function drawEntrance(ctx: CanvasRenderingContext2D, cx: number, cy: number, entranceX: number, entranceY: number): void {
  // The gate spans three tiles along the grid's y axis, so every element is
  // positioned from those tiles' real screen coords — otherwise the kiosks
  // and arch end up on the wrong isometric diagonal.
  const centre = toScreen(entranceX, entranceY);
  const back = toScreen(entranceX, entranceY - 1); // up-and-right on screen
  const front = toScreen(entranceX, entranceY + 1); // down-and-left on screen
  // Convert to offsets relative to the passed-in centre
  const dx = cx - centre.x,
    dy = cy - centre.y;
  const B = { x: back.x + dx, y: back.y + dy };
  const F = { x: front.x + dx, y: front.y + dy };
  // Unit vector along the gate, pointing from back to front
  const ax = F.x - B.x,
    ay = F.y - B.y;
  const alen = Math.hypot(ax, ay);
  const ux = ax / alen,
    uy = ay / alen;

  const t = simClock * 0.003;

  // Draws one ticket kiosk. `flip` mirrors the window side so the pair reads
  // as facing each other across the gateway.
  const kiosk = (p: { x: number; y: number }, flip: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 1, 12, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Side wall for iso depth, on the away side
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.moveTo(p.x + flip * 9, p.y - 23);
    ctx.lineTo(p.x + flip * 14, p.y - 26);
    ctx.lineTo(p.x + flip * 14, p.y - 4);
    ctx.lineTo(p.x + flip * 9, p.y - 1);
    ctx.closePath();
    ctx.fill();
    // Front face
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.roundRect(p.x - 9, p.y - 23, 18, 22, 2);
    ctx.fill();
    // Striped hipped roof
    ctx.fillStyle = '#fef3c7';
    ctx.beginPath();
    ctx.moveTo(p.x - 13, p.y - 23);
    ctx.lineTo(p.x, p.y - 32);
    ctx.lineTo(p.x + flip * 16, p.y - 29);
    ctx.lineTo(p.x + flip * 13 - flip * 0, p.y - 23);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#dc2626';
    for (let s = 0; s < 3; s++) {
      ctx.beginPath();
      ctx.moveTo(p.x - 11 + s * 8, p.y - 23);
      ctx.lineTo(p.x - 8.5 + s * 8, p.y - 23);
      ctx.lineTo(p.x - 1 + s * 3.2, p.y - 30.5);
      ctx.lineTo(p.x - 2.6 + s * 3.2, p.y - 30.5);
      ctx.closePath();
      ctx.fill();
    }
    // Service window with an attendant
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(p.x - 6.5, p.y - 18, 13, 8);
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 14.2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 15.2, 2.5, Math.PI, 0);
    ctx.fill();
    // Counter shelf + fascia sign
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(p.x - 8, p.y - 9.6, 16, 1.8);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(p.x - 8, p.y - 7.4, 16, 5, 1);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 4.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TICKETS', p.x, p.y - 3.4);
    if (isNight) {
      ctx.fillStyle = '#fef08a';
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#fde047';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 25, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  };

  // Low wall running along the gate axis, tying the kiosks to the arch
  const wall = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    ctx.fillStyle = '#991b1b';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 11);
    ctx.lineTo(to.x, to.y - 11);
    ctx.lineTo(to.x, to.y - 1);
    ctx.lineTo(from.x, from.y - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fca5a5';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 11.5);
    ctx.lineTo(to.x, to.y - 11.5);
    ctx.lineTo(to.x, to.y - 9.5);
    ctx.lineTo(from.x, from.y - 9.5);
    ctx.closePath();
    ctx.fill();
  };

  // Arch springs from points just inside each flanking tile
  const springB = { x: B.x + ux * 11, y: B.y + uy * 11 };
  const springF = { x: F.x - ux * 11, y: F.y - uy * 11 };
  const apexY = cy - 56;

  // ── Painted back-to-front so overlaps read correctly ──
  wall(B, springB);
  kiosk(B, 1); // rear kiosk (up-right)

  // Arch: dark core, red body, bright highlight
  const archStroke = (w: number, col: string, lift: number) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(springB.x, springB.y - 2 - lift);
    ctx.quadraticCurveTo(cx, apexY - lift, springF.x, springF.y - 2 - lift);
    ctx.stroke();
    ctx.lineCap = 'butt';
  };
  archStroke(10, '#7f1d1d', 0);
  archStroke(6, '#dc2626', 2);
  archStroke(2, '#fca5a5', 4);

  // Turnstiles across the gateway, spaced along the gate axis
  [-0.42, 0, 0.42].forEach((k) => {
    const sx = cx + ux * k * alen,
      sy = cy + uy * k * alen;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(sx, sy - 2, 4.5, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillRect(sx - 0.9, sy - 6.5, 1.8, 4.5);
  });

  // Park-name banner hung at the arch apex
  const bannerY = apexY - 4;
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(cx - 46, bannerY, 92, 16, 3);
  ctx.fill();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(cx - 46, bannerY, 92, 16, 3);
  ctx.stroke();
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 11px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DYNAMICS PARK', cx, bannerY + 8.5);
  ctx.textBaseline = 'alphabetic';

  // Flagpoles at the banner's ends
  [-46, 46].forEach((ox, i) => {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx + ox, bannerY + 2);
    ctx.lineTo(cx + ox, bannerY - 16);
    ctx.stroke();
    ctx.fillStyle = i ? '#3b82f6' : '#22c55e';
    const fw = (i ? 10 : -10) + Math.sin(t + i * 2) * 2;
    ctx.beginPath();
    ctx.moveTo(cx + ox, bannerY - 16);
    ctx.quadraticCurveTo(cx + ox + fw * 0.6, bannerY - 14 + Math.sin(t * 2 + i) * 1.5, cx + ox + fw, bannerY - 12);
    ctx.lineTo(cx + ox, bannerY - 9);
    ctx.closePath();
    ctx.fill();
  });

  // Chase lights tracing the arch
  if (isNight) {
    for (let i = 0; i <= 12; i++) {
      const k = i / 12,
        v = 1 - k;
      const px = v * v * springB.x + 2 * v * k * cx + k * k * springF.x;
      const py = v * v * (springB.y - 6) + 2 * v * k * (apexY - 4) + k * k * (springF.y - 6);
      const lit = Math.floor(simClock * 0.004 + i) % 3 !== 0;
      ctx.fillStyle = lit ? (i % 2 ? '#fef08a' : '#fb7185') : 'rgba(148,163,184,0.5)';
      if (lit) {
        ctx.shadowBlur = 7;
        ctx.shadowColor = ctx.fillStyle;
      }
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  
  }

  wall(springF, F);
  kiosk(F, -1); // front kiosk (down-left) overlaps the arch leg
}

/** Park boundary fence around the whole plot, RCT style, with a gap at the gate. */
export function drawParkFence(ctx: CanvasRenderingContext2D, state: GameState, entranceY: number): void {
  const postMat = '#78716c',
    railMat = 'rgba(120,113,108,0.75)';
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const a = toScreen(ax, ay),
      b = toScreen(bx, by);
    ctx.strokeStyle = railMat;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 7);
    ctx.lineTo(b.x, b.y - 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 3);
    ctx.lineTo(b.x, b.y - 3);
    ctx.stroke();
    ctx.fillStyle = postMat;
    ctx.fillRect(a.x - 0.9, a.y - 9, 1.8, 9);
  };
  const N = state.gridSize;
  for (let i = 0; i < N; i++) {
    // West edge — leave a gap across the three entrance rows
    if (i < entranceY - 1 || i > entranceY + 1) seg(-0.5, i - 0.5, -0.5, i + 0.5);
    seg(N - 0.5, i - 0.5, N - 0.5, i + 0.5); // east
    seg(i - 0.5, -0.5, i + 0.5, -0.5); // north
    seg(i - 0.5, N - 0.5, i + 0.5, N - 0.5); // south
  }
}

export function drawTree(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  drawGroundShadow(ctx, cx, cy, 13);
  const h = tileHash(cx, cy);
  const variant = Math.floor(h * 3); // 3 deterministic species
  const sway = Math.sin(simClock * 0.0009 + cx * 0.1) * 1.6;
  // Root flare + tapered trunk
  ctx.fillStyle = '#57430f';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 5, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.moveTo(cx - 2.8, cy);
  ctx.lineTo(cx + 2.8, cy);
  ctx.lineTo(cx + 1.4 + sway * 0.4, cy - 17);
  ctx.lineTo(cx - 1.4 + sway * 0.4, cy - 17);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(cx + 0.6, cy - 17, 1.6, 17);
  const tx = cx + sway;
  if (variant === 0) {
    // Broad deciduous — layered blobs, lit from upper-left
    const blobs: [number, number, number][] = [
      [0, -24, 12],
      [-8, -18, 8.5],
      [8, -18, 8.5],
      [-4, -29, 7],
      [5, -28, 6.5],
    ];
    ctx.fillStyle = '#14532d';
    blobs.forEach(([ox, oy, r]) => {
      ctx.beginPath();
      ctx.arc(tx + ox + 1.5, cy + oy + 1.5, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#16a34a';
    blobs.forEach(([ox, oy, r]) => {
      ctx.beginPath();
      ctx.arc(tx + ox, cy + oy, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(tx - 4, cy - 28, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx - 9, cy - 20, 3.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 1) {
    // Conifer — stacked tiers
    for (let i = 0; i < 4; i++) {
      const w = 13 - i * 2.6,
        yy = cy - 8 - i * 8;
      ctx.fillStyle = ['#14532d', '#166534', '#15803d', '#16a34a'][i];
      ctx.beginPath();
      ctx.moveTo(tx, yy - 12);
      ctx.lineTo(tx + w, yy);
      ctx.lineTo(tx - w, yy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.moveTo(tx, cy - 44);
    ctx.lineTo(tx + 3, cy - 38);
    ctx.lineTo(tx - 3, cy - 38);
    ctx.closePath();
    ctx.fill();
  } else {
    // Palm — arcing fronds
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.42;
      ctx.beginPath();
      ctx.moveTo(tx, cy - 18);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 9, cy - 26, tx + Math.cos(a) * 16, cy - 22 + Math.abs(i - 3) * 1.6);
      ctx.stroke();
    }
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.42;
      ctx.beginPath();
      ctx.moveTo(tx, cy - 18);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 9, cy - 27, tx + Math.cos(a) * 15, cy - 23 + Math.abs(i - 3) * 1.6);
      ctx.stroke();
    }
    ctx.fillStyle = '#a16207';
    ([[-2, -17], [2, -16], [0, -14]] as [number, number][]).forEach(([ox, oy]) => {
      ctx.beginPath();
      ctx.arc(tx + ox, cy + oy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** `state` is optional and trailing so this fits the uniform SpriteFn shape
 *  render/sprites/index.ts's SPRITES table uses -- render() always passes it
 *  in practice; the fallback to 0 only matters for any other caller. */
export function drawTrashCan(ctx: CanvasRenderingContext2D, cx: number, cy: number, state?: GameState): void {
  const full = state?.litter[`${Math.round(cx)},${Math.round(cy)}`] || 0;
  drawGroundShadow(ctx, cx, cy, 7);
  // Tapered bin with hoop bands
  ctx.fillStyle = '#3f4a5a';
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 1);
  ctx.lineTo(cx + 5, cy - 1);
  ctx.lineTo(cx + 4, cy - 13);
  ctx.lineTo(cx - 4, cy - 13);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const yy = cy - 3 - i * 3.5;
    ctx.beginPath();
    ctx.moveTo(cx - 4.7 + i * 0.25, yy);
    ctx.lineTo(cx + 4.7 - i * 0.25, yy);
    ctx.stroke();
  }
  // Domed lid with a swing flap
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 13.5, 5.2, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 14.6, 4.4, 1.8, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 14.2, 2.4, 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  // Recycle marking
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 5px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('♺', cx, cy - 6);
  // Overflowing when the area is filthy
  if (full > 1) {
    ctx.fillStyle = '#a8a29e';
    ctx.beginPath();
    ctx.arc(cx - 2, cy - 16, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(cx + 2.2, cy - 16.6, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawBench(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  drawGroundShadow(ctx, cx, cy, 11);
  const h = tileHash(cx, cy);
  // Cast-iron legs
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(cx - 10, cy - 6, 2, 6);
  ctx.fillRect(cx + 8, cy - 6, 2, 6);
  // Slatted seat
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 ? '#a16207' : '#b45309';
    ctx.fillRect(cx - 12, cy - 8 - i * 1.6, 24, 1.4);
  }
  // Slatted back, angled
  ctx.save();
  ctx.translate(cx, cy - 10);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 ? '#a16207' : '#b45309';
    ctx.fillRect(-12, -3 - i * 2.4, 24, 1.8);
  }
  ctx.restore();
  // Armrests
  ctx.fillStyle = '#374151';
  ctx.fillRect(cx - 12.5, cy - 12, 2, 5);
  ctx.fillRect(cx + 10.5, cy - 12, 2, 5);
  // Sometimes a guest is resting here
  if (h > 0.55) {
    const col = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7'][Math.floor(h * 4) % 4];
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(cx - 3 + (h - 0.5) * 10, cy - 16, 6, 8, 2);
    ctx.fill();
    ctx.fillStyle = '#fcd9b6';
    ctx.beginPath();
    ctx.arc(cx + (h - 0.5) * 10, cy - 17.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawFlowerBed(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  setPad(1);
  drawIsoDeck(ctx, cx, cy, 1.0, '#3f2d16', '#2a1d0e', 3);
  setPad(2);
  const gy = cy - 3;
  // Stone border ring
  const { w, h } = padHalf(1);
  ctx.strokeStyle = '#a8a29e';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, gy - h);
  ctx.lineTo(cx + w, gy);
  ctx.lineTo(cx, gy + h);
  ctx.lineTo(cx - w, gy);
  ctx.closePath();
  ctx.stroke();
  // Tilled soil rows
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 18 + i * 3, gy + i * 2);
    ctx.lineTo(cx + 18 + i * 3, gy + i * 2);
    ctx.stroke();
  }
  // Flower clusters — deterministic layout, gentle sway
  const t = simClock * 0.0015;
  const cols = ['#ec4899', '#eab308', '#3b82f6', '#a855f7', '#ef4444', '#f97316'];
  for (let i = 0; i < 9; i++) {
    const hh = tileHash(cx + i * 13, cy - i * 7);
    const ox = ((i % 3) - 1) * 9 + (hh - 0.5) * 5;
    const oy = (Math.floor(i / 3) - 1) * 5 + (hh - 0.5) * 2;
    const fx = cx + ox + Math.sin(t + i) * 0.7,
      fy = gy + oy - 3;
    // Stem + leaves
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx, fy + 4);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.ellipse(fx - 1.6, fy + 2, 1.6, 0.7, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // 5-petal bloom with a center
    const col = cols[Math.floor(hh * cols.length)];
    ctx.fillStyle = col;
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2 + hh * 3;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(pa) * 1.7, fy + Math.sin(pa) * 1.2, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(fx, fy, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawLamp(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  setPad(1);
  drawIsoDeck(ctx, cx, cy, 1.0, '#94a3b8', '#64748b', 2);
  setPad(2);
  const gy = cy - 2;
  // Fluted base
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(cx, gy, 4, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.roundRect(cx - 2.6, gy - 5, 5.2, 5, 1);
  ctx.fill();
  // Tapered post with highlight
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(cx - 1.6, gy - 5);
  ctx.lineTo(cx + 1.6, gy - 5);
  ctx.lineTo(cx + 1.1, gy - 26);
  ctx.lineTo(cx - 1.1, gy - 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(226,232,240,0.35)';
  ctx.fillRect(cx - 1.3, gy - 26, 0.9, 21);
  // Cross-arm + scroll bracket
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 3, gy - 23);
  ctx.quadraticCurveTo(cx, gy - 26, cx + 3, gy - 23);
  ctx.stroke();
  // Glass lantern housing
  const lit = isNight || ((window as unknown as { _nightAlpha?: number })._nightAlpha || 0) > 0.15;
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(cx - 4, gy - 28);
  ctx.lineTo(cx + 4, gy - 28);
  ctx.lineTo(cx + 2.4, gy - 34);
  ctx.lineTo(cx - 2.4, gy - 34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = lit ? '#fef08a' : 'rgba(226,232,240,0.55)';
  ctx.beginPath();
  ctx.moveTo(cx - 3.2, gy - 28.6);
  ctx.lineTo(cx + 3.2, gy - 28.6);
  ctx.lineTo(cx + 2, gy - 33.4);
  ctx.lineTo(cx - 2, gy - 33.4);
  ctx.closePath();
  if (lit) {
    ctx.shadowBlur = isNight ? 22 : 8;
    ctx.shadowColor = '#fde047';
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  // Finial cap
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(cx - 3, gy - 34);
  ctx.lineTo(cx + 3, gy - 34);
  ctx.lineTo(cx, gy - 37.5);
  ctx.closePath();
  ctx.fill();
  // Halo + moths at night
  if (isNight) drawLampNight(ctx, cx, cy);
}

export function drawFountain(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  drawGroundShadow(ctx, cx, cy, 16);
  drawPoly(ctx, cx, cy, '#cbd5e1');
  // Basin with water
  ctx.beginPath();
  ctx.ellipse(cx, cy - 2, 14, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#94a3b8';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - 3, 12, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  const t = simClock * 0.005;
  // Water shimmer
  ctx.fillStyle = 'rgba(191, 219, 254, 0.6)';
  for (let i = 0; i < 3; i++) {
    const sx = cx + Math.sin(t + i * 2.1) * 8;
    ctx.beginPath();
    ctx.ellipse(sx, cy - 3 + Math.cos(t + i) * 1.5, 2, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Center column + arcing jets
  ctx.fillStyle = '#64748b';
  ctx.fillRect(cx - 1.5, cy - 14, 3, 11);
  const h = 16 + Math.sin(t) * 2;
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.quadraticCurveTo(cx - 7, cy - 14 - h * 0.7, cx - 9, cy - 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.quadraticCurveTo(cx + 7, cy - 14 - h * 0.7, cx + 9, cy - 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx, cy - 14 - h * 0.5);
  ctx.stroke();
  // Falling droplets
  ctx.fillStyle = 'rgba(147, 197, 253, 0.9)';
  for (let i = 0; i < 4; i++) {
    const dp = (t * 0.6 + i * 0.25) % 1;
    ctx.beginPath();
    ctx.arc(cx + (i - 1.5) * 5 * dp, cy - 14 - Math.sin(dp * Math.PI) * h * 0.8, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}



/** Night-only lights for drawLamp. Split out so the baked sprite
 *  (render/atlas.ts) can blit the day structure and still add these on
 *  top -- main.ts tints the scene at night, but emissive detail has to be
 *  drawn, not dimmed. drawLamp() still calls it, so the vector fallback
 *  is unchanged. */
export function drawLampNight(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const gy = cy - 2;
  const g = ctx.createRadialGradient(cx, gy - 31, 0, cx, gy - 31, 16);
  g.addColorStop(0, 'rgba(254,240,138,0.4)');
  g.addColorStop(1, 'rgba(254,240,138,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, gy - 31, 16, 0, Math.PI * 2);
  ctx.fill();
  const mt = simClock * 0.004;
  ctx.fillStyle = 'rgba(226,232,240,0.6)';
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.arc(cx + Math.sin(mt + i * 3) * 7, gy - 31 + Math.cos(mt * 1.3 + i * 2) * 5, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  }
