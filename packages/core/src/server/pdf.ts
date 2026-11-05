/**
 * Tiny dependency-free PDF writer for operational documents (receipts,
 * invoices, offer letters, report cards).
 *
 * Scope is deliberately narrow: one Helvetica font, A4 pages, wrapped text.
 * This keeps document generation working in every deployment without pulling
 * a native rendering toolchain into the API image. Rich HTML/Unicode PDF
 * rendering can be swapped in later behind the same `renderPdf()` contract.
 */

export interface PdfDocumentInput {
  title: string;
  lines: readonly string[];
  footer?: string;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const TITLE_SIZE = 16;
const BODY_SIZE = 10;
const LINE_HEIGHT = 14;
const MAX_CHARS = 92;

export function renderPdf(input: PdfDocumentInput): Buffer {
  const titleLines = wrap(input.title, 70);
  const bodyLines = input.lines.flatMap((line) => (line === '' ? [''] : wrap(line, MAX_CHARS)));
  const footerLines = input.footer ? wrap(input.footer, MAX_CHARS) : [];

  const firstPageCapacity = Math.max(
    1,
    Math.floor((PAGE_HEIGHT - MARGIN * 2 - TITLE_SIZE * 1.5 - footerLines.length * LINE_HEIGHT) / LINE_HEIGHT),
  );
  const pageCapacity = Math.max(
    1,
    Math.floor((PAGE_HEIGHT - MARGIN * 2 - footerLines.length * LINE_HEIGHT) / LINE_HEIGHT),
  );

  const pages: string[][] = [];
  let cursor = 0;
  let limit = firstPageCapacity;
  while (cursor < bodyLines.length || pages.length === 0) {
    pages.push(bodyLines.slice(cursor, cursor + limit));
    cursor += limit;
    limit = pageCapacity;
  }

  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  pages.forEach((body, index) => {
    const content = pageContent(index, titleLines, body, footerLines);
    const pageId = pageObjectIds[index]!;
    const contentId = pageId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  });

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function pageContent(
  pageIndex: number,
  titleLines: string[],
  body: string[],
  footer: string[],
): string {
  const parts: string[] = [];
  if (pageIndex === 0) {
    parts.push(`BT /F1 ${TITLE_SIZE} Tf ${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`);
    titleLines.forEach((line) => parts.push(`(${escapeText(line)}) Tj T*`));
    parts.push('ET');
  }

  const bodyTop = PAGE_HEIGHT - MARGIN - (pageIndex === 0 ? TITLE_SIZE * 1.8 : 0);
  parts.push(`BT /F1 ${BODY_SIZE} Tf ${MARGIN} ${bodyTop} Td ${LINE_HEIGHT} TL`);
  for (const line of body) {
    parts.push(`(${escapeText(line)}) Tj T*`);
  }
  parts.push('ET');

  if (footer.length > 0) {
    const footerTop = MARGIN + footer.length * LINE_HEIGHT;
    parts.push(`BT /F1 8 Tf ${MARGIN} ${footerTop} Td ${LINE_HEIGHT} TL`);
    for (const line of footer) parts.push(`(${escapeText(line)}) Tj T*`);
    parts.push('ET');
  }

  return parts.join('\n');
}

function wrap(value: string, width: number): string[] {
  const normalized = value.replace(/\r/g, '');
  if (normalized.length <= width) return [normalized];
  const words = normalized.split(/(\s+)/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + word).length > width) {
      if (current.trim().length > 0) lines.push(current.trimEnd());
      current = word.trimStart();
    } else {
      current += word;
    }
  }
  if (current.trim().length > 0) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [''];
}

function escapeText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
