import { NextRequest, NextResponse } from "next/server";
import { prisma, isDbError } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

function notebookToJson(nb: {
  id: string;
  userId: string;
  title: string;
  createdAt: bigint;
  updatedAt: bigint;
}) {
  return {
    id: nb.id,
    userId: nb.userId,
    title: nb.title,
    createdAt: String(nb.createdAt),
    updatedAt: String(nb.updatedAt),
  };
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get(USER_ID_HEADER)?.trim() ?? null;
  if (!userId) {
    return NextResponse.json(
      { error: "Missing X-User-Id header" },
      { status: 401 }
    );
  }
  try {
    const list = await prisma.notebook.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(list.map(notebookToJson));
  } catch (err) {
    if (isDbError(err)) {
      return NextResponse.json(
        {
          error:
            "Database unavailable. Set DATABASE_URL and ensure Postgres is running.",
        },
        { status: 503 }
      );
    }
    throw err;
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
  const body = await request.json().catch(() => ({}));
  const title = (body?.title as string | undefined)?.trim() ?? "Untitled";
  const now = BigInt(Date.now());
  const id = `nb-${now}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const notebook = await prisma.notebook.create({
      data: { id, userId, title, createdAt: now, updatedAt: now },
    });
    return NextResponse.json(notebookToJson(notebook), { status: 201 });
  } catch (err) {
    if (isDbError(err)) {
      return NextResponse.json(
        {
          error:
            "Database unavailable. Set DATABASE_URL and ensure Postgres is running.",
        },
        { status: 503 }
      );
    }
    throw err;
  }
}
