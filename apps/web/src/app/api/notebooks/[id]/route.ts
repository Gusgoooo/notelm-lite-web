import { NextRequest, NextResponse } from "next/server";
import { prisma, isDbError } from "@/lib/server/db";

const USER_ID_HEADER = "x-user-id";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = request.headers.get(USER_ID_HEADER)?.trim() ?? null;
  if (!userId) {
    return NextResponse.json(
      { error: "Missing X-User-Id header" },
      { status: 401 }
    );
  }
  try {
    const existing = await prisma.notebook.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }
    await prisma.notebook.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
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
