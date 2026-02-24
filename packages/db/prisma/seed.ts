import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_USER_ID = "dev-user";
const DEFAULT_USER_EMAIL = "dev@localhost";

async function main() {
  const user = await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: {
      id: DEFAULT_USER_ID,
      email: DEFAULT_USER_EMAIL,
    },
  });
  console.log("Seeded default user:", user.id, user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
