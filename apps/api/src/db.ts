import { PrismaClient } from "@notelm/db";

export const prisma = new PrismaClient();

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
