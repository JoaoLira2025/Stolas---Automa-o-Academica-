// Server-only Lovable AI Gateway helpers.
export const LOVABLE_AI_BASE = "https://ai.gateway.lovable.dev/v1";

export function getLovableApiKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
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
  const res = await fetch(`${LOVABLE_AI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": getLovableApiKey(),
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    body: JSON.stringify({
      model: opts.model ?? "google/gemini-2.5-flash",
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429)
      throw new Error("Limite de requisições atingido. Aguarde alguns instantes.");
    if (res.status === 402)
      throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
    throw new Error(`AI Gateway erro ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}
