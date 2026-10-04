/**
 * GET /api/admin/business-os/ai-activity/drill-down (Gap B slice B2a,
 * workplan § F; AC-B2, AC-B5, AC-B8, AC-B13, AC-B14; SA-RC-11, SA-B2-8, OQ-8,
 * OQ-9): 401 / 403 before any read and before validation; 400 on a missing,
 * malformed, repeated or extra key (an `accountId` beside the action id
 * included), with no read; one identical 404 body for an unknown id, an
 * adjustment, a deleted account and a platform account; 200 with every second
 * read keyed on the charge row; another account's data never in the body;
 * one accountability log line with ids and counts only; 500 without internals.
 *
 * The builder is real; the repositories are faked at the wiring seam.
 */

import * as fs from 'fs';
import * as path from 'path';
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

const mockLedger = {
  findChargesByActionIds: jest.fn(),
  listChargesOfGroupForAccount: jest.fn(),
  listAdjustmentsForActionIds: jest.fn(),
};
jest.mock('@/lib/business-os/credits/aiActivityDrillDownDeps', () => ({
  aiActivityDrillDownLedger: () => mockLedger,
}));

const mockArchive = { getLatestCutoff: jest.fn(), listRuns: jest.fn() };
jest.mock('@/lib/business-os/credits/aiActivityDeps', () => ({
  aiActivityArchive: () => mockArchive,
}));

const mockListEntries = jest.fn();
jest.mock('@/lib/repositories/AuditTrailRepository', () => ({
  auditTrailRepository: { listAiActionEntriesAllAccountsByGroupIds: (...a: unknown[]) => mockListEntries(...a) },
}));

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockFindNames(...a) },
}));

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const OTHER = '88888888-8888-4888-8888-888888888888';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const GROUP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const DRILL_DOWN_PATH = '/api/admin/business-os/ai-activity/drill-down';
const call = (query = '') => GET(new NextRequest(`http://localhost${DRILL_DOWN_PATH}${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

function chargeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', kind: 'charge', action_id: ACTION, adjusts_action_id: null, reason_code: null, user_id: ACCOUNT,
    period_start: '2026-09-29T00:00:00+00:00', group_id: GROUP, credits: '2.000000', cost_usd: '0.0020000000',
    credit_value_version: 0, is_fallback_priced: false, service: 'ai', action_type: 'chat_turn', triggered_by: 'owner',
    outcome: 'succeeded', created_at: '2026-10-01T10:00:00+00:00',
    ...over,
  };
}

const entryRow = (user: string, details: Record<string, unknown> = {}) => ({
  id: `e-${user}`,
  user_id: user,
  created_at: '2026-10-01T09:59:59+00:00',
  entity_id: GROUP,
  details: { schema: 2, actionId: ACTION, callCount: 2, failedCallCount: 0, inputTokens: 10, outputTokens: 5, totalTokens: 15, models: ['model-alpha'], ...details },
});

function seed(found: unknown[] = [chargeRow()], group: unknown[] = found) {
  mockLedger.findChargesByActionIds.mockResolvedValue({ data: found, error: null });
  mockLedger.listChargesOfGroupForAccount.mockResolvedValue({ data: { rows: group, reachedCeiling: false }, error: null });
  mockLedger.listAdjustmentsForActionIds.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: 'Alpha Studio' }], error: null });
  mockListEntries.mockResolvedValue({ data: { rows: [], reachedLimit: false }, error: null });
  mockArchive.getLatestCutoff.mockResolvedValue({ data: null, error: null });
  mockArchive.listRuns.mockResolvedValue({ data: [], error: null });
}

const noReadHappened = () => {
  for (const fn of Object.values(mockLedger)) expect(fn).not.toHaveBeenCalled();
  expect(mockFindNames).not.toHaveBeenCalled();
  expect(mockListEntries).not.toHaveBeenCalled();
  for (const fn of Object.values(mockArchive)) expect(fn).not.toHaveBeenCalled();
};

const noSecondRead = () => {
  expect(mockLedger.listChargesOfGroupForAccount).not.toHaveBeenCalled();
  expect(mockLedger.listAdjustmentsForActionIds).not.toHaveBeenCalled();
  expect(mockFindNames).not.toHaveBeenCalled();
  expect(mockListEntries).not.toHaveBeenCalled();
};

const infoLines = (message: string) => mockLog.info.mock.calls.filter(([, msg]) => msg === message);

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

describe('authz: before anything else', () => {
  it('401 when signed out, with no read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call(`?actionId=${ACTION}`);
    expect(res.status).toBe(401);
    noReadHappened();
  });

  it('403 for a signed-in non-admin, with no read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(`?actionId=${ACTION}`);
    expect(res.status).toBe(403);
    noReadHappened();
  });

  it('403, not 400, for a non-admin with an invalid query: validation never runs first', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(`?actionId=nope&accountId=${OTHER}`);
    expect(res.status).toBe(403);
  });

  it('requireAdmin is the first statement of the handler', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function GET'));
    const beforeGate = body.slice(body.indexOf('{') + 1, body.indexOf('await requireAdmin('));
    const statements = beforeGate
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'));
    expect(statements).toEqual([
      "const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();",
      'const baseLogger = logger.child({ correlationId });',
      'const gate =',
    ]);
  });
});

describe('400: the action id is the only input (SA-RC-11, OQ-8)', () => {
  beforeEach(asAdmin);

  it.each([
    ['no action id', ''],
    ['an empty action id', '?actionId='],
    ['a malformed action id', '?actionId=not-a-uuid'],
    ['a filter-syntax action id', `?actionId=${ACTION},kind.eq.adjustment`],
    ['a repeated action id', `?actionId=${ACTION}&actionId=${ACTION}`],
    ['an accountId beside the action id (AC-B5: it cannot widen the read)', `?actionId=${ACTION}&accountId=${OTHER}`],
    ['a groupId beside the action id', `?actionId=${ACTION}&groupId=${GROUP}`],
    ['any other key', `?actionId=${ACTION}&from=2026-10-01`],
  ])('%s → 400, with no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    noReadHappened();
  });
});

describe('404: one identical body for every "not found" (OQ-9)', () => {
  beforeEach(asAdmin);

  const NOT_FOUND = { success: false, error: 'This AI action could not be found' };

  it.each([
    ['an unknown action id', [] as unknown[]],
    ["an adjustment's id", [chargeRow({ kind: 'adjustment', adjusts_action_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009', group_id: null })]],
    ["a deleted account's charge", [chargeRow({ user_id: null })]],
    ["a platform account's charge", [chargeRow({ user_id: PLATFORM })]],
  ])('%s → 404 with the same body and no second read', async (_name, found) => {
    seed(found);
    const res = await call(`?actionId=${ACTION}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    noSecondRead();
    const lines = infoLines('Admin opened an AI action that was not found');
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toEqual({ actionId: ACTION, found: false, durationMs: expect.any(Number) });
  });
});

describe('200: the drill-down', () => {
  beforeEach(asAdmin);

  it('reads the group, names and audit entries with the CHARGE ROW values and the admin context', async () => {
    const res = await call(`?actionId=${ACTION}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      actionId: ACTION,
      account: { accountId: ACCOUNT, companyName: 'Alpha Studio' },
      group: { groupId: GROUP, status: 'ok', chargedActions: 1, shared: false, atLeast: false },
    });
    expect(body.data.group.charges[0]).toMatchObject({ actionId: ACTION, opened: true, costUsd: { gross: 0.002, net: 0.002 } });

    expect(mockLedger.findChargesByActionIds).toHaveBeenCalledWith([ACTION]);
    expect(mockLedger.listChargesOfGroupForAccount.mock.calls[0].slice(0, 2)).toEqual([ACCOUNT, GROUP]);
    expect(mockFindNames).toHaveBeenCalledWith([ACCOUNT]);
    const [context, groupIds] = mockListEntries.mock.calls[0];
    expect(context).toEqual({ correlationId: expect.any(String), adminId: ADMIN.id });
    expect(groupIds).toEqual([GROUP]);
    expect(mockArchive.getLatestCutoff).toHaveBeenCalledWith('audit_trail');
  });

  it('SA-B2-8: an upper-case action id is lower-cased before the lookup, the opened flag and the log line', async () => {
    const res = await call(`?actionId=${ACTION.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(mockLedger.findChargesByActionIds).toHaveBeenCalledWith([ACTION]);
    const body = await res.json();
    expect(body.data.actionId).toBe(ACTION);
    expect(body.data.group.charges.filter((c: { opened: boolean }) => c.opened)).toHaveLength(1);
    const lines = infoLines('Admin opened a Business OS AI action');
    expect(lines).toHaveLength(1);
    expect(lines[0][0].actionId).toBe(ACTION);
  });

  it('AC-B5: another account sharing the grouping id never reaches the body', async () => {
    const theirs = chargeRow({
      id: 'r2',
      action_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
      user_id: OTHER,
      action_type: 'marker_other_account_type',
    });
    seed([chargeRow()], [chargeRow(), theirs]);
    mockListEntries.mockResolvedValue({
      data: { rows: [entryRow(OTHER, { callCount: 987654, models: ['marker-other-account-model'] }), entryRow(ACCOUNT)], reachedLimit: false },
      error: null,
    });
    const res = await call(`?actionId=${ACTION}`);
    const body = await res.json();
    expect(body.data.group.chargedActions).toBe(1);
    expect(body.data.group.charges[0].entry).toEqual({
      state: 'found',
      callCount: 2,
      failedCallCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      models: ['model-alpha'],
      errorCode: null,
    });
    expect(body.data.audit.noEntry.accountMismatch).toBe(1);
    const json = JSON.stringify(body);
    for (const marker of [OTHER, '987654', 'marker-other-account-model', 'marker_other_account_type']) expect(json).not.toContain(marker);
  });

  it('logs one info line with the admin context, the action and the counts — no business name, model or row', async () => {
    mockListEntries.mockResolvedValue({ data: { rows: [entryRow(ACCOUNT, { models: ['marker-logged-model'] })], reachedLimit: false }, error: null });
    await call(`?actionId=${ACTION}`);
    const lines = infoLines('Admin opened a Business OS AI action');
    expect(lines).toHaveLength(1);
    expect(mockLog.info.mock.calls).toHaveLength(1);
    expect(lines[0][0]).toEqual({
      actionId: ACTION,
      found: true,
      accountId: ACCOUNT,
      chargedActions: 1,
      atLeast: false,
      group: 'ok',
      names: 'ok',
      adjustments: 'ok',
      unresolvedAdjustments: 0,
      unreadableAmounts: 0,
      audit: { status: 'ok', archive: 'ok', noEntry: { tooRecent: 0, mayBeArchived: 0, lost: 0, unknown: 0, accountMismatch: 0 } },
      durationMs: expect.any(Number),
    });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    expect(logged).not.toContain('Alpha Studio');
    expect(logged).not.toContain('marker-logged-model');
  });

  it('QA-B2a-4: when the group read failed, the log line claims no count (chargedActions null), and the drawer still opens', async () => {
    mockLedger.listChargesOfGroupForAccount.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call(`?actionId=${ACTION}`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.group).toMatchObject({ status: 'failed', chargedActions: 1 });
    const lines = infoLines('Admin opened a Business OS AI action');
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toMatchObject({ group: 'failed', chargedActions: null });
  });

  it('the route source wires the admin-pinned reads with their context (adminReadMethods caller pin)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).toContain('auditTrailRepository.listAiActionEntriesAllAccountsByGroupIds(');
    expect(source).toContain('{ correlationId, adminId: gate.user.id }');
    expect(source).toContain('businessProfileRepository.findAdminIdentitiesByUserIds(');
  });
});

describe('500', () => {
  beforeEach(asAdmin);

  it('a failed charge read is an error, never a 404', async () => {
    mockLedger.findChargesByActionIds.mockResolvedValue({ data: null, error: new Error('secret internal detail') });
    const res = await call(`?actionId=${ACTION}`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'The AI action could not be read. Try again.' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('returns a generic message, without details outside development, when something unexpected throws', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      mockLedger.findChargesByActionIds.mockResolvedValue({
        data: {
          find(): never {
            throw new Error('secret internal detail');
          },
        },
        error: null,
      });
      const res = await call(`?actionId=${ACTION}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
