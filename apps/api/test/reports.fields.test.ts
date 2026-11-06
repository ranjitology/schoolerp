import { describe, expect, it } from 'vitest';
import { REPORT_FIELDS, REPORT_KEYS, savedReportConfigSchema } from '../src/reports/reports.service';

describe('saved report field contract', () => {
  it('exposes unique whitelisted keys for every report', () => {
    for (const key of REPORT_KEYS) {
      const catalog = REPORT_FIELDS[key];
      const columnKeys = catalog.columns.map((field) => field.key);
      const metricKeys = catalog.metrics.map((field) => field.key);
      expect(new Set(columnKeys).size).toBe(columnKeys.length);
      expect(new Set(metricKeys).size).toBe(metricKeys.length);
      expect(columnKeys.length + metricKeys.length).toBeGreaterThan(0);
    }
  });

  it('accepts whitelisted columns and metrics', () => {
    const parsed = savedReportConfigSchema.parse({
      report: 'enrollment',
      from: '2026-01-01',
      to: '2026-01-31',
      columns: ['admissionNo', 'class', 'status'],
      metrics: ['students', 'classes'],
    });
    expect(parsed.columns).toEqual(['admissionNo', 'class', 'status']);
    expect(parsed.metrics).toEqual(['students', 'classes']);
  });

  it('rejects unknown fields so a saved view cannot leak arbitrary columns', () => {
    expect(() =>
      savedReportConfigSchema.parse({ report: 'fees', columns: ['passwordHash'] }),
    ).toThrow(/Unknown column/);
    expect(() =>
      savedReportConfigSchema.parse({ report: 'fees', metrics: ['margin'] }),
    ).toThrow(/Unknown metric/);
  });

  it('rejects columns for reports that export metric rows only', () => {
    expect(() =>
      savedReportConfigSchema.parse({ report: 'overview', columns: ['students'] }),
    ).toThrow(/Unknown column/);
    expect(() =>
      savedReportConfigSchema.parse({ report: 'modules', columns: ['libraryBooks'] }),
    ).toThrow(/Unknown column/);
  });
});
