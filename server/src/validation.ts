/**
 * The 11-point table from docs/API-CONTRACT.md §6, run on every PUT "before
 * touching the database."
 *
 * Checks 7 and 10 (parkValue, rating) are not separate assertions here. The
 * contract says to "compare against the SlotMeta the client sent," but
 * neither GameState nor SavePayload (net/client.ts) carries one -- see the
 * note in routes/slots.ts and the PR discussion this was flagged in. The
 * server never accepts a claimed parkValue/rating in the first place; it
 * always recomputes both from `state` (routes/slots.ts's summarize() call),
 * so there is nothing left to mismatch and reject here.
 *
 * Check 1 (body ≤ 2 MB) is Fastify's bodyLimit, set from the shared
 * MAX_SAVE_BYTES in index.ts -- a 413 before this file's code ever runs.
 */

import { apiError } from './errors';
import { migrate, ledgerReconciles, BUILD_DATA, SAVE_VERSION, type GameState } from './shared';

const VALID_GRID_SIZES = new Set([15, 19, 23, 27, 31, 35]);
const PARK_NAME_MAX = 48;
const RIDE_NAME_MAX = 28;

// client/src/main.ts sets the fastest a game day can ever pass:
// TIME_SPEED = 0.15 hours/economy tick, ECONOMY_TICK_MS = 1500ms, and
// gameSpeed maxes out at 3 (setSpeed(3), the '+' hotkey). So one day takes at
// least (24 / 0.15) * 1500 / 3 = 80,000ms of elapsed real time, no matter how
// `playtimeMs` counts idle/paused time -- idle time can only add to it, never
// subtract from what a day actually required. That makes this bound safe
// regardless of exactly how ui/auth.ts's getPlaytimeMs() (not built yet,
// save/sync.ts's SyncOptions) ends up counting pauses.
const MIN_MS_PER_DAY_AT_MAX_SPEED = ((24 / 0.15) * 1500) / 3;

/** Ride names go into a leaderboard, next to a park name from a stranger.
 *  Contract §6: sanitise on write; the client's own render paths already use
 *  textContent, not innerHTML, but nothing here should have to trust that. */
function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching C0/DEL
  return input.replace(/[\x00-\x1F\x7F]/g, '');
}

export interface StoredSlot {
  day: number;
  playtimeMs: number;
}

export interface ValidatedSave {
  state: GameState;
  parkName: string;
}

/**
 * `stored` is the slot's current day/playtimeMs, or null for a slot that
 * doesn't exist yet (checks 8 and 9 have nothing to be monotonic against).
 */
export function validateSave(
  rawState: unknown,
  rawParkName: string,
  playtimeMs: number,
  stored: StoredSlot | null,
): ValidatedSave {
  // Check 3. Must read the RAW version: migrate()'s upgrade() ladder
  // (save/migrations.ts) unconditionally stamps its output to SAVE_VERSION at
  // the end, even for input that started newer, so checking after migrate()
  // would hide exactly the case this is meant to catch.
  if (
    rawState !== null &&
    typeof rawState === 'object' &&
    typeof (rawState as { version?: unknown }).version === 'number' &&
    (rawState as { version: number }).version > SAVE_VERSION
  ) {
    throw apiError(400, 'save_from_newer_client', 'This save is from a newer version of the game.');
  }

  // Check 2.
  const state = migrate(rawState);
  if (!state) throw apiError(400, 'invalid_save', 'Not a recoverable save.');

  // Check 4.
  if (!VALID_GRID_SIZES.has(state.gridSize)) {
    throw apiError(
      400,
      'invalid_grid_size',
      `gridSize must be one of ${[...VALID_GRID_SIZES].join(', ')}.`,
    );
  }
  if (
    !Array.isArray(state.map) ||
    state.map.length !== state.gridSize ||
    state.map.some((col) => !Array.isArray(col) || col.length !== state.gridSize)
  ) {
    throw apiError(400, 'grid_mismatch', 'map dimensions must match gridSize.');
  }

  // Check 5.
  for (const col of state.map) {
    for (const cell of col) {
      if (cell !== null && cell !== 'entrance' && !BUILD_DATA[cell]) {
        throw apiError(400, 'unknown_cell', `Unknown tile id "${cell}" on the map.`);
      }
    }
  }

  // Check 6 -- load-bearing: funds must follow from the ledger alone.
  if (!ledgerReconciles(state)) {
    throw apiError(422, 'books_do_not_balance', 'funds do not follow from the ledger.');
  }

  // Checks 8 and 9: monotonic per slot.
  if (stored) {
    if (state.dayCount < stored.day) {
      throw apiError(422, 'time_travel', `day ${state.dayCount} is behind the stored day ${stored.day}.`);
    }
    if (playtimeMs < stored.playtimeMs) {
      throw apiError(422, 'time_travel', 'playtimeMs went backwards.');
    }
  }
  const minPlaytimeForDay = Math.max(0, state.dayCount - 1) * MIN_MS_PER_DAY_AT_MAX_SPEED;
  if (playtimeMs < minPlaytimeForDay) {
    throw apiError(
      422,
      'implausible_day',
      `day ${state.dayCount} is not reachable in ${playtimeMs}ms of playtime.`,
    );
  }

  // Check 11.
  const parkName = stripControlChars(rawParkName);
  if (parkName.length < 1 || parkName.length > PARK_NAME_MAX) {
    throw apiError(400, 'invalid_park_name', `parkName must be 1-${PARK_NAME_MAX} characters.`);
  }
  for (const [key, name] of Object.entries(state.rideNames)) {
    const clean = stripControlChars(name);
    if (clean.length > RIDE_NAME_MAX) {
      throw apiError(400, 'invalid_ride_name', `Ride name "${name}" exceeds ${RIDE_NAME_MAX} characters.`);
    }
    state.rideNames[key] = clean;
  }

  return { state, parkName };
}
