import { config } from 'dotenv';
import { resolve } from 'path';
import { defineConfig } from 'drizzle-kit';

config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/notebookgo',
  },
});
