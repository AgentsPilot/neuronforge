/**
 * AuditTrailRepository.findLatestAdminExchangeRateSync (Admin Exchange Rates
 * slice 1e, SA §13.8 SQ-51 (1)): the sixth admin exception. It feeds the
 * "Rates last checked" tile from the newest successful sync audit entry: an
 * admin context first, a fixed select, `AUDIT_EVENTS` constants, one row, and
 * every failure returned, never thrown. Slice 1f (SA §13.9 SQ-53, SQ-57): the
 * select gains `checked_by:actor_id` (the acting admin's id); a null actor is
 * `checkedBy: null`, any other type an error.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
const logCalls: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const record =
      (level: string) =>
      (...args: unknown[]) => {
        logCalls.push([level, ...args]);
      };
    const logger: Record<string, unknown> = { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  ADMIN_EXCHANGE_RATE_SYNC_COLUMNS,
  AuditTrailRepository,
  type AdminAuditReadContext,
} from '@/lib/repositories/AuditTrailRepository';

const CONTEXT: AdminAuditReadContext = { correlationId: 'corr-1', adminId: 'aaaaaaaa-1111-4111-8111-111111111111' };

type Outcome = { data: unknown; error: unknown } | Error;

/** A recording client: every builder call is kept; the query resolves with `outcome` (or rejects with it). */
function client(outcome: Outcome) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lt']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
    outcome instanceof Error ? reject(outcome) : resolve(outcome);
  const supabase = {
    from: (table: string) => {
      calls.push(['from', [table]]);
      return chain;
    },
  };
  return { repo: new AuditTrailRepository(supabase as unknown as SupabaseClient), calls };
}

beforeEach(() => {
  logCalls.length = 0;
});

describe('findLatestAdminExchangeRateSync', () => {
  it('the exact select, filters, order and limit', async () => {
    const { repo, calls } = client({ data: [], error: null });
    await repo.findLatestAdminExchangeRateSync(CONTEXT);
    expect(ADMIN_EXCHANGE_RATE_SYNC_COLUMNS).toBe('created_at, rate_date:details->>rateDate, checked_by:actor_id');
    expect(calls).toEqual([
      ['from', ['audit_trail']],
      ['select', ['created_at, rate_date:details->>rateDate, checked_by:actor_id']],
      ['eq', ['action', 'EXCHANGE_RATE_SYNC_RUN']],
      ['eq', ['entity_type', 'exchange_rate']],
      ['eq', ['details->>outcome', 'ok']],
      ['order', ['created_at', { ascending: false }]],
      ['limit', [1]],
    ]);
  });

  it('never scopes by user_id, never selects details, user_id, the email, the ip or the hash', async () => {
    const { repo, calls } = client({ data: [], error: null });
    await repo.findLatestAdminExchangeRateSync(CONTEXT);
    expect(calls.filter(([method, args]) => method === 'eq' && args[0] === 'user_id')).toEqual([]);
    expect(ADMIN_EXCHANGE_RATE_SYNC_COLUMNS).not.toMatch(/(^|[ ,])details($|,)|user_id|email|ip_address|hash/);
  });

  it('no row → null', async () => {
    const { repo } = client({ data: [], error: null });
    expect(await repo.findLatestAdminExchangeRateSync(CONTEXT)).toEqual({ data: null, error: null });
  });

  it('a null data array → null', async () => {
    const { repo } = client({ data: null, error: null });
    expect(await repo.findLatestAdminExchangeRateSync(CONTEXT)).toEqual({ data: null, error: null });
  });

  it('a row → mapped, and the info log carries the row count only', async () => {
    const { repo } = client({
      data: [{ created_at: '2026-10-25T09:14:03.123+00:00', rate_date: '2026-10-23', checked_by: CONTEXT.adminId }],
      error: null,
    });
    expect(await repo.findLatestAdminExchangeRateSync(CONTEXT)).toEqual({
      data: { checkedAt: '2026-10-25T09:14:03.123+00:00', rateDate: '2026-10-23', checkedBy: CONTEXT.adminId },
      error: null,
    });
    expect(logCalls).toContainEqual([
      'info',
      { correlationId: 'corr-1', adminId: CONTEXT.adminId, method: 'findLatestAdminExchangeRateSync', rows: 1 },
      expect.any(String),
    ]);
  });

  it.each([
    ['an unreal rate date', { created_at: '2026-10-25T09:14:03Z', rate_date: '2026-02-30' }],
    ['a missing rate date', { created_at: '2026-10-25T09:14:03Z', rate_date: null }],
    ['a missing time', { created_at: null, rate_date: '2026-10-23' }],
    ['a non-string actor (slice 1f)', { created_at: '2026-10-25T09:14:03Z', rate_date: '2026-10-23', checked_by: 42 }],
  ])('%s → an error, not a row', async (_label, row) => {
    const { repo } = client({ data: [row], error: null });
    const result = await repo.findLatestAdminExchangeRateSync(CONTEXT);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('a null actor → checkedBy null, not an error (slice 1f, SQ-53: shown as "Unknown user")', async () => {
    const { repo } = client({ data: [{ created_at: '2026-10-25T09:14:03Z', rate_date: '2026-10-23', checked_by: null }], error: null });
    expect(await repo.findLatestAdminExchangeRateSync(CONTEXT)).toEqual({
      data: { checkedAt: '2026-10-25T09:14:03Z', rateDate: '2026-10-23', checkedBy: null },
      error: null,
    });
  });

  it.each([
    ['no context', undefined],
    ['no correlation id', { correlationId: '', adminId: CONTEXT.adminId }],
    ['no admin id', { correlationId: 'c', adminId: '' }],
  ])('%s → an error and no query', async (_label, context) => {
    const { repo, calls } = client({ data: [], error: null });
    const result = await repo.findLatestAdminExchangeRateSync(context as unknown as AdminAuditReadContext);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('a query error → an error, warn logged, nothing thrown', async () => {
    const { repo } = client({ data: null, error: { message: 'relation down', code: '57014' } });
    const result = await repo.findLatestAdminExchangeRateSync(CONTEXT);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(logCalls.some(([level]) => level === 'warn')).toBe(true);
  });

  it('a rejected query → an error, nothing thrown', async () => {
    const { repo } = client(new Error('socket hang up'));
    const result = await repo.findLatestAdminExchangeRateSync(CONTEXT);
    expect(result).toEqual({ data: null, error: expect.any(Error) });
  });
});
