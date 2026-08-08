/**
 * Save slots -- step 4 of docs/BACKEND-HANDOFF.md's build order.
 *
 * Deliberately WITHOUT the 11-point validation table (API-CONTRACT.md §6) --
 * that is step 5. What is here: routing, auth, and the concurrency mechanics
 * the handoff calls out as "the part most likely to be subtly wrong" (§5
 * step 4) -- the CAS on `revision`, done in SQL, and the save_history write
 * that goes with it (contract §5).
 *
 * One check does land early anyway: `migrate(state)` returning non-null.
 * That is check 2 in the table, but it is not optional here -- summarize()
 * and the CAS writes below need a well-formed GameState just to not throw,
 * so there is no version of "without validation" that skips it.
 *
 * Headline stats (day/funds/parkValue/rating/guests) are always recomputed
 * from `state` via shared summarize(), never read from a client-asserted
 * field -- see the PR notes on API-CONTRACT.md §6 checks 7/10: the contract
 * says to "compare against the SlotMeta the client sent," but neither
 * GameState nor SavePayload (net/client.ts) carries one. The only
 * implementable and trust-model-B-consistent reading is that the server
 * never accepts a claimed parkValue/rating at all -- it computes both, and
 * that computed number is what gets stored. `funds` is the one real
 * exception (it is a GameState field), and it gets its own self-consistency
 * check (ledgerReconciles) in step 5, not a comparison against a claim.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db';
import { apiError } from '../errors';
import { requireUser } from '../auth/session';
import { migrate, summarize, type GameState } from '../shared';

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

function parseSlotParam(request: FastifyRequest<{ Params: { slot: string } }>): number {
  const n = Number(request.params.slot);
  if (!Number.isInteger(n) || n < SLOT_MIN || n > SLOT_MAX) {
    throw apiError(400, 'invalid_slot', `slot must be an integer ${SLOT_MIN}-${SLOT_MAX}.`);
  }
  return n;
}

async function fetchSlotMeta(userId: string, slot: number): Promise<SlotMeta | null> {
  const { rows } = await pool.query<SlotRow>(
    `SELECT slot, park_name, save_version, day, funds, park_value, rating, guests,
            playtime_ms, revision, updated_at
       FROM save_slots WHERE user_id = $1 AND slot = $2`,
    [userId, slot],
  );
  return rows[0] ? toSlotMeta(rows[0]) : null;
}

interface PutBody {
  parkName?: string;
  playtimeMs?: number;
  baseRevision?: number;
  state?: unknown;
}

export async function slotRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/slots', async (request) => {
    const user = await requireUser(request);
    const { rows } = await pool.query<SlotRow>(
      // Headline stats only -- never touches save_blobs (contract §3: the
      // load screen and leaderboard must not pay for parsing a 200 KB blob).
      `SELECT slot, park_name, save_version, day, funds, park_value, rating, guests,
              playtime_ms, revision, updated_at
         FROM save_slots WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user.id],
    );
    return { slots: rows.map(toSlotMeta) };
  });

  app.get<{ Params: { slot: string } }>('/api/slots/:slot', async (request) => {
    const user = await requireUser(request);
    const slot = parseSlotParam(request);
    const { rows } = await pool.query<SlotRow & { state: GameState }>(
      `SELECT s.slot, s.park_name, s.save_version, s.day, s.funds, s.park_value, s.rating,
              s.guests, s.playtime_ms, s.revision, s.updated_at, b.state
         FROM save_slots s
         JOIN save_blobs b ON b.slot_id = s.id
        WHERE s.user_id = $1 AND s.slot = $2`,
      [user.id, slot],
    );
    const row = rows[0];
    if (!row) throw apiError(404, 'slot_not_found', `No park in slot ${slot}.`);
    return { meta: toSlotMeta(row), state: row.state };
  });

  app.put<{ Params: { slot: string }; Body: PutBody }>('/api/slots/:slot', async (request) => {
    const user = await requireUser(request);
    const slot = parseSlotParam(request);
    const body = request.body ?? {};

    if (typeof body.parkName !== 'string' || body.parkName.length < 1) {
      throw apiError(400, 'invalid_park_name', 'parkName is required.');
    }
    if (typeof body.playtimeMs !== 'number' || !Number.isFinite(body.playtimeMs) || body.playtimeMs < 0) {
      throw apiError(400, 'invalid_playtime', 'playtimeMs must be a non-negative number.');
    }
    if (typeof body.baseRevision !== 'number' || !Number.isInteger(body.baseRevision) || body.baseRevision < 0) {
      throw apiError(400, 'invalid_base_revision', 'baseRevision must be a non-negative integer.');
    }

    // Check 2 (API-CONTRACT.md §6), landed early -- see file header.
    const state = migrate(body.state);
    if (!state) throw apiError(400, 'invalid_save', 'Not a recoverable save.');

    const summary = summarize(state);
    const params = [
      user.id,
      slot,
      body.parkName,
      summary.saveVersion,
      summary.day,
      summary.funds,
      summary.parkValue,
      summary.rating,
      summary.guests,
      body.playtimeMs,
    ] as const;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const row = await (body.baseRevision === 0
        ? createSlot(client, params)
        : updateSlot(client, params, body.baseRevision));

      if (!row) {
        // 0 rows: either the slot already exists (baseRevision 0 meant "new")
        // or someone else's write landed first (baseRevision > 0, stale).
        // Either way it is the same shape of conflict from the client's
        // point of view -- API-CONTRACT.md §5's 409-with-current-SlotMeta.
        const current = await fetchSlotMeta(user.id, slot);
        throw apiError(409, 'revision_conflict', 'This park was saved elsewhere first.', current ?? undefined);
      }

      if (body.baseRevision === 0) {
        await client.query(`INSERT INTO save_blobs (slot_id, state) VALUES ($1, $2)`, [
          row.id,
          state,
        ]);
      } else {
        // Archive what was there before overwriting it (contract §5).
        const old = await client.query<{ state: GameState }>(
          `SELECT state FROM save_blobs WHERE slot_id = $1`,
          [row.id],
        );
        if (old.rows[0]) {
          await client.query(
            `INSERT INTO save_history (slot_id, revision, state) VALUES ($1, $2, $3)`,
            [row.id, row.revision - 1, old.rows[0].state],
          );
        }
        await client.query(`UPDATE save_blobs SET state = $2 WHERE slot_id = $1`, [row.id, state]);
      }

      await client.query('COMMIT');
      return { meta: toSlotMeta(row) };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  app.delete<{ Params: { slot: string } }>('/api/slots/:slot', async (request, reply) => {
    const user = await requireUser(request);
    const slot = parseSlotParam(request);
    // Idempotent: deleting a slot that is already gone is still a 204, same
    // as everywhere else in this API that treats "already in the state you
    // wanted" as success rather than a 404 to handle specially.
    await pool.query(`DELETE FROM save_slots WHERE user_id = $1 AND slot = $2`, [user.id, slot]);
    reply.code(204);
  });
}

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
  client: import('pg').PoolClient,
  [userId, slot, parkName, saveVersion, day, funds, parkValue, rating, guests, playtimeMs]: Params,
): Promise<SlotRow & { id: string } | undefined> {
  const { rows } = await client.query<SlotRow & { id: string }>(
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
  client: import('pg').PoolClient,
  [userId, slot, parkName, saveVersion, day, funds, parkValue, rating, guests, playtimeMs]: Params,
  baseRevision: number,
): Promise<SlotRow & { id: string } | undefined> {
  const { rows } = await client.query<SlotRow & { id: string }>(
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
