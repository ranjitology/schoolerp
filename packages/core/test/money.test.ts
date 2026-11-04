import { describe, expect, it } from 'vitest';
import {
  allocateMinor,
  currencyFactor,
  formatMoney,
  fromMinor,
  moneyToDecimalString,
  parseMoneyToMinor,
  percentOfMinor,
  sumMinor,
  assertNonNegative,
} from '../src/money';
import { ValidationError } from '../src/errors';

describe('money', () => {
  it('parses decimal strings into minor units without floats', () => {
    expect(parseMoneyToMinor('1234.50')).toBe(123450);
    expect(parseMoneyToMinor('1,234.5')).toBe(123450);
    expect(parseMoneyToMinor('Rs. 1 234')).toBe(123400);
    expect(parseMoneyToMinor('0.05')).toBe(5);
    expect(parseMoneyToMinor('-25.75')).toBe(-2575);
    expect(parseMoneyToMinor(10)).toBe(1000);
    expect(parseMoneyToMinor(0.1)).toBe(10);
  });

  it('supports zero- and three-decimal currencies', () => {
    expect(currencyFactor('JPY')).toBe(1);
    expect(parseMoneyToMinor('100', 'JPY')).toBe(100);
    expect(parseMoneyToMinor('1.234', 'KWD')).toBe(1234);
    expect(fromMinor(1234, 'KWD')).toBe(1.234);
  });

  it('rejects invalid precision and malformed input', () => {
    expect(() => parseMoneyToMinor('10.999')).toThrow(ValidationError);
    expect(() => parseMoneyToMinor('abc')).toThrow(ValidationError);
    expect(() => parseMoneyToMinor(Number.NaN)).toThrow(ValidationError);
  });

  it('formats and serialises exactly', () => {
    expect(moneyToDecimalString(123456)).toBe('1234.56');
    expect(moneyToDecimalString(-5)).toBe('-0.05');
    expect(moneyToDecimalString(100, 'JPY')).toBe('100');
    expect(formatMoney(123456)).toContain('1,234.56');
  });

  it('allocates by largest remainder without losing paisa', () => {
    const parts = allocateMinor(1000, [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(sumMinor(parts)).toBe(1000);
    expect(allocateMinor(0, [2, 5])).toEqual([0, 0]);
    expect(() => allocateMinor(100, [])).toThrow();
    expect(() => allocateMinor(100, [0])).toThrow();
  });

  it('computes basis points with half-up rounding', () => {
    expect(percentOfMinor(1000, 500)).toBe(50);
    expect(percentOfMinor(1001, 500)).toBe(50);
    expect(percentOfMinor(1, 5000)).toBe(1);
    expect(percentOfMinor(999, 1000)).toBe(100);
  });

  it('guards negative amounts where forbidden', () => {
    expect(() => assertNonNegative(-1)).toThrow(ValidationError);
    expect(assertNonNegative(0)).toBeUndefined();
  });
});
