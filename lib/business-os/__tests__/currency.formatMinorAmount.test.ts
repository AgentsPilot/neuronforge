/**
 * `formatMinorAmount` (credits boost slice 5a, SA C-1, NFR-9): minor units to a
 * written price through `refundMath`, in the reader's language.
 */

import { formatMinorAmount } from '@/lib/business-os/currency';

const norm = (text: string) => text.replace(/[\s  ‎‏]+/g, ' ').trim();
const intl = (major: number, language: string, digits: number) =>
  norm(
    new Intl.NumberFormat(language, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major)
  );

describe('formatMinorAmount', () => {
  it('English: the three package prices are whole dollars, no decimals', () => {
    expect(formatMinorAmount(1000, 'USD', 'en')).toBe('$10');
    expect(formatMinorAmount(2500, 'USD', 'en')).toBe('$25');
    expect(formatMinorAmount(5000, 'USD', 'en')).toBe('$50');
  });

  it('a fractional amount keeps its cents', () => {
    expect(formatMinorAmount(1250, 'USD', 'en')).toBe('$12.50');
    expect(formatMinorAmount(1999, 'usd', 'en')).toBe('$19.99');
  });

  it.each(['he', 'es', 'en'])('%s: written by Intl for the language, in USD, never converted', (language) => {
    expect(norm(formatMinorAmount(2500, 'USD', language))).toBe(intl(25, language, 0));
    expect(norm(formatMinorAmount(1250, 'USD', language))).toBe(intl(12.5, language, 2));
    // The digits are the price's own, whatever the language.
    expect(formatMinorAmount(5000, 'USD', language)).toMatch(/50/);
  });

  it('follows the currency\'s own minor unit (refundMath), not a typed hundredth', () => {
    expect(norm(formatMinorAmount(1000, 'JPY', 'en'))).toBe(norm(new Intl.NumberFormat('en', { style: 'currency', currency: 'JPY' }).format(1000)));
    expect(norm(formatMinorAmount(1500, 'KWD', 'en'))).toBe(
      norm(new Intl.NumberFormat('en', { style: 'currency', currency: 'KWD', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(1.5))
    );
  });
});

describe('R-6: large values and the Spanish and Hebrew forms', () => {
  it('en: grouping on large amounts, cents kept, whole millions without decimals', () => {
    expect(formatMinorAmount(123456789, 'USD', 'en')).toBe('$1,234,567.89');
    expect(formatMinorAmount(100000000, 'USD', 'en')).toBe('$1,000,000');
    expect(formatMinorAmount(1, 'USD', 'en')).toBe('$0.01');
    expect(formatMinorAmount(999, 'USD', 'en')).toBe('$9.99');
  });

  it('es: US$ after the number, comma decimals, dot grouping', () => {
    expect(norm(formatMinorAmount(1000, 'USD', 'es'))).toBe('10 US$');
    expect(norm(formatMinorAmount(1250, 'USD', 'es'))).toBe('12,50 US$');
    expect(norm(formatMinorAmount(123456789, 'USD', 'es'))).toBe('1.234.567,89 US$');
  });

  it('he: the symbol after the number', () => {
    expect(norm(formatMinorAmount(1000, 'USD', 'he'))).toBe('10 $');
    expect(norm(formatMinorAmount(1250, 'USD', 'he'))).toBe('12.50 $');
    expect(norm(formatMinorAmount(123456789, 'USD', 'he'))).toBe('1,234,567.89 $');
  });
});
