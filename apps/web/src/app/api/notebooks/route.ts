import { NextRequest, NextResponse } from "next/server";
import { sql, DEV_USER_ID, ensureSeedUser } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

function getUserId(request: NextRequest): string {
  return request.headers.get(USER_ID_HEADER)?.trim() || DEV_USER_ID;
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  try {
    await ensureSeedUser();
    const rows = await sql`
      SELECT id, user_id, title, created_at, updated_at
      FROM "Notebook"
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `;
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        title: r.title,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      }))
    );
  } catch (err) {
    console.error("[notebooks GET]", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  console.log("[v0] notebooks POST userId:", userId);
  const body = await request.json().catch(() => ({}));
  const title = (body?.title as string | undefined)?.trim() || "Untitled";
  const now = Date.now();
  const id = `nb-${now}-${Math.random().toString(36).slice(2, 9)}`;
  console.log("[v0] notebooks POST title:", title, "id:", id);

  try {
    console.log("[v0] notebooks POST calling ensureSeedUser");
    await ensureSeedUser();
    console.log("[v0] notebooks POST inserting notebook");
    await sql`
      INSERT INTO "Notebook" (id, user_id, title, created_at, updated_at)
      VALUES (${id}, ${userId}, ${title}, ${now}, ${now})
    `;
    console.log("[v0] notebooks POST success");
    return NextResponse.json(
      { id, userId, title, createdAt: String(now), updatedAt: String(now) },
      { status: 201 }
    );
  } catch (err) {
    console.error("[v0] notebooks POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
