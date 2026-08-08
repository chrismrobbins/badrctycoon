import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from './env';
import { ApiError } from './errors';
import { MAX_SAVE_BYTES } from './shared';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { slotRoutes } from './routes/slots';
import { leaderboardRoutes } from './routes/leaderboard';
import { pruneHistory } from './jobs/pruneHistory';

const app = Fastify({
  logger: true,
  // API-CONTRACT.md §6 check 1: reject a save over 2 MB with 413. The wrapper
  // fields (parkName, playtimeMs, baseRevision) around `state` are a few dozen
  // bytes -- 4 KB of headroom is generous, not a loophole.
  bodyLimit: MAX_SAVE_BYTES + 4096,
});

await app.register(cookie);
// Global backstop; individual routes (auth) set stricter per-route limits via
// `config: { rateLimit: {...} }`. Per-username limiting for login/register
// lives in auth/rateLimit.ts -- this plugin only sees IPs.
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

app.setErrorHandler((error: unknown, request, reply) => {
  if (error instanceof ApiError) {
    reply.code(error.status).send(error.toBody());
    return;
  }

  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;

  // @fastify/rate-limit and Fastify's own bodyLimit both throw plain Errors
  // with a statusCode rather than our ApiError -- give them the same envelope
  // shape everything else uses.
  if (statusCode === 429) {
    reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests.' } });
    return;
  }
  if (statusCode === 413) {
    reply.code(413).send({ error: { code: 'payload_too_large', message: 'Save is too large.' } });
    return;
  }

  request.log.error(error);
  reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(slotRoutes);
await app.register(leaderboardRoutes);

// save_history pruning "on a schedule (not in a trigger)" (contract §5) --
// once shortly after boot so a long-lived process doesn't wait a full
// interval for its first pass, then hourly. See jobs/pruneHistory.ts for why
// this doesn't belong on the save path itself.
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
setTimeout(() => void runPruneHistory(), 30_000);
setInterval(() => void runPruneHistory(), PRUNE_INTERVAL_MS);

async function runPruneHistory(): Promise<void> {
  try {
    const deleted = await pruneHistory();
    if (deleted > 0) app.log.info({ deleted }, 'pruned save_history');
  } catch (err) {
    app.log.error(err, 'save_history prune failed');
  }
}

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
