import type { GameState } from '../core/state';
import { RIDE_TYPES, RIDE_ACCENT, MINI_COLORS, STAFF_KINDS } from '../content';
import { toScreen, toMap, rotationAngle } from './camera';

/** Whether the minimap panel is shown. Sole writer is toggleMinimap(); read
 *  directly by main.ts's render() to decide whether to bother redrawing it
 *  at all (throttled to every 6th frame there).
 *
 *  Starts FALSE to match the markup: #minimap-wrap ships with the `hidden`
 *  class, and this flag used to start true, so the first click set it to false
 *  and re-hid an already-hidden panel -- it took two clicks to open the
 *  minimap. That is ARCHITECTURE.md 3.7. */
export let minimapOn = false;

export function toggleMinimap(): void {
  minimapOn = !minimapOn;
  document.getElementById('minimap-wrap').classList.toggle('hidden', !minimapOn);
  document.getElementById('btn-minimap').classList.toggle('text-blue-500', minimapOn);
}

export function drawMinimap(state: GameState, mainCanvas: HTMLCanvasElement, zoom: number, panX: number, panY: number): void {
  const mc = document.getElementById('minimap') as HTMLCanvasElement;
  if (!mc || !minimapOn) return;
  const m = mc.getContext('2d')!;
  m.clearRect(0, 0, mc.width, mc.height);
  m.fillStyle = '#0b1220';
  m.fillRect(0, 0, mc.width, mc.height);
  // Rotate the whole minimap with the map. A north-up minimap stops matching
  // the view the moment you press Q -- it is meant to be the same park, and
  // reading a rotated world off an unrotated map is worse than no map.
  //
  // Mid-turn the square is at an angle and its corners would overflow the
  // panel, so it is scaled to its own bounding box: |cos|+|sin| is 1 square-on
  // and sqrt(2) at 45 degrees, which is exactly the shrink needed to keep it
  // inside. The scale returns to 1 whenever the turn lands.
  const t = -rotationAngle * (Math.PI / 2);
  const fit = 1 / (Math.abs(Math.cos(t)) + Math.abs(Math.sin(t)));
  const cell = Math.min((mc.width - 8) / state.gridSize, (mc.height - 8) / state.gridSize) * fit;
  const ox = (mc.width - cell * state.gridSize) / 2,
    oy = (mc.height - cell * state.gridSize) / 2;
  m.save();
  m.translate(mc.width / 2, mc.height / 2);
  m.rotate(t);
  m.translate(-mc.width / 2, -mc.height / 2);
  // Land
  m.fillStyle = '#14532d';
  m.fillRect(ox, oy, cell * state.gridSize, cell * state.gridSize);
  for (let x = 0; x < state.gridSize; x++) {
    for (let y = 0; y < state.gridSize; y++) {
      const c = state.map[x][y];
      if (!c) continue;
      m.fillStyle = RIDE_TYPES.has(c) ? RIDE_ACCENT[c] || '#a855f7' : MINI_COLORS[c] || '#cbd5e1';
      m.fillRect(ox + x * cell, oy + y * cell, Math.max(1, cell), Math.max(1, cell));
    }
  }
  // Guests
  m.fillStyle = 'rgba(255,255,255,0.85)';
  for (const g of state.visualGuests as { x: number; y: number }[]) m.fillRect(ox + g.x * cell, oy + g.y * cell, Math.max(1, cell * 0.5), Math.max(1, cell * 0.5));
  // Staff
  for (const w of state.staff) {
    m.fillStyle = STAFF_KINDS[w.kind].color;
    m.fillRect(ox + w.x * cell, oy + w.y * cell, Math.max(1.5, cell * 0.6), Math.max(1.5, cell * 0.6));
  }
  // Viewport outline -- invert the camera transform at the 4 screen corners.
  //
  // Drawn as the actual QUAD those corners map to, not their bounding box: an
  // isometric viewport is a diamond in map space, and the bounding box of a
  // diamond claims roughly twice the area you can really see.
  const corners = [
    [0, 0],
    [mainCanvas.width, 0],
    [mainCanvas.width, mainCanvas.height],
    [0, mainCanvas.height],
  ].map(([sx, sy]) => toMap(sx, sy, mainCanvas, zoom, panX, panY));
  // Clipped to the park. Zoomed in, the viewport quad extends well past the
  // map edge, and unclipped it reads as a stray diagonal across the panel
  // rather than as "here is the bit you're looking at".
  m.save();
  m.beginPath();
  m.rect(ox, oy, cell * state.gridSize, cell * state.gridSize);
  m.clip();
  m.strokeStyle = 'rgba(96,165,250,0.9)';
  m.lineWidth = 1.5;
  m.beginPath();
  corners.forEach((c, i) => {
    const px = ox + c.x * cell,
      py = oy + c.y * cell;
    if (i === 0) m.moveTo(px, py);
    else m.lineTo(px, py);
  });
  m.closePath();
  m.stroke();
  m.restore();   // viewport clip
  m.restore();   // minimap rotation
}

/** Returns the new camera pan so a click on the minimap centers the main
 *  view there -- the caller (main.ts) owns zoom/panX/panY and applies it. */
export function minimapJump(
  e: MouseEvent,
  state: GameState,
  mainCanvas: HTMLCanvasElement,
  zoom: number,
): { panX: number; panY: number } {
  const mc = document.getElementById('minimap') as HTMLCanvasElement;
  const r = mc.getBoundingClientRect();
  // Must undo exactly what drawMinimap() applied, or clicking a ride jumps you
  // somewhere else entirely once the park is rotated.
  const t = -rotationAngle * (Math.PI / 2);
  const fit = 1 / (Math.abs(Math.cos(t)) + Math.abs(Math.sin(t)));
  const cell = Math.min((mc.width - 8) / state.gridSize, (mc.height - 8) / state.gridSize) * fit;
  const ox = (mc.width - cell * state.gridSize) / 2,
    oy = (mc.height - cell * state.gridSize) / 2;

  // Click position in minimap pixels, then un-rotated about the panel centre.
  const rawX = (e.clientX - r.left) * (mc.width / r.width);
  const rawY = (e.clientY - r.top) * (mc.height / r.height);
  const hx = mc.width / 2,
    hy = mc.height / 2;
  const c = Math.cos(-t),
    sn = Math.sin(-t);
  const px = hx + (rawX - hx) * c - (rawY - hy) * sn;
  const py = hy + (rawX - hx) * sn + (rawY - hy) * c;
  const gx = (px - ox) / cell;
  const gy = (py - oy) / cell;
  // Center the camera on that tile
  const w = toScreen(gx, gy);
  return {
    panX: -w.x * zoom,
    panY: mainCanvas.height / 2 - (mainCanvas.height / 4 + 50) - w.y * zoom,
  };
}
