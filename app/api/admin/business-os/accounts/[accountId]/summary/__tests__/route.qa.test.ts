/**
 * QA (admin reorganisation slice 2b): cases the summary route's own suite does
 * not cover.
 *
 *   - The top-level 500 (something THROWS, rather than returning an error)
 *     carries no detail outside development, and does in development.
 *   - 401/403 still win over an invalid account id (gate before validation).
 *   - The failure projection holds against rows written by older or careless
 *     code: `details` as a string, owner text in an allow-listed key, wrong
 *     types, and oversized values.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
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
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({ onboardingConversationRepository: {} }));

const mockListCalls = jest.fn();
jest.mock('@/lib/repositories/TokenUsageRepository', () => ({
  tokenUsageRepository: { listCallsInWindow: (...a: unknown[]) => mockListCalls(...a) },
}));

const mockListFailures = jest.fn();
jest.mock('@/lib/repositories/AuditTrailRepository', () => ({
  auditTrailRepository: { listAdminAiFailures: (...a: unknown[]) => mockListFailures(...a) },
}));

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const SECRET = 'connection to postgres://user:pw@db.internal failed';

const call = (accountId: string) =>
  GET(new NextRequest(`http://localhost/api/admin/business-os/accounts/${accountId}/summary`), {
    params: { accountId },
  });

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const setNodeEnv = (value: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockIsTenant.mockResolvedValue(true);
  mockFindAdminIdentity.mockResolvedValue({ data: null, error: null });
  mockListCalls.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockListFailures.mockResolvedValue({ data: [], error: null });
});

afterAll(() => setNodeEnv(ORIGINAL_NODE_ENV ?? 'test'));

describe('a thrown error', () => {
  it('500 with no detail in production', async () => {
    setNodeEnv('production');
    mockIsTenant.mockRejectedValue(new Error(SECRET));
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('postgres://');
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Internal server error' });
  });

  it('500 with no detail in production when a read throws instead of returning an error', async () => {
    setNodeEnv('production');
    mockListFailures.mockRejectedValue(new Error(SECRET));
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('postgres://');
  });

  it('keeps the detail in development only', async () => {
    setNodeEnv('development');
    mockIsTenant.mockRejectedValue(new Error(SECRET));
    const body = await (await call(ACCOUNT)).json();
    expect(body.details).toBe(SECRET);
  });
});

describe('gate before validation', () => {
  it('401 (not 400) for a signed-out caller with an invalid id', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call('not-a-uuid')).status).toBe(401);
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it('403 (not 400) for a non-admin with an invalid id', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('not-a-uuid')).status).toBe(403);
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it.each([['%27%20OR%201%3D1'], ['..%2F..%2Fetc'], [ACCOUNT + 'x']])('400 for id %s, before any read', async (id) => {
    const res = await call(decodeURIComponent(id));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'invalid_account_id' });
    expect(mockIsTenant).not.toHaveBeenCalled();
  });
});

describe('the failure projection against hostile rows', () => {
  const ownerText = 'Dear Dana, your therapy session notes: ' + 'x'.repeat(500);

  it('drops a details STRING (older rows) entirely', async () => {
    mockListFailures.mockResolvedValue({
      data: [{ id: 'f1', created_at: '2026-09-22T10:00:00.000Z', entity_id: null, details: ownerText }],
      error: null,
    });
    const { data } = await (await call(ACCOUNT)).json();
    expect(data.recentAiFailures.items[0]).toEqual({
      id: 'f1',
      createdAt: '2026-09-22T10:00:00.000Z',
      groupId: null,
      area: null,
      actionType: null,
      trigger: null,
      errorCode: null,
      callCount: null,
      failedCallCount: null,
    });
    expect(JSON.stringify(data)).not.toContain('Dear Dana');
  });

  it('caps an allow-listed string at 80 characters and nulls wrong types', async () => {
    mockListFailures.mockResolvedValue({
      data: [
        {
          id: 'f2',
          created_at: '2026-09-22T10:00:00.000Z',
          entity_id: 'g'.repeat(300),
          details: {
            area: { nested: ownerText },
            actionType: ['x'],
            trigger: 42,
            errorCode: ownerText,
            callCount: -3,
            failedCallCount: 'many',
            outcome: ownerText,
            models: ['gpt'],
          },
        },
      ],
      error: null,
    });
    const text = await (await call(ACCOUNT)).text();
    const item = JSON.parse(text).data.recentAiFailures.items[0];
    expect(item.groupId).toHaveLength(80);
    expect(item.errorCode).toHaveLength(80);
    expect(item.area).toBeNull();
    expect(item.actionType).toBeNull();
    expect(item.trigger).toBeNull();
    expect(item.callCount).toBeNull();
    expect(item.failedCallCount).toBeNull();
    expect(Object.keys(item).sort()).toEqual(
      ['actionType', 'area', 'callCount', 'createdAt', 'errorCode', 'failedCallCount', 'groupId', 'id', 'trigger'].sort()
    );
    expect(text).not.toContain('"outcome"');
    expect(text).not.toContain('"models"');
  });

  it('a spend read that returns an error exposes no error text in the block', async () => {
    mockListCalls.mockResolvedValue({ data: null, error: new Error(SECRET) });
    const text = await (await call(ACCOUNT)).text();
    expect(JSON.parse(text).data.aiSpend30d.status).toBe('error');
    expect(JSON.parse(text).data.aiSpend30d.currency).toBe('USD');
    expect(text).not.toContain('postgres://');
  });
});
