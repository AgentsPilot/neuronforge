/**
 * Unit tests for ensureDefaultPaymentRules — the lazy, idempotent, race-safe
 * default-rule seed.
 *
 * Asserts:
 *  - fast path: if the user already has ≥1 rule, no insert is attempted.
 *  - first seed: the 3 defaults are inserted via the race-safe
 *    insertDefaultsIgnoringDuplicates (ON CONFLICT DO NOTHING), not a per-rule create.
 *  - a failed existence check skips the seed (best-effort, never throws).
 */

import {
  ensureDefaultPaymentRules,
  DEFAULT_PAYMENT_RULES,
} from '@/lib/payments/defaultPaymentRules';
import type { PaymentAutomationRuleRepository } from '@/lib/repositories/PaymentAutomationRepository';

function makeRepo(overrides: Partial<Record<'list' | 'insertDefaultsIgnoringDuplicates', jest.Mock>> = {}) {
  const list = overrides.list ?? jest.fn().mockResolvedValue({ data: [], error: null });
  const insertDefaultsIgnoringDuplicates =
    overrides.insertDefaultsIgnoringDuplicates ??
    jest.fn().mockResolvedValue({ data: DEFAULT_PAYMENT_RULES.length, error: null });
  return {
    repo: { list, insertDefaultsIgnoringDuplicates } as unknown as PaymentAutomationRuleRepository,
    list,
    insertDefaultsIgnoringDuplicates,
  };
}

describe('ensureDefaultPaymentRules', () => {
  it('is a no-op when the user already has rules (fast path — no insert)', async () => {
    const { repo, list, insertDefaultsIgnoringDuplicates } = makeRepo({
      list: jest.fn().mockResolvedValue({ data: [{ id: 'rule-existing' }], error: null }),
    });

    await ensureDefaultPaymentRules('u1', repo);

    expect(list).toHaveBeenCalledWith('u1', { limit: 1 });
    expect(insertDefaultsIgnoringDuplicates).not.toHaveBeenCalled();
  });

  it('seeds the 3 defaults via the race-safe ignore-duplicates insert on first emit', async () => {
    const { repo, insertDefaultsIgnoringDuplicates } = makeRepo();

    await ensureDefaultPaymentRules('u1', repo);

    expect(insertDefaultsIgnoringDuplicates).toHaveBeenCalledTimes(1);
    const [userId, rules] = insertDefaultsIgnoringDuplicates.mock.calls[0];
    expect(userId).toBe('u1');
    expect(rules).toHaveLength(DEFAULT_PAYMENT_RULES.length);
    expect(rules.map((r: { name: string }) => r.name)).toEqual(
      DEFAULT_PAYMENT_RULES.map((r) => r.name)
    );
  });

  it('skips the seed (no throw) when the existence check errors', async () => {
    const { repo, insertDefaultsIgnoringDuplicates } = makeRepo({
      list: jest.fn().mockResolvedValue({ data: null, error: new Error('db down') }),
    });

    await expect(ensureDefaultPaymentRules('u1', repo)).resolves.toBeUndefined();
    expect(insertDefaultsIgnoringDuplicates).not.toHaveBeenCalled();
  });
});
