import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const sql = neon(process.env.DATABASE_URL!);

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? "dev@localhost";

export async function ensureSeedUser() {
  await sql`
    INSERT INTO "User" (id, email, "createdAt", "updatedAt")
    VALUES (${DEV_USER_ID}, ${DEV_USER_EMAIL}, ${Date.now()}, ${Date.now()})
    ON CONFLICT (id) DO NOTHING
  `;
}

export { DEV_USER_ID };
