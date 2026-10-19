/**
 * `describeCapabilityAmount` — the bare figure a comparison cell prints
 * (upgrade modal UM-0, SA Q-3).
 *
 * The rule worth pinning is the refusal: only a monthly rate or an included
 * count becomes a bare number. A one-off total must stay `null`, so the caller
 * falls back to the full "… in total" wording rather than printing a figure that
 * reads like a monthly one.
 */

import { describeCapabilityAmount, describeCapabilityValue } from '@/lib/business-os/entitlements/capabilityDisplay';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

const catalog = readCodeConfig().catalog as Record<string, CapabilityDef>;
const format = (locale: string, n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);

describe('describeCapabilityAmount', () => {
  it('a monthly rate is its bare figure, grouped in the reader\'s language', () => {
    for (const locale of ['en', 'he', 'es'] as const) {
      expect(describeCapabilityAmount({ perMonth: 19750 }, locale)).toBe(format(locale, 19750));
    }
    // CLDR: Spanish groups five digits with a dot; English with a comma.
    expect(describeCapabilityAmount({ perMonth: 19750 }, 'es')).toBe('19.750');
    expect(describeCapabilityAmount({ perMonth: 19750 }, 'en')).toBe('19,750');
  });

  it('a fair-use ceiling and an included quantity are their bare figures too', () => {
    expect(describeCapabilityAmount({ ceilingPerMonth: 10000 }, 'en')).toBe('10,000');
    expect(describeCapabilityAmount({ included: 1, purchasable: false }, 'en')).toBe('1');
    expect(describeCapabilityAmount({ included: 5, purchasable: true }, 'en')).toBe('5');
  });

  it('a one-off total is null, so the caller keeps the full wording', () => {
    expect(describeCapabilityAmount({ total: 2000 }, 'en')).toBeNull();
    // And the fallback the caller uses says what it is.
    expect(describeCapabilityValue({ total: 2000 }, catalog['credits.allowance'], 'en')).toMatch(/in total/);
  });

  it('a boolean, a variant or an add-on state has no amount', () => {
    for (const value of [true, false, 'priority', 'unavailable', 'included']) {
      expect(describeCapabilityAmount(value, 'en')).toBeNull();
    }
  });

  it('defaults to English when no locale is given', () => {
    expect(describeCapabilityAmount({ perMonth: 32250 })).toBe('32,250');
  });
});
