import { PrismaClient } from "@notelm/db";

// Reuse Prisma Client across hot reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? (globalThis.__prisma = new PrismaClient());

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

export async function ensureSeedUser() {
  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: {},
    create: {
      id: DEV_USER_ID,
      email: process.env.DEV_USER_EMAIL ?? "dev@localhost",
    },
  });
}

export function isDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("DATABASE_URL") ||
    msg.includes("Can't reach database") ||
    msg.includes("Connection refused") ||
    msg.includes("connect ECONNREFUSED") ||
    msg.includes("denied access") ||
    msg.includes("(not available)") ||
    msg.includes("does not exist")
  );
}
