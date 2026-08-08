import type { GameState } from '../core/state';
import { BUILD_DATA, SHOP_TYPES, RIDE_TYPES, SCENERY_TYPES, NEEDS, NEED_BY_ID, BALLOON_BUY_CHANCE, BALLOON_HAPPINESS } from '../content';
import { litterAt, dropLitter } from './litter';
import { isNightAt } from './time';
import * as Fin from './finance';

/**
 * The sim-owned half of a guest -- everything updateGuest() reads or writes.
 * Display-only fields (color, balloonColor, name -- used by draw() and the
 * guest inspector panel, never by the sim) stay on the Guest *class* in
 * main.ts until render/ui/ split out; this is deliberately not the whole
 * on-screen guest.
 */
export interface Guest {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  progress: number;
  speed: number;
  lastX: number;
  lastY: number;
  happiness: number;
  ridesRidden: number;
  queuedAt: string | null;
  queueTimer: number;
  hunger: number;
  thirst: number;
  bladder: number;
  hasBalloon: boolean;
  money: number;
  /** Needs are indexed dynamically by need.id (see the NEEDS loop below) --
   *  hunger/thirst/bladder above are the named view of the same fields. */
  [key: string]: unknown;
}

const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
const DIRS8: [number, number][] = [...DIRS, [1, 1], [-1, 1], [1, -1], [-1, -1]];

export function createGuest(startX: number, startY: number): Guest {
  return {
    x: startX,
    y: startY,
    targetX: startX,
    targetY: startY,
    progress: 1,
    speed: 0.01 + Math.random() * 0.02,
    lastX: startX,
    lastY: startY,
    happiness: 50 + Math.floor(Math.random() * 20), // 50-70 starting
    ridesRidden: 0,
    queuedAt: null, // "ax,ay" if queued
    queueTimer: 0,
    hunger: 20 + Math.random() * 30,
    thirst: 20 + Math.random() * 30,
    bladder: 10 + Math.random() * 20,
    hasBalloon: false,
    money: 25 + Math.floor(Math.random() * 60),
  };
}

export interface GuestEvent {
  msg: string;
  type: 'info' | 'good' | 'bad';
}

/**
 * One frame of a guest's needs/shopping/queueing/wandering AI. Mutates `g`
 * (and `state` for shop revenue/litter/queue bookkeeping) and returns the log
 * lines the caller should hand to logEvent() -- sim never touches the DOM.
 *
 * NOTE: still calls Math.random() directly throughout. Seeded RNG is
 * deliberately deferred -- see sim/litter.ts's note and ARCHITECTURE.md §8.
 */
export function updateGuest(state: GameState, g: Guest): GuestEvent[] {
  const events: GuestEvent[] = [];

  // Needs creep up; unmet needs erode happiness. Driven by content/needs.ts
  // rather than a hardcoded list, so a new need is a data change.
  for (const need of NEEDS) {
    const level = Math.min(100, (g[need.id] as number) + need.growth);
    g[need.id] = level;
    if (level > need.painAbove) g.happiness = Math.max(0, g.happiness - need.painRate);
  }
  if (state.weather === 'rain') g.happiness = Math.max(0, g.happiness - 0.005);
  // Filth is depressing; a bench underfoot is a nice rest.
  const filth = litterAt(state, g.x, g.y);
  if (filth) g.happiness = Math.max(0, g.happiness - 0.02 * filth);

  // If queued at a ride, wait.
  if (g.queuedAt) {
    g.queueTimer++;
    if (g.queueTimer > 200) {
      // Impatient — leave queue.
      g.happiness = Math.max(0, g.happiness - 15);
      const q = state.rideQueues[g.queuedAt];
      if (q) q.queue = Math.max(0, q.queue - 1);
      g.queuedAt = null;
      g.queueTimer = 0;
    }
    return events;
  }

  if (g.progress >= 1) {
    g.x = g.targetX;
    g.y = g.targetY;

    // Shop next door? Buy if the need is real.
    for (const [dx, dy] of DIRS) {
      const nx = g.x + dx,
        ny = g.y + dy;
      if (nx < 0 || nx >= state.gridSize || ny < 0 || ny >= state.gridSize) continue;
      const cell = state.map[nx][ny];
      if (cell && SHOP_TYPES.has(cell)) {
        const sd = BUILD_DATA[cell];
        // The shop declares which need it serves; the need declares when to
        // buy, what it resets to, and whether it litters.
        const need = sd.shop ? NEED_BY_ID[sd.shop] : undefined;
        let bought = false;
        if (need) {
          if ((g[need.id] as number) > need.buyAbove) {
            g[need.id] = need.resetTo;
            bought = true;
          }
        } else if (sd.shop === 'balloon' && !g.hasBalloon && Math.random() < BALLOON_BUY_CHANCE) {
          g.hasBalloon = true;
          g.happiness = Math.min(100, g.happiness + BALLOON_HAPPINESS);
          bought = true;
        }
        if (bought && g.money >= sd.price) {
          Fin.earn(state, sd.price, 'shops');
          g.money -= sd.price;
          state.shopSales++;
          if (need?.litters) dropLitter(state, g.x, g.y);
          const sk = `${nx},${ny}`;
          if (!state.shopStats[sk]) state.shopStats[sk] = { sales: 0, earned: 0 };
          state.shopStats[sk].sales++;
          state.shopStats[sk].earned += sd.price;
          g.happiness = Math.min(100, g.happiness + 6);
          if (Math.random() > 0.85) {
            events.push({ msg: `A guest spent $${sd.price} at ${state.rideNames[sk] || cell}.`, type: 'good' });
          }
          break;
        }
      }
    }

    // Check if adjacent to a ride — chance to queue.
    if (Math.random() < 0.15) {
      for (const [dx, dy] of DIRS) {
        const nx = g.x + dx,
          ny = g.y + dy;
        if (nx >= 0 && nx < state.gridSize && ny >= 0 && ny < state.gridSize) {
          const cell = state.map[nx][ny];
          if (cell && RIDE_TYPES.has(cell)) {
            // Find anchor.
            const key = state.anchorOf[`${nx},${ny}`];
            const aKey = key ? `${key.ax},${key.ay}` : `${nx},${ny}`;
            const q = state.rideQueues[aKey];
            if (q && !q.broken && q.queue < BUILD_DATA[cell].capacity * 2) {
              q.queue++;
              g.queuedAt = aKey;
              g.queueTimer = 0;
              return events;
            }
          }
        }
      }
    }

    // Occasionally drop trash while strolling.
    if (Math.random() < 0.006 && state.map[g.x]?.[g.y] === 'path') dropLitter(state, g.x, g.y);

    // Normal path wandering.
    const neighbors: { x: number; y: number }[] = [];
    for (const [dx, dy] of DIRS) {
      const nx = g.x + dx;
      const ny = g.y + dy;
      if (nx >= 0 && nx < state.gridSize && ny >= 0 && ny < state.gridSize) {
        if (state.map[nx][ny] === 'path' || state.map[nx][ny] === 'entrance') {
          neighbors.push({ x: nx, y: ny });
        }
      }
    }

    if (neighbors.length > 0) {
      let next = neighbors[Math.floor(Math.random() * neighbors.length)];
      if (neighbors.length > 1 && next.x === g.lastX && next.y === g.lastY) {
        next = neighbors.find((n) => n.x !== g.lastX || n.y !== g.lastY) || next;
      }
      g.lastX = g.x;
      g.lastY = g.y;
      g.targetX = next.x;
      g.targetY = next.y;
      g.progress = 0;
    }

    // Scenery happiness boost — check surroundings.
    for (const [dx, dy] of DIRS8) {
      const nx = g.x + dx,
        ny = g.y + dy;
      if (nx >= 0 && nx < state.gridSize && ny >= 0 && ny < state.gridSize) {
        const cell = state.map[nx][ny];
        if (cell && SCENERY_TYPES.has(cell)) {
          g.happiness = Math.min(100, g.happiness + 0.3);
        }
      }
    }

    // Night penalty if no lamps nearby.
    if (isNightAt(state.gameTime)) {
      let hasLamp = false;
      for (const [dx, dy] of DIRS8) {
        const nx = g.x + dx,
          ny = g.y + dy;
        if (nx >= 0 && nx < state.gridSize && ny >= 0 && ny < state.gridSize && state.map[nx][ny] === 'lamp') {
          hasLamp = true;
          break;
        }
      }
      if (!hasLamp) g.happiness = Math.max(0, g.happiness - 0.5);
    }
  } else {
    g.progress += g.speed;
  }

  return events;
}
