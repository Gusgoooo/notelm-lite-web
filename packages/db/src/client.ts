import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import * as schema from './schema.js';

const rootEnv = resolve(process.cwd(), '../../.env');
const cwdEnv = resolve(process.cwd(), '.env');
if (existsSync(rootEnv)) config({ path: rootEnv });
else if (existsSync(cwdEnv)) config({ path: cwdEnv });
else config();

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/notebookgo';

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type Db = typeof db;
