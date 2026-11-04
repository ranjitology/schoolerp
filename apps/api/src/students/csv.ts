/**
 * Minimal RFC 4180 CSV reader/writer used by the student import/export flow.
 * Handles quoted fields, embedded commas/newlines, CRLF and a UTF-8 BOM.
 */
export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
}

export function parseCsv(input: string, maxRows = 5_000): CsvParseResult {
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const errors: string[] = [];
  if (records.length === 0) return { headers: [], rows: [], errors: ['The file is empty'] };

  const headers = records[0]!.map((header) => header.trim());
  if (headers.some((header) => !header)) errors.push('Header row contains an empty column name');
  if (new Set(headers).size !== headers.length) errors.push('Header row contains duplicate columns');
  if (records.length - 1 > maxRows) {
    errors.push(`A single import is limited to ${maxRows} rows`);
  }

  const rows: Record<string, string>[] = [];
  for (let index = 1; index < records.length && index <= maxRows; index += 1) {
    const values = records[index]!;
    if (values.length === 1 && values[0]!.trim() === '') continue;
    const row: Record<string, string> = {};
    headers.forEach((header, column) => {
      row[header] = (values[column] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows, errors };
}

export function toCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) lines.push(columns.map((column) => escape(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export const STUDENT_IMPORT_COLUMNS = [
  'admissionNo',
  'firstName',
  'lastName',
  'gender',
  'className',
  'sectionName',
  'rollNo',
  'dateOfBirth',
  'phone',
  'guardianName',
  'guardianPhone',
] as const;
