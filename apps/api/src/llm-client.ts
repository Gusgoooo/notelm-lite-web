const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const LLM_ERROR_CODES = {
  LLM_CONFIG: "LLM_CONFIG",
  LLM_NETWORK: "LLM_NETWORK",
  LLM_REGION: "LLM_REGION",
  LLM_UNAVAILABLE: "LLM_UNAVAILABLE",
} as const;

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: keyof typeof LLM_ERROR_CODES
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export async function generateCompletion(
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LLMError("OPENROUTER_API_KEY is not set", "LLM_CONFIG");
  }

  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-3.5-turbo";
  console.log("[LLM] using model =", model);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
      throw new LLMError(`Network error: ${msg}`, "LLM_NETWORK");
    }
    throw new LLMError(`LLM unavailable: ${msg}`, "LLM_UNAVAILABLE");
  }

  const text = await res.text();

  if (res.status === 403 || res.status === 451) {
    throw new LLMError(`Region or access denied: ${text.slice(0, 200)}`, "LLM_REGION");
  }
  if (res.status === 401 || res.status === 402) {
    throw new LLMError(`Invalid or missing API key / quota: ${text.slice(0, 200)}`, "LLM_CONFIG");
  }
  if (!res.ok) {
    throw new LLMError(`OpenRouter error ${res.status}: ${text.slice(0, 200)}`, "LLM_UNAVAILABLE");
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new LLMError("Invalid JSON from OpenRouter", "LLM_UNAVAILABLE");
  }
  const content = data.choices?.[0]?.message?.content ?? "";
  return content;
}
