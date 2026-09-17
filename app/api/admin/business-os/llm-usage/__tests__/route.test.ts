/**
 * GET /api/admin/business-os/llm-usage — Layer 1.1 AC-1, AC-2, AC-3, AC-13, AC-14, AC-19 (server logs).
 *
 * Gate order 401 → 403 → 400 with no ledger or profile read before it passes;
 * a thrown admin check fails closed; the happy path returns every check; logs
 * are info for manual and debug for auto and never carry a business name; the
 * route writes nothing, calls no provider, emits no audit event, and returns no
 * payload, metadata, error message or email.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

const logs: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: unknown, msg: unknown) => logs.push({ level, ctx, msg });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// Only read methods exist on these mocks: a write would throw and show as a 500.
const listCallsInWindow = jest.fn();
const countInWindow = jest.fn();
const listLabelsInWindow = jest.fn();
jest.mock('@/lib/repositories/TokenUsageRepository', () => ({
  tokenUsageRepository: {
    listCallsInWindow: (...a: unknown[]) => listCallsInWindow(...a),
    countInWindow: (...a: unknown[]) => countInWindow(...a),
    listLabelsInWindow: (...a: unknown[]) => listLabelsInWindow(...a),
  },
}));

const findByUserId = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: (...a: unknown[]) => findByUserId(...a) },
}));

const readUsageSummary = jest.fn();
const readTokensPerCredit = jest.fn();
jest.mock('@/lib/business-os/usage/usageSummary', () => ({
  ...jest.requireActual('@/lib/business-os/usage/usageSummary'),
  readUsageSummary: (...a: unknown[]) => readUsageSummary(...a),
  readTokensPerCredit: () => readTokensPerCredit(),
}));

// Any direct database access from the route would land here.
const directDb = jest.fn(() => {
  throw new Error('direct database access');
});
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: () => directDb(), rpc: () => directDb() },
  createServerSupabaseClient: jest.fn(),
}));

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: auditLog }) },
}));

const providerComplete = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: providerComplete }),
  ProviderFactory: { getProvider: () => ({ chatCompletion: providerComplete }) },
}));

import { GET } from '../route';
import { PLATFORM_ACCOUNT_MESSAGE } from '@/lib/business-os/usage/llmUsageVerification';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };
const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const OTHER_ACCOUNT = '99999999-9999-4999-8999-999999999999';
const ZERO = '00000000-0000-0000-0000-000000000000';
const SYS = '22222222-2222-4222-8222-222222222222';
const BUSINESS_NAME = 'Acme Very Distinctive Test Co';
const NOW = new Date('2026-09-17T12:00:00.000Z');

function iso(offsetMs: number) {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

function req(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)
  ).toString();
  return new NextRequest(`http://localhost/api/admin/business-os/llm-usage?${qs}`, {
    method: 'GET',
    headers: { 'x-correlation-id': 'corr-test' },
  });
}

function validParams(overrides: Record<string, string | undefined> = {}) {
  return { accountId: ACCOUNT, since: iso(-3600_000), ...overrides };
}

function anyRead() {
  return (
    listCallsInWindow.mock.calls.length +
    countInWindow.mock.calls.length +
    listLabelsInWindow.mock.calls.length +
    findByUserId.mock.calls.length +
    readUsageSummary.mock.calls.length
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  delete process.env.SYSTEM_ADMIN_USER_ID;

  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  listCallsInWindow.mockResolvedValue({
    data: {
      rows: [
        {
          id: 'r1',
          created_at: iso(-60_000),
          feature: 'business-os-chat',
          component: 'planner',
          session_id: '33333333-3333-4333-8333-333333333333',
          input_tokens: 10,
          output_tokens: 5,
          cost_usd: '0.001',
          success: false,
          error_code: 'rate_limited',
        },
      ],
      reachedCeiling: false,
    },
    error: null,
  });
  countInWindow.mockResolvedValue({ data: 0, error: null });
  listLabelsInWindow.mockResolvedValue({ data: [], error: null });
  findByUserId.mockResolvedValue({ data: { company_name: BUSINESS_NAME, email: 'owner@example.com' }, error: null });
  readUsageSummary.mockResolvedValue({
    summary: {
      totalTokens: 15,
      totalCalls: 1,
      byFeature: new Map([['business-os-chat', { tokens: 15, calls: 1 }]]),
      byDay: new Map(),
    },
    summedBy: 'database',
  });
  readTokensPerCredit.mockResolvedValue(10);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('GET /api/admin/business-os/llm-usage — gate', () => {
  it('401 when signed out, with no admin check and no read', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(req(validParams()));
    expect(res.status).toBe(401);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(anyRead()).toBe(0);
  });

  it('403 for a signed-in non-admin, logged at warn with the user id, no read', async () => {
    getUser.mockResolvedValue({ id: 'u-2', email: 'u2@example.com' });
    isAdmin.mockResolvedValue(false);
    const res = await GET(req(validParams()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Forbidden' });
    expect(logs).toContainEqual(expect.objectContaining({ level: 'warn', ctx: { userId: 'u-2' } }));
    expect(anyRead()).toBe(0);
  });

  it('403 for a user whose profiles.role is admin but who is not in admin_users', async () => {
    // AdminAccessService (admin_users) says no; nothing else is consulted. The
    // static boundary test proves the route never reads profiles.role (WC-8).
    getUser.mockResolvedValue({ id: 'u-3', email: 'u3@example.com', app_metadata: { role: 'admin' }, role: 'admin' });
    isAdmin.mockResolvedValue(false);
    const res = await GET(req(validParams()));
    expect(res.status).toBe(403);
    expect(isAdmin).toHaveBeenCalledWith({ id: 'u-3', email: 'u3@example.com' });
  });

  it('403, not 500, when the admin check throws (fail closed)', async () => {
    isAdmin.mockRejectedValue(new Error('admin_users unavailable'));
    const res = await GET(req(validParams()));
    expect(res.status).toBe(403);
    expect(anyRead()).toBe(0);
  });

  it('403, not 400, for a non-admin sending invalid parameters', async () => {
    isAdmin.mockResolvedValue(false);
    const res = await GET(req({ accountId: 'nope', since: 'never' }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/business-os/llm-usage — validation (AC-3)', () => {
  it.each<[string, Record<string, string | undefined>, string | RegExp]>([
    ['a non-UUID account id', { accountId: 'abc' }, 'Account id must be a UUID'],
    ['a missing account id', { accountId: undefined }, 'Account id is required'],
    ['the all-zero platform account', { accountId: ZERO }, PLATFORM_ACCOUNT_MESSAGE],
    ['a malformed start time', { since: 'last tuesday' }, 'Start time must be an ISO 8601 timestamp'],
    ['a start time 61 s in the future', { since: iso(61_000) }, 'Start time is in the future'],
    ['a start time older than 7 days + 60 s', { since: iso(-7 * 86400_000 - 61_000) }, /more than 7 days ago/],
    ['an unknown trigger', { trigger: 'sometimes' }, /Invalid enum value/],
  ])('400 for %s, with no read', async (_label, overrides, message) => {
    const res = await GET(req(validParams(overrides)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    if (typeof message === 'string') expect(body.error).toBe(message);
    else expect(body.error).toMatch(message);
    expect(anyRead()).toBe(0);
  });

  it('400 for SYSTEM_ADMIN_USER_ID as the selected business', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    const res = await GET(req(validParams({ accountId: SYS })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PLATFORM_ACCOUNT_MESSAGE);
    expect(anyRead()).toBe(0);
  });

  it('200 for a start time up to 60 s ahead, clamped to now', async () => {
    const res = await GET(req(validParams({ since: iso(59_000) })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.window).toEqual({ start: NOW.toISOString(), end: NOW.toISOString(), startClamped: true });
  });
});

describe('GET /api/admin/business-os/llm-usage — happy path', () => {
  it('returns every check, area totals and the checked platform ids for the requested account (AC-13)', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    const res = await GET(req(validParams({ accountId: ACCOUNT.toUpperCase() })));
    expect(res.status).toBe(200);
    const { success, data } = await res.json();

    expect(success).toBe(true);
    expect(Object.keys(data.checks).sort()).toEqual(['calls', 'groups', 'legacyLabels', 'platformAccount', 'usageCard']);
    expect(data.areaTotals.status).toBe('complete');
    expect(data.platformAccountIdsChecked).toEqual([ZERO, SYS]);
    expect(data.account).toEqual({ userId: ACCOUNT, companyName: BUSINESS_NAME, profileLookup: 'found' });
    expect(data.window.end).toBe(NOW.toISOString());

    expect(listCallsInWindow.mock.calls[0][0]).toBe(ACCOUNT);
    expect(readUsageSummary.mock.calls[0][0]).toBe(ACCOUNT);
    for (const [ids] of countInWindow.mock.calls) {
      expect((ids as string[]).includes(OTHER_ACCOUNT)).toBe(false);
    }
  });

  it('is read-only: no audit event, no provider call, no direct database access (AC-14)', async () => {
    const res = await GET(req(validParams()));
    expect(res.status).toBe(200);
    expect(auditLog).not.toHaveBeenCalled();
    expect(providerComplete).not.toHaveBeenCalled();
    expect(directDb).not.toHaveBeenCalled();
  });

  it('returns no payload, metadata, error message, email or prompt (AC-14, FR-20)', async () => {
    const res = await GET(req(validParams()));
    const text = await res.text();
    for (const forbidden of ['request_payload', 'response_metadata', '"metadata"', 'error_message', 'errorMessage', 'email', 'prompt', '@example.com']) {
      expect(text).not.toContain(forbidden);
    }
    // The failed call's error code is carried; its message is not.
    expect(text).toContain('rate_limited');
  });

  it('logs a manual refresh at info with ids, window and statuses, never the business name (AC-19)', async () => {
    await GET(req(validParams({ trigger: 'manual' })));
    const served = logs.filter((l) => l.msg === 'LLM usage report served');
    expect(served).toHaveLength(1);
    expect(served[0].level).toBe('info');
    expect(served[0].ctx).toMatchObject({
      adminUserId: ADMIN.id,
      accountId: ACCOUNT,
      trigger: 'manual',
      windowEnd: NOW.toISOString(),
      rowsRead: 1,
      incomplete: false,
      statuses: expect.objectContaining({ calls: 'pass', usageCard: 'pass' }),
    });
    expect(JSON.stringify(logs)).not.toContain(BUSINESS_NAME);
  });

  it('logs an automatic refresh at debug and skips the name lookup (RC-11, WC-6)', async () => {
    const res = await GET(req(validParams({ trigger: 'auto' })));
    const body = await res.json();
    const served = logs.filter((l) => l.msg === 'LLM usage report served');
    expect(served.map((l) => l.level)).toEqual(['debug']);
    expect(logs.some((l) => l.level === 'info')).toBe(false);
    expect(findByUserId).not.toHaveBeenCalled();
    expect(body.data.account.profileLookup).toBe('skipped');
  });

  it('flags and warns once about a non-UUID SYSTEM_ADMIN_USER_ID, without its value (WC-9)', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'not-a-uuid-value';
    const res = await GET(req(validParams()));
    const text = await res.text();
    expect(JSON.parse(text).data.platformAccountEnvIgnored).toBe(true);
    expect(text).not.toContain('not-a-uuid-value');
    const warns = logs.filter((l) => l.level === 'warn' && String(l.msg).includes('SYSTEM_ADMIN_USER_ID'));
    expect(warns).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain('not-a-uuid-value');
  });

  it('answers 500 with a generic message if report building throws unexpectedly', async () => {
    readTokensPerCredit.mockImplementation(() => {
      throw new Error('secret internals');
    });
    const res = await GET(req(validParams()));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe('Internal server error');
    expect(text).not.toContain('secret internals');
  });
});
