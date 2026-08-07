/**
 * The one serializable game state object.
 *
 * Phase 2 of the port. Before this, the park lived in ~40 module-level `let`s in
 * main.ts, which meant there was no object to serialize -- saveGame() hand-listed
 * 25 fields and had already drifted, silently dropping guests, attendance,
 * happiness, weather and park-open state on every reload.
 *
 * The rule now: **if it belongs in the save, it belongs on GameState.** Saving is
 * `JSON.stringify(state)` and nothing else, so a new field cannot be forgotten.
 *
 * What is deliberately NOT here: camera, current tool, game speed, open panels,
 * audio, the undo stack, and transient FX (rain, fireworks). Those are session or
 * view concerns that stay module-level in main.ts until phases 4 gives them homes
 * in ui/ and render/. Persisting the camera is a later, separate decision.
 */

/** Bump on any shape change and add a migration. See migrations.ts -- the loader
 *  must never reject an old save, only upgrade it. */
export const SAVE_VERSION = 6;

export interface Ledger {
  income: { admission: number; rides: number; shops: number; objectives: number; loans: number };
  expense: {
    construction: number; wages: number; repairs: number; interest: number;
    marketing: number; research: number; land: number; loanRepaid: number;
  };
}

export interface RideQueue {
  queue: number;
  ridersOnBoard: number;
  cycleTimer: number;
  broken: boolean;
  repairTimer: number;
  riders: number;
  earned: number;
  breakdowns: number;
}

export interface ShopStat {
  sales: number;
  earned: number;
}

export interface Anchor {
  ax: number;
  ay: number;
}

export interface MarketingCampaign {
  key: string | null;
  daysLeft: number;
}

export interface Research {
  unlocked: string[];
  progress: number;
  budget: number;
}

export interface AwardWon {
  id: string;
  day: number;
}

/** Tile type id, or null for bare grass. */
export type Cell = string | null;

export interface GameState {
  version: number;

  // ── The plot ──
  gridSize: number;
  /** map[x][y] -- tile type id or null. */
  map: Cell[][];
  /** "x,y" -> the anchor tile of the multi-tile structure occupying it. */
  anchorOf: Record<string, Anchor>;
  landPurchased: number;

  // ── Money ──
  funds: number;
  /** Sum of construction costs. Park value = funds + builtValue.
   *  TODO(phase 4): derive from the map instead of accumulating -- see
   *  ARCHITECTURE.md 3.5. The server cannot validate an accumulator. */
  builtValue: number;
  loanBalance: number;
  admissionPrice: number;
  ledger: Ledger;
  dayLedger: Ledger;

  // ── Progress ──
  /** TODO(phase 4): also an accumulator, and awards add to the same counter as
   *  buildings, so it is not derivable from the map at all. */
  rating: number;
  dayCount: number;
  /** Hours, 0-24. */
  gameTime: number;
  objectiveIndex: number;
  shopSales: number;
  awardsWon: AwardWon[];
  lastAwardDay: number;
  research: Research;
  marketing: MarketingCampaign;

  // ── Population ──
  /** Target attendance. Kept separate from visualGuests.length by the economy
   *  tick; phase 4 should collapse the two. */
  guests: number;
  /** Live guest entities. Persisted from phase 2 onward -- the old save dropped
   *  them, so a reload emptied a busy park. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed as Guest[] in phase 4 when Guest moves to sim/guests.ts
  visualGuests: any[];
  parkHappiness: number;
  isParkOpen: boolean;
  /** Derived: recomputeCleanliness() rederives this from litter-per-path at boot
   *  and on every tick, so the persisted value is only a cache. */
  cleanliness: number;

  // ── World ──
  weather: 'clear' | 'cloudy' | 'rain';
  weatherTicks: number;
  /** "x,y" -> 0..3 units of trash. */
  litter: Record<string, number>;

  // ── Attractions & staff ──
  /** Keyed by anchor "ax,ay". */
  rideQueues: Record<string, RideQueue>;
  /** Keyed by anchor "ax,ay" -- player-facing names, user input. */
  rideNames: Record<string, string>;
  shopStats: Record<string, ShopStat>;
  // Typed as Staff[] in phase 4 when the worker moves to sim/staff.ts
  staff: any[];
}

function emptyLedger(): Ledger {
  return {
    income: { admission: 0, rides: 0, shops: 0, objectives: 0, loans: 0 },
    expense: {
      construction: 0, wages: 0, repairs: 0, interest: 0,
      marketing: 0, research: 0, land: 0, loanRepaid: 0,
    },
  };
}

export const STARTING_FUNDS = 10_000;
export const DEFAULT_GRID_SIZE = 15;

/** Everything unlocked from the start; the rest arrives via research. */
const STARTING_UNLOCKS = [
  'path', 'flowerbed', 'trashcan', 'bench', 'lamp', 'tree', 'fountain',
  'foodstall', 'drinkstall', 'restroom', 'carousel',
];

export function createGameState(): GameState {
  return {
    version: SAVE_VERSION,

    gridSize: DEFAULT_GRID_SIZE,
    map: [],
    anchorOf: {},
    landPurchased: 0,

    funds: STARTING_FUNDS,
    builtValue: 0,
    loanBalance: 0,
    admissionPrice: 12,
    ledger: emptyLedger(),
    dayLedger: emptyLedger(),

    rating: 0,
    dayCount: 1,
    gameTime: 6.0,
    objectiveIndex: 0,
    shopSales: 0,
    awardsWon: [],
    lastAwardDay: 0,
    research: { unlocked: [...STARTING_UNLOCKS], progress: 0, budget: 40 },
    marketing: { key: null, daysLeft: 0 },

    guests: 0,
    visualGuests: [],
    parkHappiness: 50,
    isParkOpen: false,
    cleanliness: 100,

    weather: 'clear',
    weatherTicks: 30,
    litter: {},

    rideQueues: {},
    rideNames: {},
    shopStats: {},
    staff: [],
  };
}
