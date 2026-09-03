import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

const A4 = { w: 595.28, h: 841.89 }; // points
const MM = 2.834645; // 1mm em points

// ABNT NBR 14724
const MARGIN_L = 30 * MM; // 3 cm
const MARGIN_T = 30 * MM; // 3 cm
const MARGIN_R = 20 * MM; // 2 cm
const MARGIN_B = 20 * MM; // 2 cm

const FONT_SIZE = 12;
const LINE_HEIGHT = FONT_SIZE * 1.5;

// Recuo da primeira linha de parágrafo: 1,25 cm
const PARAGRAPH_INDENT = 12.5 * MM;

// Citação longa: 4 cm a partir da margem esquerda
const QUOTE_INDENT = 40 * MM;

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

/**
 * Quebra o texto em linhas respeitando a largura disponível.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safePdfText(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";

  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth) {
      if (cur) lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Desenha uma linha com espaçamento normal (sem justificação).
 */
function drawNormalLine(
  page: PDFPage,
  line: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
) {
  page.drawText(line, { x, y: y - size, size, font, color: rgb(0, 0, 0) });
}

interface TextRun {
  text: string;
  bold: boolean;
}

function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Aceita *texto* e **texto**
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    runs.push({ text: match[2] ?? match[3], bold: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex), bold: false });
  }

  return runs.length ? runs : [{ text, bold: false }];
}

/**
 * Desenha uma linha JUSTIFICADA. A última linha do parágrafo nunca é justificada.
 */
function drawJustifiedLine(
  page: PDFPage,
  line: string,
  font: PDFFont,
  boldFont: PDFFont,
  size: number,
  x: number,
  y: number,
  maxWidth: number,
  justify: boolean,
) {
  const runs = parseInlineMarkdown(line);
  const words: { text: string; bold: boolean }[] = [];

  for (const run of runs) {
    for (const w of run.text.split(/\s+/).filter(Boolean)) {
      words.push({ text: w, bold: run.bold });
    }
  }
  if (!words.length) return;

  if (!justify || words.length <= 1) {
    let currentX = x;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const currentFont = word.bold ? boldFont : font;
      page.drawText(word.text, { x: currentX, y: y - size, size, font: currentFont, color: rgb(0, 0, 0) });
      currentX += currentFont.widthOfTextAtSize(word.text, size);
      if (i < words.length - 1) currentX += font.widthOfTextAtSize(" ", size);
    }
    return;
  }

  let textWidth = 0;
  for (const word of words) {
    const currentFont = word.bold ? boldFont : font;
    textWidth += currentFont.widthOfTextAtSize(word.text, size);
  }

  const gaps = words.length - 1;
  const normalSpace = font.widthOfTextAtSize(" ", size);
  textWidth += normalSpace * gaps;

  const extraSpace = Math.max(0, maxWidth - textWidth);
  const additionalSpace = gaps > 0 ? extraSpace / gaps : 0;

  let currentX = x;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const currentFont = word.bold ? boldFont : font;
    page.drawText(word.text, { x: currentX, y: y - size, size, font: currentFont, color: rgb(0, 0, 0) });
    currentX += currentFont.widthOfTextAtSize(word.text, size);
    if (i < words.length - 1) currentX += normalSpace + additionalSpace;
  }
}

/**
 * Desenha um parágrafo com recuo de primeira linha, justificação e espaçamento 1,5.
 */
function drawParagraph(
  pageRef: () => PDFPage,
  lines: string[],
  font: PDFFont,
  boldFont: PDFFont,
  size: number,
  lineHeight: number,
  maxWidth: number,
  paragraphIndent: number,
  getY: () => number,
  setY: (value: number) => void,
  ensureSpace: (height: number) => void,
): void {
  for (let i = 0; i < lines.length; i++) {
    ensureSpace(lineHeight);
    const currentY = getY();
    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    const indent = isFirstLine ? paragraphIndent : 0;
    const availableWidth = maxWidth - indent;

    drawJustifiedLine(
      pageRef(),
      lines[i],
      font,
      boldFont,
      size,
      MARGIN_L + indent,
      currentY,
      availableWidth,
      !isLastLine,
    );
    setY(currentY - lineHeight);
  }
}

// ============================================================
// SUMÁRIO + NUMERAÇÃO DE PÁGINA
// ============================================================

interface HeadingEntry {
  level: 1 | 2 | 3;
  text: string;
  pageIndex: number; // 0-based, relativo às páginas do corpo
}

interface TocEntry {
  level: 1 | 2 | 3;
  text: string;
  page: number; // número absoluto final, já com capa + sumário somados
}

interface BodyResult {
  pages: PDFPage[];
  headings: HeadingEntry[];
}

/**
 * Desenha todo o corpo do documento (títulos, parágrafos, citações, referências)
 * numa instância de PDFDocument. Usada duas vezes: uma vez "a seco" (dry-run, num
 * documento descartável) só para descobrir em qual página cada título vai cair, e
 * uma segunda vez de verdade, depois que já sabemos quantas páginas o sumário vai
 * ocupar e portanto qual vai ser a numeração real de cada página.
 */
function renderBody(
  doc: PDFDocument,
  font: PDFFont,
  fontBold: PDFFont,
  blocks: Block[],
  references: string[] | undefined,
): BodyResult {
  const maxW = A4.w - MARGIN_L - MARGIN_R;
  const pages: PDFPage[] = [];
  const headings: HeadingEntry[] = [];

  let page = doc.addPage([A4.w, A4.h]);
  pages.push(page);
  let y = A4.h - MARGIN_T;

  const ensureSpace = (height: number) => {
    if (y - height < MARGIN_B) {
      page = doc.addPage([A4.w, A4.h]);
      pages.push(page);
      y = A4.h - MARGIN_T;
    }
  };

  const drawLines = (lines: string[], f: PDFFont, size: number, lh: number, indent = 0) => {
    for (const line of lines) {
      ensureSpace(lh);
      page.drawText(line, { x: MARGIN_L + indent, y: y - size, size, font: f, color: rgb(0, 0, 0) });
      y -= lh;
    }
  };

  for (const block of blocks) {
    // TÍTULO PRINCIPAL
    if (block.type === "h1") {
      ensureSpace(LINE_HEIGHT * 2.4);
      y -= LINE_HEIGHT * 0.6;
      headings.push({ level: 1, text: block.text, pageIndex: pages.length - 1 });
      drawLines(wrap(block.text.toUpperCase(), fontBold, 14, maxW), fontBold, 14, LINE_HEIGHT);
      y -= LINE_HEIGHT * 0.6;
      continue;
    }

    // SUBTÍTULO
    if (block.type === "h2") {
      ensureSpace(LINE_HEIGHT * 1.8);
      y -= LINE_HEIGHT * 0.4;
      headings.push({ level: 2, text: block.text, pageIndex: pages.length - 1 });
      drawLines(wrap(block.text, fontBold, 13, maxW), fontBold, 13, LINE_HEIGHT);
      y -= LINE_HEIGHT * 0.4;
      continue;
    }

    // SUBSEÇÃO
    if (block.type === "h3") {
      ensureSpace(LINE_HEIGHT * 1.4);
      y -= LINE_HEIGHT * 0.3;
      headings.push({ level: 3, text: block.text, pageIndex: pages.length - 1 });
      drawLines(wrap(block.text, fontBold, 12, maxW), fontBold, 12, LINE_HEIGHT);
      y -= LINE_HEIGHT * 0.3;
      continue;
    }

    // CITAÇÃO LONGA (recuo 4cm, fonte 10, espaçamento simples)
    if (block.type === "quote") {
      const quoteFontSize = 10;
      const quoteLineHeight = 12;
      const quoteWidth = maxW - QUOTE_INDENT;
      const quoteLines = wrap(block.text, font, quoteFontSize, quoteWidth);

      for (const line of quoteLines) {
        ensureSpace(quoteLineHeight);
        drawNormalLine(page, line, font, quoteFontSize, MARGIN_L + QUOTE_INDENT, y);
        y -= quoteLineHeight;
      }
      y -= LINE_HEIGHT * 0.3;
      continue;
    }

    // PARÁGRAFO NORMAL
    if (block.type === "p") {
      const lines = wrap(block.text, font, FONT_SIZE, maxW - PARAGRAPH_INDENT);

      drawParagraph(
        () => page,
        lines,
        font,
        fontBold,
        FONT_SIZE,
        LINE_HEIGHT,
        maxW,
        PARAGRAPH_INDENT,
        () => y,
        (newY) => {
          y = newY;
        },
        ensureSpace,
      );
      y -= LINE_HEIGHT * 0.2;
    }
  }

  // REFERÊNCIAS
  if (references && references.length) {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = A4.h - MARGIN_T;

    const refTitleWidth = fontBold.widthOfTextAtSize("REFERÊNCIAS", 12);
    page.drawText("REFERÊNCIAS", {
      x: (A4.w - refTitleWidth) / 2,
      y: y - 14,
      size: 12,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    headings.push({ level: 1, text: "REFERÊNCIAS", pageIndex: pages.length - 1 });
    y -= LINE_HEIGHT * 2;

    const refLineHeight = FONT_SIZE * 1.2; // espaçamento simples entre linhas da mesma referência
    for (const ref of references) {
      const lines = wrap(ref, font, FONT_SIZE, maxW);
      for (const line of lines) {
        ensureSpace(refLineHeight);
        page.drawText(line, { x: MARGIN_L, y: y - FONT_SIZE, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
        y -= refLineHeight;
      }
      y -= FONT_SIZE * 0.7; // respiro extra entre referências diferentes
    }
  }

  return { pages, headings };
}

/** Desenha o número da página no canto superior direito. */
function drawPageNumber(page: PDFPage, font: PDFFont, number: number) {
  const text = String(number);
  const size = 10;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: A4.w - MARGIN_R - w,
    y: A4.h - 15 * MM,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

/** Desenha uma linha do sumário: título + pontilhado + número da página. */
function drawTocEntry(page: PDFPage, font: PDFFont, fontBold: PDFFont, entry: TocEntry, y: number) {
  const size = 12;
  const isTopLevel = entry.level === 1;
  const f = isTopLevel ? fontBold : font;
  const indent = entry.level === 1 ? 0 : entry.level === 2 ? 8 * MM : 16 * MM;
  const label = safePdfText(isTopLevel ? entry.text.toUpperCase() : entry.text);
  const pageLabel = String(entry.page);

  const labelX = MARGIN_L + indent;
  const pageLabelWidth = font.widthOfTextAtSize(pageLabel, size);
  const pageLabelX = A4.w - MARGIN_R - pageLabelWidth;

  page.drawText(label, { x: labelX, y, size, font: f, color: rgb(0, 0, 0) });

  const labelWidth = f.widthOfTextAtSize(label, size);
  const dotsStartX = labelX + labelWidth + 4;
  const dotsEndX = pageLabelX - 4;
  const dotWidth = font.widthOfTextAtSize(".", size);

  if (dotsEndX > dotsStartX && dotWidth > 0) {
    const dotsCount = Math.floor((dotsEndX - dotsStartX) / dotWidth);
    if (dotsCount > 0) {
      page.drawText(".".repeat(dotsCount), { x: dotsStartX, y, size, font, color: rgb(0.4, 0.4, 0.4) });
    }
  }

  page.drawText(pageLabel, { x: pageLabelX, y, size, font, color: rgb(0, 0, 0) });
}

/** Estima quantas páginas o sumário vai ocupar, antes de desenhá-lo de verdade. */
function estimateTocPageCount(entryCount: number): number {
  const usableHeight = A4.h - MARGIN_T - MARGIN_B;
  const titleReserved = LINE_HEIGHT * 2.5;
  const firstPageCapacity = Math.max(1, Math.floor((usableHeight - titleReserved) / LINE_HEIGHT));
  const otherPageCapacity = Math.max(1, Math.floor(usableHeight / LINE_HEIGHT));
  if (entryCount <= firstPageCapacity) return 1;
  const remaining = entryCount - firstPageCapacity;
  return 1 + Math.ceil(remaining / otherPageCapacity);
}

/** Desenha o sumário completo (paginado, se necessário) e retorna as páginas criadas. */
function drawToc(doc: PDFDocument, font: PDFFont, fontBold: PDFFont, entries: TocEntry[]): PDFPage[] {
  const tocLineHeight = LINE_HEIGHT;
  const pages: PDFPage[] = [];

  let page = doc.addPage([A4.w, A4.h]);
  pages.push(page);
  let y = A4.h - MARGIN_T;

  const titleWidth = fontBold.widthOfTextAtSize("SUMÁRIO", 14);
  page.drawText("SUMÁRIO", { x: (A4.w - titleWidth) / 2, y: y - 14, size: 14, font: fontBold, color: rgb(0, 0, 0) });
  y -= LINE_HEIGHT * 2.5;

  for (const entry of entries) {
    if (y - tocLineHeight < MARGIN_B) {
      page = doc.addPage([A4.w, A4.h]);
      pages.push(page);
      y = A4.h - MARGIN_T;
    }
    drawTocEntry(page, font, fontBold, entry, y - 12);
    y -= tocLineHeight;
  }

  return pages;
}

export interface AbntDocOptions {
  title: string;
  author: string;
  institution?: string;
  course?: string;
  city?: string;
  year?: string;
  content: string;
  references?: string[];
}

export async function generateAbntPdf(opts: AbntDocOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  // ============================================================
  // CAPA
  // ============================================================

  const cover = doc.addPage([A4.w, A4.h]);

  const drawCenter = (page: PDFPage, text: string, y: number, size = 12, bold = false) => {
    const f = bold ? fontBold : font;
    const safeText = safePdfText(text);
    const w = f.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, { x: (A4.w - w) / 2, y, size, font: f, color: rgb(0, 0, 0) });
  };

  drawCenter(cover, (opts.institution ?? "INSTITUIÇÃO DE ENSINO").toUpperCase(), A4.h - MARGIN_T, 12, true);
  if (opts.course) drawCenter(cover, opts.course.toUpperCase(), A4.h - MARGIN_T - 18, 12, true);
  drawCenter(cover, opts.author.toUpperCase(), A4.h - MARGIN_T - 80, 12, true);
  drawCenter(cover, opts.title.toUpperCase(), A4.h / 2, 14, true);
  drawCenter(cover, opts.city ?? "Cidade", MARGIN_B + 40, 12, true);
  drawCenter(cover, opts.year ?? String(new Date().getFullYear()), MARGIN_B + 22, 12, true);

  // ============================================================
  // SUMÁRIO (calculado a partir de um dry-run do corpo)
  // ============================================================

  const blocks = parseBlocks(opts.content);

  // Dry-run: gera o corpo inteiro num documento descartável só para saber
  // em qual página (relativa) cada título vai cair.
  const dryDoc = await PDFDocument.create();
  const dryFont = await dryDoc.embedFont(StandardFonts.TimesRoman);
  const dryFontBold = await dryDoc.embedFont(StandardFonts.TimesRomanBold);
  const dryResult = renderBody(dryDoc, dryFont, dryFontBold, blocks, opts.references);

  const tocPageCount = estimateTocPageCount(dryResult.headings.length);
  // página 1 = capa; páginas 2..(1+tocPageCount) = sumário; corpo começa logo depois
  const bodyStartAbsolutePage = 1 + tocPageCount + 1;

  const tocEntries: TocEntry[] = dryResult.headings.map((h) => ({
    level: h.level,
    text: h.text,
    page: bodyStartAbsolutePage + h.pageIndex,
  }));

  const tocPages = drawToc(doc, font, fontBold, tocEntries);
  tocPages.forEach((p, i) => drawPageNumber(p, font, 2 + i));

  // ============================================================
  // CORPO REAL (capa + sumário já desenhados, agora o conteúdo de verdade)
  // ============================================================

  const bodyResult = renderBody(doc, font, fontBold, blocks, opts.references);
  bodyResult.pages.forEach((p, i) => drawPageNumber(p, font, bodyStartAbsolutePage + i));

  return await doc.save();
}