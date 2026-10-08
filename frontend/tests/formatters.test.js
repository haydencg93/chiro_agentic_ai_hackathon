import { describe, expect, it } from 'vitest';
import { formatCurrency, formatPercent } from '../src/utils/formatters.js';

describe('formatCurrency', () => {
  it('formats whole dollars with a symbol and separators', () => {
    expect(formatCurrency(1240)).toBe('$1,240');
    expect(formatCurrency(84250)).toBe('$84,250');
  });

  it('rounds to whole dollars', () => {
    expect(formatCurrency(12.6)).toBe('$13');
  });

  it('falls back to $0 for missing or invalid values', () => {
    expect(formatCurrency()).toBe('$0');
    expect(formatCurrency(null)).toBe('$0');
    expect(formatCurrency(undefined)).toBe('$0');
    expect(formatCurrency('abc')).toBe('$0');
    expect(formatCurrency(NaN)).toBe('$0');
  });
});

describe('formatPercent', () => {
  it('formats a 0-1 ratio as a whole percent', () => {
    expect(formatPercent(0.84)).toBe('84%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('falls back to 0% for invalid values', () => {
    expect(formatPercent()).toBe('0%');
    expect(formatPercent('nope')).toBe('0%');
  });
});
