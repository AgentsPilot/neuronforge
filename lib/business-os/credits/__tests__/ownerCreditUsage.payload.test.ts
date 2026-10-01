/**
 * FR-28 / AC-21 / AC-37 — what the owner card's payload may carry (credit
 * deduction slice 6a, SA Q-3).
 *
 * The exact key set, recursively, for every shape the payload can take; then a
 * banned-word scan over every key: no tokens, dollars, cost, price, model,
 * "pilot", fallback, account id — and no `ai` as a word segment (the name must
 * not say "AI", BD-15). `ai` is matched as a camelCase / snake_case SEGMENT, so
 * `remaining` and `trial_total` pass while `aiCredits` would not.
 */

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshot: async () => ({ resolution: null, unavailable: true, stale: false }) }),
}));

import { readOwnerCreditUsage, type OwnerCreditUsageDeps } from '../ownerCreditUsage';
import type { OwnerCreditAllowance } from '../ownerCreditUsageTypes';

const USER = '11111111-1111-4111-8111-111111111111';
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';

const EXPECTED_KEYS = [
  'allowance',
  'allowance.amount',
  'allowance.per',
  'granted',
  'period',
  'period.kind',
  'period.resetsOn',
  'remaining',
  'used',
  'usedAutomatic',
  'usedByOwner',
];

const BANNED_SUBSTRING = /token|usd|cost|dollar|price|model|pilot|fallback|user_?id|account/i;
const AI_SEGMENT = /(^|_)ai($|_|[A-Z])|[a-z]Ai($|[A-Z_])/;

function keysOf(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const here = prefix ? `${prefix}.${key}` : key;
    return [here, ...keysOf(child, here)];
  });
}

function deps(allowance: OwnerCreditAllowance | null, anchor: string | null): OwnerCreditUsageDeps {
  const row = {
    period_start: ANCHOR,
    credits_total: '5.000000',
    credits_owner: '3.000000',
    credits_scheduled: '2.000000',
    credits_external: '0',
    credits_adjustment: '0',
  };
  return {
    findPeriodAnchor: async () => ({ data: anchor, error: null }),
    periodStartFor: async () => ({ data: ANCHOR, error: null }),
    owner: {
      findTotalsForPeriod: async () => ({ data: row, error: null }),
      listTotalsFrom: async () => ({ data: { rows: [row], reachedCeiling: false }, error: null }),
      listAdjustmentsForPeriods: async () => ({ data: { rows: [], reachedCeiling: false }, error: null }),
      findChargesByActionIds: async () => ({ data: [], error: null }),
    },
    now: () => new Date('2026-09-30T12:00:00.000Z'),
    readAllowance: async () => allowance,
  };
}

const log = { warn: jest.fn(), error: jest.fn() };

describe('the banned-word rules (proved on planted keys first)', () => {
  it.each(['aiCredits', 'ai_used', 'usedAi', 'ai', 'tokensUsed', 'costUsd', 'pilotCredits', 'modelName', 'isFallbackPriced', 'userId', 'user_id', 'accountId'])(
    'rejects %s',
    (key) => {
      expect(BANNED_SUBSTRING.test(key) || AI_SEGMENT.test(key)).toBe(true);
    }
  );

  it.each(['remaining', 'trial_total', 'details', 'maintained', 'gained'])('passes %s', (key) => {
    expect(BANNED_SUBSTRING.test(key) || AI_SEGMENT.test(key)).toBe(false);
  });
});

describe.each([
  ['a monthly plan', { amount: 32250, per: 'month' } as OwnerCreditAllowance, ANCHOR, EXPECTED_KEYS],
  ['a trial', { amount: 2000, per: 'total' } as OwnerCreditAllowance, ANCHOR, EXPECTED_KEYS],
  // No allowance: `allowance` is null, so its two children are absent.
  ['no allowance', null, ANCHOR, EXPECTED_KEYS.filter((k) => !k.startsWith('allowance.'))],
  ['no plan row', null, null, EXPECTED_KEYS.filter((k) => !k.startsWith('allowance.'))],
])('the payload for %s', (_name, allowance, anchor, expected) => {
  it('has exactly the allowed keys', async () => {
    const result = await readOwnerCreditUsage(USER, deps(allowance, anchor), log);
    expect(keysOf(result.data).sort()).toEqual([...expected].sort());
  });

  it('no key names tokens, dollars, cost, model, pilot, fallback, an account or "ai"', async () => {
    const result = await readOwnerCreditUsage(USER, deps(allowance, anchor), log);
    const offenders = keysOf(result.data)
      .flatMap((path) => path.split('.'))
      .filter((key) => BANNED_SUBSTRING.test(key) || AI_SEGMENT.test(key));
    expect(offenders).toEqual([]);
  });

  it('carries no value that is the account id', async () => {
    const result = await readOwnerCreditUsage(USER, deps(allowance, anchor), log);
    expect(JSON.stringify(result.data)).not.toContain(USER);
  });
});
