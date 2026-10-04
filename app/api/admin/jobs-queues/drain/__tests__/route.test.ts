/**
 * POST /api/admin/jobs-queues/drain — "Drain now" (ADMIN_BOS_CLEANUP slice 7d).
 *
 * Workplan §5.1–§5.5 as amended by SA (W7D-1, W7D-3, W7D-6, W7D-9, W7D-10):
 *   G  the gate comes first, and on a denial nothing runs and nothing is read
 *   Z  strict Zod → 400, and nothing runs
 *   Q  each queue calls only its own drain, once; two presses are two runs
 *   A  ONE write-ahead audit row (BOS_QUEUE_DRAIN_STARTED) flushed BEFORE the
 *      drain; counts only, in the response and the log; no run record; no
 *      content anywhere
 *
 * Every service module is a factory mock (W7D-6): no real service, database
 * client or PDF chain is loaded.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

// ── Gate ──────────────────────────────────────────────────────────────────
const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }),
  },
}));

// The gate's own refusal record is not this route's audit; kept out of the way
// so "logAndFlush was not called" is exact on every denial.
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

// ── Order log: every observable step, in order ───────────────────────────
const order: string[] = [];

// ── Logger: records every call ───────────────────────────────────────────
const loggedArgs: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec =
      (level: string) =>
      (...args: unknown[]) => {
        loggedArgs.push({ level, args });
      };
    const logger: Record<string, unknown> = {
      info: rec('info'),
      warn: rec('warn'),
      error: rec('error'),
      debug: rec('debug'),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// ── Audit flush: controllable, recording ─────────────────────────────────
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args),
}));

// ── Run record (C7-11): must never be called ─────────────────────────────
const mockWithCronRunRecord = jest.fn();
jest.mock('@/lib/cron/cronRunRecorder', () => ({
  withCronRunRecord: (...args: unknown[]) => mockWithCronRunRecord(...args),
}));

// ── Database: any table touch is recorded (none is expected) ─────────────
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

// ── The five drains, plus what the cron routes also run (never here) ─────
const mockProcessDueReminders = jest.fn();
const mockProcessOverdueItems = jest.fn();
const mockBillDueDatedStages = jest.fn();
const mockMarkAllOverdueInvoices = jest.fn();
const mockProcessScheduledExecutions = jest.fn();
const mockProcessDueRetries = jest.fn();
const mockProcessDueBriefings = jest.fn();
const mockDispatchLeadResponses = jest.fn();
const mockDrainInsightActions = jest.fn();

jest.mock('@/lib/services/PaymentReminderService', () => ({
  paymentReminderService: {
    processDueReminders: (...a: unknown[]) => mockProcessDueReminders(...a),
    processOverdueItems: (...a: unknown[]) => mockProcessOverdueItems(...a),
    billDueDatedStages: (...a: unknown[]) => mockBillDueDatedStages(...a),
  },
}));
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: { markAllOverdueInvoices: (...a: unknown[]) => mockMarkAllOverdueInvoices(...a) },
}));
jest.mock('@/lib/services/PaymentAutomationEngine', () => ({
  paymentAutomationEngine: {
    processScheduledExecutions: (...a: unknown[]) => mockProcessScheduledExecutions(...a),
  },
}));
jest.mock('@/lib/services/PaymentRetryService', () => ({
  paymentRetryService: { processDueRetries: (...a: unknown[]) => mockProcessDueRetries(...a) },
}));
jest.mock('@/lib/services/DailyBriefingDispatchService', () => ({
  processDueBriefings: (...a: unknown[]) => mockProcessDueBriefings(...a),
}));
jest.mock('@/lib/services/LeadResponseDispatchService', () => ({
  dispatchLeadResponses: (...a: unknown[]) => mockDispatchLeadResponses(...a),
}));
jest.mock('@/lib/services/InsightActionDispatchService', () => ({
  drainInsightActions: (...a: unknown[]) => mockDrainInsightActions(...a),
}));

import { POST } from '../route';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };
const DRAIN_URL = 'http://localhost/api/admin/jobs-queues/drain';
const ALL_QUEUES: BosQueueId[] = BOS_QUEUES.map((q) => q.id);

const ENTRY: Record<BosQueueId, jest.Mock> = {
  payment_reminders: mockProcessDueReminders,
  payment_automations: mockProcessScheduledExecutions,
  daily_briefing_sends: mockProcessDueBriefings,
  lead_responses: mockDispatchLeadResponses,
  insight_actions: mockDrainInsightActions,
};
const NEVER = [mockProcessOverdueItems, mockBillDueDatedStages, mockMarkAllOverdueInvoices, mockProcessDueRetries];

const DEFAULT_RESULT: Record<BosQueueId, unknown> = {
  payment_reminders: { processed: 3, sent: 2, failed: 1 },
  payment_automations: undefined,
  daily_briefing_sends: { enqueued: 2, sent: 1, skipped: 1, failed: 0 },
  lead_responses: { reaped: 1, enqueued: 2, claimed: 3, sent: 2, skipped: 1 },
  insight_actions: { reaped: 0, claimed: 2, sent: 2, skipped: 0, failed: 0 },
};

function post(body: unknown, init: { raw?: string; headers?: Record<string, string> } = {}): NextRequest {
  const payload = init.raw !== undefined ? init.raw : body === undefined ? undefined : JSON.stringify(body);
  return new NextRequest(DRAIN_URL, {
    method: 'POST',
    ...(payload === undefined ? {} : { body: payload }),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

const valid = (queue: BosQueueId = 'lead_responses', reason = 'cron is down') => post({ queue, reason });

function asAdmin() {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
}

function drainCalls(): number {
  return Object.values(ENTRY).reduce((n, m) => n + m.mock.calls.length, 0);
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setImmediate(r));

/** Let the route run until `condition` holds (bounded), without real timers. */
async function until(condition: () => boolean) {
  for (let i = 0; i < 50 && !condition(); i++) await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  loggedArgs.length = 0;
  mockTablesTouched.length = 0;
  for (const [queue, mock] of Object.entries(ENTRY) as Array<[BosQueueId, jest.Mock]>) {
    mock.mockImplementation(async () => {
      order.push(`drain:${queue}`);
      return DEFAULT_RESULT[queue];
    });
  }
  mockLogAndFlush.mockImplementation(async () => {
    order.push('audit');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('G — the gate comes first (C7-14, W7D-3)', () => {
  function expectNothingRan() {
    expect(drainCalls()).toBe(0);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockTablesTouched).toEqual([]);
    for (const m of NEVER) expect(m).not.toHaveBeenCalled();
  }

  it('G-1 signed out → 401, nothing runs, the body is never read', async () => {
    mockGetUser.mockResolvedValue(null);
    const request = valid();
    const jsonSpy = jest.spyOn(request, 'json');
    const res = await POST(request);
    expect(res.status).toBe(401);
    expect(jsonSpy).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('G-2 signed in, not an admin → 403, nothing runs, the body is never read', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const request = valid();
    const jsonSpy = jest.spyOn(request, 'json');
    const res = await POST(request);
    expect(res.status).toBe(403);
    expect(jsonSpy).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('G-3 the admin check throws → 403, nothing runs', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));
    const res = await POST(valid());
    expect(res.status).toBe(403);
    expectNothingRan();
  });

  it('G-4 the auth lookup throws → 401, nothing runs', async () => {
    mockGetUser.mockRejectedValue(new Error('malformed cookie jar'));
    const res = await POST(valid());
    expect(res.status).toBe(401);
    expectNothingRan();
  });

  it('G-5 an invalid body AND signed out → 401, not 400 (the gate wins)', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await POST(post({ queue: 'nope' }));
    expect(res.status).toBe(401);
    expectNothingRan();
  });

  it('G-6 source: inside POST, requireAdmin( is preceded only by the correlation id and logger.child', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const handler = code.match(/export async function POST\(request: NextRequest\) \{([\s\S]*)$/);
    expect(handler).not.toBeNull();
    const beforeGate = handler![1].split('await requireAdmin(')[0];
    const statements = beforeGate
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3); // correlation id, logger child, and the `const gate =` head
    expect(statements[0]).toMatch(/^const correlationId = request\.headers\.get\('x-correlation-id'\) \|\| crypto\.randomUUID\(\)$/);
    expect(statements[1]).toMatch(/^const requestLogger = logger\.child\(\{ correlationId, route: ROUTE \}\)$/);
    expect(statements[2]).toBe('const gate =');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Z — strict Zod → 400, nothing runs (W7D-4)', () => {
  beforeEach(asAdmin);

  async function expect400(request: NextRequest) {
    const res = await POST(request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: 'invalid_input' });
    expect(typeof body.error).toBe('string');
    expect(drainCalls()).toBe(0);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    return body;
  }

  it('Z-1 an unknown queue', async () => {
    await expect400(post({ queue: 'nope', reason: 'abc' }));
  });

  it.each([
    ['missing', { queue: 'lead_responses' }],
    ['1 character after trim', { queue: 'lead_responses', reason: ' a ' }],
    ['blank', { queue: 'lead_responses', reason: '     ' }],
    ['501 characters', { queue: 'lead_responses', reason: 'x'.repeat(501) }],
    ['not a string', { queue: 'lead_responses', reason: 12345 }],
  ])('Z-2 a reason that is %s', async (_label, body) => {
    await expect400(post(body));
  });

  it('Z-2 a two-character reason padded with spaces', async () => {
    await expect400(post({ queue: 'lead_responses', reason: '  ab  ' }));
  });

  it('Z-3 an extra key (strict): accountId', async () => {
    await expect400(post({ queue: 'lead_responses', reason: 'abc', accountId: CUSTOMER.id }));
  });

  it('Z-4 a body that is not JSON, and an empty body', async () => {
    await expect400(post(undefined, { raw: 'not json' }));
    await expect400(post(undefined));
  });

  it('Z-5 the reason is trimmed before it is recorded', async () => {
    const res = await POST(post({ queue: 'lead_responses', reason: '  fix stuck cron  ' }));
    expect(res.status).toBe(200);
    expect(mockLogAndFlush.mock.calls[0][0].details.reason).toBe('fix stuck cron');
  });

  it('Z-6 details only in development', async () => {
    const before = process.env.NODE_ENV;
    try {
      const prod = await expect400(post({ queue: 'nope', reason: 'abc' }));
      expect(prod.details).toBeUndefined();
      Object.assign(process.env, { NODE_ENV: 'development' });
      const dev = await expect400(post({ queue: 'nope', reason: 'abc' }));
      expect(typeof dev.details).toBe('string');
    } finally {
      Object.assign(process.env, { NODE_ENV: before });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Q — each queue calls only its own drain (C7-10, C7-16)', () => {
  beforeEach(asAdmin);

  it.each(ALL_QUEUES)('%s → exactly its own entry point, once, with no arguments', async (queue) => {
    const res = await POST(valid(queue));
    expect(res.status).toBe(200);
    for (const [id, mock] of Object.entries(ENTRY)) {
      if (id === queue) {
        expect(mock).toHaveBeenCalledTimes(1);
        expect(mock).toHaveBeenCalledWith();
      } else {
        expect(mock).not.toHaveBeenCalled();
      }
    }
    // Never the cron's other steps: stage billing, overdue scan, overdue
    // marking, Stripe retries (§C last column).
    for (const m of NEVER) expect(m).not.toHaveBeenCalled();
  });

  it('two presses at once are two runs: no server lock refuses or serialises them (§D.4)', async () => {
    const [a, b] = await Promise.all([POST(valid('payment_reminders')), POST(valid('payment_reminders'))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(mockProcessDueReminders).toHaveBeenCalledTimes(2);
  });

  it('QA: two presses at once write two audit rows, one per press, each with its own correlation id', async () => {
    const [a, b] = await Promise.all([
      POST(valid('payment_reminders', 'first press')),
      POST(valid('payment_reminders', 'second press')),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(mockLogAndFlush).toHaveBeenCalledTimes(2);
    const rows = mockLogAndFlush.mock.calls.map(([entry]) => entry);
    expect(rows.map((r) => r.action)).toEqual(['BOS_QUEUE_DRAIN_STARTED', 'BOS_QUEUE_DRAIN_STARTED']);
    expect(rows.map((r) => r.details.reason).sort()).toEqual(['first press', 'second press']);
    expect(rows[0].details.correlationId).not.toBe(rows[1].details.correlationId);
  });

  it('the drain is awaited: the response waits for it (no fire-and-forget, B7-11)', async () => {
    const gate = deferred<unknown>();
    mockDrainInsightActions.mockImplementationOnce(() => gate.promise);
    let settled = false;
    const pending = POST(valid('insight_actions')).then((r) => {
      settled = true;
      return r;
    });
    await until(() => mockDrainInsightActions.mock.calls.length > 0);
    await flush();
    expect(mockDrainInsightActions).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    gate.resolve({ claimed: 1, sent: 1 });
    const res = await pending;
    expect(settled).toBe(true);
    expect((await res.json()).data.counts).toEqual([
      { key: 'claimed', label: 'picked up', value: 1 },
      { key: 'sent', label: 'sent', value: 1 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('A — write-ahead audit, counts only, no run record (W7D-1, W7D-9, W7D-10)', () => {
  beforeEach(asAdmin);

  it('A-1 one row, exactly this shape, flushed through logAndFlush', async () => {
    const res = await POST(valid('lead_responses', 'cron is down'));
    expect(res.status).toBe(200);

    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry, flushLogger, context] = mockLogAndFlush.mock.calls[0];
    expect(entry).toEqual({
      action: 'BOS_QUEUE_DRAIN_STARTED',
      entityType: 'bos_queue',
      entityId: 'lead_responses',
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'warning',
      details: { reason: 'cron is down', queue: 'lead_responses', correlationId: expect.any(String) },
      request: expect.anything(),
    });
    expect(Object.keys(entry.details).sort()).toEqual(['correlationId', 'queue', 'reason']);
    expect(flushLogger).toBeDefined();
    expect(context).toEqual({ reason: expect.any(String), continues: expect.any(String) });

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(['counts', 'durationMs', 'queue']);
    expect(body.data.queue).toBe('lead_responses');
    expect(body.data.counts).toEqual([
      { key: 'reaped', label: 'recovered from a dead run', value: 1 },
      { key: 'enqueued', label: 'queued', value: 2 },
      { key: 'claimed', label: 'picked up', value: 3 },
      { key: 'sent', label: 'sent', value: 2 },
      { key: 'skipped', label: 'skipped', value: 1 },
    ]);
    expect(typeof body.data.durationMs).toBe('number');
  });

  it('A-1 the correlation id in the row is the request header when given', async () => {
    await POST(post({ queue: 'insight_actions', reason: 'abc' }, { headers: { 'x-correlation-id': 'corr-123' } }));
    expect(mockLogAndFlush.mock.calls[0][0].details.correlationId).toBe('corr-123');
  });

  it('A-2 order: the audit flush settles BEFORE the drain is called, then the response', async () => {
    const audit = deferred();
    mockLogAndFlush.mockImplementationOnce(async () => {
      order.push('audit-started');
      await audit.promise;
      order.push('audit');
    });
    let settled = false;
    const pending = POST(valid('payment_reminders')).then((r) => {
      settled = true;
      order.push('response');
      return r;
    });
    await until(() => mockLogAndFlush.mock.calls.length > 0);
    await flush();
    await flush();
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(mockProcessDueReminders).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    audit.resolve();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(order).toEqual(['audit-started', 'audit', 'drain:payment_reminders', 'response']);
  });

  it('A-3 an audit flush that timed out (it never rejects) does not block the drain', async () => {
    mockLogAndFlush.mockImplementationOnce(async () => undefined);
    const res = await POST(valid('insight_actions'));
    expect(res.status).toBe(200);
    expect(mockDrainInsightActions).toHaveBeenCalledTimes(1);
  });

  it('A-4 a drain that throws → 500 drain_failed; exactly one audit call (the pre-drain one); no row text leaks', async () => {
    mockDispatchLeadResponses.mockImplementationOnce(async () => {
      throw new Error('SECRET-ROW-TEXT');
    });
    const res = await POST(valid('lead_responses'));
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ success: false, code: 'drain_failed' });
    expect(body.details).toBeUndefined(); // NODE_ENV is 'test'
    expect(text).not.toContain('SECRET-ROW-TEXT');

    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockLogAndFlush.mock.calls[0][0].details)).not.toContain('SECRET-ROW-TEXT');
    expect(order[0]).toBe('audit');

    // The error is in the server error log only, as { err }.
    const errorLines = loggedArgs.filter(
      (l): l is { level: string; args: unknown[] } => (l as { level: string }).level === 'error'
    );
    expect(errorLines).toHaveLength(1);
    const [context] = errorLines[0].args as [Record<string, unknown>];
    expect((context.err as Error).message).toBe('SECRET-ROW-TEXT');
    expect(context.outcome).toBe('failed');
  });

  it('A-5 no run record: no withCronRunRecord call, no table touched', async () => {
    for (const queue of ALL_QUEUES) await POST(valid(queue));
    expect(mockWithCronRunRecord).not.toHaveBeenCalled();
    expect(mockTablesTouched).toEqual([]);
  });

  it.each(ALL_QUEUES)('A-6 %s: no content reaches the response, the logs or the audit row', async (queue) => {
    ENTRY[queue].mockImplementationOnce(async () => ({
      ...((DEFAULT_RESULT[queue] as Record<string, unknown> | undefined) ?? {}),
      error_message: 'SENTINEL-ERR',
      skip_reason: 'SENTINEL-SKIP',
      payload: { to: 'sentinel@client.test' },
      recommendation: 'SENTINEL-REC',
      contactId: 'SENTINEL-CONTACT',
      invoiceId: 'SENTINEL-INV',
      ids: ['SENTINEL-ID'],
    }));
    const res = await POST(valid(queue));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(Object.keys(body.data).sort()).toEqual(['counts', 'durationMs', 'queue']);

    for (const serialised of [text, JSON.stringify(loggedArgs), JSON.stringify(mockLogAndFlush.mock.calls[0][0].details)]) {
      expect(serialised).not.toMatch(/SENTINEL/);
      expect(serialised).not.toContain('@');
      expect(serialised).not.toContain('client.test');
    }
  });

  it('A-7 the reason is never logged; it is in the audit row only', async () => {
    const reason = 'UNIQUE-REASON-TEXT 4711';
    await POST(valid('payment_reminders', reason));
    expect(JSON.stringify(loggedArgs)).not.toContain('UNIQUE-REASON-TEXT');
    expect(mockLogAndFlush.mock.calls[0][0].details.reason).toBe(reason);
  });

  it('A-7 the log lines carry only the allowed fields', async () => {
    await POST(valid('lead_responses'));
    const allowed = new Set(['adminUserId', 'queue', 'correlationId', 'outcome', 'counts', 'durationMs', 'err']);
    for (const line of loggedArgs as Array<{ args: unknown[] }>) {
      const [context] = line.args;
      if (context && typeof context === 'object') {
        for (const key of Object.keys(context)) expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it('A-8 payment_automations (void) → 200 with counts: []', async () => {
    const res = await POST(valid('payment_automations'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ queue: 'payment_automations', counts: [] });
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  });

  it('A-9 no BOS_QUEUE_DRAIN_STARTED row on an invalid body or a denied gate', async () => {
    await POST(post({ queue: 'nope', reason: 'abc' }));
    mockGetUser.mockResolvedValue(null);
    await POST(valid());
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    await POST(valid());
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(drainCalls()).toBe(0);
  });
});
