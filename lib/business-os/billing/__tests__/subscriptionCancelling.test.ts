/**
 * The one home of "is this plan subscription set to end?" (plan payments
 * follow-ups C-3; workplan BUSINESS_OS_PLAN_PAYMENTS_FOLLOWUPS_C3_WORKPLAN.md
 * §2.1; SA Q-4, W-3, W-4).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  cancelSourceOf,
  hasCancelDate,
  isSetToEndThisPeriod,
  latestItemPeriodEnd,
  type CancelPeriodFacts,
} from '@/lib/business-os/billing/subscriptionCancelling';

const PERIOD_END = 1_795_000_000;
const DAY = 86_400;

const facts = (overrides: Partial<CancelPeriodFacts> = {}): CancelPeriodFacts => ({
  cancelAtPeriodEnd: false,
  cancelAt: null,
  periodEnd: PERIOD_END,
  ...overrides,
});

describe('isSetToEndThisPeriod: the stored flag (W-4 table)', () => {
  it.each<[string, Partial<CancelPeriodFacts>, boolean]>([
    ['flag true, no date', { cancelAtPeriodEnd: true }, true],
    ['flag true, `cancel_at` = the period end (in-app, X-2)', { cancelAtPeriodEnd: true, cancelAt: PERIOD_END }, true],
    ['flag true with a LATER `cancel_at` (the flag wins)', { cancelAtPeriodEnd: true, cancelAt: PERIOD_END + 10 * DAY }, true],
    ['`cancel_at` EQUAL to the period end, flag false (dashboard "end of period")', { cancelAt: PERIOD_END }, true],
    ['`cancel_at` before the period end (a custom early date)', { cancelAt: PERIOD_END - 5 * DAY }, true],
    ['`cancel_at` in the past, not yet ended (a race)', { cancelAt: 1_000 }, true],
    ['`cancel_at` one second after the period end', { cancelAt: PERIOD_END + 1 }, false],
    ['`cancel_at` well after the period end (renews once more)', { cancelAt: PERIOD_END + 30 * DAY }, false],
    ['`cancel_at` set, period end null (unknown → will not renew)', { cancelAt: PERIOD_END, periodEnd: null }, true],
    ['`cancel_at` set, period end 0 (treated as unknown)', { cancelAt: PERIOD_END, periodEnd: 0 }, true],
    ['`cancel_at` 0', { cancelAt: 0 }, false],
    ['`cancel_at` negative', { cancelAt: -5 }, false],
    ['`cancel_at` NaN', { cancelAt: Number.NaN }, false],
    ['`cancel_at` Infinity', { cancelAt: Number.POSITIVE_INFINITY }, false],
    ['`cancel_at` undefined', { cancelAt: undefined }, false],
    ['`cancel_at` null, flag false', {}, false],
    ['period end null, no date, flag false', { periodEnd: null }, false],
  ])('%s → %s', (_label, overrides, expected) => {
    expect(isSetToEndThisPeriod(facts(overrides))).toBe(expected);
  });

  it('two items with different ends: the LATEST decides', () => {
    const items = [
      { currentPeriodEnd: PERIOD_END - 10 * DAY },
      { currentPeriodEnd: PERIOD_END },
    ];
    const periodEnd = latestItemPeriodEnd(items);
    expect(periodEnd).toBe(PERIOD_END);
    // Between the two ends: inside the subscription's life → true.
    expect(isSetToEndThisPeriod(facts({ cancelAt: PERIOD_END - 5 * DAY, periodEnd }))).toBe(true);
    expect(isSetToEndThisPeriod(facts({ cancelAt: PERIOD_END + DAY, periodEnd }))).toBe(false);
  });

  it('status-blind by design: a trialing plan set to end at its trial end (the item period end) is true', () => {
    // No status is an input; the callers check ended / status first.
    const trial = { status: 'trialing', ...facts({ cancelAt: PERIOD_END }) };
    expect(isSetToEndThisPeriod(trial)).toBe(true);
  });
});

describe('hasCancelDate: fresh readers, any date counts (SA Q-6)', () => {
  it.each<[string, { cancelAtPeriodEnd: boolean; cancelAt?: number | null }, boolean]>([
    ['flag true', { cancelAtPeriodEnd: true }, true],
    ['`cancel_at` set', { cancelAtPeriodEnd: false, cancelAt: PERIOD_END }, true],
    ['`cancel_at` AFTER any period (still a date)', { cancelAtPeriodEnd: false, cancelAt: PERIOD_END + 30 * DAY }, true],
    ['`cancel_at` 0', { cancelAtPeriodEnd: false, cancelAt: 0 }, false],
    ['`cancel_at` null', { cancelAtPeriodEnd: false, cancelAt: null }, false],
    ['`cancel_at` absent', { cancelAtPeriodEnd: false }, false],
  ])('%s → %s', (_label, input, expected) => {
    expect(hasCancelDate(input)).toBe(expected);
  });
});

describe('cancelSourceOf: for the mirror log', () => {
  it.each<[Partial<CancelPeriodFacts>, string | null]>([
    [{ cancelAtPeriodEnd: true, cancelAt: PERIOD_END }, 'flag'],
    [{ cancelAt: PERIOD_END }, 'cancel_at'],
    [{ cancelAt: PERIOD_END + DAY }, 'cancel_at_after_period'],
    [{}, null],
    [{ cancelAt: 0 }, null],
  ])('%o → %s', (overrides, expected) => {
    expect(cancelSourceOf(facts(overrides))).toBe(expected);
  });
});

describe('latestItemPeriodEnd', () => {
  it('the latest non-null end; null when none', () => {
    expect(latestItemPeriodEnd([])).toBeNull();
    expect(latestItemPeriodEnd([{ currentPeriodEnd: null }])).toBeNull();
    expect(latestItemPeriodEnd([{ currentPeriodEnd: 5 }, { currentPeriodEnd: null }, { currentPeriodEnd: 9 }])).toBe(9);
  });
});

describe('the module', () => {
  it('imports nothing (pure; keeps planReconcilePass "pure given its ports", SA W-1)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/business-os/billing/subscriptionCancelling.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
