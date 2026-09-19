/**
 * FreeTierGrantService — the once-only, race-safe free-tier grant (S-6 fix).
 *
 * Workplan §6.2 (S1–S14) plus the SA additions (S3b, S7b, S7c, S7d, S13b, and
 * S8 rewritten for RC-1). The ledger cases (S15, S16) are gone with the ledger
 * row itself: check C2 (2026-09-20) showed `credit_transactions` does not allow
 * `activity_type = 'free_tier_grant'`. Every repository is mocked; nothing touches the DB.
 */

import {
  FreeTierGrantService,
  FreeTierConfigError,
  MAX_GRANT_ATTEMPTS,
  parseFreeTierConfig,
} from '@/lib/services/FreeTierGrantService';
import type { Logger } from '@/lib/logger';
import type { UserSubscriptionGrantState } from '@/lib/repositories/types';
import { readFileSync } from 'fs';
import { join } from 'path';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-19T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const RAW = 208340;

const CONFIG_ROWS = [
  { key: 'free_tier_pilot_tokens', value: 20834 },
  { key: 'free_tier_storage_mb', value: 1000 },
  { key: 'free_tier_executions', value: 50 },
  { key: 'free_tier_duration_days', value: 30 },
];

function makeLogger() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return logger as typeof logger & Logger;
}

function row(overrides: Partial<UserSubscriptionGrantState> = {}): UserSubscriptionGrantState {
  return {
    user_id: USER,
    balance: 100,
    total_earned: 300,
    storage_quota_mb: 500,
    executions_quota: 10,
    account_frozen: false,
    free_tier_granted_at: null,
    ...overrides,
  };
}

function setup(opts: { configRows?: Array<{ key: string; value: unknown }>; rawTokens?: number } = {}) {
  const configRepository = {
    getByKeys: jest.fn().mockResolvedValue({ data: opts.configRows ?? CONFIG_ROWS, error: null }),
  };
  const subscriptionRepository = {
    findGrantStateByUserId: jest.fn(),
    insertFreeTierRow: jest.fn(),
    applyFreeTierGrant: jest.fn(),
  };
  const toRawTokens = jest.fn().mockResolvedValue(opts.rawTokens ?? RAW);
  const service = new FreeTierGrantService({
    configRepository: configRepository as never,
    subscriptionRepository: subscriptionRepository as never,
    toRawTokens,
    now: () => NOW,
  });
  const logger = makeLogger();
  return { service, configRepository, subscriptionRepository, toRawTokens, logger };
}

const noRow = { data: null, error: null };
const withRow = (r: UserSubscriptionGrantState) => ({ data: r, error: null });

describe('FreeTierGrantService.grant', () => {
  it('S1: no row → plain insert with the new-row values → GRANTED', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(noRow);
    t.subscriptionRepository.insertFreeTierRow.mockResolvedValue({ data: { inserted: true, conflict: false }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(res).toEqual({
      status: 'GRANTED',
      path: 'insert',
      attempts: 1,
      allocation: { pilot_tokens: 20834, raw_tokens: RAW, storage_mb: 1000, executions: 50 },
    });
    expect(t.subscriptionRepository.insertFreeTierRow).toHaveBeenCalledWith(USER, {
      rawTokens: RAW,
      storageMb: 1000,
      executionsQuota: 50,
      grantedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    });
    expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
  });

  it('S2: already granted → ALREADY_GRANTED, no config read, no insert or update (RC-7)', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row({ free_tier_granted_at: '2026-01-01T00:00:00Z' })));

    const res = await t.service.grant(USER, t.logger);

    expect(res).toEqual({ status: 'ALREADY_GRANTED', attempts: 1 });
    expect(t.subscriptionRepository.findGrantStateByUserId).toHaveBeenCalledTimes(1);
    expect(t.configRepository.getByKeys).not.toHaveBeenCalled();
    expect(t.toRawTokens).not.toHaveBeenCalled();
    expect(t.subscriptionRepository.insertFreeTierRow).not.toHaveBeenCalled();
    expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
  });

  it('S3: insert → 23505 → re-read shows granted → ALREADY_GRANTED, no update', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId
      .mockResolvedValueOnce(noRow)
      .mockResolvedValueOnce(withRow(row({ free_tier_granted_at: NOW.toISOString() })));
    t.subscriptionRepository.insertFreeTierRow.mockResolvedValue({ data: { inserted: false, conflict: true }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(res).toEqual({ status: 'ALREADY_GRANTED', attempts: 2 });
    expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
  });

  it('S3b: insert → 23505 → re-read finds an ungranted row (created concurrently) → update path → GRANTED', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId
      .mockResolvedValueOnce(noRow)
      .mockResolvedValueOnce(withRow(row({ balance: 0, total_earned: 0 })));
    t.subscriptionRepository.insertFreeTierRow.mockResolvedValue({ data: { inserted: false, conflict: true }, error: null });
    t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(res).toMatchObject({ status: 'GRANTED', path: 'update', attempts: 2 });
    expect(t.configRepository.getByKeys).toHaveBeenCalledTimes(1); // loaded once across attempts
  });

  it('S4: existing ungranted row → conditional update with cumulative totals and no forbidden keys', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row()));
    t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(res).toMatchObject({ status: 'GRANTED', path: 'update', attempts: 1 });
    const [uid, expected, patch] = t.subscriptionRepository.applyFreeTierGrant.mock.calls[0];
    expect(uid).toBe(USER);
    expect(expected).toBe(100);
    expect(patch.balance).toBe(100 + RAW);
    expect(patch.total_earned).toBe(300 + RAW);
    expect(patch.free_tier_initial_amount).toBe(RAW);
    expect(patch.free_tier_granted_at).toBe(NOW.toISOString());
    for (const k of ['account_frozen', 'status', 'user_id', 'id', 'storage_used_mb', 'executions_used']) {
      expect(patch).not.toHaveProperty(k);
    }
  });

  it('S5: update matches 0 rows, re-read shows granted (lost race) → ALREADY_GRANTED after one update', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId
      .mockResolvedValueOnce(withRow(row()))
      .mockResolvedValueOnce(withRow(row({ free_tier_granted_at: NOW.toISOString() })));
    t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: false }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(res).toEqual({ status: 'ALREADY_GRANTED', attempts: 2 });
    expect(t.subscriptionRepository.applyFreeTierGrant).toHaveBeenCalledTimes(1);
  });

  it('S6: balance moved → retry uses the fresh balance → GRANTED', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId
      .mockResolvedValueOnce(withRow(row({ balance: 100 })))
      .mockResolvedValueOnce(withRow(row({ balance: 40 })));
    t.subscriptionRepository.applyFreeTierGrant
      .mockResolvedValueOnce({ data: { updated: false }, error: null })
      .mockResolvedValueOnce({ data: { updated: true }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(res).toMatchObject({ status: 'GRANTED', attempts: 2 });
    expect(t.subscriptionRepository.applyFreeTierGrant.mock.calls[1][1]).toBe(40);
    expect(t.subscriptionRepository.applyFreeTierGrant.mock.calls[1][2].balance).toBe(40 + RAW);
  });

  it('S7 / S7c: balance keeps moving → RETRY_EXHAUSTED after 3 attempts, logged at error (RC-3)', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row()));
    t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: false }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(MAX_GRANT_ATTEMPTS).toBe(3);
    expect(res).toEqual({ status: 'RETRY_EXHAUSTED', attempts: 3 });
    expect(t.subscriptionRepository.applyFreeTierGrant).toHaveBeenCalledTimes(3);
    expect(t.logger.error).toHaveBeenCalledWith({ attempts: 3 }, expect.stringMatching(/retries exhausted/));
  });

  it('S7b: insert keeps returning 23505 with no row visible → RETRY_EXHAUSTED after 3, not an endless loop (RC-2)', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(noRow);
    t.subscriptionRepository.insertFreeTierRow.mockResolvedValue({ data: { inserted: false, conflict: true }, error: null });

    const res = await t.service.grant(USER, t.logger);

    expect(res).toEqual({ status: 'RETRY_EXHAUSTED', attempts: 3 });
    expect(t.subscriptionRepository.insertFreeTierRow).toHaveBeenCalledTimes(3);
  });

  it('S7d (RF-1): insert returns neither inserted nor conflict → throws, no retry, no update', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(noRow);
    t.subscriptionRepository.insertFreeTierRow.mockResolvedValue({ data: { inserted: false, conflict: false }, error: null });

    await expect(t.service.grant(USER, t.logger)).rejects.toThrow('Free-tier insert returned no row and no conflict');
    expect(t.subscriptionRepository.insertFreeTierRow).toHaveBeenCalledTimes(1);
    expect(t.subscriptionRepository.findGrantStateByUserId).toHaveBeenCalledTimes(1);
    expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
  });

  it('S8 (RC-1): frozen row that was never granted → INELIGIBLE_FROZEN, no write', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row({ account_frozen: true })));

    const res = await t.service.grant(USER, t.logger);

    expect(res).toEqual({ status: 'INELIGIBLE_FROZEN', attempts: 1 });
    // RC-7 / SA F-5: the frozen path costs one SELECT; config and pricing are never read.
    expect(t.configRepository.getByKeys).not.toHaveBeenCalled();
    expect(t.toRawTokens).not.toHaveBeenCalled();
    expect(t.subscriptionRepository.insertFreeTierRow).not.toHaveBeenCalled();
    expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
    expect(t.logger.warn).toHaveBeenCalled();
  });

  it('RC-1: an account frozen between our read and our write ends INELIGIBLE_FROZEN on the re-read', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId
      .mockResolvedValueOnce(withRow(row()))
      .mockResolvedValueOnce(withRow(row({ account_frozen: true })));
    t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: false }, error: null });

    const res = await t.service.grant(USER, t.logger);
    expect(res).toEqual({ status: 'INELIGIBLE_FROZEN', attempts: 2 });
  });

  it('S9: cron-frozen and already granted → ALREADY_GRANTED, no write (stays frozen)', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(
      withRow(row({ account_frozen: true, balance: 0, free_tier_granted_at: '2026-01-01T00:00:00Z' }))
    );

    const res = await t.service.grant(USER, t.logger);

    expect(res).toEqual({ status: 'ALREADY_GRANTED', attempts: 1 });
    expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
    expect(t.subscriptionRepository.insertFreeTierRow).not.toHaveBeenCalled();
  });

  describe('S10: quotas are never lowered', () => {
    it.each([
      ['storage above config is kept', { storage_quota_mb: 5000 }, { storage: 5000 }],
      ['storage below config is raised', { storage_quota_mb: 10 }, { storage: 1000 }],
      ['unlimited executions stay unlimited', { executions_quota: null }, { executions: null }],
      ['executions below config are raised', { executions_quota: 10 }, { executions: 50 }],
      ['executions above config are kept', { executions_quota: 999 }, { executions: 999 }],
    ])('%s', async (_label, overrides, expected) => {
      const t = setup();
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row(overrides)));
      t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });

      const res = await t.service.grant(USER, t.logger);
      const patch = t.subscriptionRepository.applyFreeTierGrant.mock.calls[0][2];

      if ('storage' in expected) expect(patch.storage_quota_mb).toBe(expected.storage);
      if ('executions' in expected) expect(patch.executions_quota).toBe(expected.executions);
      // The response reports the effective values written.
      expect(res).toMatchObject({ allocation: { storage_mb: patch.storage_quota_mb, executions: patch.executions_quota } });
    });

    it('config executions null (unlimited) → null', async () => {
      const t = setup({ configRows: [...CONFIG_ROWS.slice(0, 2), { key: 'free_tier_executions', value: null }, CONFIG_ROWS[3]] });
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row({ executions_quota: 10 })));
      t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });
      await t.service.grant(USER, t.logger);
      expect(t.subscriptionRepository.applyFreeTierGrant.mock.calls[0][2].executions_quota).toBeNull();
    });
  });

  describe('S11: expiry only on rows that held no credits (Q3 (a))', () => {
    it('balance 0 and total_earned 0 → free_tier_expires_at set', async () => {
      const t = setup();
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row({ balance: 0, total_earned: 0 })));
      t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });
      await t.service.grant(USER, t.logger);
      expect(t.subscriptionRepository.applyFreeTierGrant.mock.calls[0][2].free_tier_expires_at).toBe(
        new Date(NOW.getTime() + 30 * DAY).toISOString()
      );
    });

    it('null balance and null total_earned count as 0 → expiry set', async () => {
      const t = setup();
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row({ balance: null, total_earned: null })));
      t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });
      await t.service.grant(USER, t.logger);
      expect(t.subscriptionRepository.applyFreeTierGrant.mock.calls[0][2]).toHaveProperty('free_tier_expires_at');
    });

    it.each([
      ['prior balance', { balance: 5, total_earned: 5 }],
      ['spent down to 0 after buying', { balance: 0, total_earned: 500 }],
    ])('%s → no expiry key', async (_l, overrides) => {
      const t = setup();
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row(overrides)));
      t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });
      await t.service.grant(USER, t.logger);
      expect(t.subscriptionRepository.applyFreeTierGrant.mock.calls[0][2]).not.toHaveProperty('free_tier_expires_at');
    });
  });

  it('S12: null existing balance → update uses expectedBalance null', async () => {
    const t = setup();
    t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row({ balance: null })));
    t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: { updated: true }, error: null });
    await t.service.grant(USER, t.logger);
    const [, expected, patch] = t.subscriptionRepository.applyFreeTierGrant.mock.calls[0];
    expect(expected).toBeNull();
    expect(patch.balance).toBe(RAW);
  });

  describe('S13 / S13b: configuration', () => {
    it('missing keys → today\'s defaults (20834 / 1000 / 0 / 30)', () => {
      expect(parseFreeTierConfig([])).toEqual({ pilotTokens: 20834, storageMb: 1000, executions: 0, durationDays: 30 });
    });

    it('string values are parsed as before', () => {
      expect(parseFreeTierConfig([
        { key: 'free_tier_pilot_tokens', value: '100' },
        { key: 'free_tier_storage_mb', value: '200' },
        { key: 'free_tier_executions', value: null },
        { key: 'free_tier_duration_days', value: '7' },
      ])).toEqual({ pilotTokens: 100, storageMb: 200, executions: null, durationDays: 7 });
    });

    it.each([
      ['negative storage', { key: 'free_tier_storage_mb', value: -1 }],
      ['NaN pilot tokens', { key: 'free_tier_pilot_tokens', value: 'abc' }],
      ['zero duration', { key: 'free_tier_duration_days', value: 0 }],
    ])('invalid value (%s) → throws, no write', async (_l, bad) => {
      const t = setup({ configRows: [...CONFIG_ROWS.filter((r) => r.key !== bad.key), bad] });
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(noRow);

      await expect(t.service.grant(USER, t.logger)).rejects.toBeInstanceOf(FreeTierConfigError);
      expect(t.subscriptionRepository.insertFreeTierRow).not.toHaveBeenCalled();
      expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
    });

    it.each([[0], [-5], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'S13b: raw token amount %p → throws, no write (Q8)',
      async (raw) => {
        const t = setup({ rawTokens: raw });
        t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row()));
        await expect(t.service.grant(USER, t.logger)).rejects.toBeInstanceOf(FreeTierConfigError);
        expect(t.subscriptionRepository.insertFreeTierRow).not.toHaveBeenCalled();
        expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
      }
    );

    it('config read error → throws, no write', async () => {
      const t = setup();
      t.configRepository.getByKeys.mockResolvedValue({ data: null, error: new Error('db down') });
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(noRow);
      await expect(t.service.grant(USER, t.logger)).rejects.toThrow('Failed to load free-tier configuration');
      expect(t.subscriptionRepository.insertFreeTierRow).not.toHaveBeenCalled();
    });
  });

  describe('S14: repository errors fail closed', () => {
    it('read error (incl. duplicate rows) → throws, no write', async () => {
      const t = setup();
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue({ data: null, error: new Error('multiple rows') });
      await expect(t.service.grant(USER, t.logger)).rejects.toThrow('Failed to read subscription grant state');
      expect(t.subscriptionRepository.insertFreeTierRow).not.toHaveBeenCalled();
      expect(t.subscriptionRepository.applyFreeTierGrant).not.toHaveBeenCalled();
    });

    it('insert error (not a conflict) → throws', async () => {
      const t = setup();
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(noRow);
      t.subscriptionRepository.insertFreeTierRow.mockResolvedValue({ data: null, error: new Error('boom') });
      await expect(t.service.grant(USER, t.logger)).rejects.toThrow('Failed to insert');
    });

    it('update error → throws', async () => {
      const t = setup();
      t.subscriptionRepository.findGrantStateByUserId.mockResolvedValue(withRow(row()));
      t.subscriptionRepository.applyFreeTierGrant.mockResolvedValue({ data: null, error: new Error('boom') });
      await expect(t.service.grant(USER, t.logger)).rejects.toThrow('Failed to apply');
    });
  });

  it('writes no credit_transactions ledger row (C2, 2026-09-20)', () => {
    // `credit_transactions_activity_type_check` does not allow 'free_tier_grant', and
    // 'welcome_bonus' / 'reward_credit' must never be reused (the Stripe webhook reads both).
    // The grant stays traceable via free_tier_granted_at / free_tier_initial_amount and the
    // FREE_TIER_ALLOCATED audit entry. Re-adding a ledger write needs the migration in §8.1 F-4.
    const source: string = readFileSync(join(__dirname, '..', 'FreeTierGrantService.ts'), 'utf8');
    expect(source).not.toMatch(/CreditTransactionRepository|createFreeTierGrantEntry|SHIP_FREE_TIER_LEDGER_ROW/);
    expect(source).not.toMatch(/from\(['"]credit_transactions['"]\)/);
  });
});
