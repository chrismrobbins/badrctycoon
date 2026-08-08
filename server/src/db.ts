/** One pool, shared by every route. */

import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.databaseUrl });

pool.on('error', (err) => {
  // A dropped idle client must not crash the process -- log and keep serving;
  // the next query gets a fresh connection from the pool.
  console.error('[db] idle client error', err);
});
