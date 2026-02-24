import { NextRequest, NextResponse } from "next/server";
import { generateCompletion, LLMError } from "@/lib/server/llm-client";
import { sql } from "@/lib/server/db";
import { retrieveChunks } from "@/lib/server/retrieval";
import type { RetrievalItem } from "@/lib/server/retrieval";

const DEFAULT_TOP_K = 6;
const EVIDENCE_MAX_CHARS = 400;

type AskMode = "llm" | "evidence";

interface CitationShape {
  chunkId: string;
  sourceId: string;
  pageOrIndex: number | null;
  snippet: string | null;
}

function toCitation(item: RetrievalItem): CitationShape {
  return {
    chunkId: item.chunkId,
    sourceId: item.sourceId,
    pageOrIndex: item.pageOrIndex,
    snippet: item.snippet,
  };
}

function buildEvidenceLabel(item: RetrievalItem, index: number): string {
  const label = `[C${index + 1}]`;
  const excerpt = (item.snippet ?? item.text).slice(0, EVIDENCE_MAX_CHARS);
  const page = item.pageOrIndex != null ? ` (p.${item.pageOrIndex})` : "";
  return `${label}${page} ${excerpt}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const notebookId = (body?.notebookId as string | undefined)?.trim();
  const question = (body?.question as string | undefined)?.trim();

  if (!notebookId) {
    return NextResponse.json({ error: "notebookId is required" }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const topK = Math.min(
    typeof body.topK === "number" && body.topK > 0 ? body.topK : DEFAULT_TOP_K,
    20
  );
  const requestedMode: AskMode =
    body.mode === "evidence" || body.mode === "llm" ? body.mode : "llm";

  const items = await retrieveChunks(notebookId, question, topK);
  const citations: CitationShape[] = items.map(toCitation);

  let mode: AskMode = requestedMode;
  let answer: string | null = null;

  if (requestedMode === "llm") {
    try {
      const evidenceBlocks = items
        .map((item, i) => buildEvidenceLabel(item, i))
        .join("\n\n");
      const systemPrompt =
        "You answer only using the provided evidence. Cite sources with [C1], [C2], etc. when making claims. If the evidence does not contain enough information, say so.";
      const userPrompt = `Evidence:\n${evidenceBlocks}\n\nQuestion: ${question}\n\nAnswer (cite with [C1][C2] etc.):`;

      answer = await generateCompletion([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      const now = Date.now();
      const convId = `conv-${now}-${Math.random().toString(36).slice(2, 9)}`;
      const userMsgId = `msg-${now}-${Math.random().toString(36).slice(2, 9)}`;
      const assistantMsgId = `msg-${now + 1}-${Math.random().toString(36).slice(2, 9)}`;

      await sql`
        INSERT INTO "Conversation" (id, notebook_id, title, created_at, updated_at)
        VALUES (${convId}, ${notebookId}, ${question.slice(0, 80)}, ${now}, ${now})
      `;
      await sql`
        INSERT INTO "Message" (id, conversation_id, role, content, created_at)
        VALUES
          (${userMsgId}, ${convId}, 'user', ${question}, ${now}),
          (${assistantMsgId}, ${convId}, 'assistant', ${answer}, ${now})
      `;
      if (items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          await sql`
            INSERT INTO "MessageCitation" (id, message_id, cite_key, chunk_id, source_id, page_or_index, snippet, created_at)
            VALUES (
              ${`mc-${assistantMsgId}-${i}`},
              ${assistantMsgId},
              ${`C${i + 1}`},
              ${item.chunkId},
              ${item.sourceId},
              ${item.pageOrIndex},
              ${item.snippet},
              ${now}
            )
            ON CONFLICT (id) DO NOTHING
          `;
        }
      }
    } catch (err) {
      const isLLM = err instanceof LLMError;
      console.warn(
        "[ask] LLM failed, falling back to evidence mode",
        isLLM ? (err as LLMError).code : err
      );
      mode = "evidence";
      answer = null;
    }
  }

  return NextResponse.json({ mode, answer, citations, evidence: citations });
}
