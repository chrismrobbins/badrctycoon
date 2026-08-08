import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ApiError } from './errors';
import { createDbClient } from './db';
import type { AppEnv } from './types';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { slotRoutes } from './routes/slots';
import { leaderboardRoutes } from './routes/leaderboard';
import { pruneHistory } from './jobs/pruneHistory';

export type { Env } from './types';

const app = new Hono<AppEnv>();

// One pg Client per request (db.ts), closed after the response is sent
// rather than blocking on it -- see db.ts for why this replaces the
// module-level Pool the Node version used.
app.use('*', async (c, next) => {
  const db = await createDbClient(c.env);
  c.set('db', db);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(db.end());
  }
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json(error.toBody(), error.status as ContentfulStatusCode);
  }

  // Hono's built-in body-size guard (see hono/bodyLimit in routes/slots.ts)
  // and anything else with a numeric statusCode get the same envelope shape
  // as ApiError -- see routes/slots.ts's use of the bodyLimit middleware for
  // where the 413 actually comes from.
  const statusCode =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (statusCode === 413) {
    return c.json({ error: { code: 'payload_too_large', message: 'Save is too large.' } }, 413);
  }

  console.error(error);
  return c.json({ error: { code: 'internal_error', message: 'Something went wrong.' } }, 500);
});

app.route('/', healthRoutes);
app.route('/', authRoutes);
app.route('/', slotRoutes);
app.route('/', leaderboardRoutes);

export default {
  fetch: app.fetch,

  // save_history pruning "on a schedule (not in a trigger)" (contract §5).
  // Was a setInterval in the Node build; Workers don't stay alive between
  // requests, so a Cron Trigger (wrangler.jsonc: hourly) is what that
  // becomes here.
  async scheduled(_controller, env, ctx): Promise<void> {
    const db = await createDbClient(env);
    ctx.waitUntil(
      pruneHistory(db)
        .then((deleted) => {
          if (deleted > 0) console.log(`pruned ${deleted} save_history rows`);
        })
        .catch((err) => console.error('save_history prune failed', err))
        .finally(() => db.end()),
    );
  },
} satisfies ExportedHandler<AppEnv['Bindings']>;
