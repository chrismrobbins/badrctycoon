/**
 * Public -- no auth required (confirmed with the repo owner; the handoff
 * left this as an open question in API-CONTRACT.md §9 / BACKEND-HANDOFF.md
 * §10 rather than deciding it).
 *
 * No score-submission endpoint exists anywhere in this API. Rows here come
 * only from `scores`, which routes/slots.ts's saveSlot() upserts from a
 * validated save -- a client that cannot submit a score directly cannot fake
 * one (contract §3).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { apiError } from '../errors';

const METRICS = new Set(['park_value', 'guests_peak', 'day_reached']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface LeaderboardRow {
  rank: number;
  displayName: string;
  value: number;
}

export const leaderboardRoutes = new Hono<AppEnv>();

leaderboardRoutes.get('/api/leaderboard', async (c) => {
  const metric = c.req.query('metric') ?? 'park_value';
  if (!METRICS.has(metric)) {
    throw apiError(400, 'invalid_metric', `metric must be one of ${[...METRICS].join(', ')}.`);
  }

  const rawLimit = Number(c.req.query('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  const { rows } = await c.get('db').query<{ display_name: string; value: string | number }>(
    `SELECT u.display_name, s.value
       FROM scores s
       JOIN users u ON u.id = s.user_id
      WHERE s.metric = $1
      ORDER BY s.value DESC
      LIMIT $2`,
    [metric, limit],
  );

  const leaderboardRows: LeaderboardRow[] = rows.map((row, i) => ({
    rank: i + 1,
    displayName: row.display_name,
    value: Number(row.value),
  }));
  return c.json({ rows: leaderboardRows });
});
