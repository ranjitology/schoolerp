import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRADE_BANDS,
  buildResultSheet,
  gradeFor,
  percentage,
  rankStudents,
  validateGradeBands,
  weightedAggregate,
} from '../src/grading';
import { ValidationError } from '../src/errors';

describe('grading', () => {
  it('validates the default scale', () => {
    expect(() => validateGradeBands(DEFAULT_GRADE_BANDS)).not.toThrow();
  });

  it('detects gaps, overlaps and duplicate grades', () => {
    const gap = DEFAULT_GRADE_BANDS.filter((b) => b.grade !== 'B');
    expect(() => validateGradeBands(gap)).toThrow(/Gap or overlap/);
    const overlap = [...DEFAULT_GRADE_BANDS, { grade: 'X', minPercent: 95, maxPercent: 100, gpa: 4 }];
    expect(() => validateGradeBands(overlap)).toThrow();
    const duplicate = DEFAULT_GRADE_BANDS.map((b) =>
      b.grade === 'A' ? { ...b, grade: 'A+' } : b,
    );
    expect(() => validateGradeBands(duplicate)).toThrow(/Duplicate/);
  });

  it('maps boundary percentages to the right grade', () => {
    expect(gradeFor(100).band.grade).toBe('A+');
    expect(gradeFor(90).band.grade).toBe('A+');
    expect(gradeFor(89.99).band.grade).toBe('A');
    expect(gradeFor(33).band.grade).toBe('E');
    expect(gradeFor(33).passed).toBe(true);
    expect(gradeFor(32.99).band.grade).toBe('F');
    expect(gradeFor(32.99).passed).toBe(false);
    expect(gradeFor(0).band.grade).toBe('F');
  });

  it('computes percentages and rejects invalid marks', () => {
    expect(percentage(45, 50)).toBe(90);
    expect(percentage(0, 100)).toBe(0);
    expect(() => percentage(101, 100)).toThrow(ValidationError);
    expect(() => percentage(10, 0)).toThrow(ValidationError);
    expect(() => percentage(-1, 100)).toThrow(ValidationError);
    expect(() => gradeFor(101)).toThrow(ValidationError);
  });

  it('computes weighted aggregates across terms', () => {
    const result = weightedAggregate([
      { obtained: 80, maximum: 100, weight: 25 },
      { obtained: 90, maximum: 100, weight: 75 },
    ]);
    expect(result.percentage).toBe(87.5);
    expect(result.weightTotal).toBe(100);
    const absent = weightedAggregate([
      { obtained: 90, maximum: 100, weight: 50 },
      { obtained: 100, maximum: 100, weight: 50, absent: true },
    ]);
    expect(absent.percentage).toBe(45);
    expect(() => weightedAggregate([])).toThrow();
    expect(() => weightedAggregate([{ obtained: 10, maximum: 10, weight: 0 }])).toThrow();
  });

  it('ranks with competition ranking and deterministic ties', () => {
    const ranked = rankStudents([
      { studentId: 'b', percentage: 90, tieBreaker: 450 },
      { studentId: 'a', percentage: 90, tieBreaker: 450 },
      { studentId: 'c', percentage: 80 },
      { studentId: 'd', percentage: 70 },
    ]);
    expect(ranked.map((r) => [r.studentId, r.rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
      ['d', 4],
    ]);
    expect(rankStudents([])).toEqual([]);
  });

  it('builds report-card results with pass/fail and GPA', () => {
    const sheet = buildResultSheet([
      { subjectId: 'math', obtained: 90, maximum: 100 },
      { subjectId: 'sci', obtained: 80, maximum: 100 },
    ]);
    expect(sheet.totalObtained).toBe(170);
    expect(sheet.percentage).toBe(85);
    expect(sheet.grade).toBe('A');
    expect(sheet.passed).toBe(true);
    expect(sheet.gpa).toBe(3.8);
    expect(sheet.subjects[0]?.gpa).toBe(4);
  });

  it('fails a student absent in one subject and rejects empty marks', () => {
    const sheet = buildResultSheet([
      { subjectId: 'math', obtained: 90, maximum: 100 },
      { subjectId: 'sci', obtained: 0, maximum: 100, absent: true },
    ]);
    expect(sheet.passed).toBe(false);
    expect(sheet.subjects[1]?.absent).toBe(true);
    expect(() => buildResultSheet([])).toThrow();
  });
});
