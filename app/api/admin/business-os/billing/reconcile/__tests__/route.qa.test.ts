/**
 * QA (P-8b.3c): adversarial tests for POST /api/admin/business-os/billing/reconcile.
 *
 *   QG  gate order with odd and huge bodies: 401/403 always win over 400, and
 *       the body is never read before the gate
 *   QZ  bodies the Dev suite did not try (prototype keys, nested, whitespace,
 *       BOM, two objects, a 1 MB object)
 *   QA  the audit write HANGS (bounded: the pass still runs inside the budget)
 *       or throws synchronously
 *   QE  the runner itself throws: 500, fixed words, details only in development,
 *       no raw text in the production answer
 *   QP  no PII, secret or raw Stripe text reaches the answer or the logs when
 *       the pass throws with such text in its message
 *   QC  odd counts from the pass (fractions, strings, NaN) are dropped by the
 *       runner; the answer is still well formed
 *   QR  the REAL production wiring (`planReconcileDeps`) over a recording
 *       Supabase stub: `bos_cron_runs` is only ever read, never written
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (...args: unknown[]) => {
      logged.push({ level, args });
    };
    const logger: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal') };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make(), logger: make() };
});

const mockAuditLog = jest.fn();
const mockAuditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockAuditLog(...args), flush: (...args: unknown[]) => mockAuditFlush(...args) },
}));

// A recording Supabase stub: every table, every chained method, in order.
type Op = { table: string; methods: string[] };
const mockOps: Op[] = [];
jest.mock('@/lib/supabaseServer', () => {
  const builder = (op: Op): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'then') {
            const single = op.methods.includes('maybeSingle') || op.methods.includes('single');
            const result = single ? { data: null, error: null } : { data: [], error: null, count: 0 };
            return (resolve: (v: unknown) => void) => resolve(result);
          }
          return () => {
            op.methods.push(prop);
            return builder(op);
          };
        },
      }
    );
  return {
    supabaseServer: {
      from: (table: string) => {
        const op = { table, methods: [] as string[] };
        mockOps.push(op);
        return builder(op);
      },
      rpc: (fn: string) => {
        const op = { table: `rpc:${fn}`, methods: [] as string[] };
        mockOps.push(op);
        return builder(op);
      },
    },
  };
});

// Stripe is never called: the service is a stub that lists one plan event.
const mockListEvents = jest.fn();
const mockListSubs = jest.fn();
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({
    listBusinessOsPlanEvents: (...a: unknown[]) => mockListEvents(...a),
    listBusinessOsSubscriptionsByPrice: (...a: unknown[]) => mockListSubs(...a),
  }),
}));
jest.mock('@/lib/business-os/billing/planPriceCatalog', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planPriceCatalog');
  return { ...actual, planPriceCatalog: { load: async () => ({ byPriceId: new Map<string, string>() }) } };
});
const mockHandle = jest.fn();
jest.mock('@/lib/business-os/billing/planBillingHandler', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planBillingHandler');
  return { ...actual, handlePlanBillingEvent: (...a: unknown[]) => mockHandle(...a) };
});
jest.mock('@/lib/business-os/billing/webhookDispatcher', () => ({
  dispatchBusinessOsEvent: async () => ({ kind: 'flow', flow: 'plan' }),
}));

// The runner is real by default; QE swaps in a throwing one.
const mockRunnerOverride: { fn: null | ((...a: unknown[]) => unknown) } = { fn: null };
jest.mock('@/lib/business-os/billing/reconcilePassRunner', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/reconcilePassRunner');
  return {
    ...actual,
    runReconcilePasses: (...a: unknown[]) => (mockRunnerOverride.fn ? mockRunnerOverride.fn(...a) : actual.runReconcilePasses(...a)),
  };
});

// The pass under test: QR uses the real wiring; the other blocks swap its run.
const mockPassOverride: { fn: null | ((...a: unknown[]) => unknown) } = { fn: null };
jest.mock('@/lib/business-os/billing/planReconcileDeps', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planReconcileDeps');
  return {
    ...actual,
    planReconcilePass: {
      name: 'plan',
      run: (...a: unknown[]) => (mockPassOverride.fn ? mockPassOverride.fn(...a) : actual.planReconcilePass.run(...a)),
    },
  };
});

import { POST } from '../route';
import { __resetAuditFlushChainForTests, AUDIT_FLUSH_TIMEOUT_MS } from '@/lib/audit/boundedAuditFlush';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };
const URL = 'http://localhost/api/admin/business-os/billing/reconcile';
const PII = 'jane.doe+billing@example.org';
const SECRET = 'sk_live_51QAfakeSECRETvalue';
const RAW_STRIPE = 'No such customer: cus_RAWSTRIPE123';

function post(raw?: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL, {
    method: 'POST',
    ...(raw === undefined ? {} : { body: raw }),
    headers: { 'content-type': 'application/json', ...headers },
  });
}
function asAdmin() {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
}
const CLEAN = { eventsSeen: 0, replayed: 0, replayFailed: 0, incomplete: 0, deadlineHit: 0, windowClipped: 0, apiVersionSkipped: 0, checkIncomplete: 0, mismatch: 0, orphan: 0, unassigned: 0 };

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  mockOps.length = 0;
  mockRunnerOverride.fn = null;
  mockPassOverride.fn = async () => ({ ...CLEAN });
  mockAuditLog.mockResolvedValue(undefined);
  mockAuditFlush.mockResolvedValue(undefined);
  __resetAuditFlushChainForTests();
});
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV;
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
});

const HUGE = JSON.stringify({ accountId: 'x'.repeat(1024 * 1024) });

describe('QG: the gate wins over any body', () => {
  it.each([
    ['a 1 MB object', HUGE],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"x"'],
    ['not JSON', '<html>'],
    ['extra keys', '{"a":1,"b":2}'],
  ])('%s: signed out → 401, not an admin → 403; the body is never read, nothing is audited or run', async (_n, raw) => {
    const passSpy = jest.fn();
    mockPassOverride.fn = passSpy;
    mockGetUser.mockResolvedValue(null);
    let request = post(raw);
    let textSpy = jest.spyOn(request, 'text');
    expect((await POST(request)).status).toBe(401);
    expect(textSpy).not.toHaveBeenCalled();

    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    request = post(raw);
    textSpy = jest.spyOn(request, 'text');
    expect((await POST(request)).status).toBe(403);
    expect(textSpy).not.toHaveBeenCalled();

    expect(passSpy).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockOps).toEqual([]);
  });
});

describe('QZ: bodies after the gate', () => {
  it.each([
    ['a 1 MB object', HUGE],
    ['__proto__ key', '{"__proto__":{"admin":true}}'],
    ['constructor key', '{"constructor":{}}'],
    ['a nested empty object', '{"x":{}}'],
    ['an array holding {}', '[{}]'],
    ['two objects', '{}{}'],
    ['true', 'true'],
    ['a key with an empty name', '{"":0}'],
  ])('%s → 400 with fixed words, no details outside development, nothing audited or run', async (_n, raw) => {
    asAdmin();
    const passSpy = jest.fn();
    mockPassOverride.fn = passSpy;
    const response = await POST(post(raw));
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ success: false, error: 'This action takes no input', code: 'invalid_input' });
    expect(passSpy).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    // The rejected body never reaches a log line.
    expect(JSON.stringify(logged)).not.toContain('xxxxxxxxxx');
  });

  it.each([
    ['{} with whitespace', '  \n{ }\t '],
    ['whitespace only', ' \n\t '],
    // The body is decoded as UTF-8, which strips a leading BOM: it is still `{}`.
    ['a BOM before {}', '﻿{}'],
  ])('%s is accepted as the empty body', async (_n, raw) => {
    asAdmin();
    expect((await POST(post(raw))).status).toBe(200);
  });

  it('in development a 400 carries a Zod message, never the body', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    asAdmin();
    const response = await POST(post(JSON.stringify({ leak: PII })));
    const body = (await response.json()) as { details?: unknown };
    expect(response.status).toBe(400);
    expect(typeof body.details).toBe('string');
    expect(JSON.stringify(body)).not.toContain(PII);
  });
});

describe('QA: the audit write is bounded and never blocks the run', () => {
  it('a HANGING audit flush: the pass still runs and the answer is 200, inside the flush budget plus slack', async () => {
    asAdmin();
    mockAuditFlush.mockImplementation(() => new Promise(() => undefined));
    const passSpy = jest.fn(async () => ({ ...CLEAN }));
    mockPassOverride.fn = passSpy;
    const started = Date.now();
    const response = await POST(post('{}'));
    const elapsed = Date.now() - started;
    expect(response.status).toBe(200);
    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(AUDIT_FLUSH_TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(AUDIT_FLUSH_TIMEOUT_MS + 1500);
    expect(logged.some((l) => l.level === 'warn' || l.level === 'error')).toBe(true);
  }, 10000);

  it('an audit log() that THROWS synchronously: the pass still runs and the answer is 200', async () => {
    asAdmin();
    mockAuditLog.mockImplementation(() => {
      throw new Error(`audit exploded for ${PII}`);
    });
    const passSpy = jest.fn(async () => ({ ...CLEAN }));
    mockPassOverride.fn = passSpy;
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await response.json())).not.toContain(PII);
  });
});

describe('QE: the runner itself throws (the defect guard)', () => {
  const boom = () => {
    throw new Error(`${RAW_STRIPE} for ${PII} using ${SECRET}`);
  };

  it('production: 500, fixed words, no details, no raw text in the answer', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    asAdmin();
    mockRunnerOverride.fn = async () => boom();
    const response = await POST(post());
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      success: false,
      error: 'The plan reconcile stopped with an error. Some events may already have been replayed.',
      code: 'reconcile_failed',
    });
    expect(JSON.stringify(body)).not.toMatch(/sk_live|cus_|@example\.org/);
    const errors = logged.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].args[1]).toBe('Plan reconcile failed');
  });

  it('test env (not development): no details either', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    asAdmin();
    mockRunnerOverride.fn = async () => boom();
    const body = (await (await POST(post())).json()) as Record<string, unknown>;
    expect(body.details).toBeUndefined();
  });

  it('development: details are the error message (development only)', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    asAdmin();
    mockRunnerOverride.fn = async () => boom();
    const body = (await (await POST(post())).json()) as { details?: string };
    expect(body.details).toContain('No such customer');
  });

  it('a non-Error throw (a string) is handled the same way', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    asAdmin();
    mockRunnerOverride.fn = async () => {
      throw 'plain string';
    };
    const response = await POST(post());
    expect(response.status).toBe(500);
    expect(((await response.json()) as { details?: unknown }).details).toBeUndefined();
  });
});

describe('QP: the pass throws with PII, a secret and raw Stripe text in its message', () => {
  it('200, passesFailed 1, and neither the answer nor any log line carries the text', async () => {
    asAdmin();
    mockPassOverride.fn = async () => {
      const err = new Error(`${RAW_STRIPE} for ${PII} using ${SECRET}`);
      err.name = 'StripeInvalidRequestError';
      throw err;
    };
    const response = await POST(post('{}', { 'x-correlation-id': 'corr-qa-1' }));
    expect(response.status).toBe(200);
    const text = JSON.stringify(await response.json());
    expect(JSON.parse(text).data).toMatchObject({ passesRun: 1, passesFailed: 1, counts: {} });
    const logs = JSON.stringify(logged);
    for (const s of [PII, SECRET, 'cus_RAWSTRIPE123', 'No such customer']) {
      expect(text).not.toContain(s);
      expect(logs).not.toContain(s);
    }
    // The runner names the error class only.
    expect(logs).toContain('StripeInvalidRequestError');
    // The admin's email never appears either (only the UUID).
    expect(logs).not.toContain(ADMIN.email);
    expect(text).not.toContain(ADMIN.email);
  });
});

describe('QC: odd counts from the pass', () => {
  it('fractions, strings, NaN, Infinity and bad keys are dropped; the answer holds only safe integers', async () => {
    asAdmin();
    mockPassOverride.fn = async () => ({
      eventsSeen: 2,
      replayed: 1.5,
      incomplete: 'yes',
      deadlineHit: Number.NaN,
      windowClipped: Number.POSITIVE_INFINITY,
      'bad-key': 1,
    });
    const response = await POST(post());
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { counts: Record<string, unknown>; passesFailed: number } };
    expect(data.counts).toEqual({ planEventsSeen: 2 });
    expect(data.passesFailed).toBe(0);
    // A dropped left-work key cannot raise the warn.
    expect(logged.some((l) => (l.args[0] as { event?: string })?.event === 'bos_plan_reconcile_admin_left_work')).toBe(false);
  });
});

describe('QR: the real production wiring never writes bos_cron_runs', () => {
  it('one plan event is claimed and replayed; bos_cron_runs is only selected from; no rpc touches a run', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_qa_not_a_real_key';
    asAdmin();
    mockPassOverride.fn = null; // the real planReconcilePass over the real lazy wiring
    const API = '2025-10-29.clover';
    mockListEvents.mockResolvedValue({
      items: [
        {
          id: 'evt_qa_1',
          object: 'event',
          type: 'invoice.paid',
          created: Math.floor(Date.now() / 1000) - 120,
          livemode: false,
          api_version: API,
          data: { object: { id: 'in_qa_1' } },
        },
      ],
      complete: true,
    });
    mockListSubs.mockResolvedValue({ items: [], complete: true });
    mockHandle.mockResolvedValue(undefined);

    const response = await POST(post());
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { counts: Record<string, number>; passesFailed: number } };
    expect(data.passesFailed).toBe(0);
    expect(mockHandle).toHaveBeenCalledTimes(1);
    expect(data.counts.planReplayed).toBe(1);

    const cronOps = mockOps.filter((op) => op.table === 'bos_cron_runs');
    expect(cronOps.length).toBeGreaterThan(0); // the window anchor read happened
    for (const op of cronOps) {
      expect(op.methods).toContain('select');
      for (const write of ['insert', 'update', 'upsert', 'delete']) expect(op.methods).not.toContain(write);
    }
    expect(mockOps.filter((op) => op.table.startsWith('rpc:')).map((op) => op.table)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/cron/i)])
    );
    // The only writes are claim rows (and the audit, which is mocked away).
    const writes = mockOps.filter((op) => op.methods.some((m) => ['insert', 'update', 'upsert', 'delete'].includes(m)));
    expect(new Set(writes.map((op) => op.table))).toEqual(new Set(['processed_webhook_events']));
  });
});
