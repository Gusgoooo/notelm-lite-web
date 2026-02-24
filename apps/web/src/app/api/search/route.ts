import { NextRequest, NextResponse } from "next/server";
import { retrieveChunks } from "@/lib/server/retrieval";

const DEFAULT_K = 5;
const MAX_K = 20;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const notebookId = searchParams.get("notebookId")?.trim();
  const q = searchParams.get("q")?.trim();

  if (!notebookId) {
    return NextResponse.json(
      { error: "notebookId is required" },
      { status: 400 }
    );
  }
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  let k = DEFAULT_K;
  const kParam = searchParams.get("k");
  if (kParam !== null) {
    const parsed = parseInt(kParam, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: "k must be a positive integer" },
        { status: 400 }
      );
    }
    k = Math.min(parsed, MAX_K);
  }

  try {
    const items = await retrieveChunks(notebookId, q, k);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[search] failed:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
