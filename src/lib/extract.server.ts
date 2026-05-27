// Server-only content extraction: PDF, TXT, XLSX, URLs, YouTube.
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";

const MAX_TEXT = 120_000;

function clip(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  return text.slice(0, MAX_TEXT) + "\n\n[... conteúdo truncado para caber no contexto ...]";
}

export async function extractFromBuffer(buf: ArrayBuffer, mime: string, name: string): Promise<string> {
  const lower = (mime || "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";

  try {
    if (lower.includes("pdf") || ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? (text as string[]).join("\n\n") : String(text ?? "");
      if (!merged.trim()) {
        return `[PDF "${name}" parece ser composto apenas por imagens/digitalizações. Não foi possível extrair texto. Sugestão: use um PDF com texto selecionável ou converta-o via OCR antes de enviar.]`;
      }
      return clip(merged);
    }

    if (lower.startsWith("text/") || ["txt", "md", "csv", "json", "html", "xml"].includes(ext)) {
      return clip(new TextDecoder().decode(buf));
    }

    if (
      lower.includes("spreadsheet") ||
      lower.includes("excel") ||
      lower.includes("officedocument.spreadsheetml") ||
      ["xlsx", "xls", "ods", "xlsm"].includes(ext)
    ) {
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      let out = `Planilha "${name}" — ${wb.SheetNames.length} aba(s): ${wb.SheetNames.join(", ")}\n`;
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        out += `\n## Aba: ${sheetName}\n`;
        out += XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        out += "\n";
      }
      return clip(out);
    }

    // Fallback: try to decode as text
    return clip(new TextDecoder("utf-8", { fatal: false }).decode(buf));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha ao extrair "${name}" (${mime || ext}): ${msg}`);
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractFromUrl(url: string): Promise<string> {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return extractYouTubeTranscript(yt[1]);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; StolasBot/1.0; +https://stolas.app)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Falha ao acessar ${url} (HTTP ${res.status})`);
  const html = await res.text();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url;
  return clip(`# ${decodeHtmlEntities(title)}\n\nFonte: ${url}\n\n${stripHtml(html)}`);
}

// --- YouTube transcript ---
// Strategy: fetch watch page, parse ytInitialPlayerResponse, get captionTracks,
// fetch the timedtext URL (try srv3/json3 first, fallback to XML).

async function fetchYouTubePage(videoId: string): Promise<string> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=pt&persist_hl=1`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`YouTube respondeu HTTP ${res.status}`);
  return res.text();
}

type CaptionTrack = { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string } };
type YtConfig = { INNERTUBE_API_KEY?: string; INNERTUBE_CONTEXT_CLIENT_VERSION?: string };

function parsePlayerResponse(html: string): { title?: string; tracks: CaptionTrack[] } {
  // ytInitialPlayerResponse = { ... };
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:var|<\/script>)/);
  if (!m) return { tracks: [] };
  try {
    const json = JSON.parse(m[1]);
    const tracks: CaptionTrack[] = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title: string | undefined = json?.videoDetails?.title;
    return { title, tracks };
  } catch {
    return { tracks: [] };
  }
}

function parseYtConfig(html: string): YtConfig {
  const m = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);/);
  if (m) {
    try { return JSON.parse(m[1]) as YtConfig; } catch { /* fall through */ }
  }
  const key = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/)?.[1];
  return key ? { INNERTUBE_API_KEY: key } : {};
}

function normalizeCaptionTrack(t: any): CaptionTrack {
  return {
    baseUrl: t.baseUrl,
    languageCode: t.languageCode,
    kind: t.kind,
    name: t.name?.simpleText ? t.name : { simpleText: t.name?.runs?.map((r: any) => r.text).join("") },
  };
}

async function fetchAndroidCaptionTracks(videoId: string, apiKey?: string): Promise<CaptionTrack[]> {
  if (!apiKey) return [];
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 11)",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "pt", gl: "BR" } },
      videoId,
    }),
  });
  if (!res.ok) return [];
  try {
    const json = await res.json() as any;
    const tracks = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return tracks.map(normalizeCaptionTrack).filter((t: CaptionTrack) => t.baseUrl);
  } catch {
    return [];
  }
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;
  const score = (t: CaptionTrack) => {
    let s = 0;
    if (t.languageCode?.startsWith("pt")) s += 100;
    else if (t.languageCode?.startsWith("en")) s += 50;
    if (!t.kind) s += 10; // manual captions preferred over asr
    return s;
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}

async function fetchTranscriptJson(baseUrl: string): Promise<string | null> {
  // json3 is the most reliable structured format
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", "json3");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!res.ok) return null;
  const raw = await res.text();
  if (!raw.trim()) return null;
  try {
    const json = JSON.parse(raw) as { events?: { segs?: { utf8?: string }[] }[] };
    const parts: string[] = [];
    for (const ev of json.events ?? []) {
      if (!ev.segs) continue;
      const line = ev.segs.map((s) => s.utf8 ?? "").join("").replace(/\n/g, " ").trim();
      if (line) parts.push(line);
    }
    return parts.join(" ");
  } catch {
    return null;
  }
}

async function fetchTranscriptXml(baseUrl: string): Promise<string | null> {
  const res = await fetch(baseUrl);
  if (!res.ok) return null;
  const xml = await res.text();
  if (!xml.includes("<text")) return null;
  const text = xml
    .replace(/<text[^>]*>/g, "\n")
    .replace(/<\/text>/g, "");
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

async function extractYouTubeTranscript(videoId: string): Promise<string> {
  try {
    const html = await fetchYouTubePage(videoId);
    const { title, tracks } = parsePlayerResponse(html);

    if (!tracks.length) {
      return `[Vídeo YouTube "${title ?? videoId}" não possui legendas/transcrição disponíveis. Sem legendas o conteúdo de áudio não pode ser extraído. Sugestão: ative legendas automáticas no YouTube ou cole um resumo manual.]`;
    }

    const track = pickTrack(tracks);
    if (!track) return `[Não foi possível selecionar uma faixa de legenda para ${videoId}]`;

    const transcript = (await fetchTranscriptJson(track.baseUrl)) ?? (await fetchTranscriptXml(track.baseUrl));

    if (!transcript) {
      return `[Falha ao baixar transcrição do vídeo "${title ?? videoId}". O YouTube pode estar bloqueando a requisição.]`;
    }

    const header = `# Transcrição completa do vídeo: ${title ?? videoId}\nFonte: https://www.youtube.com/watch?v=${videoId}\nIdioma da legenda: ${track.languageCode}${track.kind === "asr" ? " (gerada automaticamente)" : ""}\n\n`;
    return clip(header + transcript);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[Erro ao processar vídeo YouTube ${videoId}: ${msg}]`;
  }
}
