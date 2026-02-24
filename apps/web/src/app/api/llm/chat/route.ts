import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const {
    messages,
    model = "openai/gpt-3.5-turbo",
    max_tokens,
    temperature,
  } = body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  const payload = {
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
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: "OpenRouter request failed", detail: text.slice(0, 500) },
      { status: res.status }
    );
  }

  try {
    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON from OpenRouter", detail: text.slice(0, 200) },
      { status: 502 }
    );
  }
}
