// Server-only content extraction: PDF, TXT, XLSX, URLs, YouTube.
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";

const MAX_TEXT = 80_000;

function clip(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  return text.slice(0, MAX_TEXT) + "\n\n[... conteúdo truncado para caber no contexto ...]";
}

export async function extractFromBuffer(buf: ArrayBuffer, mime: string, name: string): Promise<string> {
  const lower = (mime || "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";

  if (lower.includes("pdf") || ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return clip(typeof text === "string" ? text : text.join("\n\n"));
  }

  if (lower.startsWith("text/") || ["txt", "md", "csv"].includes(ext)) {
    return clip(new TextDecoder().decode(buf));
  }

  if (
    lower.includes("spreadsheet") ||
    lower.includes("excel") ||
    ["xlsx", "xls", "ods"].includes(ext)
  ) {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    let out = "";
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      out += `\n## Planilha: ${sheetName}\n`;
      out += XLSX.utils.sheet_to_csv(sheet);
      out += "\n";
    }
    return clip(out);
  }

  // Fallback: try to decode as text
  try {
    return clip(new TextDecoder("utf-8", { fatal: false }).decode(buf));
  } catch {
    return `[Arquivo ${name} não pôde ser extraído automaticamente. Tipo: ${mime}]`;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractFromUrl(url: string): Promise<string> {
  // YouTube special handling
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return extractYouTubeTranscript(yt[1]);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 StolasBot/1.0" },
  });
  if (!res.ok) throw new Error(`Falha ao acessar ${url} (HTTP ${res.status})`);
  const html = await res.text();
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? url;
  return clip(`# ${title}\n\nFonte: ${url}\n\n${stripHtml(html)}`);
}

async function extractYouTubeTranscript(videoId: string): Promise<string> {
  // Try YouTube's public timed-text endpoint (works when uploader enabled captions)
  try {
    const langs = ["pt", "pt-BR", "en"];
    for (const lang of langs) {
      const url = `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}`;
      const res = await fetch(url);
      const xml = await res.text();
      if (xml && xml.includes("<text")) {
        const text = xml
          .replace(/<text[^>]*>/g, "\n")
          .replace(/<\/text>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
        return clip(`# Transcrição do vídeo YouTube (${videoId})\n\n${stripHtml(text)}`);
      }
    }
  } catch {
    /* ignore */
  }
  return `[Vídeo YouTube ${videoId}: não foi possível obter transcrição automática. Vídeos sem legendas públicas não podem ser processados. Sugestão: forneça um resumo manual ou habilite legendas.]`;
}
