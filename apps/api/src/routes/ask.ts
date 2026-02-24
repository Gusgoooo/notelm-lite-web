import type { FastifyInstance } from "fastify";
import { generateCompletion, LLMError } from "../llm-client.js";
import { prisma } from "../db.js";
import { retrieveChunks } from "../retrieval.js";
import type { RetrievalItem } from "../retrieval.js";

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

export async function askRoutes(app: FastifyInstance) {
  app.post<{
    Body: { notebookId?: string; question?: string; topK?: number; mode?: AskMode };
  }>("/ask", async (request, reply) => {
    const body = request.body ?? {};
    const notebookId = body.notebookId?.trim();
    const question = body.question?.trim();
    if (!notebookId) {
      return reply.status(400).send({ error: "notebookId is required" });
    }
    if (!question) {
      return reply.status(400).send({ error: "question is required" });
    }
    const topK = Math.min(
      typeof body.topK === "number" && body.topK > 0 ? body.topK : DEFAULT_TOP_K,
      20
    );
    const requestedMode: AskMode =
      body.mode === "evidence" || body.mode === "llm" ? body.mode : "llm";

    const items = await retrieveChunks(notebookId, question, topK);
    const citations: CitationShape[] = items.map(toCitation);
    const evidence = citations;

    let mode: AskMode = requestedMode;
    let answer: string | null = null;

    if (requestedMode === "llm") {
      try {
        const evidenceBlocks = items
          .map((item, i) => buildEvidenceLabel(item, i))
          .join("\n\n");
        const systemPrompt = `You answer only using the provided evidence. Cite sources with [C1], [C2], etc. when making claims. If the evidence does not contain enough information, say so.`;
        const userPrompt = `Evidence:\n${evidenceBlocks}\n\nQuestion: ${question}\n\nAnswer (cite with [C1][C2] etc.):`;

        answer = await generateCompletion([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);

        const now = BigInt(Date.now());
        const convId = `conv-${now}-${Math.random().toString(36).slice(2, 9)}`;
        const userMsgId = `msg-${now}-${Math.random().toString(36).slice(2, 9)}`;
        const assistantMsgId = `msg-${now}-${Math.random().toString(36).slice(2, 9)}`;

        await prisma.conversation.create({
          data: {
            id: convId,
            notebookId,
            title: question.slice(0, 80),
            createdAt: now,
            updatedAt: now,
          },
        });
        await prisma.message.createMany({
          data: [
            {
              id: userMsgId,
              conversationId: convId,
              role: "user",
              content: question,
              createdAt: now,
            },
            {
              id: assistantMsgId,
              conversationId: convId,
              role: "assistant",
              content: answer,
              createdAt: now,
            },
          ],
        });
        await prisma.messageCitation.createMany({
          data: items.map((item, i) => ({
            id: `mc-${assistantMsgId}-${i}`,
            messageId: assistantMsgId,
            citeKey: `C${i + 1}`,
            chunkId: item.chunkId,
            sourceId: item.sourceId,
            pageOrIndex: item.pageOrIndex,
            snippet: item.snippet,
            createdAt: now,
          })),
        });
      } catch (err) {
        const isLLM = err instanceof LLMError;
        request.log.warn(
          { err, code: isLLM ? (err as LLMError).code : undefined },
          "LLM failed, falling back to evidence mode"
        );
        mode = "evidence";
        answer = null;
      }
    }

    return reply.send({
      mode,
      answer,
      citations,
      evidence,
    });
  });
}
