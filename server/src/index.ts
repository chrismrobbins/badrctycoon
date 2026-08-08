import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from './env';
import { ApiError } from './errors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';

const app = Fastify({ logger: true });

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
  // @fastify/rate-limit throws a plain Error with statusCode 429 rather than
  // our ApiError -- give it the same envelope shape everything else uses.
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  if (statusCode === 429) {
    reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests.' } });
    return;
  }
  request.log.error(error);
  reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
});

await app.register(healthRoutes);
await app.register(authRoutes);

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
