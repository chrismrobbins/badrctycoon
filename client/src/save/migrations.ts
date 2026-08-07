/**
 * Save migrations.
 *
 * THE RULE: a migration never rejects. It upgrades, or it fills in a default.
 *
 * The monolith got this wrong in a way that destroyed data. loadGame() opened
 * with `if (!s || s.v !== 5 || !Array.isArray(s.map)) return false;` -- any save
 * that was not exactly v5 was discarded, a fresh park was created over the top,
 * and the 12-second autosave overwrote the original moments later. Bumping the
 * version number silently deleted every existing player's park.
 *
 * So: dispatch on STRUCTURE, not on version equality. If it has a map, it is a
 * park, and we recover whatever else we can.
 */

import { createGameState, SAVE_VERSION, type GameState } from '../core/state';

/** Shape written by the pre-phase-2 monolith (payload said v:5). */
interface LegacySave {
  v?: number;
  map?: unknown;
  gridSize?: number;
  rideMeta?: Record<string, { riders?: number; earned?: number; breakdowns?: number }>;
  [k: string]: unknown;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function obj<T>(v: unknown, fallback: T): T {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback;
}

function arr<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}

/**
 * Everything the monolith ever wrote, folded onto the current shape.
 *
 * Deliberately tolerant of v < 5 too. Those saves were rejected outright before,
 * but their field names were a subset of v5's, so a best-effort pick recovers a
 * playable park where the old code wiped it.
 */
function fromLegacy(s: LegacySave): GameState {
  const next = createGameState();

  next.gridSize = num(s.gridSize, 15);
  next.map = s.map as GameState['map'];
  next.anchorOf = obj(s.anchorOf, {});
  next.landPurchased = num(s.landPurchased, 0);

  next.funds = num(s.funds, next.funds);
  next.builtValue = num(s.builtValue, 0);
  next.loanBalance = num(s.loanBalance, 0);
  next.admissionPrice = num(s.admissionPrice, 12);
  if (obj<any>(s.ledger, null as any)?.income) next.ledger = s.ledger as GameState['ledger'];

  next.rating = num(s.rating, 0);
  next.dayCount = num(s.dayCount, 1);
  next.gameTime = num(s.gameTime, 6);
  next.objectiveIndex = num(s.objectiveIndex, 0);
  next.shopSales = num(s.shopSales, 0);
  next.awardsWon = arr(s.awardsWon, []);
  next.lastAwardDay = num(s.lastAwardDay, 0);
  if (Array.isArray(obj<any>(s.research, {} as any).unlocked)) {
    next.research = s.research as GameState['research'];
  }
  next.marketing = obj(s.marketing, { key: null, daysLeft: 0 });

  next.litter = obj(s.litter, {});
  next.rideNames = obj(s.rideNames, {});
  next.shopStats = obj(s.shopStats, {});
  next.staff = arr(s.staff, []);

  // Legacy stored only lifetime tallies and rebuilt the live queue on load. Fold
  // those tallies into full RideQueue records; the caller reconciles them against
  // the map, since a ride may have been bulldozed by a later migration.
  next.rideQueues = {};
  for (const [k, m] of Object.entries(s.rideMeta ?? {})) {
    next.rideQueues[k] = {
      queue: 0, ridersOnBoard: 0, cycleTimer: 0, broken: false, repairTimer: 0,
      riders: num(m?.riders, 0), earned: num(m?.earned, 0), breakdowns: num(m?.breakdowns, 0),
    };
  }

  // Never persisted by the monolith -- guests, attendance, happiness, weather and
  // park-open state all reset on reload. Defaults from createGameState() stand in;
  // from v6 onward they are saved for real.
  return next;
}

/**
 * Bring any recovered save up to SAVE_VERSION.
 *
 * Add a `case` per version bump. Each step mutates in place and falls through to
 * the next -- no `break`, that is the point.
 */
function upgrade(s: GameState): GameState {
  /* eslint-disable no-fallthrough */
  switch (s.version) {
    // case 6: ...changes for v7...; s.version = 7;
    default:
      s.version = SAVE_VERSION;
  }
  return s;
}

/** Returns a migrated state, or null if `raw` is not recoverably a park. */
export function migrate(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as LegacySave & Partial<GameState>;

  // The only structural requirement: it has a grid.
  if (!Array.isArray(s.map)) return null;

  // `version` is the phase-2 field; `v` was the monolith's.
  const versioned = typeof s.version === 'number';
  return upgrade(versioned ? (s as GameState) : fromLegacy(s));
}
