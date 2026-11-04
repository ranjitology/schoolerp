import { describe, expect, it } from 'vitest';
import {
  adToBs,
  addBsDays,
  bsDateRange,
  bsToAd,
  BsCalendarError,
  formatBsDate,
  isValidBsDate,
} from '../src/calendar';

describe('BS calendar', () => {
  it('converts known Nepali New Year dates', () => {
    expect(adToBs('2024-04-13')).toEqual({ year: 2081, month: 1, day: 1 });
    expect(adToBs('2025-04-14')).toEqual({ year: 2082, month: 1, day: 1 });
    expect(adToBs('2026-04-14')).toEqual({ year: 2083, month: 1, day: 1 });
  });

  it('round-trips AD → BS → AD', () => {
    for (const date of ['2024-01-01', '2024-12-31', '2027-07-16', '2030-02-28']) {
      expect(bsToAd(adToBs(date))).toBe(date);
    }
  });

  it('formats BS dates', () => {
    expect(formatBsDate({ year: 2081, month: 1, day: 1 })).toBe('2081-01-01');
    expect(formatBsDate({ year: 2081, month: 1, day: 1 }, 'long')).toBe('1 Baisakh 2081 BS');
  });

  it('adds days across month boundaries', () => {
    expect(addBsDays({ year: 2081, month: 12, day: 31 }, 1)).toEqual({
      year: 2082,
      month: 1,
      day: 1,
    });
  });

  it('rejects impossible BS dates', () => {
    expect(isValidBsDate({ year: 2081, month: 13, day: 1 })).toBe(false);
    expect(() => bsToAd({ year: 2081, month: 1, day: 99 })).toThrow(BsCalendarError);
  });

  it('returns inclusive ranges', () => {
    expect(bsDateRange({ year: 2081, month: 1, day: 1 }, { year: 2081, month: 1, day: 3 })).toHaveLength(3);
  });
});
