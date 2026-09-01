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
      blocks.push({
        type: "p",
        text: buf.join(" ").trim(),
      });

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

      blocks.push({
        type: "h3",
        text: line.slice(4),
      });

      continue;
    }

    if (line.startsWith("## ")) {
      flush();

      blocks.push({
        type: "h2",
        text: line.slice(3),
      });

      continue;
    }

    if (line.startsWith("# ")) {
      flush();

      blocks.push({
        type: "h1",
        text: line.slice(2),
      });

      continue;
    }

    if (line.startsWith("> ")) {
      flush();

      blocks.push({
        type: "quote",
        text: line.slice(2),
      });

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
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = safePdfText(text).split(/\s+/);

  const lines: string[] = [];
  let cur = "";

  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;

    if (font.widthOfTextAtSize(next, size) > maxWidth) {
      if (cur) {
        lines.push(cur);
      }

      cur = word;
    } else {
      cur = next;
    }
  }

  if (cur) {
    lines.push(cur);
  }

  return lines;
}

/**
 * Desenha uma linha com espaçamento normal.
 */
function drawNormalLine(
  page: PDFPage,
  line: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
) {
  page.drawText(line, {
    x,
    y: y - size,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

/**
 * Desenha uma linha JUSTIFICADA.
 *
 * A última linha do parágrafo nunca é justificada.
 *
 * @param line Texto da linha
 * @param maxWidth Largura disponível
 * @param justify Se deve justificar
 */
function drawJustifiedLine(
  page: PDFPage,
  line: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  maxWidth: number,
  justify: boolean,
) {
  const words = line.split(/\s+/).filter(Boolean);

  // Uma palavra sozinha não precisa de justificação.
  if (!justify || words.length <= 1) {
    drawNormalLine(page, line, font, size, x, y);
    return;
  }

  const normalText = words.join(" ");

  const textWidth = font.widthOfTextAtSize(normalText, size);

  // Quantidade de espaço adicional que precisa ser distribuída
  const extraSpace = maxWidth - textWidth;

  // Número de espaços existentes
  const gaps = words.length - 1;

  // Espaço normal entre palavras
  const normalSpace = font.widthOfTextAtSize(" ", size);

  // Espaço adicional por intervalo
  const additionalSpace = extraSpace / gaps;

  let currentX = x;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    page.drawText(word, {
      x: currentX,
      y: y - size,
      size,
      font,
      color: rgb(0, 0, 0),
    });

    currentX += font.widthOfTextAtSize(word, size);

    if (i < words.length - 1) {
      currentX += normalSpace + additionalSpace;
    }
  }
}

/**
 * Desenha um parágrafo com:
 *
 * - recuo de primeira linha de 1,25 cm
 * - alinhamento justificado
 * - espaçamento 1,5
 */
function drawParagraph(
  page: PDFPage,
  lines: string[],
  font: PDFFont,
  size: number,
  lineHeight: number,
  y: number,
  maxWidth: number,
  paragraphIndent: number,
  ensureSpace: (height: number) => void,
): number {
  for (let i = 0; i < lines.length; i++) {
    ensureSpace(lineHeight);

    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;

    const indent = isFirstLine ? paragraphIndent : 0;

    const availableWidth = maxWidth - indent;

    drawJustifiedLine(
      page,
      lines[i],
      font,
      size,
      MARGIN_L + indent,
      y,
      availableWidth,
      !isLastLine,
    );

    y -= lineHeight;
  }

  return y;
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

export async function generateAbntPdf(
  opts: AbntDocOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const maxW = A4.w - MARGIN_L - MARGIN_R;

  // ============================================================
  // CAPA
  // ============================================================

  const cover = doc.addPage([A4.w, A4.h]);

  const drawCenter = (
    page: PDFPage,
    text: string,
    y: number,
    size = 12,
    bold = false,
  ) => {
    const f = bold ? fontBold : font;

    const safeText = safePdfText(text);

    const w = f.widthOfTextAtSize(safeText, size);

    page.drawText(safeText, {
      x: (A4.w - w) / 2,
      y,
      size,
      font: f,
      color: rgb(0, 0, 0),
    });
  };

  drawCenter(
    cover,
    (opts.institution ?? "INSTITUIÇÃO DE ENSINO").toUpperCase(),
    A4.h - MARGIN_T,
    12,
    true,
  );

  if (opts.course) {
    drawCenter(
      cover,
      opts.course.toUpperCase(),
      A4.h - MARGIN_T - 18,
      12,
      true,
    );
  }

  drawCenter(
    cover,
    opts.author.toUpperCase(),
    A4.h - MARGIN_T - 80,
    12,
    true,
  );

  drawCenter(
    cover,
    opts.title.toUpperCase(),
    A4.h / 2,
    14,
    true,
  );

  drawCenter(
    cover,
    opts.city ?? "Cidade",
    MARGIN_B + 40,
    12,
    true,
  );

  drawCenter(
    cover,
    opts.year ?? String(new Date().getFullYear()),
    MARGIN_B + 22,
    12,
    true,
  );

  // ============================================================
  // CONTEÚDO
  // ============================================================

  const blocks = parseBlocks(opts.content);

  let page = doc.addPage([A4.w, A4.h]);

  let y = A4.h - MARGIN_T;

  const ensureSpace = (height: number) => {
    if (y - height < MARGIN_B) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - MARGIN_T;
    }
  };

  /**
   * Desenha linhas simples.
   * Usado principalmente para títulos.
   */
  const drawLines = (
    lines: string[],
    f: PDFFont,
    size: number,
    lh: number,
    indent = 0,
  ) => {
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

  for (const block of blocks) {
    // ==========================================================
    // TÍTULO PRINCIPAL
    // ==========================================================

    if (block.type === "h1") {
      ensureSpace(LINE_HEIGHT * 2);

      y -= LINE_HEIGHT * 0.5;

      drawLines(
        wrap(
          block.text.toUpperCase(),
          fontBold,
          14,
          maxW,
        ),
        fontBold,
        14,
        LINE_HEIGHT,
      );

      y -= LINE_HEIGHT * 0.3;

      continue;
    }

    // ==========================================================
    // SUBTÍTULO
    // ==========================================================

    if (block.type === "h2") {
      ensureSpace(LINE_HEIGHT * 1.5);

      y -= LINE_HEIGHT * 0.3;

      drawLines(
        wrap(
          block.text,
          fontBold,
          13,
          maxW,
        ),
        fontBold,
        13,
        LINE_HEIGHT,
      );

      continue;
    }

    // ==========================================================
    // SUBSEÇÃO
    // ==========================================================

    if (block.type === "h3") {
      ensureSpace(LINE_HEIGHT);

      drawLines(
        wrap(
          block.text,
          fontBold,
          12,
          maxW,
        ),
        fontBold,
        12,
        LINE_HEIGHT,
      );

      continue;
    }

    // ==========================================================
    // CITAÇÃO LONGA
    // ==========================================================

    if (block.type === "quote") {
      // ABNT:
      // - recuo de 4 cm da margem esquerda
      // - fonte menor
      // - espaçamento simples
      // - sem recuo de primeira linha

      const quoteFontSize = 10;
      const quoteLineHeight = 12;

      const quoteWidth = A4.w - MARGIN_R - MARGIN_L - QUOTE_INDENT;

      const quoteLines = wrap(
        block.text,
        font,
        quoteFontSize,
        quoteWidth,
      );

      for (const line of quoteLines) {
        ensureSpace(quoteLineHeight);

        // Citação longa fica alinhada à esquerda dentro
        // do bloco de 4 cm, sem recuo adicional.
        drawNormalLine(
          page,
          line,
          font,
          quoteFontSize,
          MARGIN_L + QUOTE_INDENT,
          y,
        );

        y -= quoteLineHeight;
      }

      y -= LINE_HEIGHT * 0.3;

      continue;
    }

    // ==========================================================
    // PARÁGRAFO NORMAL
    // ==========================================================

    if (block.type === "p") {
      const lines = wrap(
        block.text,
        font,
        FONT_SIZE,
        maxW - PARAGRAPH_INDENT,
      );

      y = drawParagraph(
        page,
        lines,
        font,
        FONT_SIZE,
        LINE_HEIGHT,
        y,
        maxW,
        PARAGRAPH_INDENT,
        ensureSpace,
      );

      // Pequeno espaçamento entre parágrafos
      y -= LINE_HEIGHT * 0.2;
    }
  }

  // ============================================================
  // REFERÊNCIAS
  // ============================================================

  if (opts.references && opts.references.length) {
    page = doc.addPage([A4.w, A4.h]);

    y = A4.h - MARGIN_T;

    drawCenter(
      page,
      "REFERÊNCIAS",
      y - 14,
      12,
      true,
    );

    y -= LINE_HEIGHT * 2;

    for (const ref of opts.references) {
      const lines = wrap(
        ref,
        font,
        FONT_SIZE,
        maxW,
      );

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