import type { GameState } from '../core/state';
import { RIDE_TYPES, RIDE_ACCENT, MINI_COLORS, STAFF_KINDS } from '../content';
import { toScreen, toMap } from './camera';

/** Whether the minimap panel is shown. Sole writer is toggleMinimap(); read
 *  directly by main.ts's render() to decide whether to bother redrawing it
 *  at all (throttled to every 6th frame there). */
export let minimapOn = true;

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
  const cell = Math.min((mc.width - 8) / state.gridSize, (mc.height - 8) / state.gridSize);
  const ox = (mc.width - cell * state.gridSize) / 2,
    oy = (mc.height - cell * state.gridSize) / 2;
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
  // Viewport rectangle — invert the camera transform at the 4 screen corners
  const corners = [
    [0, 0],
    [mainCanvas.width, 0],
    [mainCanvas.width, mainCanvas.height],
    [0, mainCanvas.height],
  ].map(([sx, sy]) => toMap(sx, sy, mainCanvas, zoom, panX, panY));
  const xs = corners.map((c) => c.x),
    ys = corners.map((c) => c.y);
  const x0 = Math.max(0, Math.min(...xs)),
    x1 = Math.min(state.gridSize, Math.max(...xs));
  const y0 = Math.max(0, Math.min(...ys)),
    y1 = Math.min(state.gridSize, Math.max(...ys));
  m.strokeStyle = 'rgba(96,165,250,0.9)';
  m.lineWidth = 1;
  m.strokeRect(ox + x0 * cell, oy + y0 * cell, (x1 - x0) * cell, (y1 - y0) * cell);
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
  const cell = Math.min((mc.width - 8) / state.gridSize, (mc.height - 8) / state.gridSize);
  const ox = (mc.width - cell * state.gridSize) / 2,
    oy = (mc.height - cell * state.gridSize) / 2;
  const gx = ((e.clientX - r.left) * (mc.width / r.width) - ox) / cell;
  const gy = ((e.clientY - r.top) * (mc.height / r.height) - oy) / cell;
  // Center the camera on that tile
  const w = toScreen(gx, gy);
  return {
    panX: -w.x * zoom,
    panY: mainCanvas.height / 2 - (mainCanvas.height / 4 + 50) - w.y * zoom,
  };
}
