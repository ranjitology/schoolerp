import { describe, expect, it } from 'vitest';
import { renderPdf } from '../src/server/pdf';

describe('PDF renderer', () => {
  it('produces a well-formed single-page PDF', () => {
    const pdf = renderPdf({
      title: 'Fee Receipt',
      lines: ['Receipt No.: RCPT-001', 'Amount: NPR 1,200.00'],
      footer: 'Green Valley School',
    });
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 1');
    expect(text).toContain('(Receipt No.: RCPT-001) Tj');
    expect(text).toContain('/BaseFont /Helvetica');
  });

  it('escapes parentheses and backslashes in text', () => {
    const text = renderPdf({ title: 'Note', lines: ['A (B) \\ C'] }).toString('latin1');
    expect(text).toContain('(A \\(B\\) \\\\ C) Tj');
  });

  it('paginates long content and keeps every page reachable', () => {
    const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
    const text = renderPdf({ title: 'Long report', lines }).toString('latin1');
    const pageCount = Number(text.match(/\/Count (\d+)/)?.[1]);

    expect(pageCount).toBeGreaterThan(1);
    expect(text).toContain('/Kids [');
    expect(text).toContain('Line 200');
  });
});
