import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";

const USER_ID_HEADER = "x-user-id";

function getUserId(request: FastifyRequest): string | null {
  const id = request.headers[USER_ID_HEADER];
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

function notebookToJson(nb: { id: string; userId: string; title: string; createdAt: bigint; updatedAt: bigint }) {
  return {
    id: nb.id,
    userId: nb.userId,
    title: nb.title,
    createdAt: String(nb.createdAt),
    updatedAt: String(nb.updatedAt),
  };
}

function isDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("DATABASE_URL") ||
    msg.includes("Can't reach database") ||
    msg.includes("Connection refused") ||
    msg.includes("connect ECONNREFUSED") ||
    msg.includes("denied access") ||
    msg.includes("(not available)")
  );
}

export async function notebooksRoutes(app: FastifyInstance) {
  app.get("/notebooks", async (request, reply) => {
    const userId = getUserId(request);
    if (!userId) {
      return reply.status(401).send({ error: "Missing X-User-Id header" });
    }
    try {
      const list = await prisma.notebook.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });
      return reply.send(list.map(notebookToJson));
    } catch (err) {
      if (isDbError(err)) {
        return reply.status(503).send({
          error: "Database unavailable. Set DATABASE_URL in packages/db/.env and ensure Postgres is running.",
        });
      }
      throw err;
    }
  });

  app.post<{ Body: { title?: string } }>("/notebooks", async (request, reply) => {
    const userId = getUserId(request);
    if (!userId) {
      return reply.status(401).send({ error: "Missing X-User-Id header" });
    }
    const title = request.body?.title?.trim() ?? "Untitled";
    const now = BigInt(Date.now());
    const id = `nb-${now}-${Math.random().toString(36).slice(2, 9)}`;
    try {
      const notebook = await prisma.notebook.create({
        data: {
          id,
          userId,
          title,
          createdAt: now,
          updatedAt: now,
        },
      });
      return reply.status(201).send(notebookToJson(notebook));
    } catch (err) {
      if (isDbError(err)) {
        return reply.status(503).send({
          error: "Database unavailable. Set DATABASE_URL in packages/db/.env and ensure Postgres is running.",
        });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/notebooks/:id", async (request, reply) => {
    const userId = getUserId(request);
    if (!userId) {
      return reply.status(401).send({ error: "Missing X-User-Id header" });
    }
    const { id } = request.params;
    try {
      const existing = await prisma.notebook.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Notebook not found" });
      }
      await prisma.notebook.delete({ where: { id } });
      return reply.status(204).send();
    } catch (err) {
      if (isDbError(err)) {
        return reply.status(503).send({
          error: "Database unavailable. Set DATABASE_URL in packages/db/.env and ensure Postgres is running.",
        });
      }
      throw err;
    }
  });
}
