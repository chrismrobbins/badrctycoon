import type { GameState } from '../core/state';
import { BUILD_DATA, RIDE_TYPES } from '../content';
import { getSceneryBonusAt } from './scenery';
import { isNightAt } from './time';
import * as Fin from './finance';

export interface RideEvent {
  msg: string;
  type: 'info' | 'good' | 'bad';
}

/**
 * Advances every ride's breakdown/cycle/boarding state by one economy tick
 * (1.5s). Mutates state directly; returns the log lines the caller should
 * hand to logEvent() -- sim never touches the DOM.
 *
 * NOTE: still calls Math.random() directly for breakdown rolls. Seeded RNG
 * is deliberately deferred -- see sim/litter.ts's note and ARCHITECTURE.md §8.
 */
export function processRideQueues(state: GameState): RideEvent[] {
  const events: RideEvent[] = [];
  const night = isNightAt(state.gameTime);

  for (const key in state.rideQueues) {
    const q = state.rideQueues[key];
    const [ax, ay] = key.split(',').map(Number);
    const type = state.map[ax]?.[ay];
    if (!type || !RIDE_TYPES.has(type)) {
      delete state.rideQueues[key];
      continue;
    }

    const data = BUILD_DATA[type];

    // ── Breakdowns ──
    if (q.broken) {
      q.repairTimer -= 1.5;
      if (q.repairTimer <= 0) {
        q.broken = false;
        const bill = Math.ceil(data.cost * 0.08);
        Fin.spend(state, bill, 'repairs');
        events.push({ msg: `${state.rideNames[key] || type} repaired — mechanic invoice: $${bill}.`, type: 'info' });
      }
      continue;
    }
    if (Math.random() < 0.006 && q.queue + q.ridersOnBoard > 0) {
      q.broken = true;
      q.breakdowns = (q.breakdowns || 0) + 1;
      q.repairTimer = 20 + Math.random() * 25;
      events.push({ msg: `${state.rideNames[key] || type} broke down! A mechanic has been dispatched.`, type: 'bad' });
      // Everyone bails from the queue, annoyed.
      for (const g of state.visualGuests as { queuedAt: string | null; queueTimer: number; happiness: number }[]) {
        if (g.queuedAt === key) {
          g.happiness = Math.max(0, g.happiness - 20);
          g.queuedAt = null;
          g.queueTimer = 0;
        }
      }
      q.queue = 0;
      q.ridersOnBoard = 0;
      continue;
    }

    q.cycleTimer += 1.5; // seconds per economy tick

    if (q.cycleTimer >= data.cycleTime) {
      // Ride cycle complete — riders disembark happy.
      if (q.riders === undefined) {
        q.riders = 0;
        q.earned = 0;
        q.breakdowns = 0;
      }
      const sceneryBonus = getSceneryBonusAt(state, ax, ay);
      const nightBonus = night ? data.nightBonus : 0;
      const excitementTotal = data.excitement + sceneryBonus + nightBonus;

      // Boost happiness for riders.
      let ridersProcessed = 0;
      for (const g of state.visualGuests as { queuedAt: string | null; queueTimer: number; happiness: number; ridesRidden: number }[]) {
        if (g.queuedAt === key && ridersProcessed < q.ridersOnBoard) {
          g.happiness = Math.min(100, g.happiness + excitementTotal * 0.3);
          g.ridesRidden++;
          g.queuedAt = null;
          g.queueTimer = 0;
          ridersProcessed++;
        }
      }

      // Revenue from riders.
      const ticketPrice = Math.ceil(data.cost * 0.005) + Math.floor(sceneryBonus * 0.5);
      const revenue = q.ridersOnBoard * ticketPrice;
      if (revenue > 0) {
        Fin.earn(state, revenue, 'rides');
        q.earned += revenue;
        q.riders += ridersProcessed;
        if (Math.random() > 0.7) {
          events.push({ msg: `${state.rideNames[key] || type} earned $${revenue} from ${q.ridersOnBoard} riders!`, type: 'good' });
        }
      }

      // Load new riders from queue.
      q.ridersOnBoard = Math.min(q.queue, data.capacity);
      q.queue -= q.ridersOnBoard;
      q.cycleTimer = 0;
    }
  }

  return events;
}
