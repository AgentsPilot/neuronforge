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

import type { OwnerCreditLotRow } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { readOwnerCreditUsage, type OwnerCreditCardDeps } from '../ownerCreditUsage';
import type { OwnerCreditAllowance } from '../ownerCreditUsageTypes';

const USER = '11111111-1111-4111-8111-111111111111';
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';

/**
 * Slice 11d (S11-AC-7): a lot carrying everything the owner must never see.
 * The owner repository could not even select these columns; the fake hands
 * them over anyway, to prove the builder passes on nothing but the figure.
 */
const LOT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REASON = 'Goodwill after the outage, ticket 4471';
const ADMIN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LEAKY_LOT = {
  id: LOT_ID,
  creditsGranted: 200,
  expiresAt: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  draws: [],
  reason: REASON,
  actorAdminId: ADMIN_ID,
  idempotencyKey: `admin_grant:${LOT_ID}`,
  source: 'admin_grant',
  sourceRef: LOT_ID,
  creditsBase: 200,
  creditsBonus: 0,
  creditValueVersion: 3,
} as unknown as OwnerCreditLotRow;

const EXPECTED_KEYS = [
  'allowance',
  'allowance.amount',
  'allowance.per',
  'extraCredits',
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

function deps(
  allowance: OwnerCreditAllowance | null,
  anchor: string | null,
  lots: OwnerCreditLotRow[] = [LEAKY_LOT]
): OwnerCreditCardDeps {
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
      listOwnCreditLots: async () => ({ data: lots, error: null }),
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

  it('no key names a reason, an actor, an admin, a key, a source, a lot, the base / bonus split or a version (S11-AC-7)', async () => {
    const result = await readOwnerCreditUsage(USER, deps(allowance, anchor), log);
    const offenders = keysOf(result.data)
      .flatMap((path) => path.split('.'))
      .filter(isLotDetailKey);
    expect(offenders).toEqual([]);
  });

  it('carries the extra figure only: no lot id, reason, admin, key or source value (S11-D-4 A)', async () => {
    const result = await readOwnerCreditUsage(USER, deps(allowance, anchor), log);
    expect(result.data!.extraCredits).toBe(200);
    const text = JSON.stringify(result.data);
    for (const value of [LOT_ID, REASON, ADMIN_ID, 'admin_grant', USER]) expect(text).not.toContain(value);
  });

  it('has the same key set with no lots (extraCredits: 0)', async () => {
    const result = await readOwnerCreditUsage(USER, deps(allowance, anchor, []), log);
    expect(result.data!.extraCredits).toBe(0);
    expect(keysOf(result.data).sort()).toEqual([...expected].sort());
  });
});

/** Slice 11d: the key segments that name lot detail (a Set, matched whole). */
const LOT_DETAIL_SEGMENTS = new Set(['reason', 'actor', 'admin', 'source', 'lot', 'lots', 'base', 'bonus', 'version']);

/** Slice 11d: a key segment naming lot detail (camelCase / snake_case segments). */
function isLotDetailKey(key: string): boolean {
  const segments = key.split(/_|(?=[A-Z])/).map((s) => s.toLowerCase()).filter(Boolean);
  return segments.some((s) => LOT_DETAIL_SEGMENTS.has(s) || s.startsWith('idempot'));
}

describe('the S11-AC-7 rule (proved on planted keys first)', () => {
  it.each([
    'reason',
    'actorAdminId',
    'admin_note',
    'idempotencyKey',
    'idempotency_key',
    'source',
    'sourceRef',
    'lotId',
    'lots',
    'creditsBase',
    'credits_bonus',
    'creditValueVersion',
    // A combined total under a lot name is caught too.
    'planAndLotsTotal',
  ])('rejects %s', (key) => {
    expect(isLotDetailKey(key)).toBe(true);
  });

  it.each(['allowance', 'remaining', 'extraCredits', 'resetsOn', 'used', 'usedByOwner', 'usedAutomatic', 'period', 'kind', 'amount', 'per'])(
    'passes %s',
    (key) => {
      expect(isLotDetailKey(key)).toBe(false);
    }
  );
});

describe('no combined total (G11d-1, R-5 (c))', () => {
  it.each(['granted', 'total', 'combined', 'balance'])('the payload has no %s key', async (word) => {
    const result = await readOwnerCreditUsage(USER, deps({ amount: 32250, per: 'month' }, ANCHOR), log);
    const segments = keysOf(result.data).flatMap((path) => path.split('.'));
    expect(segments.filter((k) => k.toLowerCase().includes(word))).toEqual([]);
  });
});
