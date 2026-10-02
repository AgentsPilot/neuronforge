/**
 * The one presentation rule for a plan category's line (user decision,
 * 2026-10-02): a category whose ONLY feature is named like its heading prints
 * the value alone, so nobody reads "Credits: Credits (…)". Every other row
 * prints the server's summary untouched.
 */

import { planCategoryLine } from '@/lib/business-os/planCategoryLine';

describe('planCategoryLine', () => {
  it('one feature named like the heading → the value alone', () => {
    expect(
      planCategoryLine('Credits', { features: [{ label: 'Credits', value: '19,750 per month' }], summary: 'Credits (19,750 per month)' })
    ).toBe('19,750 per month');
  });

  it.each([
    ['קרדיטים', 'קרדיטים', '2,000 בסך הכול'],
    ['Créditos', 'Créditos', '2000 en total'],
    // Case, outer spaces and Unicode form are not a different name to a reader.
    ['CREDITS', ' credits ', '19,750 per month'],
    ['Créditos', 'Créditos', '19.750 al mes'],
  ])('heading %s, label %s → the value alone', (heading, label, value) => {
    expect(planCategoryLine(heading, { features: [{ label, value }], summary: `${label} (${value})` })).toBe(value);
  });

  it('a value that is just "yes" leaves nothing to add — the heading says it', () => {
    expect(planCategoryLine('Client documents', { features: [{ label: 'Client documents', value: 'yes' }], summary: 'Client documents' })).toBeNull();
  });

  it('a different name keeps the summary', () => {
    const row = { features: [{ label: 'Email volume', value: '10,000 per month' }], summary: 'Email volume (10,000 per month)' };
    expect(planCategoryLine('Marketing', row)).toBe(row.summary);
  });

  it('more than one feature keeps the summary, even when one is named like the heading', () => {
    const row = {
      features: [
        { label: 'Payments', value: 'yes' },
        { label: 'Invoices', value: 'yes' },
      ],
      summary: 'Payments, Invoices',
    };
    expect(planCategoryLine('Payments', row)).toBe(row.summary);
  });

  it('a payload without features (an older body) keeps the summary', () => {
    expect(planCategoryLine('Credits', { summary: 'Credits (x)' })).toBe('Credits (x)');
  });
});
