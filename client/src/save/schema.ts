/**
 * Serialization boundary.
 *
 * What `serialize()` returns is the save format -- the same bytes that go into
 * localStorage today and into Postgres `save_blobs.state` once the API lands. It
 * is therefore the client/server contract; see docs/API-CONTRACT.md.
 *
 * The whole design goal is that this file contains no field list. Saving is
 * `JSON.stringify(state)`, so a field added to GameState is persisted for free
 * and cannot be forgotten the way the monolith's hand-maintained list was.
 */

import { SAVE_VERSION, type GameState } from '../core/state';
import { parkRating, parkValue } from '../sim/park';
import { migrate } from './migrations';
import { rebuildAnchors } from '../sim/anchors';

/**
 * Unchanged from the monolith on purpose. The key is where existing players'
 * parks already are; renaming it would orphan every one of them for no gain.
 * The version now lives inside the payload, where migrations can act on it.
 */
export const SAVE_KEY = 'c2c_park_v4';

/** Server rejects anything larger. A full 35x35 park runs 100-200 KB. */
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;

/** Headline stats denormalised onto `save_slots` so the load screen and the
 *  leaderboard never have to parse the blob. Mirrors those columns exactly. */
export interface SaveSummary {
  saveVersion: number;
  day: number;
  funds: number;
  parkValue: number;
  rating: number;
  guests: number;
}

export function summarize(state: GameState): SaveSummary {
  return {
    saveVersion: state.version,
    day: state.dayCount,
    funds: Math.round(state.funds),
    parkValue: Math.round(parkValue(state)),
    rating: parkRating(state),
    guests: state.guests,
  };
}

/**
 * A JSON-safe deep copy of the state.
 *
 * Guest instances survive as plain objects -- JSON drops their methods, and
 * `hydrate()` on the way back in restores the prototype. Nothing here knows the
 * field names.
 */
export function serialize(state: GameState): GameState {
  state.version = SAVE_VERSION;
  const out = JSON.parse(JSON.stringify(state)) as GameState;
  // anchorOf is derived from `map` (sim/anchors.ts) -- persisting it stores a
  // second copy of the same fact that can drift out of step, and on a full
  // park it is one of the larger things in the blob. Dropped on the way out
  // and rebuilt on the way in.
  delete (out as Partial<GameState>).anchorOf;
  return out;
}

/** Parse + migrate. Returns null only when the input is not recoverably a park. */
export function deserialize(json: string | null): GameState | null {
  if (!json) return null;
  try {
    const state = migrate(JSON.parse(json));
    // Rebuilt unconditionally, so saves written before anchorOf was dropped
    // are corrected rather than trusted -- if the stored copy had drifted from
    // the map, this is where it stops mattering. No migration step needed.
    rebuildAnchors(state);
    return state;
  } catch {
    return null; // corrupt JSON -- treat as no save rather than throwing on boot
  }
}

export function loadFromLocalStorage(): GameState | null {
  try {
    return deserialize(localStorage.getItem(SAVE_KEY));
  } catch {
    return null; // private mode
  }
}

export function saveToLocalStorage(state: GameState): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(state)));
    return true;
  } catch {
    return false; // private mode or quota -- autosave is best-effort
  }
}
