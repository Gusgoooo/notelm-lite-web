import type { FastifyInstance } from "fastify";
import { retrieveChunks } from "../retrieval.js";

const DEFAULT_K = 5;
const MAX_K = 20;

export async function searchRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { notebookId?: string; q?: string; k?: string };
  }>("/search", async (request, reply) => {
    const notebookId = request.query.notebookId?.trim();
    const q = request.query.q?.trim();
    if (!notebookId) {
      return reply.status(400).send({ error: "notebookId is required" });
    }
    if (!q) {
      return reply.status(400).send({ error: "q is required" });
    }
    let k = DEFAULT_K;
    if (request.query.k !== undefined) {
      const parsed = parseInt(request.query.k, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        return reply.status(400).send({ error: "k must be a positive integer" });
      }
      k = Math.min(parsed, MAX_K);
    }

    try {
      const items = await retrieveChunks(notebookId, q, k);
      return reply.send({ items });
    } catch (err) {
      request.log.error(err, "search failed");
      throw err;
    }
  });
}
