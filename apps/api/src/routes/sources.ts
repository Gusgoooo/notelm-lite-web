import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { chunkSource } from "../chunking.js";
import { prisma } from "../db.js";
import { extractTextPerPageFromBuffer } from "../pdf.js";
import * as storage from "../storage.js";

const USER_ID_HEADER = "x-user-id";

function isDbError(err: unknown): boolean {
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

function getUserId(request: FastifyRequest): string | null {
  const id = request.headers[USER_ID_HEADER];
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

function sourceToJson(
  s: {
    id: string;
    notebookId: string;
    type: string;
    title: string;
    originalUri: string | null;
    originalName: string | null;
    storedUri: string | null;
    status: string;
    errorMessage: string | null;
    contentHash: string;
    createdAt: bigint;
    updatedAt: bigint;
  },
  chunkCount?: number
) {
  return {
    id: s.id,
    notebookId: s.notebookId,
    type: s.type,
    title: s.title,
    originalName: s.originalName ?? undefined,
    storedUri: s.storedUri ?? undefined,
    status: s.status,
    errorMessage: s.errorMessage ?? undefined,
    contentHash: s.contentHash,
    chunkCount: chunkCount ?? 0,
    createdAt: String(s.createdAt),
    updatedAt: String(s.updatedAt),
  };
}

async function processPdfSource(sourceId: string, storedUri: string) {
  const now = BigInt(Date.now());
  try {
    const buffer = await storage.get(storedUri);
    const pageTexts = await extractTextPerPageFromBuffer(buffer);
    for (let i = 0; i < pageTexts.length; i++) {
      const segmentId = `seg-${sourceId}-${i + 1}`;
      await prisma.sourceSegment.create({
        data: {
          id: segmentId,
          sourceId,
          segmentType: "pdf_page",
          segmentIndex: i + 1,
          text: pageTexts[i],
          createdAt: now,
        },
      });
    }
    await chunkSource(sourceId);
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        status: "ready",
        updatedAt: now,
        parseMetaJson: JSON.stringify({ pageCount: pageTexts.length }),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        status: "failed",
        errorMessage: message,
        updatedAt: BigInt(Date.now()),
      },
    });
  }
}

export async function sourcesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { notebookId?: string } }>("/sources", async (request, reply) => {
    const userId = getUserId(request);
    if (!userId) return reply.status(401).send({ error: "Missing X-User-Id header" });
    const notebookId = request.query.notebookId;
    if (!notebookId) return reply.status(400).send({ error: "notebookId required" });
    try {
      const notebook = await prisma.notebook.findFirst({
        where: { id: notebookId, userId },
      });
      if (!notebook) return reply.status(404).send({ error: "Notebook not found" });

      const list = await prisma.source.findMany({
        where: { notebookId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { chunks: true } } },
      });
      return reply.send(
        list.map((s) => sourceToJson(s, s._count.chunks))
      );
    } catch (err) {
      if (isDbError(err)) {
        return reply.status(503).send({ error: "Database unavailable." });
      }
      throw err;
    }
  });

  app.post("/sources/upload", async (request, reply) => {
    const userId = getUserId(request);
    if (!userId) return reply.status(401).send({ error: "Missing X-User-Id header" });

    let notebookId: string | null = null;
    let buffer: Buffer | null = null;
    let filename = "document.pdf";

    try {
      for await (const part of request.parts()) {
        if (part.type === "field" && part.fieldname === "notebookId") {
          notebookId = (part as { value?: string }).value?.trim() ?? null;
        }
        if (part.type === "file" && part.fieldname === "file") {
          filename = part.filename ?? filename;
          buffer = await part.toBuffer();
        }
      }
    } catch (err) {
      request.log.warn(err, "multipart parse failed");
      return reply.status(400).send({ error: "Invalid multipart body" });
    }

    if (!notebookId) return reply.status(400).send({ error: "notebookId required" });
    if (!buffer) return reply.status(400).send({ error: "No file" });

    try {
      const notebook = await prisma.notebook.findFirst({
        where: { id: notebookId, userId },
      });
      if (!notebook) return reply.status(404).send({ error: "Notebook not found" });

      if (!filename.toLowerCase().endsWith(".pdf")) {
        return reply.status(400).send({ error: "Only PDF files allowed" });
      }
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const now = BigInt(Date.now());
      const sourceId = `src-${now}-${Math.random().toString(36).slice(2, 9)}`;
      const title = path.basename(filename, ".pdf") || "Untitled PDF";

      const storedUri = await storage.put(`${sourceId}.pdf`, buffer);

      await prisma.source.create({
        data: {
          id: sourceId,
          notebookId,
          type: "pdf",
          title,
          originalName: filename,
          storedUri,
          status: "processing",
          contentHash,
          createdAt: now,
          updatedAt: now,
        },
      });

      processPdfSource(sourceId, storedUri).catch((err) => {
        request.log.error(err, "PDF processing failed");
      });

      return reply.status(201).send(
        sourceToJson({
          id: sourceId,
          notebookId,
          type: "pdf",
          title,
          originalUri: null,
          originalName: filename,
          storedUri,
          status: "processing",
          errorMessage: null,
          contentHash,
          createdAt: now,
          updatedAt: now,
        })
      );
    } catch (err) {
      if (isDbError(err)) {
        return reply.status(503).send({ error: "Database unavailable." });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/sources/:id/file", async (request, reply) => {
    const userId = getUserId(request);
    if (!userId) return reply.status(401).send({ error: "Missing X-User-Id header" });
    const sourceId = request.params.id;
    const source = await prisma.source.findFirst({
      where: { id: sourceId },
      include: { notebook: true },
    });
    if (!source || source.notebook.userId !== userId) {
      return reply.status(404).send({ error: "Source not found" });
    }
    const uri = source.storedUri;
    if (!uri) return reply.status(404).send({ error: "File not stored" });
    if (storage.isStoredUriUrl(uri)) {
      return reply.redirect(uri, 302);
    }
    const absolutePath = path.isAbsolute(uri) ? uri : path.resolve(process.cwd(), uri);
    try {
      const stat = await fs.promises.stat(absolutePath);
      if (!stat.isFile()) return reply.status(404).send({ error: "File not found" });
      return reply
        .header("content-type", "application/pdf")
        .send(fs.createReadStream(absolutePath));
    } catch {
      return reply.status(404).send({ error: "File not found" });
    }
  });
}
