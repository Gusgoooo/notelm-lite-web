import * as path from "node:path";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma, isDbError } from "@/lib/server/db";
import { extractTextPerPageFromBuffer } from "@/lib/server/pdf";
import { chunkSource } from "@/lib/server/chunking";
import * as storage from "@/lib/server/storage";

const USER_ID_HEADER = "x-user-id";

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

export async function POST(request: NextRequest) {
  const userId = request.headers.get(USER_ID_HEADER)?.trim() ?? null;
  if (!userId) {
    return NextResponse.json(
      { error: "Missing X-User-Id header" },
      { status: 401 }
    );
  }

  let notebookId: string | null = null;
  let buffer: Buffer | null = null;
  let filename = "document.pdf";

  try {
    const formData = await request.formData();
    const notebookIdField = formData.get("notebookId");
    if (typeof notebookIdField === "string") {
      notebookId = notebookIdField.trim() || null;
    }
    const fileField = formData.get("file");
    if (fileField instanceof File) {
      filename = fileField.name || filename;
      const arrayBuffer = await fileField.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart body" },
      { status: 400 }
    );
  }

  if (!notebookId) {
    return NextResponse.json({ error: "notebookId required" }, { status: 400 });
  }
  if (!buffer) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  try {
    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, userId },
    });
    if (!notebook) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }
    if (!filename.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files allowed" },
        { status: 400 }
      );
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

    // fire-and-forget PDF processing
    processPdfSource(sourceId, storedUri).catch(console.error);

    return NextResponse.json(
      {
        id: sourceId,
        notebookId,
        type: "pdf",
        title,
        originalName: filename,
        storedUri,
        status: "processing",
        contentHash,
        chunkCount: 0,
        createdAt: String(now),
        updatedAt: String(now),
      },
      { status: 201 }
    );
  } catch (err) {
    if (isDbError(err)) {
      return NextResponse.json(
        { error: "Database unavailable." },
        { status: 503 }
      );
    }
    throw err;
  }
}
