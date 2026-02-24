import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbEnvPath = path.resolve(__dirname, "../../packages/db/.env");
const loaded = config({ path: dbEnvPath });
if (!process.env.DATABASE_URL) {
  console.warn("[API] DATABASE_URL not set. Tried loading from:", dbEnvPath);
} else {
  console.info("[API] DATABASE_URL loaded from", loaded.parsed ? dbEnvPath : "process env");
}
config({ path: path.resolve(process.cwd(), ".env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ensureSeedUser } from "./db.js";
import { askRoutes } from "./routes/ask.js";
import { llmRoutes } from "./routes/llm.js";
import { notebooksRoutes } from "./routes/notebooks.js";
import { searchRoutes } from "./routes/search.js";
import { sourcesRoutes } from "./routes/sources.js";

const app = Fastify({ logger: true });

app.setErrorHandler((err, _request, reply) => {
  reply.status(err.statusCode ?? 500).send({
    error: err.message ?? "Internal Server Error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

app.get("/health", async (_request, reply) => {
  return reply.send({ ok: true });
});

const start = async () => {
  try {
    await app.register(cors, { origin: true });
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
    await app.register(llmRoutes);
    await app.register(notebooksRoutes);
    await app.register(sourcesRoutes);
    await app.register(searchRoutes);
    await app.register(askRoutes);
    try {
      await ensureSeedUser();
    } catch (dbErr) {
      app.log.warn(dbErr, "DB seed failed (DATABASE_URL missing or Postgres down). API will start but notebooks/sources will fail.");
    }
    const port = Number(process.env.PORT) || 3001;
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
