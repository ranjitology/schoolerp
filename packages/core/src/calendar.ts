/**
 * Bikram Sambat (BS) ↔ Gregorian (AD) conversion.
 *
 * The conversion data lives in `nepali-date-converter`, which ships the
 * Government of Nepal month-length table. We wrap it so the rest of the
 * codebase never depends on the library's object API and so failures are
 * explicit rather than silently producing a wrong date.
 */
import NepaliDate from 'nepali-date-converter';

export interface BsDate {
  year: number;
  /** 1–12 (Baisakh … Chaitra) */
  month: number;
  day: number;
}

export const BS_MONTHS_EN = [
  'Baisakh',
  'Jestha',
  'Ashadh',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const;

export const BS_MONTHS_NP = [
  'बैशाख',
  'जेठ',
  'असार',
  'साउन',
  'भदौ',
  'असोज',
  'कार्तिक',
  'मंसिर',
  'पुष',
  'माघ',
  'फाल्गुन',
  'चैत',
] as const;

const BS_MIN_YEAR = 2000;
const BS_MAX_YEAR = 2090;

export class BsCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BsCalendarError';
  }
}

function toUtcDate(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new BsCalendarError('Invalid date');
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BsCalendarError('AD dates must use YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BsCalendarError(`Invalid AD date: ${value}`);
  }
  return date;
}

export function isValidBsDate(value: BsDate): boolean {
  if (
    !Number.isInteger(value.year) ||
    value.year < BS_MIN_YEAR ||
    value.year > BS_MAX_YEAR ||
    !Number.isInteger(value.month) ||
    value.month < 1 ||
    value.month > 12 ||
    !Number.isInteger(value.day) ||
    value.day < 1 ||
    value.day > 32
  ) {
    return false;
  }
  try {
    const converted = new NepaliDate(value.year, value.month - 1, value.day);
    return (
      converted.getYear() === value.year &&
      converted.getMonth() === value.month - 1 &&
      converted.getDate() === value.day
    );
  } catch {
    return false;
  }
}

/** Converts an AD date (Date or `YYYY-MM-DD`) to a BS calendar date. */
export function adToBs(value: string | Date): BsDate {
  const date = toUtcDate(value);
  const converted = new NepaliDate(
    new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const result = {
    year: converted.getYear(),
    month: converted.getMonth() + 1,
    day: converted.getDate(),
  };
  if (result.year < BS_MIN_YEAR || result.year > BS_MAX_YEAR) {
    throw new BsCalendarError(
      `AD date ${date.toISOString().slice(0, 10)} is outside the supported BS range`,
    );
  }
  return result;
}

/** Converts a BS date to an AD `YYYY-MM-DD` string. */
export function bsToAd(value: BsDate): string {
  if (!isValidBsDate(value)) {
    throw new BsCalendarError(
      `Invalid BS date ${value.year}-${value.month}-${value.day}`,
    );
  }
  const converted = new NepaliDate(value.year, value.month - 1, value.day);
  const jsDate = converted.toJsDate();
  return [
    jsDate.getFullYear(),
    String(jsDate.getMonth() + 1).padStart(2, '0'),
    String(jsDate.getDate()).padStart(2, '0'),
  ].join('-');
}

export function formatBsDate(value: BsDate, style: 'short' | 'long' = 'short'): string {
  if (!isValidBsDate(value)) throw new BsCalendarError('Invalid BS date');
  const month = BS_MONTHS_EN[value.month - 1]!;
  return style === 'long'
    ? `${value.day} ${month} ${value.year} BS`
    : `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

export function formatBsDateNepali(value: BsDate): string {
  if (!isValidBsDate(value)) throw new BsCalendarError('Invalid BS date');
  return `${BS_MONTHS_NP[value.month - 1]} ${value.day}, ${value.year}`;
}

/** Converts either calendar to a canonical AD `YYYY-MM-DD`. */
export function toAdIso(
  value: string | Date | BsDate,
  calendarSystem: 'AD' | 'BS',
): string {
  if (calendarSystem === 'AD') {
    return toUtcDate(value as string | Date).toISOString().slice(0, 10);
  }
  if (typeof value === 'string' || value instanceof Date) {
    throw new BsCalendarError('BS input must be a { year, month, day } object');
  }
  return bsToAd(value);
}

/** Adds calendar days to a BS date by round-tripping through AD. */
export function addBsDays(value: BsDate, days: number): BsDate {
  const ad = new Date(`${bsToAd(value)}T00:00:00.000Z`);
  ad.setUTCDate(ad.getUTCDate() + days);
  return adToBs(ad);
}

/** Inclusive list of BS dates between two dates (useful for registers). */
export function bsDateRange(start: BsDate, end: BsDate): BsDate[] {
  const startIso = bsToAd(start);
  const endIso = bsToAd(end);
  if (startIso > endIso) throw new BsCalendarError('Start date must be before end date');
  const dates: BsDate[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  const last = new Date(`${endIso}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(adToBs(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
