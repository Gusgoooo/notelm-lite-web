export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sql, DEV_USER_ID } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

function getUserId(request: NextRequest): string {
  return request.headers.get(USER_ID_HEADER)?.trim() || DEV_USER_ID;
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const notebookId = request.nextUrl.searchParams.get("notebookId");
  if (!notebookId) {
    return NextResponse.json({ error: "notebookId required" }, { status: 400 });
  }
  try {
    // verify notebook ownership
    const nb = await sql`
      SELECT id FROM "Notebook" WHERE id = ${notebookId} AND user_id = ${userId}
    `;
    if (nb.length === 0) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }
    const rows = await sql`
      SELECT
        s.id, s.notebook_id, s.type, s.title,
        s.original_name, s.stored_uri, s.status,
        s.error_message, s.content_hash,
        s.created_at, s.updated_at,
        COUNT(c.id)::int AS chunk_count
      FROM "Source" s
      LEFT JOIN "Chunk" c ON c.source_id = s.id
      WHERE s.notebook_id = ${notebookId}
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `;
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        notebookId: r.notebook_id,
        type: r.type,
        title: r.title,
        originalName: r.original_name,
        storedUri: r.stored_uri,
        status: r.status,
        errorMessage: r.error_message,
        contentHash: r.content_hash,
        chunkCount: r.chunk_count,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      }))
    );
  } catch (err) {
    console.error("[sources GET]", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
