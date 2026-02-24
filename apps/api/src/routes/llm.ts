import type { FastifyInstance } from "fastify";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function llmRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      messages: Array<{ role: string; content: string }>;
      model?: string;
      max_tokens?: number;
      temperature?: number;
    };
  }>("/llm/chat", async (request, reply) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return reply.status(500).send({
        error: "OPENROUTER_API_KEY is not set",
      });
    }

    const { messages, model = "openai/gpt-3.5-turbo", max_tokens, temperature } = request.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: "messages array is required" });
    }

    const body = {
      model,
      messages,
      stream: false,
      ...(typeof max_tokens === "number" && { max_tokens }),
      ...(typeof temperature === "number" && { temperature }),
    };

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      request.log.warn({ status: res.status, body: text }, "OpenRouter error");
      return reply.status(res.status).send({
        error: "OpenRouter request failed",
        detail: text.slice(0, 500),
      });
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return reply.status(502).send({ error: "Invalid JSON from OpenRouter", detail: text.slice(0, 200) });
    }

    return reply.send(data);
  });
}
