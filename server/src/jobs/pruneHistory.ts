/**
 * save_history keeps a row per successful save (routes/slots.ts's saveSlot),
 * so a slot saved often accumulates forever without this. API-CONTRACT.md
 * §5: "prune to the most recent N per slot on a schedule (not in a
 * trigger)" -- a trigger would run this on the hot save path; a schedule
 * keeps it off of it.
 *
 * "On a schedule" is a Cron Trigger (wrangler.jsonc, hourly), invoked from
 * worker.ts's scheduled() handler -- Workers don't stay alive between
 * requests the way the original setInterval version assumed.
 */

import type { Client } from 'pg';

export const HISTORY_KEEP_PER_SLOT = 20;

export async function pruneHistory(db: Client, keepPerSlot = HISTORY_KEEP_PER_SLOT): Promise<number> {
  const { rowCount } = await db.query(
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
