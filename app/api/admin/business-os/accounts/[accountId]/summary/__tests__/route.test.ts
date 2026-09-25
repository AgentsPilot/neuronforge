/**
 * GET /api/admin/business-os/accounts/[accountId]/summary
 * (admin reorganisation slice 2b, SA C-5).
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockIsTenant = jest.fn();
jest.mock('@/lib/business-os/entitlements/adminOps', () => ({
  isBusinessOsTenant: (...args: unknown[]) => mockIsTenant(...args),
}));

const mockFindAdminIdentity = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentity: (...a: unknown[]) => mockFindAdminIdentity(...a) },
}));
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({
  onboardingConversationRepository: {},
}));

const mockListCalls = jest.fn();
jest.mock('@/lib/repositories/TokenUsageRepository', () => ({
  tokenUsageRepository: { listCallsInWindow: (...a: unknown[]) => mockListCalls(...a) },
}));

const mockListFailures = jest.fn();
jest.mock('@/lib/repositories/AuditTrailRepository', () => ({
  auditTrailRepository: { listAdminAiFailures: (...a: unknown[]) => mockListFailures(...a) },
}));

import { GET } from '../route';
import { bosRowFilter } from '@/lib/business-os/llm/callCatalog';
import { classifyCallRow, computeAreaTotals, readOk } from '@/lib/business-os/usage/llmUsageVerification';
import type { LedgerCallRow } from '@/lib/repositories/TokenUsageRepository';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PLATFORM = '00000000-0000-0000-0000-000000000000';

const call = (accountId: string) =>
  GET(new NextRequest(`http://localhost/api/admin/business-os/accounts/${accountId}/summary`), {
    params: { accountId },
  });

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const CALLS: LedgerCallRow[] = [
  {
    id: 'c1', created_at: '2026-09-20T10:00:00.000Z', feature: 'business-os-insights', component: 'insight_generation',
    session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input_tokens: 100, output_tokens: 50, cost_usd: '0.002', success: true, error_code: null,
  },
  {
    id: 'c2', created_at: '2026-09-21T10:00:00.000Z', feature: 'lead-reply', component: 'lead-reply',
    session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', input_tokens: 10, output_tokens: 5, cost_usd: 0.0005, success: true, error_code: null,
  },
];

function allReadsOk() {
  mockIsTenant.mockResolvedValue(true);
  mockFindAdminIdentity.mockResolvedValue({
    data: { user_id: ACCOUNT, company_name: 'Acme Therapy', vertical: 'therapist', sub_vertical: null },
    error: null,
  });
  mockListCalls.mockResolvedValue({ data: { rows: CALLS, reachedCeiling: false }, error: null });
  mockListFailures.mockResolvedValue({
    data: [
      {
        id: 'f1',
        created_at: '2026-09-22T10:00:00.000Z',
        entity_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        details: {
          area: 'insights',
          actionType: 'insight_detection',
          trigger: 'cron',
          errorCode: 'provider_timeout',
          callCount: 3,
          failedCallCount: 1,
          // Keys that must never reach the screen:
          prompt: 'SECRET PROMPT TEXT',
          message: 'owner wrote this',
          callNames: ['insight_generation'],
        },
      },
    ],
    error: null,
  });
}

const noRepositoryCalls = () => {
  expect(mockIsTenant).not.toHaveBeenCalled();
  expect(mockFindAdminIdentity).not.toHaveBeenCalled();
  expect(mockListCalls).not.toHaveBeenCalled();
  expect(mockListFailures).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
});

describe('the gate runs first (C-5a: evidence that nothing is read before it)', () => {
  it('401 signed out, zero repository calls', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call(ACCOUNT)).status).toBe(401);
    noRepositoryCalls();
  });

  it('403 for a non-admin, zero repository calls', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call(ACCOUNT)).status).toBe(403);
    noRepositoryCalls();
  });
});

describe('refusals', () => {
  it('400 for an id that is not a UUID', async () => {
    asAdmin();
    const res = await call('not-a-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'invalid_account_id' });
    noRepositoryCalls();
  });

  it('409 for the platform account, before the tenancy read (C-5b)', async () => {
    asAdmin();
    const res = await call(PLATFORM);
    expect(res.status).toBe(409);
    noRepositoryCalls();
  });

  it('404 for a login that is not a Business OS account', async () => {
    asAdmin();
    mockIsTenant.mockResolvedValue(false);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'not_a_business_os_account' });
    expect(mockListCalls).not.toHaveBeenCalled();
  });

  it('500 when tenancy cannot be determined', async () => {
    asAdmin();
    mockIsTenant.mockResolvedValue(null);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'tenant_check_failed' });
  });
});

describe('the summary', () => {
  it('returns business, USD spend computed like the LLM usage report, and projected failures', async () => {
    asAdmin();
    allReadsOk();
    const res = await call(ACCOUNT);
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.business).toEqual({ status: 'ok', companyName: 'Acme Therapy', vertical: 'therapist', subVertical: null });

    const expected = computeAreaTotals(readOk({ rows: CALLS.map(classifyCallRow), incomplete: false }));
    expect(data.aiSpend30d.currency).toBe('USD');
    expect(data.aiSpend30d.status).toBe('complete');
    expect(data.aiSpend30d.total).toEqual(expected.total);
    expect(mockListCalls.mock.calls[0][0]).toBe(ACCOUNT);
    expect(mockListCalls.mock.calls[0][2]).toEqual(bosRowFilter());
    expect(mockListCalls.mock.calls[0][3]).toEqual({ pageSize: 1000, ceiling: 5000 });

    expect(data.recentAiFailures.items).toEqual([
      {
        id: 'f1',
        createdAt: '2026-09-22T10:00:00.000Z',
        groupId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        area: 'insights',
        actionType: 'insight_detection',
        trigger: 'cron',
        errorCode: 'provider_timeout',
        callCount: 3,
        failedCallCount: 1,
      },
    ]);
  });

  it('never returns prompt, message or other unlisted detail keys, and never logs the business name', async () => {
    asAdmin();
    allReadsOk();
    const text = await (await call(ACCOUNT)).text();
    expect(text).not.toContain('SECRET PROMPT TEXT');
    expect(text).not.toContain('owner wrote this');
    expect(text).not.toContain('callNames');
    const logged = JSON.stringify([...mockLog.info.mock.calls, ...mockLog.error.mock.calls]);
    expect(logged).not.toContain('Acme Therapy');
  });

  it('keeps going when one read fails: spend error, failures still returned', async () => {
    asAdmin();
    allReadsOk();
    mockListCalls.mockResolvedValue({ data: null, error: new Error('ledger down') });
    const res = await call(ACCOUNT);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.aiSpend30d.status).toBe('error');
    expect(data.recentAiFailures.status).toBe('ok');
    expect(JSON.stringify(data)).not.toContain('ledger down');
  });

  it('marks spend incomplete when the per-account read reached its ceiling', async () => {
    asAdmin();
    allReadsOk();
    mockListCalls.mockResolvedValue({ data: { rows: CALLS, reachedCeiling: true }, error: null });
    const { data } = await (await call(ACCOUNT)).json();
    expect(data.aiSpend30d.status).toBe('incomplete');
  });

  it('says "none" for a tenant with no business profile yet (onboarding in progress)', async () => {
    asAdmin();
    allReadsOk();
    mockFindAdminIdentity.mockResolvedValue({ data: null, error: null });
    const { data } = await (await call(ACCOUNT)).json();
    expect(data.business).toEqual({ status: 'none' });
  });
});
