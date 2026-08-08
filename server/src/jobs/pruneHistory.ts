/**
 * save_history keeps a row per successful save (routes/slots.ts's saveSlot),
 * so a slot saved often accumulates forever without this. API-CONTRACT.md
 * §5: "prune to the most recent N per slot on a schedule (not in a
 * trigger)" -- a trigger would run this on the hot save path; a schedule
 * keeps it off of it.
 *
 * "On a schedule" is a single setInterval in index.ts, appropriate for one
 * Node process. If this ever runs as more than one instance, move it to a
 * real job runner (or a Postgres cron extension) so it doesn't run N times
 * redundantly -- the query itself is idempotent either way, just wasteful.
 */

import { pool } from '../db';

export const HISTORY_KEEP_PER_SLOT = 20;

export async function pruneHistory(keepPerSlot = HISTORY_KEEP_PER_SLOT): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM save_history
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY slot_id ORDER BY created_at DESC) AS rn
            FROM save_history
        ) ranked
        WHERE ranked.rn > $1
      )`,
    [keepPerSlot],
  );
  return rowCount ?? 0;
}
