import { NextRequest, NextResponse } from "next/server";
import { prisma, isDbError } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

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
  chunkCount = 0
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
    chunkCount,
    createdAt: String(s.createdAt),
    updatedAt: String(s.updatedAt),
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
  const notebookId = request.nextUrl.searchParams.get("notebookId");
  if (!notebookId) {
    return NextResponse.json({ error: "notebookId required" }, { status: 400 });
  }
  try {
    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, userId },
    });
    if (!notebook) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }
    const list = await prisma.source.findMany({
      where: { notebookId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } },
    });
    return NextResponse.json(list.map((s) => sourceToJson(s, s._count.chunks)));
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
