/**
 * POST /api/admin/business-os/billing/reconcile (plan payments P-8b.3c;
 * workplan D3-4; SA ruling 5, P3-SA-3, P3-SA-8). The boost reconcile route's
 * test shape:
 *
 *   G  the gate comes first: on every denial nothing is read, run or audited
 *   Z  the body must be empty or `{}` (strict): anything else is a 400, after
 *      the gate, and nothing runs
 *   A  ONE write-ahead `BOS_BILLING_RECONCILE_TRIGGERED` row, flushed BEFORE
 *      the pass, on a system entity, the admin as user and actor; an audit
 *      write that rejects never stops the pass
 *   R  the plan pass only, trigger `admin`, 45 s deadline; counts only; the
 *      left-work warn on ANY plan `partlyDoneWhen` key; a lost claim is said in
 *      words; no cron run is recorded; the cron secret is never read
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';
import type Stripe from 'stripe';

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
const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (...args: unknown[]) => {
      logged.push({ level, args });
    };
    const logger: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The real bounded flush is used by the audit-reject test, over this sink.
const mockAuditLog = jest.fn();
const mockAuditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockAuditLog(...args), flush: (...args: unknown[]) => mockAuditFlush(...args) },
}));
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args) }));

// SA fix 1: an admin press never records a run of the scheduled job.
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
jest.mock('@/lib/business-os/billing/planReconcileDeps', () => ({
  planReconcilePass: { name: 'plan', run: (...args: unknown[]) => mockPassRun(...args) },
}));
// The cron's pass list must not be what the admin press runs (plan only; ruling 5).
const mockOtherPass = jest.fn();
jest.mock('@/lib/business-os/billing/reconcilePasses', () => ({
  RECONCILE_PASSES: [{ name: 'boost', run: (...args: unknown[]) => mockOtherPass(...args) }],
  RECONCILE_RUN_DEADLINE_MS: 45 * 1000,
}));

import { POST, maxDuration } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { findBosCronJob } from '@/lib/cron/bosCronJobs';
import { PLAN_LEFT_WORK_SENTENCES, planReconcileOutcome } from '@/app/admin/components/jobs/reconcileCopy';
import type { PlanReconcileDeps } from '@/lib/business-os/billing/planReconcilePass';
import type { ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };
const URL = 'http://localhost/api/admin/business-os/billing/reconcile';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The plan pass's own counts (unflattened), a clean run. */
const CLEAN = {
  eventsSeen: 2,
  replayed: 1,
  replayFailed: 0,
  skippedNotPlan: 1,
  apiVersionSkipped: 0,
  staleReclaimed: 0,
  mismatch: 0,
  orphan: 0,
  unassigned: 0,
  incomplete: 0,
  deadlineHit: 0,
  windowClipped: 0,
  checkIncomplete: 0,
};

/** The registry's plan keys in `partlyDoneWhen` (the warn's trigger set). */
const PLAN_PARTLY_DONE_KEYS = findBosCronJob('bos-billing-reconcile')!
  .partlyDoneWhen.map((condition) => condition.key)
  .filter((key) => key.startsWith('plan'));

function post(raw?: string): NextRequest {
  return new NextRequest(URL, { method: 'POST', ...(raw === undefined ? {} : { body: raw }), headers: { 'content-type': 'application/json' } });
}

function asAdmin() {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
}

const leftWorkWarns = () => logged.filter((line) => line.level === 'warn' && (line.args[0] as { event?: string })?.event === 'bos_plan_reconcile_admin_left_work');

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  logged.length = 0;
  mockTablesTouched.length = 0;
  mockLogAndFlush.mockImplementation(async () => {
    order.push('audit');
  });
  mockPassRun.mockImplementation(async () => {
    order.push('pass');
    return { ...CLEAN };
  });
});

function expectNothingRan() {
  expect(mockPassRun).not.toHaveBeenCalled();
  expect(mockOtherPass).not.toHaveBeenCalled();
  expect(mockLogAndFlush).not.toHaveBeenCalled();
  expect(mockTablesTouched).toEqual([]);
}

describe('G — the gate comes first (P3-SA-3)', () => {
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

  it('G-5 an invalid body AND signed out → 401, not 400; AND not an admin → 403, not 400 (the gate wins)', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await POST(post('{"accountId":"x"}'))).status).toBe(401);
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await POST(post('{"accountId":"x"}'))).status).toBe(403);
    expectNothingRan();
  });

  it('G-6 source: requireAdmin is the first statement after the correlation id and the child logger', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const handler = code.match(/export async function POST\(request: NextRequest\) \{([\s\S]*)$/);
    expect(handler).not.toBeNull();
    const beforeGate = handler![1].split('await requireAdmin(')[0];
    const statements = beforeGate.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^const correlationId = /);
    expect(statements[1]).toMatch(/^const requestLogger = logger\.child\(/);
    expect(statements[2]).toBe('const gate =');
  });
});

describe('Z — the body carries nothing', () => {
  it.each([
    ['an account id', '{"accountId":"22222222-2222-4222-8222-222222222222"}'],
    ['a subscription id', '{"subscriptionId":"sub_x"}'],
    ['an event id', '{"eventId":"evt_x"}'],
    ['a mode', '{"livemode":true}'],
    ['an array', '[]'],
    ['not JSON', 'run it'],
    ['null', 'null'],
    ['a number', '0'],
    ['a JSON string', '"x"'],
    ['a client-supplied run id', '{"runId":"11111111-1111-4111-8111-111111111111"}'],
    ['a truncated object', '{'],
  ])('%s → 400 after the gate, nothing runs and nothing is audited', async (_name, raw) => {
    asAdmin();
    const response = await POST(post(raw));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; error: string; details?: unknown };
    expect(body.code).toBe('invalid_input');
    expect(body.error).toBe('This action takes no input');
    expect(mockIsAdmin).toHaveBeenCalled();
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
  it('audits BEFORE the pass, against a system entity with the run id, admin as user and actor; details run_id and correlationId only', async () => {
    asAdmin();
    const response = await POST(post('{}'));
    expect(response.status).toBe(200);
    expect(order).toEqual(['audit', 'pass']);

    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry, , context] = mockLogAndFlush.mock.calls[0] as [Record<string, unknown>, unknown, Record<string, unknown>];
    const body = (await response.json()) as { data: { runId: string } };
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.BOS_BILLING_RECONCILE_TRIGGERED,
      entityType: 'system',
      entityId: body.data.runId,
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'warning',
    });
    expect(body.data.runId).toMatch(UUID);
    expect(Object.keys(entry.details as object).sort()).toEqual(['correlationId', 'run_id']);
    expect((entry.details as { run_id: string }).run_id).toBe(body.data.runId);
    expect(context).toEqual({ reason: 'plan reconcile start', continues: 'the reconcile runs regardless' });
  });

  it('an audit write that REJECTS (through the real bounded flush) still runs the pass and answers 200', async () => {
    asAdmin();
    const { logAndFlush: realLogAndFlush, __resetAuditFlushChainForTests } = jest.requireActual('@/lib/audit/boundedAuditFlush') as typeof import('@/lib/audit/boundedAuditFlush');
    __resetAuditFlushChainForTests();
    mockAuditLog.mockRejectedValue(new Error('audit_trail refused the insert'));
    mockAuditFlush.mockResolvedValue(undefined);
    mockLogAndFlush.mockImplementation((...args: unknown[]) => {
      order.push('audit');
      return (realLogAndFlush as (...a: unknown[]) => Promise<void>)(...args);
    });
    const response = await POST(post('{}'));
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(mockPassRun).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['audit', 'pass']);
    // The failure was logged, not swallowed.
    expect(logged.some((line) => line.level === 'error' || line.level === 'warn')).toBe(true);
  });
});

describe('R — the plan pass only; counts only; left work said; no cron run; no secret', () => {
  it('runs the plan pass once, trigger admin, on a 45 s deadline; never the cron pass list', async () => {
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

  it('answers the flattened plan counts, passes run and failed, and the duration', async () => {
    asAdmin();
    const response = await POST(post());
    const body = (await response.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.counts).toEqual({
      planEventsSeen: 2,
      planReplayed: 1,
      planReplayFailed: 0,
      planSkippedNotPlan: 1,
      planApiVersionSkipped: 0,
      planStaleReclaimed: 0,
      planMismatch: 0,
      planOrphan: 0,
      planUnassigned: 0,
      planIncomplete: 0,
      planDeadlineHit: 0,
      planWindowClipped: 0,
      planCheckIncomplete: 0,
    });
    expect(body.data).toMatchObject({ passesRun: 1, passesFailed: 0 });
    expect(typeof body.data.durationMs).toBe('number');
    expect(leftWorkWarns()).toEqual([]);
  });

  it('a pass that throws answers 200 with passesFailed 1 (the runner counts it)', async () => {
    asAdmin();
    mockPassRun.mockRejectedValue(new Error('defect'));
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: Record<string, unknown> }).data).toMatchObject({ passesRun: 1, passesFailed: 1 });
  });

  it('the warn set is exactly the six plan partlyDoneWhen keys of the registry', () => {
    expect([...PLAN_PARTLY_DONE_KEYS].sort()).toEqual(
      ['planApiVersionSkipped', 'planCheckIncomplete', 'planDeadlineHit', 'planIncomplete', 'planReplayFailed', 'planWindowClipped'].sort()
    );
  });

  it.each(PLAN_PARTLY_DONE_KEYS)('%s > 0 → one bos_plan_reconcile_admin_left_work warn, counts only', async (key) => {
    asAdmin();
    const passKey = key.charAt(4).toLowerCase() + key.slice(5);
    mockPassRun.mockResolvedValue({ ...CLEAN, [passKey]: 2 });
    expect((await POST(post())).status).toBe(200);
    const warns = leftWorkWarns();
    expect(warns).toHaveLength(1);
    const [fields] = warns[0].args as [Record<string, unknown>];
    expect(Object.keys(fields).sort()).toEqual(['event', key, 'runId'].sort());
    expect(fields[key]).toBe(2);
    expect(fields.runId).toMatch(UUID);
  });

  it('a pass that failed (passesFailed > 0) → the same one left-work warn, counts only', async () => {
    asAdmin();
    mockPassRun.mockRejectedValue(new Error('defect'));
    expect((await POST(post())).status).toBe(200);
    const warns = leftWorkWarns();
    expect(warns).toHaveLength(1);
    const [fields] = warns[0].args as [Record<string, unknown>];
    expect(Object.keys(fields).sort()).toEqual(['event', 'passesFailed', 'runId']);
    expect(fields.passesFailed).toBe(1);
    expect(JSON.stringify(fields)).not.toContain('defect');
  });

  it('findings alone (mismatch, orphan, unassigned) are not left work: no left-work warn', async () => {
    asAdmin();
    mockPassRun.mockResolvedValue({ ...CLEAN, mismatch: 1, orphan: 1, unassigned: 1 });
    expect((await POST(post())).status).toBe(200);
    expect(leftWorkWarns()).toEqual([]);
  });

  it('a LOST claim (another run holds the event): the real pass counts it incomplete, the route warns, and the words say so (R3-3)', async () => {
    asAdmin();
    const { createPlanReconcilePass } = jest.requireActual('@/lib/business-os/billing/planReconcilePass') as typeof import('@/lib/business-os/billing/planReconcilePass');
    const API = '2025-10-29.clover';
    const event = {
      id: 'evt_lost1',
      object: 'event',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000) - 60,
      livemode: false,
      api_version: API,
      data: { object: { id: 'in_lost1' } },
    } as unknown as Stripe.Event;
    const handled: string[] = [];
    const deps: PlanReconcileDeps = {
      eventTypes: ['invoice.paid'],
      verifiedShapes: { [API]: ['invoice.paid'] },
      staleClaimAgeMs: 15 * 60 * 1000,
      keyLivemode: () => false,
      stripe: () => ({
        listBusinessOsPlanEvents: async () => ({ items: [event], complete: true }),
        listBusinessOsSubscriptionsByPrice: async () => ({ items: [], complete: true }),
      }),
      claims: {
        findClaim: async () => ({ data: null, error: null }),
        // The nightly run (or a live delivery) claimed it between the read and this insert.
        insertClaim: async () => ({ error: { code: '23505', message: 'duplicate' } }),
        reclaimStale: async () => ({ data: { won: false }, error: null }),
        reclaimFailedIfStillFailed: async () => ({ data: { won: false }, error: null }),
        complete: async () => ({ error: null }),
        markFailed: async () => ({ error: null }),
      },
      dispatch: async () => ({ kind: 'plan' }),
      handle: async (e) => {
        handled.push(e.id);
      },
      recentRuns: async () => ({ data: [], error: null }),
      billingRows: async () => ({ data: [], error: null }),
      planFacts: async () => ({ data: {}, error: null }),
      recordedPayments: async () => ({ data: { eventIds: [], invoiceIds: [] }, error: null }),
      planPrices: async () => new Map(),
      clock: () => Date.now(),
    };
    const realPass = createPlanReconcilePass(deps);
    mockPassRun.mockImplementation((context: ReconcilePassContext) => realPass.run(context));

    const response = await POST(post('{}'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { counts: Record<string, number>; passesFailed: number } };
    expect(handled).toEqual([]);
    expect(body.data.counts.planIncomplete).toBe(1);
    expect(body.data.counts.planReplayed).toBe(0);
    expect(leftWorkWarns()).toHaveLength(1);

    const lines = planReconcileOutcome(body.data);
    expect(lines).not.toBeNull();
    expect(lines![0]).toMatch(/^Plan reconcile did not finish everything: /);
    expect(lines).toContain(PLAN_LEFT_WORK_SENTENCES.planIncomplete(1));
    expect(lines).toContain('Some plan events were left for the nightly run: another run held them, or a limit was reached.');
    expect(lines!.some((line) => line.startsWith('Plan reconcile finished'))).toBe(false);
  });

  it('never records a run of the scheduled job, never reads CRON_SECRET, never imports the cron pass list (source)', async () => {
    asAdmin();
    await POST(post());
    expect(mockWithCronRunRecord).not.toHaveBeenCalled();
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('CRON_SECRET');
    expect(code).not.toContain('withCronRunRecord');
    expect(code).not.toContain('cronRunRecorder');
    expect(code).not.toContain('BosCronRunRepository');
    expect(code).not.toContain('bos_cron_runs');
    expect(code).not.toContain('/api/cron/');
    expect(code).not.toContain('RECONCILE_PASSES');
    expect(code).toContain("import { planReconcilePass } from '@/lib/business-os/billing/planReconcileDeps';");
    expect(code).toMatch(/runReconcilePasses\(\[planReconcilePass\],/);
    expect(code).not.toMatch(/boostReconcile/);
    // It never reads an env var at all (P3-SA-11) beyond the development-details guard.
    expect(code.match(/process\.env\.\w+/g)?.every((ref) => ref === 'process.env.NODE_ENV')).toBe(true);
  });

  it('no log line carries an email address', async () => {
    asAdmin();
    await POST(post());
    expect(JSON.stringify(logged)).not.toContain('@');
  });

  it('has a 60 s limit, above the 45 s deadline', () => {
    expect(maxDuration).toBe(60);
  });
});
