/**
 * Thin OpenAI Chat Completions helper (server-only).
 */

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function openaiChatText(opts: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = opts.model ?? process.env.OPENAI_MODEL?.trim() ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 500,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenAI error ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned an empty response");
  return text;
}
