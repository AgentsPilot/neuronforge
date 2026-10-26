/**
 * Business OS credits boost, slice 1: the computed retail (base) rate
 * (requirement §8.1, FR-42, SA T-3a; workplan T-H1, T-F1, T-F2).
 */

import { baseCreditsFor, currentRetailRate, retailRateFor, type RetailRate } from '@/lib/business-os/entitlements/retailRate';
import { CREDIT_RETAIL_HISTORY, type CreditRetailVersion } from '@/lib/business-os/entitlements/config/creditRetail';
import { currentCreditValue, type CreditValueVersion } from '@/lib/business-os/entitlements/config/creditValue';

const VALUE_V1: CreditValueVersion = {
  version: 1,
  usdPerCredit: 0.001,
  status: 'derived',
  matrixVersion: 2,
  decidedOn: '2026-09-30',
  derivation: 'planted',
};

const retail = (markup: number, creditValueVersion = 1, version = 1): CreditRetailVersion => ({
  version,
  markup,
  creditValueVersion,
  decidedOn: '2026-10-04',
  derivation: 'planted',
});

describe('the current rate (T-H1)', () => {
  it('is 200 credits per US dollar, computed from credit value v1 and retail v2 (decision D5, 2026-10-25)', () => {
    expect(currentRetailRate()).toEqual({ ok: true, rate: { retailVersion: 2, creditValueVersion: 1, creditsPerUsd: 200 } });
  });

  it('buys one Essentials month for $10 (D5: Starter = 2,000 credits)', () => {
    const result = currentRetailRate();
    if (!result.ok) throw new Error(result.issue);
    expect(baseCreditsFor(1000, 'USD', result.rate)).toBe(2000);
  });

  it('retail v1 still computes 500 per dollar: the rate the old Essentials 19,750 was derived at (history, pricing doc §3.1)', () => {
    const result = retailRateFor(CREDIT_RETAIL_HISTORY[0], currentCreditValue());
    if (!result.ok) throw new Error(result.issue);
    expect(result.rate).toEqual({ retailVersion: 1, creditValueVersion: 1, creditsPerUsd: 500 });
    expect(baseCreditsFor(3950, 'USD', result.rate)).toBe(19750);
  });
});

describe('retailRateFor refuses what nobody decided', () => {
  it('a markup that gives a fractional rate (T-F1)', () => {
    const result = retailRateFor(retail(0.5), VALUE_V1); // 666.67 per dollar
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toMatch(/whole number/);
  });

  it('a markup paired with another credit value version (T-F2)', () => {
    const result = retailRateFor(retail(1, 0), VALUE_V1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toMatch(/credit value version 0/);
  });

  it('a negative or non-finite markup, and a non-positive credit value', () => {
    expect(retailRateFor(retail(-1), VALUE_V1).ok).toBe(false);
    expect(retailRateFor(retail(Number.NaN), VALUE_V1).ok).toBe(false);
    expect(retailRateFor(retail(1), { ...VALUE_V1, usdPerCredit: 0 }).ok).toBe(false);
  });

  it('follows the inputs: markup 1.5 gives 400 per dollar', () => {
    expect(retailRateFor(retail(1.5, 1, 2), VALUE_V1)).toEqual({
      ok: true,
      rate: { retailVersion: 2, creditValueVersion: 1, creditsPerUsd: 400 },
    });
  });
});

describe('baseCreditsFor', () => {
  const rate: RetailRate = { retailVersion: 1, creditValueVersion: 1, creditsPerUsd: 500 };

  it('converts minor units exactly', () => {
    expect(baseCreditsFor(1000, 'USD', rate)).toBe(5000);
    expect(baseCreditsFor(1, 'USD', rate)).toBe(5);
  });

  it('refuses a price that is not a positive whole number of minor units', () => {
    for (const price of [0, -100, 10.5, Number.NaN]) expect(baseCreditsFor(price, 'USD', rate)).toBeNull();
  });

  it('refuses a price that does not convert to whole credits', () => {
    expect(baseCreditsFor(1, 'USD', { ...rate, creditsPerUsd: 666 })).toBeNull();
  });

  it('refuses any currency but USD: there is no exchange rate (FR-28)', () => {
    expect(baseCreditsFor(1000, 'EUR', rate)).toBeNull();
    expect(baseCreditsFor(1000, 'JPY', rate)).toBeNull();
  });

  it('accepts only the exact literal USD, as the catalogue schema does (QA I-2)', () => {
    expect(baseCreditsFor(1000, 'usd', rate)).toBeNull();
    expect(baseCreditsFor(1000, ' USD ', rate)).toBeNull();
  });

  it('converts odd prices exactly (QA R-3)', () => {
    expect(baseCreditsFor(999, 'USD', rate)).toBe(4995);
    expect(baseCreditsFor(1, 'USD', rate)).toBe(5);
    expect(baseCreditsFor(1001, 'USD', rate)).toBe(5005);
  });
});
