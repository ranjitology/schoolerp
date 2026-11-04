import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/students/csv';

describe('CSV import/export', () => {
  it('parses quoted fields, embedded commas and newlines', () => {
    const result = parseCsv(
      'admissionNo,fullName,address\r\nS-1,"Sharma, Aarav","Kathmandu\nNepal"\r\nS-2,Rita, Lalitpur \r\n',
    );

    expect(result.errors).toEqual([]);
    expect(result.headers).toEqual(['admissionNo', 'fullName', 'address']);
    expect(result.rows).toEqual([
      { admissionNo: 'S-1', fullName: 'Sharma, Aarav', address: 'Kathmandu\nNepal' },
      { admissionNo: 'S-2', fullName: 'Rita', address: 'Lalitpur' },
    ]);
  });

  it('unescapes doubled quotes and strips a UTF-8 BOM', () => {
    const result = parseCsv('\uFEFFname,note\n"Doe, ""J""",ok\n');

    expect(result.rows).toEqual([{ name: 'Doe, "J"', note: 'ok' }]);
  });

  it('reports duplicate and empty headers', () => {
    const result = parseCsv('name,,name\na,b,c\n');

    expect(result.errors).toContain('Header row contains an empty column name');
    expect(result.errors).toContain('Header row contains duplicate columns');
  });

  it('enforces the row limit without losing headers', () => {
    const result = parseCsv('a,b\n1,2\n3,4\n5,6\n', 2);

    expect(result.rows).toHaveLength(2);
    expect(result.errors[0]).toContain('limited to 2 rows');
  });

  it('round-trips values through toCsv', () => {
    const csv = toCsv(
      [
        { admissionNo: 'S-1', name: 'Sharma, Aarav', note: 'said "hello"' },
        { admissionNo: 'S-2', name: 'Rita', note: 'line\nbreak' },
      ],
      ['admissionNo', 'name', 'note'],
    );

    const parsed = parseCsv(csv);
    expect(parsed.rows).toEqual([
      { admissionNo: 'S-1', name: 'Sharma, Aarav', note: 'said "hello"' },
      { admissionNo: 'S-2', name: 'Rita', note: 'line\nbreak' },
    ]);
  });
});
