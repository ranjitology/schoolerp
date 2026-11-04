import { describe, expect, it } from 'vitest';
import {
  academicYearFor,
  addDays,
  addMonths,
  diffDays,
  eachDate,
  formatDate,
  isBetween,
  isoWeekday,
  monthKey,
  todayIso,
  weekday,
} from '../src/dates';
import { detectTimetableConflicts, isValidWorkingDay, periodMinutes } from '../src/timetable';

describe('dates', () => {
  it('adds days and clamps month arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('computes date differences and ranges', () => {
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(28);
    expect(eachDate('2026-02-27', '2026-03-01')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
    expect(() => eachDate('2026-03-02', '2026-03-01')).toThrow();
    expect(isBetween('2026-02-01', '2026-01-01', '2026-12-31')).toBe(true);
  });

  it('derives configurable academic years', () => {
    expect(academicYearFor('2026-03-31')).toEqual({
      label: '2025-26',
      startDate: '2025-04-01',
      endDate: '2026-03-31',
    });
    expect(academicYearFor('2026-04-01').label).toBe('2026-27');
    expect(() => academicYearFor('2026-04-01', 13)).toThrow();
  });

  it('handles weekdays, month keys and formatting', () => {
    expect(weekday('2026-02-01')).toBe(0);
    expect(isoWeekday('2026-02-01')).toBe(7);
    expect(isoWeekday('2026-02-02')).toBe(1);
    expect(monthKey('2026-02-01')).toBe('2026-02');
    expect(formatDate('2026-02-01')).toContain('2026');
    expect(todayIso(new Date('2026-02-01T23:30:00Z'))).toBe('2026-02-01');
  });
});

describe('timetable', () => {
  const base = {
    dayOfWeek: 1,
    periodId: 'p1',
    classId: 'c1',
    sectionId: 's1',
    subjectId: 'sub1',
  };

  it('detects teacher, room and class-slot clashes', () => {
    const conflicts = detectTimetableConflicts([
      { ...base, id: 'a', teacherId: 't1', room: 'R1' },
      { ...base, id: 'b', sectionId: 's2', teacherId: 't1', room: 'R2' },
      { ...base, id: 'c', sectionId: 's3', teacherId: 't2', room: 'R1' },
      { ...base, id: 'd', sectionId: 's4', teacherId: 't3', room: 'R3' },
    ]);
    expect(conflicts.map((c) => c.type).sort()).toEqual(['ROOM', 'TEACHER']);
  });

  it('allows different periods and sections', () => {
    expect(
      detectTimetableConflicts([
        { ...base, id: 'a', teacherId: 't1' },
        { ...base, id: 'b', periodId: 'p2', teacherId: 't1' },
        { ...base, id: 'c', sectionId: 's2', teacherId: 't2' },
      ]),
    ).toEqual([]);
  });

  it('detects duplicate class slots', () => {
    const conflicts = detectTimetableConflicts([
      { ...base, id: 'a' },
      { ...base, id: 'b', subjectId: 'sub2' },
    ]);
    expect(conflicts[0]?.type).toBe('CLASS_SLOT');
  });

  it('validates periods and working days', () => {
    expect(
      periodMinutes([
        { startTime: '09:00', endTime: '09:45' },
        { startTime: '10:00', endTime: '10:30' },
      ]),
    ).toBe(75);
    expect(() => periodMinutes([{ startTime: '10:00', endTime: '09:00' }])).toThrow();
    expect(isValidWorkingDay(1, [1, 2, 3])).toBe(true);
    expect(isValidWorkingDay(7, [1, 2, 3])).toBe(false);
    expect(isValidWorkingDay(8, [1, 2, 3])).toBe(false);
  });
});
