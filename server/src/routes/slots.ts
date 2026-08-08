/**
 * Save slots -- steps 4 and 5 of docs/BACKEND-HANDOFF.md's build order:
 * list/load/save/delete, the CAS on `revision`, and the 11-point validation
 * table (API-CONTRACT.md §6, validation.ts) run on every PUT.
 *
 * The CAS is the part the handoff calls out as "the part most likely to be
 * subtly wrong" (§5 step 4) -- done in SQL, not application code, with the
 * save_history write that goes with it (contract §5).
 *
 * Headline stats (day/funds/parkValue/rating/guests) are always recomputed
 * from `state` via shared summarize(), never read from a client-asserted
 * field -- see this file's PR history for the API-CONTRACT.md §6 checks
 * 7/10 ambiguity this resolves: the contract says to "compare against the
 * SlotMeta the client sent," but neither GameState nor SavePayload
 * (net/client.ts) carries one. The server never accepts a claimed
 * parkValue/rating at all -- it computes both, and that computed number is
 * what gets stored. `funds` is the one real exception (it is a GameState
 * field); its self-consistency check (ledgerReconciles) is a real assertion
 * in validation.ts.
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Client } from 'pg';
import type { AppEnv } from '../types';
import { apiError } from '../errors';
import { requireUser, getSessionUser } from '../auth/session';
import { MAX_SAVE_BYTES, summarize, type GameState } from '../shared';
import { validateSave, type StoredSlot } from '../validation';

const SLOT_MIN = 1;
const SLOT_MAX = 12;

interface SlotRow {
  slot: number;
  park_name: string;
  save_version: number;
  day: number;
  funds: string | number; // bigint comes back as string from pg unless parsed
  park_value: string | number;
  rating: number;
  guests: number;
  playtime_ms: string | number;
  revision: number;
  updated_at: Date;
}

interface SlotMeta {
  slot: number;
  parkName: string;
  saveVersion: number;
  day: number;
  funds: number;
  parkValue: number;
  rating: number;
  guests: number;
  playtimeMs: number;
  revision: number;
  updatedAt: string;
}

function toSlotMeta(row: SlotRow): SlotMeta {
  return {
    slot: row.slot,
    parkName: row.park_name,
    saveVersion: row.save_version,
    day: row.day,
    funds: Number(row.funds),
    parkValue: Number(row.park_value),
    rating: row.rating,
    guests: row.guests,
    playtimeMs: Number(row.playtime_ms),
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  };
}

function parseSlotParam(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < SLOT_MIN || n > SLOT_MAX) {
    throw apiError(400, 'invalid_slot', `slot must be an integer ${SLOT_MIN}-${SLOT_MAX}.`);
  }
  return n;
}

async function fetchSlotMeta(db: Client, userId: string, slot: number): Promise<SlotMeta | null> {
  const { rows } = await db.query<SlotRow>(
    `SELECT slot, park_name, save_version, day, funds, park_value, rating, guests,
            playtime_ms, revision, updated_at
       FROM save_slots WHERE user_id = $1 AND slot = $2`,
    [userId, slot],
  );
  return rows[0] ? toSlotMeta(rows[0]) : null;
}

/** Just enough of the current row for validation checks 8/9 -- null for a
 *  slot that doesn't exist yet, which those checks treat as "nothing to be
 *  monotonic against." Includes `revision` even though checks 8/9 don't use
 *  it directly -- saveSlot() does, to decide whether those checks should run
 *  at all (see its comment). */
async function fetchStoredSlot(
  db: Client,
  userId: string,
  slot: number,
): Promise<(StoredSlot & { revision: number }) | null> {
  const { rows } = await db.query<{ day: number; playtime_ms: string | number; revision: number }>(
    `SELECT day, playtime_ms, revision FROM save_slots WHERE user_id = $1 AND slot = $2`,
    [userId, slot],
  );
  const row = rows[0];
  return row ? { day: row.day, playtimeMs: Number(row.playtime_ms), revision: row.revision } : null;
}

interface PutBody {
  parkName?: string;
  playtimeMs?: number;
  baseRevision?: number;
  state?: unknown;
}

/**
 * The full save path: validate, CAS in SQL, archive to save_history, and
 * upsert a personal best into `scores`. Shared by PUT (errors propagate to
 * the caller as the documented 4xx/409/422) and the beacon alias (errors are
 * swallowed -- see the beacon handler and API-CONTRACT.md §3: "a 409 here
 * would be shouting into a closed tab").
 *
 * `scores` is upserted here rather than as a separate submission endpoint by
 * design -- API-CONTRACT.md §3: "There is deliberately no score-submission
 * endpoint. Scores are derived server-side from a validated save on PUT."
 * `guests_peak` has no dedicated field on GameState; it falls out for free
 * from upserting `state.guests` only when it beats the stored value.
 */
async function saveSlot(db: Client, userId: string, slot: number, body: PutBody): Promise<SlotMeta> {
  if (typeof body.parkName !== 'string') {
    throw apiError(400, 'invalid_park_name', 'parkName is required.');
  }
  if (typeof body.playtimeMs !== 'number' || !Number.isFinite(body.playtimeMs) || body.playtimeMs < 0) {
    throw apiError(400, 'invalid_playtime', 'playtimeMs must be a non-negative number.');
  }
  if (typeof body.baseRevision !== 'number' || !Number.isInteger(body.baseRevision) || body.baseRevision < 0) {
    throw apiError(400, 'invalid_base_revision', 'baseRevision must be a non-negative integer.');
  }

  // The 11-point table (API-CONTRACT.md §6), run "before touching the
  // database" -- stored is read-only context for checks 8/9 (monotonic day
  // and playtime), not a write, and the actual write is still gated by the
  // CAS below regardless of what stored held at read time.
  //
  // If the client is already stale on revision, `stored` reflects a save it
  // never saw (someone else's), so its own day/playtime can look like time
  // travel purely as an artifact of comparing against the wrong baseline.
  // The real problem in that case is the stale revision, which the CAS
  // below already reports correctly; checks 8/9 have nothing meaningful to
  // say about a row the client hasn't seen yet, so they're skipped rather
  // than racing the CAS to describe the same conflict worse.
  const stored = await fetchStoredSlot(db, userId, slot);
  const isStale = stored !== null && body.baseRevision !== stored.revision;
  const { state, parkName } = validateSave(body.state, body.parkName, body.playtimeMs, isStale ? null : stored);

  const summary = summarize(state);
  const params = [
    userId,
    slot,
    parkName,
    summary.saveVersion,
    summary.day,
    summary.funds,
    summary.parkValue,
    summary.rating,
    summary.guests,
    body.playtimeMs,
  ] as const;

  try {
    await db.query('BEGIN');

    const row = await (body.baseRevision === 0
      ? createSlot(db, params)
      : updateSlot(db, params, body.baseRevision));

    if (!row) {
      // 0 rows: either the slot already exists (baseRevision 0 meant "new")
      // or someone else's write landed first (baseRevision > 0, stale).
      // Either way it is the same shape of conflict from the client's point
      // of view -- API-CONTRACT.md §5's 409-with-current-SlotMeta.
      const current = await fetchSlotMeta(db, userId, slot);
      throw apiError(409, 'revision_conflict', 'This park was saved elsewhere first.', current ?? undefined);
    }

    if (body.baseRevision === 0) {
      await db.query(`INSERT INTO save_blobs (slot_id, state) VALUES ($1, $2)`, [row.id, state]);
    } else {
      // Archive what was there before overwriting it (contract §5).
      const old = await db.query<{ state: GameState }>(
        `SELECT state FROM save_blobs WHERE slot_id = $1`,
        [row.id],
      );
      if (old.rows[0]) {
        await db.query(
          `INSERT INTO save_history (slot_id, revision, state) VALUES ($1, $2, $3)`,
          [row.id, row.revision - 1, old.rows[0].state],
        );
      }
      await db.query(`UPDATE save_blobs SET state = $2 WHERE slot_id = $1`, [row.id, state]);
    }

    await upsertScore(db, userId, 'park_value', summary.parkValue, row.id);
    await upsertScore(db, userId, 'guests_peak', state.guests, row.id);
    await upsertScore(db, userId, 'day_reached', state.dayCount, row.id);

    await db.query('COMMIT');
    return toSlotMeta(row);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function upsertScore(
  db: Client,
  userId: string,
  metric: string,
  value: number,
  slotId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO scores (user_id, metric, value, slot_id, achieved_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, metric) DO UPDATE
       SET value = EXCLUDED.value, slot_id = EXCLUDED.slot_id, achieved_at = now()
     WHERE scores.value < EXCLUDED.value`,
    [userId, metric, value, slotId],
  );
}

export const slotRoutes = new Hono<AppEnv>();

slotRoutes.get('/api/slots', async (c) => {
  const user = await requireUser(c);
  const { rows } = await c.get('db').query<SlotRow>(
    // Headline stats only -- never touches save_blobs (contract §3: the
    // load screen and leaderboard must not pay for parsing a 200 KB blob).
    `SELECT slot, park_name, save_version, day, funds, park_value, rating, guests,
            playtime_ms, revision, updated_at
       FROM save_slots WHERE user_id = $1 ORDER BY updated_at DESC`,
    [user.id],
  );
  return c.json({ slots: rows.map(toSlotMeta) });
});

slotRoutes.get('/api/slots/:slot', async (c) => {
  const user = await requireUser(c);
  const slot = parseSlotParam(c.req.param('slot'));
  const { rows } = await c.get('db').query<SlotRow & { state: GameState }>(
    `SELECT s.slot, s.park_name, s.save_version, s.day, s.funds, s.park_value, s.rating,
            s.guests, s.playtime_ms, s.revision, s.updated_at, b.state
       FROM save_slots s
       JOIN save_blobs b ON b.slot_id = s.id
      WHERE s.user_id = $1 AND s.slot = $2`,
    [user.id, slot],
  );
  const row = rows[0];
  if (!row) throw apiError(404, 'slot_not_found', `No park in slot ${slot}.`);
  return c.json({ meta: toSlotMeta(row), state: row.state });
});

// Check 1 (API-CONTRACT.md §6): reject a save over 2 MB with 413. The
// wrapper fields (parkName, playtimeMs, baseRevision) around `state` are a
// few dozen bytes -- 4 KB of headroom is generous, not a loophole.
const saveBodyLimit = bodyLimit({ maxSize: MAX_SAVE_BYTES + 4096 });

slotRoutes.put('/api/slots/:slot', saveBodyLimit, async (c) => {
  const user = await requireUser(c);
  const slot = parseSlotParam(c.req.param('slot'));
  const body = (await c.req.json().catch(() => ({}))) as PutBody;
  const meta = await saveSlot(c.get('db'), user.id, slot, body);
  return c.json({ meta });
});

// Alias for PUT, same body, for navigator.sendBeacon() on tab-hide
// (contract §3). The page is usually gone before a response lands, so this
// answers 204 unconditionally -- including when validation fails or the
// revision conflicts. Either way the save simply doesn't happen; the client
// discovers that (if it's still around) on its next real PUT. Returning an
// error here would be shouting into a closed tab.
slotRoutes.post('/api/slots/:slot/beacon', saveBodyLimit, async (c) => {
  const user = await getSessionUser(c);
  if (user) {
    const slot = Number(c.req.param('slot'));
    if (Number.isInteger(slot) && slot >= SLOT_MIN && slot <= SLOT_MAX) {
      const body = (await c.req.json().catch(() => ({}))) as PutBody;
      await saveSlot(c.get('db'), user.id, slot, body).catch((err) => {
        console.log('beacon save did not apply', err);
      });
    }
  }
  return c.body(null, 204);
});

slotRoutes.delete('/api/slots/:slot', async (c) => {
  const user = await requireUser(c);
  const slot = parseSlotParam(c.req.param('slot'));
  // Idempotent: deleting a slot that is already gone is still a 204, same
  // as everywhere else in this API that treats "already in the state you
  // wanted" as success rather than a 404 to handle specially.
  await c.get('db').query(`DELETE FROM save_slots WHERE user_id = $1 AND slot = $2`, [user.id, slot]);
  return c.body(null, 204);
});

// -- CAS helpers -------------------------------------------------------------
// Both do the compare-and-set in SQL (contract §5: "Do the CAS in SQL, not in
// application code"), so a race between two requests for the same slot can
// only ever produce one winner -- Postgres's row lock on the UPDATE/INSERT
// serialises it, not application logic.

type Params = readonly [
  userId: string,
  slot: number,
  parkName: string,
  saveVersion: number,
  day: number,
  funds: number,
  parkValue: number,
  rating: number,
  guests: number,
  playtimeMs: number,
];

async function createSlot(
  db: Client,
  [userId, slot, parkName, saveVersion, day, funds, parkValue, rating, guests, playtimeMs]: Params,
): Promise<SlotRow & { id: string } | undefined> {
  const { rows } = await db.query<SlotRow & { id: string }>(
    `INSERT INTO save_slots
       (user_id, slot, park_name, save_version, day, funds, park_value, rating, guests, playtime_ms, revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
     ON CONFLICT (user_id, slot) DO NOTHING
     RETURNING id, slot, park_name, save_version, day, funds, park_value, rating, guests,
               playtime_ms, revision, updated_at`,
    [userId, slot, parkName, saveVersion, day, funds, parkValue, rating, guests, playtimeMs],
  );
  return rows[0];
}

async function updateSlot(
  db: Client,
  [userId, slot, parkName, saveVersion, day, funds, parkValue, rating, guests, playtimeMs]: Params,
  baseRevision: number,
): Promise<SlotRow & { id: string } | undefined> {
  const { rows } = await db.query<SlotRow & { id: string }>(
    `UPDATE save_slots
        SET revision = revision + 1, park_name = $3, save_version = $4, day = $5, funds = $6,
            park_value = $7, rating = $8, guests = $9, playtime_ms = $10
      WHERE user_id = $1 AND slot = $2 AND revision = $11
      RETURNING id, slot, park_name, save_version, day, funds, park_value, rating, guests,
                playtime_ms, revision, updated_at`,
    [userId, slot, parkName, saveVersion, day, funds, parkValue, rating, guests, playtimeMs, baseRevision],
  );
  return rows[0];
}
