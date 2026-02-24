export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sql, DEV_USER_ID } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

function getUserId(request: NextRequest): string {
  return request.headers.get(USER_ID_HEADER)?.trim() || DEV_USER_ID;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserId(request);
  try {
    const rows = await sql`
      SELECT id, user_id, title, created_at, updated_at
      FROM "Notebook"
      WHERE id = ${id} AND user_id = ${userId}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }
    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      userId: r.user_id,
      title: r.title,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    });
  } catch (err) {
    console.error("[notebooks/[id] GET]", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserId(request);
  const body = await request.json().catch(() => ({}));
  const title = (body?.title as string | undefined)?.trim();
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const now = Date.now();
  try {
    const rows = await sql`
      UPDATE "Notebook"
      SET title = ${title}, updated_at = ${now}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, user_id, title, created_at, updated_at
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }
    const r = rows[0];
    return NextResponse.json({
      id: r.id,
      userId: r.user_id,
      title: r.title,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    });
  } catch (err) {
    console.error("[notebooks/[id] PATCH]", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserId(request);
  try {
    const rows = await sql`
      DELETE FROM "Notebook"
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[notebooks/[id] DELETE]", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
