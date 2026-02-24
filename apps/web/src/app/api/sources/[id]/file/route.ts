import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import * as storage from "@/lib/server/storage";

const USER_ID_HEADER = "x-user-id";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceId } = await params;
  const userId = request.headers.get(USER_ID_HEADER)?.trim() ?? null;
  if (!userId) {
    return NextResponse.json(
      { error: "Missing X-User-Id header" },
      { status: 401 }
    );
  }

  const source = await prisma.source.findFirst({
    where: { id: sourceId },
    include: { notebook: true },
  });
  if (!source || source.notebook.userId !== userId) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  const uri = source.storedUri;
  if (!uri) {
    return NextResponse.json({ error: "File not stored" }, { status: 404 });
  }

  if (storage.isStoredUriUrl(uri)) {
    return NextResponse.redirect(uri, 302);
  }

  const absolutePath = path.isAbsolute(uri)
    ? uri
    : path.resolve(process.cwd(), uri);
  try {
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const fileBuffer = await fs.promises.readFile(absolutePath);
    return new NextResponse(fileBuffer, {
      headers: { "content-type": "application/pdf" },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
