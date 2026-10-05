/**
 * usageSummary.ts — Layer 1.1 FR-23.
 *
 * Proves the module the admin LLM usage report's Check 5 reads. Since credit
 * deduction slice 6a it no longer backs the owner card (which reads the credit
 * ledger), and the Layer 1.1 route characterization suites were retired with
 * the old route; this suite is the admin side's pin.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_TOKENS_PER_CREDIT,
  parseTokensPerCredit,
  readTokensPerCredit,
  readUsageSummary,
  summaryFromRpcRows,
  toCredits,
  type UsageSummaryDeps,
} from '../usageSummary';
import { ConfigRepository } from '@/lib/repositories/ConfigRepository';
import type { LedgerSummaryRow, UsageSummaryRpcRow } from '@/lib/repositories/TokenUsageRepository';
import { createFakeSupabase, type Row } from '@/tests/helpers/fakePostgrest';

const USER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const SINCE = new Date('2026-09-10T00:00:00.000Z');

function warnLog() {
  return { warn: jest.fn() };
}

describe('summaryFromRpcRows', () => {
  it('coerces BIGINT strings and totals from feature rows only', () => {
    const rows: UsageSummaryRpcRow[] = [
      { bucket: 'feature', key: 'business-os-chat', tokens: '9007199254', calls: '12' },
      { bucket: 'feature', key: 'business-os-website', tokens: 5, calls: 1 },
      { bucket: 'day', key: '2026-09-15', tokens: '9007199259', calls: '13' },
      { bucket: 'unexpected', key: 'x', tokens: 1, calls: 1 },
    ];
    const summary = summaryFromRpcRows(rows);

    expect(summary.totalTokens).toBe(9007199259);
    expect(summary.totalCalls).toBe(13);
    expect(summary.byFeature.get('business-os-chat')).toEqual({ tokens: 9007199254, calls: 12 });
    expect(summary.byDay.get('2026-09-15')).toBe(9007199259);
    expect(summary.byDay.size).toBe(1);
  });

  it('treats non-numeric values as zero', () => {
    const summary = summaryFromRpcRows([{ bucket: 'feature', key: 'a', tokens: 'abc', calls: '' }]);
    expect(summary.byFeature.get('a')).toEqual({ tokens: 0, calls: 0 });
    expect(summary.totalTokens).toBe(0);
  });
});

describe('readUsageSummary', () => {
  function deps(overrides: Partial<UsageSummaryDeps['tokenUsage']>): UsageSummaryDeps {
    return {
      tokenUsage: {
        usageSummaryByFeatureAndDay: jest.fn(),
        listSummaryRowsPage: jest.fn(),
        ...overrides,
      },
    };
  }

  it('uses the database function when available and never reads rows', async () => {
    const d = deps({
      usageSummaryByFeatureAndDay: jest.fn().mockResolvedValue({
        data: [{ bucket: 'feature', key: 'business-os-chat', tokens: '100', calls: '2' }],
        error: null,
      }),
    });
    const log = warnLog();

    const { summary, summedBy } = await readUsageSummary(USER, SINCE, log, d);

    expect(summedBy).toBe('database');
    expect(summary.totalTokens).toBe(100);
    expect(d.tokenUsage.usageSummaryByFeatureAndDay).toHaveBeenCalledWith(USER, SINCE);
    expect(d.tokenUsage.listSummaryRowsPage).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('treats an empty function result as "no usage", not "not migrated"', async () => {
    const d = deps({ usageSummaryByFeatureAndDay: jest.fn().mockResolvedValue({ data: [], error: null }) });
    const { summary, summedBy } = await readUsageSummary(USER, SINCE, warnLog(), d);
    expect(summedBy).toBe('database');
    expect(summary.totalCalls).toBe(0);
    expect(d.tokenUsage.listSummaryRowsPage).not.toHaveBeenCalled();
  });

  it('falls back to paging the rows when the function errors, and warns', async () => {
    const page = (n: number, feature: string | null, tokens: number | null): LedgerSummaryRow[] =>
      Array.from({ length: n }, (_, i) => ({
        feature,
        total_tokens: tokens,
        created_at: new Date(Date.UTC(2026, 8, 15, 0, 0, i)).toISOString(),
      }));
    const listSummaryRowsPage = jest
      .fn()
      .mockResolvedValueOnce({ data: page(1000, 'business-os-chat', 2), error: null })
      .mockResolvedValueOnce({ data: page(1000, null, null), error: null })
      .mockResolvedValueOnce({ data: page(3, 'lead-reply', 10), error: null });
    const d = deps({
      usageSummaryByFeatureAndDay: jest.fn().mockResolvedValue({ data: null, error: new Error('missing') }),
      listSummaryRowsPage,
    });
    const log = warnLog();

    const { summary, summedBy } = await readUsageSummary(USER, SINCE, log, d);

    expect(summedBy).toBe('rows');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(listSummaryRowsPage.mock.calls).toEqual([
      [USER, SINCE, 0, 999],
      [USER, SINCE, 1000, 1999],
      [USER, SINCE, 2000, 2999],
    ]);
    expect(summary.totalCalls).toBe(2003);
    expect(summary.totalTokens).toBe(2000 + 0 + 30);
    expect(summary.byFeature.get('unknown')).toEqual({ tokens: 0, calls: 1000 });
    expect(summary.byFeature.get('lead-reply')).toEqual({ tokens: 30, calls: 3 });
    // Day buckets sum the same rows once.
    expect([...summary.byDay.values()].reduce((a, b) => a + b, 0)).toBe(summary.totalTokens);
  });

  it('throws when a fallback page read fails (the route answers 500)', async () => {
    const d = deps({
      usageSummaryByFeatureAndDay: jest.fn().mockResolvedValue({ data: null, error: new Error('missing') }),
      listSummaryRowsPage: jest.fn().mockResolvedValue({ data: null, error: new Error('timeout') }),
    });
    await expect(readUsageSummary(USER, SINCE, warnLog(), d)).rejects.toThrow('timeout');
  });
});

describe('tokens per Pilot Credit', () => {
  it.each([
    ['25', 25],
    [25, 25],
    ['0', DEFAULT_TOKENS_PER_CREDIT],
    ['-3', DEFAULT_TOKENS_PER_CREDIT],
    ['abc', DEFAULT_TOKENS_PER_CREDIT],
    ['', DEFAULT_TOKENS_PER_CREDIT],
    [null, DEFAULT_TOKENS_PER_CREDIT],
    [undefined, DEFAULT_TOKENS_PER_CREDIT],
    ['12.9', 12],
  ])('parseTokensPerCredit(%p) → %p', (value, expected) => {
    expect(parseTokensPerCredit(value)).toBe(expected);
  });

  // Through the real ConfigRepository (`.single()`) over PostgREST semantics.
  it.each<[string, Row[], number, boolean]>([
    ['one valid row', [{ config_key: 'tokens_per_pilot_credit', config_value: '25' }], 25, false],
    ['no row', [], 10, false],
    [
      'two rows',
      [
        { config_key: 'tokens_per_pilot_credit', config_value: '25' },
        { config_key: 'tokens_per_pilot_credit', config_value: '30' },
      ],
      10,
      false,
    ],
    ['a thrown client error', [{ config_key: 'tokens_per_pilot_credit', config_value: '25' }], 10, true],
  ])('readTokensPerCredit: %s', async (_label, rows, expected, throws) => {
    const fake = createFakeSupabase({ tables: { ais_system_config: rows }, throwWhen: throws ? () => true : undefined });
    const config = new ConfigRepository(fake.client as unknown as SupabaseClient);

    expect(await readTokensPerCredit({ config })).toBe(expected);
    expect(fake.queries[0].terminal).toBe('single');
  });

  it('readTokensPerCredit falls back to 10 if the repository itself throws', async () => {
    const config = { getSystemConfig: jest.fn().mockRejectedValue(new Error('boom')) };
    expect(await readTokensPerCredit({ config })).toBe(10);
  });
});

describe('the legacy token-credit measure (Check 5)', () => {
  it('rounds tokens to whole token-credits', () => {
    expect(toCredits(129496, 25)).toBe(5180);
    expect(toCredits(12, 25)).toBe(0);
    expect(toCredits(13, 25)).toBe(1);
  });

});
