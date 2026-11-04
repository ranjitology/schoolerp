/**
 * Calendar helpers. All dates are ISO `YYYY-MM-DD` calendar dates interpreted
 * as UTC, avoiding timezone drift between the browser, server, and reports.
 */
import { ValidationError } from './errors';
import { parseIsoDate } from './fees';

export type CalendarSystem = 'AD' | 'BS';

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const date = parseIsoDate(isoDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function diffDays(laterIso: string, earlierIso: string): number {
  return Math.round(
    (parseIsoDate(laterIso).getTime() - parseIsoDate(earlierIso).getTime()) / 86_400_000,
  );
}

export function isBetween(isoDate: string, startIso: string, endIso: string): boolean {
  return isoDate >= startIso && isoDate <= endIso;
}

export interface AcademicYear {
  label: string;
  startDate: string;
  endDate: string;
}

/**
 * Configurable academic year (default: 1 Baisakh / mid-April for Nepal).
 * A date before the start month belongs to the year that began last year.
 */
export function academicYearFor(
  isoDate: string,
  startMonth = 4,
  startDay = 1,
): AcademicYear {
  if (startMonth < 1 || startMonth > 12) throw new ValidationError('Invalid start month');
  if (startDay < 1 || startDay > 28) throw new ValidationError('Start day must be 1-28');
  const date = parseIsoDate(isoDate);
  const year = date.getUTCFullYear();
  const boundaryThisYear = Date.UTC(year, startMonth - 1, startDay);
  const startYear = date.getTime() >= boundaryThisYear ? year : year - 1;
  const startDate = new Date(Date.UTC(startYear, startMonth - 1, startDay))
    .toISOString()
    .slice(0, 10);
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay - 1))
    .toISOString()
    .slice(0, 10);
  return { label: `${startYear}-${String(startYear + 1).slice(2)}`, startDate, endDate };
}

export function monthKey(isoDate: string): string {
  parseIsoDate(isoDate);
  return isoDate.slice(0, 7);
}

export function eachDate(startIso: string, endIso: string): string[] {
  if (endIso < startIso) throw new ValidationError('End date precedes start date');
  const dates: string[] = [];
  let cursor = startIso;
  // Guard against unbounded loops (max 5 years).
  while (cursor <= endIso && dates.length < 1827) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function weekday(isoDate: string): number {
  return parseIsoDate(isoDate).getUTCDay();
}

/** 1 = Monday … 7 = Sunday, matching ISO-8601 and the timetable schema. */
export function isoWeekday(isoDate: string): number {
  const day = weekday(isoDate);
  return day === 0 ? 7 : day;
}

export function formatDate(
  isoDate: string,
  locale = 'en-GB',
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    parseIsoDate(isoDate),
  );
}
