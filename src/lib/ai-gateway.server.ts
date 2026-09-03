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

/**
 * Remove qualquer rastro de "raciocínio" (chain-of-thought) que tenha vazado
 * para dentro do texto de resposta, mesmo com reasoning.exclude ativado —
 * alguns modelos/providers ainda colam esse texto no meio do conteúdo.
 */
function stripLeakedReasoning(text: string): string {
  let cleaned = text;

  // Remove blocos <think>...</think> ou <thinking>...</thinking>
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");

  // Se sobrou um preâmbulo de raciocínio antes do primeiro título markdown
  // (ex.: "Here's a thinking process: 1. Analyze..."), corta tudo antes dele.
  const firstHeadingMatch = cleaned.match(/^#{1,3}\s+\S/m);
  if (firstHeadingMatch && firstHeadingMatch.index != null && firstHeadingMatch.index > 40) {
    cleaned = cleaned.slice(firstHeadingMatch.index);
  }

  return cleaned.trim();
}

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
      // Pede para a API não incluir o raciocínio interno do modelo na resposta.
      // Suportado pelos modelos de "reasoning" servidos via OpenRouter; para
      // modelos que não têm essa etapa, o parâmetro é simplesmente ignorado.
      reasoning: { exclude: true },
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
  const rawContent = data.choices[0]?.message?.content ?? "";
  return stripLeakedReasoning(rawContent);
}