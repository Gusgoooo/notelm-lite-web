import { neon } from "@neondatabase/serverless";

// Lazy singleton — avoids top-level throw during Next.js build-time module scan
let _sql: ReturnType<typeof neon> | null = null;

export function sql(...args: Parameters<ReturnType<typeof neon>>) {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql(...args);
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
