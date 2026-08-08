import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { STARTING_FUNDS } from '../shared';

/**
 * Proves two things, per docs/BACKEND-HANDOFF.md §5 step 2's "done when":
 * the process can reach Postgres, and it can import a shared client module
 * without ERR_UNSUPPORTED_DIR_IMPORT. `startingFunds` in the response is not
 * meaningful to a caller -- it is a canary that the import actually resolved.
 */
export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/api/health', async (c) => {
  const { rows } = await c.get('db').query<{ ok: number }>('SELECT 1 AS ok');
  return c.json({
    ok: true,
    db: rows[0]?.ok === 1,
    sharedModuleImport: { startingFunds: STARTING_FUNDS },
  });
});
