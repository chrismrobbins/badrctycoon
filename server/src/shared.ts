/**
 * Single point of contact with the client's pure modules.
 *
 * docs/BACKEND-HANDOFF.md §4: cost tables, park value/rating, and the save
 * migration chain already exist as pure TypeScript and must not be reimplemented
 * here. §4 also documents the one real trap: these modules use extensionless and
 * directory imports (`from '../content'`) because the client is bundled by Vite,
 * and plain Node cannot resolve those (ERR_UNSUPPORTED_DIR_IMPORT). Running under
 * `tsx` -- not `node --experimental-strip-types` -- is what makes this file work.
 *
 * Route handlers import from here rather than reaching into client/src directly,
 * so there is exactly one place that knows the relative path back to the client.
 */

export {
  createGameState,
  emptyLedger,
  SAVE_VERSION,
  STARTING_FUNDS,
  DEFAULT_GRID_SIZE,
  type GameState,
} from '../../client/src/core/state';

export { BUILD_DATA } from '../../client/src/content';
export { AWARD_BY_ID } from '../../client/src/content/awards';
export { builtValue, parkValue, parkRating } from '../../client/src/sim/park';
export { expectedFunds, ledgerReconciles } from '../../client/src/sim/finance';
export { migrate } from '../../client/src/save/migrations';
export { MAX_SAVE_BYTES, summarize, type SaveSummary } from '../../client/src/save/schema';
