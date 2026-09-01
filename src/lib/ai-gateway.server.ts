// Server-only OpenRouter AI Gateway helpers.
export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  return key;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
};

export async function chatCompletion(opts: {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
}): Promise<string> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenRouterApiKey()}`,
      "HTTP-Referer": process.env.APP_URL || "http://localhost:5173",
      "X-Title": "Stolas",
    },
    body: JSON.stringify({
      model: opts.model ?? "openrouter/free",
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429)
      throw new Error("Limite de requisições atingido. Aguarde alguns instantes.");
    if (res.status === 402)
      throw new Error("Créditos de IA esgotados. Adicione créditos no OpenRouter.");
    throw new Error(`AI Gateway erro ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}