import type { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { STARTING_FUNDS } from '../shared';

/**
 * Proves two things, per docs/BACKEND-HANDOFF.md §5 step 2's "done when":
 * the process can reach Postgres, and it can import a shared client module
 * without ERR_UNSUPPORTED_DIR_IMPORT. `startingFunds` in the response is not
 * meaningful to a caller -- it is a canary that the import actually resolved,
 * matching the probe.mts check recorded in the handoff.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    return {
      ok: true,
      db: rows[0]?.ok === 1,
      sharedModuleImport: { startingFunds: STARTING_FUNDS },
    };
  });
}
