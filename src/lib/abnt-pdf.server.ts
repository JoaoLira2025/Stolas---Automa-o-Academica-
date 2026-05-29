// Generates an ABNT-styled PDF from a markdown-ish content string.
// ABNT NBR 14724: A4, fonte 12, margens (esq/sup 3cm, dir/inf 2cm), espaçamento 1.5.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

const A4 = { w: 595.28, h: 841.89 }; // points
const MM = 2.834645; // 1mm in points
const MARGIN_L = 30 * MM;
const MARGIN_T = 30 * MM;
const MARGIN_R = 20 * MM;
const MARGIN_B = 20 * MM;
const FONT_SIZE = 12;
const LINE_HEIGHT = FONT_SIZE * 1.5;

interface Block {
  type: "h1" | "h2" | "h3" | "p" | "quote";
  text: string;
}

function safePdfText(text: string): string {
  const replacements: Record<string, string> = {
    "✅": "",
    "⚠": "",
    "️": "",
    "🛠": "",
    "📄": "",
    "•": "-",
    "✓": "-",
    "✔": "-",
    "“": '"',
    "”": '"',
    "‘": "'",
    "’": "'",
    "–": "-",
    "—": "-",
  };
  return Array.from(text)
    .map((char) => replacements[char] ?? char)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code <= 126) ||
        (code >= 160 && code <= 255)
      );
    })
    .join("");
}

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split(/\r?\n/);
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      blocks.push({ type: "p", text: buf.join(" ").trim() });
      buf = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("### ")) {
      flush();
      blocks.push({ type: "h3", text: line.slice(4) });
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      blocks.push({ type: "h2", text: line.slice(3) });
      continue;
    }
    if (line.startsWith("# ")) {
      flush();
      blocks.push({ type: "h1", text: line.slice(2) });
      continue;
    }
    if (line.startsWith("> ")) {
      flush();
      blocks.push({ type: "quote", text: line.slice(2) });
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safePdfText(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface AbntDocOptions {
  title: string;
  author: string;
  institution?: string;
  course?: string;
  city?: string;
  year?: string;
  content: string; // markdown-ish
  references?: string[];
}

export async function generateAbntPdf(opts: AbntDocOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const maxW = A4.w - MARGIN_L - MARGIN_R;

  // --- Capa ---
  const cover = doc.addPage([A4.w, A4.h]);
  const drawCenter = (page: PDFPage, text: string, y: number, size = 12, bold = false) => {
    const f = bold ? fontBold : font;
    const safeText = safePdfText(text);
    const w = f.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, { x: (A4.w - w) / 2, y, size, font: f, color: rgb(0, 0, 0) });
  };

  drawCenter(
    cover,
    (opts.institution ?? "INSTITUIÇÃO DE ENSINO").toUpperCase(),
    A4.h - MARGIN_T,
    12,
    true,
  );
  if (opts.course) drawCenter(cover, opts.course.toUpperCase(), A4.h - MARGIN_T - 18, 12, true);
  drawCenter(cover, opts.author.toUpperCase(), A4.h - MARGIN_T - 80, 12, true);
  drawCenter(cover, opts.title.toUpperCase(), A4.h / 2, 14, true);
  drawCenter(cover, opts.city ?? "Cidade", MARGIN_B + 40, 12, true);
  drawCenter(cover, opts.year ?? String(new Date().getFullYear()), MARGIN_B + 22, 12, true);

  // --- Conteúdo ---
  const blocks = parseBlocks(opts.content);
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN_T;

  const ensureSpace = (h: number) => {
    if (y - h < MARGIN_B) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - MARGIN_T;
    }
  };

  const drawLines = (lines: string[], f: PDFFont, size: number, lh: number, indent = 0) => {
    for (const line of lines) {
      ensureSpace(lh);
      page.drawText(line, {
        x: MARGIN_L + indent,
        y: y - size,
        size,
        font: f,
        color: rgb(0, 0, 0),
      });
      y -= lh;
    }
  };

  for (const b of blocks) {
    if (b.type === "h1") {
      ensureSpace(LINE_HEIGHT * 2);
      y -= LINE_HEIGHT * 0.5;
      drawLines(wrap(b.text.toUpperCase(), fontBold, 14, maxW), fontBold, 14, LINE_HEIGHT);
      y -= LINE_HEIGHT * 0.3;
    } else if (b.type === "h2") {
      ensureSpace(LINE_HEIGHT * 1.5);
      y -= LINE_HEIGHT * 0.3;
      drawLines(wrap(b.text, fontBold, 13, maxW), fontBold, 13, LINE_HEIGHT);
    } else if (b.type === "h3") {
      ensureSpace(LINE_HEIGHT);
      drawLines(wrap(b.text, fontBold, 12, maxW), fontBold, 12, LINE_HEIGHT);
    } else if (b.type === "quote") {
      // ABNT: citação longa recuo 4cm, fonte 10, espaçamento simples
      const lh10 = 12;
      const ind = 40 * MM - MARGIN_L;
      drawLines(wrap(b.text, font, 10, maxW - ind), font, 10, lh10, ind);
      y -= LINE_HEIGHT * 0.3;
    } else {
      drawLines(wrap(b.text, font, FONT_SIZE, maxW), font, FONT_SIZE, LINE_HEIGHT);
      y -= LINE_HEIGHT * 0.2;
    }
  }

  // --- Referências ---
  if (opts.references && opts.references.length) {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - MARGIN_T;
    drawCenter(page, "REFERÊNCIAS", y - 14, 12, true);
    y -= LINE_HEIGHT * 2;
    for (const ref of opts.references) {
      const lines = wrap(ref, font, FONT_SIZE, maxW);
      for (const line of lines) {
        ensureSpace(FONT_SIZE + 4);
        page.drawText(line, {
          x: MARGIN_L,
          y: y - FONT_SIZE,
          size: FONT_SIZE,
          font,
          color: rgb(0, 0, 0),
        });
        y -= FONT_SIZE + 4;
      }
      y -= 6;
    }
  }

  return await doc.save();
}
