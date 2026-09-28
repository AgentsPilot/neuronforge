/**
 * Splitting a narration into lines, without eating the facts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The stripper was a character class that included the digit escape, so it
 * removed the digits from the front of ANY line.
 *
 * A real briefing on 2026-09-27 was stored correctly as
 *
 *     1 מהן כבר הסתיימו.          ("1 of them are already done")
 *
 * and reached the owner's inbox as
 *
 *     מהן כבר הסתיימו.            ("of them are already done")
 *
 * — a sentence with its subject removed. The same helper feeds the dashboard
 * card, so the count was missing in both places, and the database was right
 * the whole time.
 *
 * A marker is a bullet, or digits followed by a full stop or bracket and a
 * space. A leading figure with nothing after it but a space is the fact the
 * line exists to report.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { briefingLines } from '../briefingLines';

describe('briefingLines', () => {
  describe('strips list markers a model might emit', () => {
    it.each([
      ['- Two people got in touch.', 'Two people got in touch.'],
      ['• Two people got in touch.', 'Two people got in touch.'],
      ['* Two people got in touch.', 'Two people got in touch.'],
      ['1. Two people got in touch.', 'Two people got in touch.'],
      ['2) Two people got in touch.', 'Two people got in touch.'],
      ['  -   padded', 'padded'],
    ])('%s', (input, expected) => {
      expect(briefingLines(input)).toEqual([expected]);
    });
  });

  describe('keeps a number that is the point of the sentence', () => {
    it('keeps the Hebrew count that was lost in production', () => {
      expect(briefingLines('1 מהן כבר הסתיימו.')).toEqual(['1 מהן כבר הסתיימו.']);
    });

    it('keeps a leading figure in English', () => {
      expect(briefingLines('2 invoices are overdue')).toEqual(['2 invoices are overdue']);
    });

    it('keeps a number that is not at the start', () => {
      expect(briefingLines('יש לך 2 פגישות היום.')).toEqual(['יש לך 2 פגישות היום.']);
    });

    it('keeps a money figure', () => {
      expect(briefingLines('4,250 is outstanding')).toEqual(['4,250 is outstanding']);
    });
  });

  describe('the rest of the contract', () => {
    it('splits on newlines and drops blanks', () => {
      expect(briefingLines('one\n\n  \ntwo')).toEqual(['one', 'two']);
    });

    it('returns nothing for an empty narration', () => {
      expect(briefingLines('')).toEqual([]);
    });

    it('handles the real briefing, end to end', () => {
      const stored = [
        'יש לך 2 פגישות היום.',
        '1 מהן כבר הסתיימו.',
        'לקוח אחד מוכן.',
        'דויד המלך עדיין חייב ₪4,250.',
      ].join('\n');

      // Every line survives intact — this is what the owner should have read.
      expect(briefingLines(stored)).toEqual([
        'יש לך 2 פגישות היום.',
        '1 מהן כבר הסתיימו.',
        'לקוח אחד מוכן.',
        'דויד המלך עדיין חייב ₪4,250.',
      ]);
    });
  });
});
