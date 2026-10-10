/**
 * POST /api/admin/business-os/credits/boost/reconcile (credits boost slice
 * 4b.2; workplan §3.5; SA C-5, C-7, Q-6).
 *
 *   G  the gate comes first: on every denial nothing is read, run or audited
 *   Z  the body must be empty or `{}` (strict): anything else is a 400 and
 *      nothing runs
 *   A  ONE write-ahead `BOS_BOOST_RECONCILE_TRIGGERED` row, flushed BEFORE the
 *      pass, on a system entity (C-7: never a purchase), the admin as user and
 *      actor; then the boost pass once, trigger `admin`, 45 s deadline
 *   R  counts only in the response; no cron run is recorded; the cron secret
 *      is never read
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

// ── Gate ──────────────────────────────────────────────────────────────────
const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
// The gate's own refusal record is not this route's audit.
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const order: string[] = [];
const loggedArgs: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...args: unknown[]) => {
      loggedArgs.push(args);
    };
    const logger: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args) }));

// C7-11 rule: an admin press never records a run of the scheduled job.
const mockWithCronRunRecord = jest.fn();
jest.mock('@/lib/cron/cronRunRecorder', () => ({ withCronRunRecord: (...args: unknown[]) => mockWithCronRunRecord(...args) }));

const mockTablesTouched: string[] = [];
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      mockTablesTouched.push(table);
      throw new Error('no table access expected');
    },
    rpc: (fn: string) => {
      mockTablesTouched.push(`rpc:${fn}`);
      throw new Error('no rpc expected');
    },
  },
}));

const mockPassRun = jest.fn();
jest.mock('@/lib/business-os/boost/boostReconcileDeps', () => ({
  boostReconcilePass: { name: 'boost', run: (...args: unknown[]) => mockPassRun(...args) },
}));
// The cron's pass list must not be what the admin press runs (boost only).
const mockOtherPass = jest.fn();
jest.mock('@/lib/business-os/billing/reconcilePasses', () => ({
  RECONCILE_PASSES: [{ name: 'plan', run: (...args: unknown[]) => mockOtherPass(...args) }],
  RECONCILE_RUN_DEADLINE_MS: 45 * 1000,
}));

import { POST, maxDuration } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };
const URL = 'http://localhost/api/admin/business-os/credits/boost/reconcile';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function post(raw?: string): NextRequest {
  return new NextRequest(URL, { method: 'POST', ...(raw === undefined ? {} : { body: raw }), headers: { 'content-type': 'application/json' } });
}

function asAdmin() {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  loggedArgs.length = 0;
  mockTablesTouched.length = 0;
  mockLogAndFlush.mockImplementation(async () => {
    order.push('audit');
  });
  mockPassRun.mockImplementation(async () => {
    order.push('pass');
    return { examined: 2, credited: 1, flagged: 0 };
  });
});

function expectNothingRan() {
  expect(mockPassRun).not.toHaveBeenCalled();
  expect(mockOtherPass).not.toHaveBeenCalled();
  expect(mockLogAndFlush).not.toHaveBeenCalled();
  expect(mockTablesTouched).toEqual([]);
}

describe('G — the gate comes first (SA C-5)', () => {
  it('G-1 signed out → 401, the body is never read, nothing runs', async () => {
    mockGetUser.mockResolvedValue(null);
    const request = post('{}');
    const textSpy = jest.spyOn(request, 'text');
    expect((await POST(request)).status).toBe(401);
    expect(textSpy).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('G-2 signed in, not an admin → 403, the body is never read, nothing runs', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const request = post('{}');
    const textSpy = jest.spyOn(request, 'text');
    expect((await POST(request)).status).toBe(403);
    expect(textSpy).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('G-3 the admin check throws → 403; G-4 the auth lookup throws → 401', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));
    expect((await POST(post('{}'))).status).toBe(403);
    mockGetUser.mockRejectedValue(new Error('malformed cookie jar'));
    expect((await POST(post('{}'))).status).toBe(401);
    expectNothingRan();
  });

  it('G-5 an invalid body AND signed out → 401, not 400 (the gate wins)', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await POST(post('{"accountId":"x"}'))).status).toBe(401);
    expectNothingRan();
  });

  it('G-6 source: requireAdmin is the first statement after the correlation id and the child logger', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const handler = code.match(/export async function POST\(request: NextRequest\) \{([\s\S]*)$/);
    expect(handler).not.toBeNull();
    const beforeGate = handler![1].split('await requireAdmin(')[0];
    const statements = beforeGate.split(';').map((s) => s.trim()).filter(Boolean);
    // The last fragment is the gate's own `const gate =`.
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^const correlationId = /);
    expect(statements[1]).toMatch(/^const requestLogger = logger\.child\(/);
    expect(statements[2]).toBe('const gate =');
  });
});

describe('Z — the body carries nothing', () => {
  it.each([
    ['an account id', '{"accountId":"22222222-2222-4222-8222-222222222222"}'],
    ['a purchase id', '{"purchaseId":"x"}'],
    ['a mode', '{"livemode":true}'],
    ['an array', '[]'],
    ['not JSON', 'run it'],
    ['null', 'null'],
    // QA R-5
    ['a number', '0'],
    ['a JSON string', '"x"'],
    ['a client-supplied run id', '{"runId":"11111111-1111-4111-8111-111111111111"}'],
    ['a truncated object', '{'],
  ])('%s → 400, nothing runs and nothing is audited', async (_name, raw) => {
    asAdmin();
    const response = await POST(post(raw));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('invalid_input');
    expect(mockPassRun).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', undefined],
    ['an empty string', ''],
    ['{}', '{}'],
  ])('%s is accepted', async (_name, raw) => {
    asAdmin();
    expect((await POST(post(raw))).status).toBe(200);
    expect(mockPassRun).toHaveBeenCalledTimes(1);
  });
});

describe('A — one write-ahead audit row on a system entity, then the pass', () => {
  it('audits BEFORE the pass, against a system entity with the run id (SA C-7), admin as user and actor', async () => {
    asAdmin();
    const response = await POST(post('{}'));
    expect(response.status).toBe(200);
    expect(order).toEqual(['audit', 'pass']);

    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry, , context] = mockLogAndFlush.mock.calls[0] as [Record<string, unknown>, unknown, Record<string, unknown>];
    const body = (await response.json()) as { data: { runId: string } };
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.BOS_BOOST_RECONCILE_TRIGGERED,
      entityType: 'system',
      entityId: body.data.runId,
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'warning',
    });
    expect(body.data.runId).toMatch(UUID);
    // C-7: never on a purchase, so it reaches no owner's audit trail.
    expect(entry.entityType).not.toBe('business_os_boost_purchase');
    expect(Object.keys(entry.details as object).sort()).toEqual(['correlationId', 'run_id']);
    expect(context).toEqual({ reason: 'boost reconcile start', continues: 'the reconcile runs regardless' });
  });

  it('runs the boost pass once, trigger admin, on a 45 s deadline; never the cron pass list', async () => {
    asAdmin();
    const before = Date.now();
    await POST(post());
    expect(mockPassRun).toHaveBeenCalledTimes(1);
    const [context] = mockPassRun.mock.calls[0] as [{ trigger: string; deadlineAt: number; now: Date }];
    expect(context.trigger).toBe('admin');
    expect(context.deadlineAt - context.now.getTime()).toBe(45 * 1000);
    expect(context.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(mockOtherPass).not.toHaveBeenCalled();
  });

  it('an audit that fails (or times out) never stops the pass: logAndFlush never rejects by contract', async () => {
    asAdmin();
    mockLogAndFlush.mockImplementation(async () => undefined);
    expect((await POST(post())).status).toBe(200);
    expect(mockPassRun).toHaveBeenCalledTimes(1);
  });
});

describe('R — counts only; no cron run recorded; no secret read', () => {
  it('answers the flattened counts, passes run and failed, and the duration', async () => {
    asAdmin();
    const response = await POST(post());
    const body = (await response.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.counts).toEqual({ boostExamined: 2, boostCredited: 1, boostFlagged: 0 });
    expect(body.data).toMatchObject({ passesRun: 1, passesFailed: 0 });
    expect(typeof body.data.durationMs).toBe('number');
  });

  it('a pass that throws answers 200 with passesFailed 1 (the runner counts it)', async () => {
    asAdmin();
    mockPassRun.mockRejectedValue(new Error('defect'));
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: Record<string, unknown> }).data).toMatchObject({ passesRun: 1, passesFailed: 1 });
  });

  it('never records a run of the scheduled job and never reads CRON_SECRET (source)', async () => {
    asAdmin();
    await POST(post());
    expect(mockWithCronRunRecord).not.toHaveBeenCalled();
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('CRON_SECRET');
    expect(code).not.toContain('withCronRunRecord');
    expect(code).not.toContain('/api/cron/');
  });

  it('no log line carries an email address', async () => {
    asAdmin();
    await POST(post());
    expect(JSON.stringify(loggedArgs)).not.toContain('@');
  });

  it('has a 60 s limit, above the 45 s deadline', () => {
    expect(maxDuration).toBe(60);
  });
});
