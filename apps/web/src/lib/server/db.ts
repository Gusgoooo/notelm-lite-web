import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

/**
 * Tagged-template SQL helper — mirrors the @neondatabase/serverless API.
 * Usage: await sql`SELECT * FROM "User" WHERE id = ${id}`
 */
export async function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> {
  let query = "";
  strings.forEach((s, i) => {
    query += s;
    if (i < values.length) query += `$${i + 1}`;
  });
  const pool = getPool();
  const result = await pool.query(query, values as unknown[]);
  return result.rows;
}

export const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? "dev@localhost";

export async function ensureSeedUser() {
  await sql`
    INSERT INTO "User" (id, email)
    VALUES (${DEV_USER_ID}, ${DEV_USER_EMAIL})
    ON CONFLICT (id) DO NOTHING
  `;
}
