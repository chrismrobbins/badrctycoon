/** Environment config, read once at startup. Fail loudly and immediately if
 *  something required is missing -- not on the first request that needs it. */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve to server/.env regardless of the process's cwd -- `npm run server:dev`
// runs from the repo root, not server/, so a bare `dotenv/config` would look in
// the wrong place.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`);
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 8787),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
};
