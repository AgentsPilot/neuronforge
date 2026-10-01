/**
 * BusinessOsCreditPeriodRepository — the credit period key from the database's
 * own rule (credit deduction slice 6a, workplan §4.2, SA Q-1, W6-8).
 *
 * Pinned: one RPC with both strings passed and the answer returned VERBATIM;
 * malformed input refused before any call; errors returned, never thrown; and
 * the source holds exactly one `.rpc(` call, no `.from(` and no `user_id`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: (...a: unknown[]) => mockLog.info(...a),
    warn: (...a: unknown[]) => mockLog.warn(...a),
    error: (...a: unknown[]) => mockLog.error(...a),
    debug: (...a: unknown[]) => mockLog.debug(...a),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  BusinessOsCreditPeriodRepository,
  businessOsCreditPeriodRepository,
  isTimestamptzString,
} from '../BusinessOsCreditPeriodRepository';

const ANCHOR = '2026-01-31T09:31:07.123456+00:00';
const AT = '2026-02-28T12:00:00.000Z';
const PERIOD = '2026-02-28T09:31:07.123456+00:00';

function rpcClient(result: { data: unknown; error: unknown } | (() => never)) {
  const rpc = jest.fn((fn: string, args: Record<string, unknown>) => {
    void fn;
    void args;
    return typeof result === 'function' ? result() : Promise.resolve(result);
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => jest.clearAllMocks());

describe('periodStartFor', () => {
  it('calls the period function with both strings and returns its answer verbatim', async () => {
    const { client, rpc } = rpcClient({ data: PERIOD, error: null });

    const result = await new BusinessOsCreditPeriodRepository(client).periodStartFor(ANCHOR, AT);

    expect(result).toEqual({ data: PERIOD, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('business_os_credit_period_start', { p_anchor: ANCHOR, p_at: AT });
  });

  it.each([
    ['a Date string', 'Wed Sep 30 2026 10:00:00 GMT+0000', AT],
    ['a bare date', '2026-09-30', AT],
    ['an empty anchor', '', AT],
    ['a bad instant', ANCHOR, 'now'],
    ['seven fractional digits', '2026-01-31T09:31:07.1234567+00:00', AT],
  ])('refuses %s before calling', async (_name, anchor, at) => {
    const { client, rpc } = rpcClient({ data: PERIOD, error: null });
    const result = await new BusinessOsCreditPeriodRepository(client).periodStartFor(anchor, at);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(rpc).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('returns a database error, never throws', async () => {
    const { client } = rpcClient({ data: null, error: new Error('permission denied for function') });
    const result = await new BusinessOsCreditPeriodRepository(client).periodStartFor(ANCHOR, AT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('permission denied for function');
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('treats a null answer as an error (NULL anchor on the database side)', async () => {
    const { client } = rpcClient({ data: null, error: null });
    const result = await new BusinessOsCreditPeriodRepository(client).periodStartFor(ANCHOR, AT);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('never throws when the client itself throws', async () => {
    const { client } = rpcClient(() => {
      throw new Error('client exploded');
    });
    const result = await new BusinessOsCreditPeriodRepository(client).periodStartFor(ANCHOR, AT);
    expect(result.error?.message).toBe('client exploded');
  });

  it('exports a singleton', () => {
    expect(businessOsCreditPeriodRepository).toBeInstanceOf(BusinessOsCreditPeriodRepository);
  });
});

describe('isTimestamptzString', () => {
  it.each([
    '2026-09-14T09:31:07.123456+00:00',
    '2026-09-14T09:31:07+00:00',
    '2026-09-14 09:31:07.1+00',
    '2026-09-14T09:31:07.123Z',
  ])('accepts %s', (value) => expect(isTimestamptzString(value)).toBe(true));

  it.each(['', '2026-09-14', 'x', '2026-13-45T99:99:99Z'])('refuses %s', (value) =>
    expect(isTimestamptzString(value)).toBe(false)
  );
});

describe('source guards (W6-8)', () => {
  const code = fs
    .readFileSync(path.join(process.cwd(), 'lib/repositories/BusinessOsCreditPeriodRepository.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes exactly one rpc call, to the period function', () => {
    expect(code.match(/\.rpc\(/g)).toHaveLength(1);
    expect(code).toMatch(/\.rpc\('business_os_credit_period_start'/);
  });

  it('reads no table and names no account column', () => {
    expect(code).not.toMatch(/\.from\(/);
    expect(code).not.toMatch(/user_id/);
  });
});
