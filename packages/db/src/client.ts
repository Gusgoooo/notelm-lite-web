import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ??
  (process.env.NODE_ENV === 'production'
    ? undefined
    : 'postgresql://postgres:postgres@localhost:5433/notebookgo');

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is required in production. The worker cannot connect to Postgres without it.'
  );
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type Db = typeof db;
