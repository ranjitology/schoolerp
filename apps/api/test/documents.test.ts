import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  renderTemplate,
} from '../src/documents/documents.service';

describe('document templates', () => {
  it('ships a starter template for every operational document', () => {
    const codes = DEFAULT_DOCUMENT_TEMPLATES.map((template) => template.code);
    expect(codes).toEqual(
      expect.arrayContaining(['STUDENT_BONAFIDE', 'FEE_RECEIPT', 'PAYSLIP', 'ADMISSION_OFFER']),
    );
  });

  it('replaces known tokens and blanks unknown ones', () => {
    const rendered = renderTemplate('Hello {{ studentName }} / {{missing}}', {
      studentName: 'Aarav Shrestha',
    });
    expect(rendered).toBe('Hello Aarav Shrestha / ');
  });

  it('keeps text without placeholders intact', () => {
    expect(renderTemplate('No tokens here', {})).toBe('No tokens here');
  });
});
