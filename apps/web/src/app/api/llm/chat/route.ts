export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LLM_API_KEY is not set" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { messages, model, max_tokens, temperature } = body ?? {};
  const resolvedModel = model ?? process.env.LLM_MODEL ?? "gpt-3.5-turbo";

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const payload = {
    model: resolvedModel,
    messages,
    stream: false,
    ...(typeof max_tokens === "number" && { max_tokens }),
    ...(typeof temperature === "number" && { temperature }),
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: "LLM request failed", detail: text.slice(0, 500) },
      { status: res.status }
    );
  }

  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON from LLM", detail: text.slice(0, 200) },
      { status: 502 }
    );
  }
}
