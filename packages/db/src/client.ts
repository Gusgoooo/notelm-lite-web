import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/notebookgo';

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type Db = typeof db;
