import Fastify from 'fastify';
import { env } from './env';
import { healthRoutes } from './routes/health';

const app = Fastify({ logger: true });

await app.register(healthRoutes);

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
