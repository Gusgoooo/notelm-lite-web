import { NextRequest, NextResponse } from "next/server";
import { sql, DEV_USER_ID } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceId } = await params;
  const userId = request.headers.get(USER_ID_HEADER)?.trim() || DEV_USER_ID;

  try {
    const rows = await sql`
      SELECT s.stored_uri
      FROM "Source" s
      JOIN "Notebook" nb ON nb.id = s.notebook_id
      WHERE s.id = ${sourceId} AND nb.user_id = ${userId}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    const uri = rows[0].stored_uri as string | null;
    if (!uri) {
      return NextResponse.json({ error: "File not stored" }, { status: 404 });
    }
    // All stored files are Vercel Blob public URLs — redirect directly
    return NextResponse.redirect(uri, 302);
  } catch (err) {
    console.error("[sources/[id]/file GET]", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
