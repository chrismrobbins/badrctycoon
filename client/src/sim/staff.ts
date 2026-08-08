import type { GameState } from '../core/state';
import { STAFF_KINDS, STAFF_NAMES, type StaffKindDef, type StaffKindId } from '../content';
import { litterAt, recomputeCleanliness } from './litter';

export interface Staff {
  kind: StaffKindId;
  name: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  progress: number;
  speed: number;
  task: string | null;
  swing: number;
  route: { x: number; y: number }[] | null;
  reroute: number;
  cleaned: number;
  sweepFx: number;
  lastX: number;
  lastY: number;
}

export function pathTiles(state: GameState): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = 0; x < state.gridSize; x++)
    for (let y = 0; y < state.gridSize; y++)
      if (state.map[x][y] === 'path' || state.map[x][y] === 'entrance') out.push({ x, y });
  return out;
}

export type HireResult =
  | { ok: true; staff: Staff; kindDef: StaffKindDef }
  | { ok: false; reason: 'no-paths' | 'insufficient-funds' };

/** Adds a new staff member and returns what happened; the caller owns the
 *  event-log/sound/UI-refresh side effects. */
export function hireStaff(state: GameState, kind: StaffKindId): HireResult {
  const kindDef = STAFF_KINDS[kind];
  const tiles = pathTiles(state);
  if (!tiles.length) return { ok: false, reason: 'no-paths' };
  if (state.funds < kindDef.wage * 2) return { ok: false, reason: 'insufficient-funds' };
  const start = tiles[Math.floor(Math.random() * tiles.length)];
  const staff: Staff = {
    kind,
    name: STAFF_NAMES[Math.floor(Math.random() * STAFF_NAMES.length)],
    x: start.x,
    y: start.y,
    tx: start.x,
    ty: start.y,
    progress: 1,
    speed: 0.024 + Math.random() * 0.012,
    task: null,
    swing: Math.random() * 6,
    route: null,
    reroute: 0,
    cleaned: 0,
    sweepFx: 0,
    lastX: -1,
    lastY: -1,
  };
  state.staff.push(staff);
  return { ok: true, staff, kindDef };
}

/** Removes the first staff member of `kind` and returns them, or null if
 *  there wasn't one. */
export function fireStaff(state: GameState, kind: StaffKindId): Staff | null {
  const i = state.staff.findIndex((s) => s.kind === kind);
  if (i < 0) return null;
  const [removed] = state.staff.splice(i, 1);
  return removed;
}

export function staffCount(state: GameState, kind: StaffKindId): number {
  return state.staff.filter((s) => s.kind === kind).length;
}

export function dailyWages(state: GameState): number {
  return state.staff.reduce((sum, s) => sum + STAFF_KINDS[s.kind].wage, 0);
}

const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** Breadth-first walk over walkable tiles -- the shortest route to the
 *  nearest tile satisfying `isGoal`. Greedy stepping used to stall in
 *  corridors and dead ends; this always finds the real way there. */
export function bfsRoute(
  state: GameState,
  from: { x: number; y: number },
  isGoal: (x: number, y: number) => boolean,
  adjacentIsEnough?: boolean,
): { x: number; y: number }[] | null {
  const kk = (x: number, y: number) => x + ',' + y;
  const start = kk(from.x, from.y);
  const prev = new Map<string, string | null>([[start, null]]);
  const queue: [number, number][] = [[from.x, from.y]];
  let found: string | null = null;
  let head = 0;

  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    if (!(cx === from.x && cy === from.y)) {
      if (isGoal(cx, cy)) {
        found = kk(cx, cy);
        break;
      }
      if (adjacentIsEnough) {
        // Rides aren't walkable, so stop on a tile beside one.
        let hit = false;
        for (const [dx, dy] of DIRS)
          if (isGoal(cx + dx, cy + dy)) {
            hit = true;
            break;
          }
        if (hit) {
          found = kk(cx, cy);
          break;
        }
      }
    }
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= state.gridSize || ny >= state.gridSize) continue;
      const c = state.map[nx]?.[ny];
      if (c !== 'path' && c !== 'entrance') continue;
      const k = kk(nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, kk(cx, cy));
      queue.push([nx, ny]);
    }
  }
  if (!found) return null;
  const route: { x: number; y: number }[] = [];
  for (let cur: string | null = found; cur && cur !== start; cur = prev.get(cur) ?? null) {
    const [px, py] = cur.split(',').map(Number);
    route.unshift({ x: px, y: py });
  }
  return route.length ? route : null;
}

export function stepRoute(w: Staff): boolean {
  if (!w.route || !w.route.length) return false;
  const next = w.route.shift()!;
  w.tx = next.x;
  w.ty = next.y;
  w.progress = 0;
  return true;
}

export function wanderStep(state: GameState, w: Staff): void {
  const options: { x: number; y: number }[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = w.x + dx,
      ny = w.y + dy;
    if (nx < 0 || ny < 0 || nx >= state.gridSize || ny >= state.gridSize) continue;
    const c = state.map[nx]?.[ny];
    if (c === 'path' || c === 'entrance') options.push({ x: nx, y: ny });
  }
  if (!options.length) return;
  // Prefer not to immediately double back.
  const fwd = options.filter((o) => o.x !== w.lastX || o.y !== w.lastY);
  const pick = (fwd.length ? fwd : options)[Math.floor(Math.random() * (fwd.length ? fwd.length : options.length))];
  w.lastX = w.x;
  w.lastY = w.y;
  w.tx = pick.x;
  w.ty = pick.y;
  w.progress = 0;
}

/** Called every animation frame (same cadence as guests) -- running this on
 *  the 1.5s economy tick made staff move ~1 tile per 90 seconds, so janitors
 *  could never keep up with littering. */
export function updateStaff(state: GameState): void {
  for (const w of state.staff as Staff[]) {
    if (w.progress < 1) {
      w.progress += w.speed;
      continue;
    }
    w.x = w.tx;
    w.y = w.ty;
    if (w.sweepFx > 0) w.sweepFx--;

    if (w.kind === 'janitor') {
      // Sweep the tile underfoot clean, and knock back the neighbours.
      let didClean = false;
      if (litterAt(state, w.x, w.y) > 0) {
        state.litter[`${w.x},${w.y}`] = 0;
        didClean = true;
        w.cleaned = (w.cleaned || 0) + 1;
      }
      for (const [dx, dy] of DIRS) {
        const k = `${w.x + dx},${w.y + dy}`;
        if (state.litter[k] > 0) {
          state.litter[k] = Math.max(0, state.litter[k] - 1);
          didClean = true;
        }
      }
      if (didClean) {
        w.sweepFx = 20;
        recomputeCleanliness(state);
      }

      // Re-route to the nearest mess when the current plan is spent.
      if (!w.route || !w.route.length || --w.reroute <= 0) {
        w.route = bfsRoute(state, w, (x, y) => litterAt(state, x, y) > 0);
        w.reroute = 120;
      }
      w.task = didClean
        ? 'sweeping up'
        : w.route && w.route.length
          ? `heading to litter (${w.route.length} tiles)`
          : 'patrolling — all clean';
      if (!stepRoute(w)) wanderStep(state, w);
    } else if (w.kind === 'mechanic') {
      // Rush to broken rides; standing beside one slashes repair time.
      const brokenAt = (x: number, y: number) => {
        const a = state.anchorOf[`${x},${y}`];
        const key = a ? `${a.ax},${a.ay}` : `${x},${y}`;
        return !!(state.rideQueues[key] && state.rideQueues[key].broken);
      };
      let working = false;
      for (const [dx, dy] of [[0, 0], ...DIRS] as [number, number][]) {
        const nx = w.x + dx,
          ny = w.y + dy;
        if (nx < 0 || ny < 0 || nx >= state.gridSize || ny >= state.gridSize) continue;
        if (!brokenAt(nx, ny)) continue;
        const a = state.anchorOf[`${nx},${ny}`];
        const key = a ? `${a.ax},${a.ay}` : `${nx},${ny}`;
        state.rideQueues[key].repairTimer -= 0.35; // per frame — a mechanic on site fixes it fast
        working = true;
        w.sweepFx = 6;
        break;
      }
      if (working) {
        w.task = 'repairing a breakdown';
        w.route = null;
      } else {
        if (!w.route || !w.route.length || --w.reroute <= 0) {
          w.route = bfsRoute(state, w, brokenAt, true);
          w.reroute = 120;
        }
        w.task = w.route && w.route.length ? 'en route to a breakdown' : 'inspecting rides';
        if (!stepRoute(w)) wanderStep(state, w);
      }
    } else {
      // Entertainer — cheer up anyone nearby.
      let cheered = 0;
      for (const g of state.visualGuests as { x: number; y: number; happiness: number }[]) {
        if (Math.abs(g.x - w.x) + Math.abs(g.y - w.y) <= 2) {
          g.happiness = Math.min(100, g.happiness + 0.12);
          cheered++;
        }
      }
      w.task = cheered ? `entertaining ${cheered} guest${cheered > 1 ? 's' : ''}` : 'looking for a crowd';
      wanderStep(state, w);
    }
  }
}
