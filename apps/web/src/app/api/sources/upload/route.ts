import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql, DEV_USER_ID } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

function getUserId(request: NextRequest): string {
  return request.headers.get(USER_ID_HEADER)?.trim() || DEV_USER_ID;
}

async function processPdfSource(sourceId: string, buffer: Buffer) {
  try {
    // Dynamic import to avoid server startup issues if pdfjs-dist unavailable
    const { extractTextPerPageFromBuffer } = await import("@/lib/server/pdf");
    const { chunkSource } = await import("@/lib/server/chunking");

    const pageTexts = await extractTextPerPageFromBuffer(buffer);
    const now = Date.now();

    for (let i = 0; i < pageTexts.length; i++) {
      const segmentId = `seg-${sourceId}-${i + 1}`;
      await sql`
        INSERT INTO "SourceSegment" (id, source_id, segment_type, segment_index, text, created_at)
        VALUES (${segmentId}, ${sourceId}, 'pdf_page', ${i + 1}, ${pageTexts[i]}, ${now})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    await chunkSource(sourceId);

    await sql`
      UPDATE "Source"
      SET status = 'ready', updated_at = ${Date.now()},
          parse_meta_json = ${JSON.stringify({ pageCount: pageTexts.length })}
      WHERE id = ${sourceId}
    `;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE "Source"
      SET status = 'failed', error_message = ${message}, updated_at = ${Date.now()}
      WHERE id = ${sourceId}
    `;
  }
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);

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
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  if (!notebookId) {
    return NextResponse.json({ error: "notebookId required" }, { status: 400 });
  }
  if (!buffer) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files allowed" }, { status: 400 });
  }

  try {
    const nb = await sql`
      SELECT id FROM "Notebook" WHERE id = ${notebookId} AND user_id = ${userId}
    `;
    if (nb.length === 0) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }

    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const now = Date.now();
    const sourceId = `src-${now}-${Math.random().toString(36).slice(2, 9)}`;
    const title = filename.replace(/\.pdf$/i, "").split("/").pop() || "Untitled PDF";

    // Store file in Vercel Blob if configured, else skip storedUri
    let storedUri: string | null = null;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import("@vercel/blob");
      const blob = await put(`sources/${sourceId}.pdf`, buffer, { access: "public" });
      storedUri = blob.url;
    }

    await sql`
      INSERT INTO "Source" (id, notebook_id, type, title, original_name, stored_uri, status, content_hash, created_at, updated_at)
      VALUES (${sourceId}, ${notebookId}, 'pdf', ${title}, ${filename}, ${storedUri}, 'processing', ${contentHash}, ${now}, ${now})
    `;

    // fire-and-forget
    processPdfSource(sourceId, buffer).catch(console.error);

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
    console.error("[sources/upload POST]", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
