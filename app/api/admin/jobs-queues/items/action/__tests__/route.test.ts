/**
 * POST /api/admin/jobs-queues/items/action — cancel one queue item
 * (ADMIN_BOS_CLEANUP slice 7b; workplan §5.1–§5.8, SA W7B-1..W7B-9).
 *
 * The two repositories are factory mocks over a MUTABLE store of queue rows:
 * the read returns the row as it is now, and the compare-and-set applies the
 * real predicates (id, the row's own user_id, status, attempts, and
 * claimed_at IS NULL for an in-progress row) to that state, returning
 * `cancelled` only when they all match. So the concurrency, stale-state and
 * double-click cases exercise compare-and-set semantics, not canned answers.
 *
 *   G  the gate comes first; on a denial nothing is read or written
 *   Z  strict Zod → 400, nothing read
 *   S  every allowed cell, per queue → 200, the exact patch, error text kept
 *   N  every refused cell → 422 / 409 with no write (C7-1, C7-2)
 *   X  stale state, a racing claim, double-click, two admins, unconfirmed outcome
 *   T  tenant isolation: the owner always comes from the row
 *   A  one audit row, after the win, after the log line, before the response
 *   P  no content, account id or reason in a response or a log
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
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

// ── Order of observable steps ─────────────────────────────────────────────
const order: string[] = [];

// ── Logger: records every call ───────────────────────────────────────────
const loggedArgs: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec =
      (level: string) =>
      (...args: unknown[]) => {
        loggedArgs.push({ level, args });
        if (typeof args[1] === 'string') order.push(`log:${args[1]}`);
      };
    const logger: Record<string, unknown> = { info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') };
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

// ── No direct database access from the route ────────────────────────────
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

// ── The two repositories, over a mutable store ───────────────────────────
const mockRead = jest.fn();
const mockCancel = jest.fn();
jest.mock('@/lib/repositories/AdminJobsQueuesRepository', () => ({
  adminJobsQueuesRepository: { readQueueItemAllAccounts: (...a: unknown[]) => mockRead(...a) },
}));
jest.mock('@/lib/repositories/AdminQueueActionsRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/AdminQueueActionsRepository');
  return {
    ...actual,
    adminQueueActionsRepository: { cancelQueueItemAllAccounts: (...a: unknown[]) => mockCancel(...a) },
  };
});

import { POST } from '../route';
import { ADMIN_QUEUE_CANCEL_PATCH } from '@/lib/repositories/AdminQueueActionsRepository';
import { CANCEL_FROM_STATUSES, IN_PROGRESS_STATUS } from '@/lib/admin/jobs/queueItemEligibility';
import { QUEUE_ITEM_ACTIONS, QUEUE_ITEM_STATUS_LABELS } from '@/lib/admin/jobs/buildQueueItemsView';
import type { QueueItemAction } from '@/lib/admin/jobs/jobsQueuesTypes';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';
import { AUDIT_EVENTS, EVENT_METADATA } from '@/lib/audit/events';
import { audienceOf } from '@/lib/audit/eventAudience';
import { AUDIT_ENTITY_TYPES } from '@/lib/audit/types';
import { AUDIT_ENTITY_OWNER_VISIBILITY, OWNER_HIDDEN_ENTITY_TYPES } from '@/lib/audit/ownerVisibility';
import { classifyAuditEvent } from '@/lib/audit/filterOptions';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };
const OWNER_A = '33333333-3333-4333-8333-333333333333';
const ITEM = 'abcdef12-3456-4789-8abc-def012345678';
const URL_ACTION = 'http://localhost/api/admin/jobs-queues/items/action';
const ALL_QUEUES: BosQueueId[] = BOS_QUEUES.map((q) => q.id);
const PAYMENT: BosQueueId[] = ['payment_reminders', 'payment_automations'];
const DEAD_MARKER = 'dead-letter: max attempts';

type Stored = Record<string, unknown> & {
  id: string;
  user_id: string;
  status: string;
  attempts: number;
  claimed_at: string | null;
  error_message: string | null;
};

/** queue → id → the row as the database holds it now. */
const store = new Map<string, Stored>();
const key = (queue: string, id: string) => `${queue}:${id}`;
/** Runs inside the CAS, before its predicates are evaluated (a racing claim). */
let beforeCas: (() => void) | null = null;
/** Held reads: the two-admins case releases them together. */
let readGate: Promise<void> | null = null;
/** Extra fields a misbehaving client might return with the row (P). */
let readExtras: Record<string, unknown> = {};

function seed(queue: BosQueueId, overrides: Partial<Stored> = {}): Stored {
  const row: Stored = {
    id: ITEM,
    user_id: OWNER_A,
    status: 'pending',
    attempts: 0,
    claimed_at: null,
    created_at: '2026-10-04T08:00:00.000Z',
    scheduled_at: PAYMENT.includes(queue) ? '2026-10-04T08:00:00.000Z' : null,
    next_attempt_at: null,
    kind: queue === 'lead_responses' ? 'chase' : queue === 'insight_actions' ? 'chase_invoice' : null,
    briefing_date: queue === 'daily_briefing_sends' ? '2026-10-04' : null,
    timezone: queue === 'daily_briefing_sends' ? 'UTC' : null,
    error_message: null,
    ...overrides,
  };
  store.set(key(queue, row.id), row);
  return row;
}

/** The RawQueueItem the real read maps (field by field). */
function mapped(row: Stored) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    attempts: row.attempts,
    claimedAt: row.claimed_at,
    createdAt: row.created_at as string,
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    kind: (row.kind as string | null) ?? null,
    briefingDate: (row.briefing_date as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
  };
}

function installStoreModel() {
  mockRead.mockImplementation(async (_ctx: unknown, queue: string, itemId: string) => {
    order.push(`read:${queue}`);
    if (readGate) await readGate;
    const row = store.get(key(queue, itemId));
    return { data: row ? { ...mapped(row), ...readExtras } : null, error: null };
  });
  mockCancel.mockImplementation(
    async (_ctx: unknown, input: { queue: BosQueueId; itemId: string; ownerUserId: string; expected: { status: string; attempts: number } }) => {
      order.push('cas');
      if (beforeCas) {
        const run = beforeCas;
        beforeCas = null;
        run();
      }
      const row = store.get(key(input.queue, input.itemId));
      const matches =
        !!row &&
        row.user_id === input.ownerUserId &&
        row.status === input.expected.status &&
        row.attempts === input.expected.attempts &&
        (input.expected.status !== IN_PROGRESS_STATUS[input.queue] || row.claimed_at === null);
      if (!matches) return { data: { outcome: 'not_matched' }, error: null };
      Object.assign(row, ADMIN_QUEUE_CANCEL_PATCH[input.queue]);
      return { data: { outcome: 'cancelled' }, error: null };
    }
  );
}

function post(body: unknown, init: { raw?: string } = {}): NextRequest {
  const payload = init.raw !== undefined ? init.raw : body === undefined ? undefined : JSON.stringify(body);
  return new NextRequest(URL_ACTION, {
    method: 'POST',
    ...(payload === undefined ? {} : { body: payload }),
    headers: { 'content-type': 'application/json' },
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    queue: 'lead_responses',
    itemId: ITEM,
    action: 'cancel',
    expected: { status: 'pending', attempts: 0 },
    reason: 'wrong client',
    ...overrides,
  };
}

function asAdmin() {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
}

const auditCalls = () => mockLogAndFlush.mock.calls.filter(([entry]) => entry?.action === 'BOS_QUEUE_ITEM_CANCELLED');
const flush = () => new Promise((r) => setImmediate(r));
async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  loggedArgs.length = 0;
  mockTablesTouched.length = 0;
  store.clear();
  beforeCas = null;
  readGate = null;
  readExtras = {};
  installStoreModel();
  mockLogAndFlush.mockImplementation(async () => {
    order.push('audit');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('G — the gate comes first (C7-14, W7D-3)', () => {
  function expectNothingRan() {
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockTablesTouched).toEqual([]);
  }

  it('G-1 signed out → 401; the body is never read', async () => {
    mockGetUser.mockResolvedValue(null);
    const request = post(body());
    const jsonSpy = jest.spyOn(request, 'json');
    expect((await POST(request)).status).toBe(401);
    expect(jsonSpy).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('G-2 signed in, not an admin → 403; the body is never read', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const request = post(body());
    const jsonSpy = jest.spyOn(request, 'json');
    expect((await POST(request)).status).toBe(403);
    expect(jsonSpy).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('G-3 the admin check throws → 403', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));
    expect((await POST(post(body()))).status).toBe(403);
    expectNothingRan();
  });

  it('G-4 the auth lookup throws → 401', async () => {
    mockGetUser.mockRejectedValue(new Error('malformed cookie jar'));
    expect((await POST(post(body()))).status).toBe(401);
    expectNothingRan();
  });

  it('G-5 an invalid body AND signed out → 401, not 400', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await POST(post({ queue: 'nope' }))).status).toBe(401);
    expectNothingRan();
  });

  it('G-6 source: inside POST, requireAdmin( is preceded only by the correlation id and logger.child', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const handler = code.match(/export async function POST\(request: NextRequest\) \{([\s\S]*)$/);
    expect(handler).not.toBeNull();
    const statements = handler![1]
      .split('await requireAdmin(')[0]
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^const correlationId = request\.headers\.get\('x-correlation-id'\) \|\| crypto\.randomUUID\(\)$/);
    expect(statements[1]).toMatch(/^const requestLogger = logger\.child\(\{ correlationId, route: ROUTE \}\)$/);
    expect(statements[2]).toBe('const gate =');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Z — strict Zod → 400, nothing read (SA §F)', () => {
  beforeEach(asAdmin);

  async function expect400(request: NextRequest) {
    const res = await POST(request);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, code: 'invalid_input' });
    expect(typeof json.error).toBe('string');
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
    return json;
  }

  it.each([
    ['an unknown queue', { queue: 'nope' }],
    ['an unknown action', { action: 'delete' }],
    // Slice 7c: 'retry' is now an action (route.retry.test.ts); these stay unknown.
    ['requeue (never an action)', { action: 'requeue' }],
    ['release (never an action)', { action: 'release' }],
    ['a non-uuid id', { itemId: 'item-1' }],
    ['a missing expected', { expected: undefined }],
    ['negative attempts', { expected: { status: 'pending', attempts: -1 } }],
    ['fractional attempts', { expected: { status: 'pending', attempts: 1.5 } }],
    ['string attempts', { expected: { status: 'pending', attempts: '0' } }],
    ['attempts over the range', { expected: { status: 'pending', attempts: 100_001 } }],
    ['an upper-case status', { expected: { status: 'PENDING', attempts: 0 } }],
    ['a 40-character status', { expected: { status: 'p'.repeat(40), attempts: 0 } }],
    ['a missing reason', { reason: undefined }],
    ['a reason of one character after trim', { reason: '  a ' }],
    ['a 501-character reason', { reason: 'x'.repeat(501) }],
    // QA 2026-10-04: the exact lower edge and a whitespace-only reason.
    ['a two-character reason', { reason: 'ab' }],
    ['a whitespace-only reason', { reason: '      ' }],
    ['a two-character reason padded with whitespace', { reason: '   ab   ' }],
  ])('Z-1..Z-3 %s', async (_label, overrides) => {
    await expect400(post(body(overrides)));
  });

  it.each([
    ['userId', { userId: OWNER_A }],
    ['accountId', { accountId: OWNER_A }],
    ['ownerUserId', { ownerUserId: OWNER_A }],
    ['expected.userId', { expected: { status: 'pending', attempts: 0, userId: OWNER_A } }],
    ['expected.claimedAt', { expected: { status: 'pending', attempts: 0, claimedAt: null } }],
  ])('Z-4 / T-2 an extra key (%s) is refused, at both levels', async (_label, overrides) => {
    seed('lead_responses');
    await expect400(post(body(overrides)));
  });

  it('Z-5 not JSON, and an empty body', async () => {
    await expect400(post(undefined, { raw: 'not json' }));
    await expect400(post(undefined));
  });

  it('Z-6 the reason is trimmed before it is recorded', async () => {
    seed('lead_responses');
    const res = await POST(post(body({ reason: '  wrong client  ' })));
    expect(res.status).toBe(200);
    expect(auditCalls()[0][0].details.reason).toBe('wrong client');
  });

  // QA 2026-10-04: the accept edges (exactly 3 and exactly 500 characters, after trim).
  it.each([
    ['exactly 3 characters', 'abc', 'abc'],
    ['exactly 500 characters', 'y'.repeat(500), 'y'.repeat(500)],
    ['500 characters plus surrounding whitespace', `  ${'z'.repeat(500)}  `, 'z'.repeat(500)],
  ])('Z-6 a reason of %s is accepted and recorded trimmed', async (_label, reason, recorded) => {
    seed('lead_responses');
    const res = await POST(post(body({ reason })));
    expect(res.status).toBe(200);
    expect(auditCalls()).toHaveLength(1);
    expect(auditCalls()[0][0].details.reason).toBe(recorded);
  });

  it('Z-7 details only in development', async () => {
    const before = process.env.NODE_ENV;
    try {
      expect((await expect400(post(body({ queue: 'nope' })))).details).toBeUndefined();
      Object.assign(process.env, { NODE_ENV: 'development' });
      expect(typeof (await expect400(post(body({ queue: 'nope' })))).details).toBe('string');
    } finally {
      Object.assign(process.env, { NODE_ENV: before });
    }
  });

  it('Z-8 QUEUE_ITEM_ACTIONS is exactly the QueueItemAction union (7b cancel; 7c adds retry)', () => {
    const actions: readonly QueueItemAction[] = QUEUE_ITEM_ACTIONS;
    expect([...actions]).toEqual(['cancel', 'retry']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
type Cell = { queue: BosQueueId; label: string; row: Partial<Stored> };
const CELLS: Cell[] = [
  { queue: 'payment_reminders', label: 'pending', row: { status: 'pending' } },
  { queue: 'payment_reminders', label: 'failed', row: { status: 'failed', attempts: 2, error_message: 'smtp 550' } },
  { queue: 'payment_reminders', label: 'failed dead-lettered', row: { status: 'failed', attempts: 5, error_message: DEAD_MARKER } },
  { queue: 'payment_reminders', label: 'processing, no claim', row: { status: 'processing', attempts: 1, claimed_at: null } },
  { queue: 'payment_automations', label: 'pending', row: { status: 'pending' } },
  { queue: 'payment_automations', label: 'pending, no due time', row: { status: 'pending', scheduled_at: null } },
  { queue: 'payment_automations', label: 'failed', row: { status: 'failed', attempts: 1, error_message: 'boom' } },
  { queue: 'payment_automations', label: 'failed guardrail', row: { status: 'failed', error_message: 'cooldown active' } },
  { queue: 'payment_automations', label: 'dead_letter', row: { status: 'dead_letter', attempts: 3 } },
  { queue: 'payment_automations', label: 'running, no claim', row: { status: 'running', attempts: 1, claimed_at: null } },
  ...(['daily_briefing_sends', 'lead_responses', 'insight_actions'] as const).flatMap((queue) => [
    { queue, label: 'pending', row: { status: 'pending' } },
    { queue, label: 'failed', row: { status: 'failed', attempts: 2, error_message: 'provider 500' } },
    { queue, label: 'failed dead-lettered', row: { status: 'failed', attempts: 3, error_message: DEAD_MARKER } },
    { queue, label: 'processing, no claim', row: { status: 'processing', attempts: 1, claimed_at: null } },
  ]),
];

describe('S — every allowed cell, per queue (C7-6, C7-16)', () => {
  beforeEach(asAdmin);

  it('covers every status of every Cancel column', () => {
    for (const queue of ALL_QUEUES) {
      expect(new Set(CELLS.filter((c) => c.queue === queue).map((c) => c.row.status))).toEqual(new Set(CANCEL_FROM_STATUSES[queue]));
    }
  });

  it.each(CELLS.map((c) => [c.queue, c.label, c] as const))('%s / %s → 200, the exact patch, the error text kept', async (_q, _l, cell) => {
    const row = seed(cell.queue, cell.row);
    const errorBefore = row.error_message;
    const res = await POST(post(body({ queue: cell.queue, expected: { status: row.status, attempts: row.attempts } })));
    expect(res.status).toBe(200);
    const json = await res.json();
    const target = PAYMENT.includes(cell.queue) ? 'cancelled' : 'skipped';
    expect(Object.keys(json).sort()).toEqual(['data', 'success']);
    expect(Object.keys(json.data).sort()).toEqual(['action', 'after', 'before', 'itemId', 'queue']);
    expect(json.data).toEqual({
      queue: cell.queue,
      itemId: ITEM,
      action: 'cancel',
      before: { status: cell.row.status, statusLabel: QUEUE_ITEM_STATUS_LABELS[cell.row.status as string] },
      after: { status: target, statusLabel: QUEUE_ITEM_STATUS_LABELS[target] },
    });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    const [ctx, input] = mockCancel.mock.calls[0];
    expect(ctx).toEqual({ correlationId: expect.any(String), adminId: ADMIN.id });
    expect(input).toEqual({
      queue: cell.queue,
      itemId: ITEM,
      ownerUserId: OWNER_A,
      expected: { status: cell.row.status, attempts: row.attempts },
    });
    expect(row.status).toBe(target);
    expect(row.error_message).toBe(errorBefore);
    if (PAYMENT.includes(cell.queue)) expect(row).not.toHaveProperty('skip_reason');
    else expect(row.skip_reason).toBe('cancelled_by_admin');
    expect(auditCalls()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('N — refused cells: C7-1 negatives and C7-2', () => {
  beforeEach(asAdmin);

  const OUTSIDE: Record<BosQueueId, string[]> = {
    payment_reminders: ['sent', 'cancelled', 'zzz'],
    payment_automations: ['completed', 'cancelled', 'zzz'],
    daily_briefing_sends: ['sent', 'skipped', 'zzz'],
    lead_responses: ['sent', 'skipped', 'zzz'],
    insight_actions: ['sent', 'skipped', 'zzz'],
  };

  it.each(ALL_QUEUES.flatMap((q) => OUTSIDE[q].map((s) => [q, s] as const)))(
    'N-1 %s / expected %s → 422 not_cancellable_state, nothing read',
    async (queue, status) => {
      seed(queue, { status });
      const res = await POST(post(body({ queue, expected: { status, attempts: 0 } })));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ success: false, code: 'not_cancellable_state' });
      expect(mockRead).not.toHaveBeenCalled();
      expect(mockCancel).not.toHaveBeenCalled();
      expect(auditCalls()).toHaveLength(0);
    }
  );

  it.each(ALL_QUEUES)('N-2 %s: a claimed in-progress row (fresh or expired lease) → 422 leased, the CAS never called', async (queue) => {
    for (const claimedAt of ['2026-10-04T11:59:00.000Z', '2026-10-01T00:00:00.000Z']) {
      jest.clearAllMocks();
      installStoreModel();
      const row = seed(queue, { status: IN_PROGRESS_STATUS[queue], attempts: 1, claimed_at: claimedAt });
      const res = await POST(post(body({ queue, expected: { status: row.status, attempts: 1 } })));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ success: false, code: 'leased' });
      expect(mockCancel).not.toHaveBeenCalled();
      expect(row.status).toBe(IN_PROGRESS_STATUS[queue]);
      expect(auditCalls()).toHaveLength(0);
    }
  });

  it('N-3 orphaned at the read, claimed before the write: the CAS misses on claimed_at → 409, no audit', async () => {
    const row = seed('lead_responses', { status: 'processing', attempts: 1, claimed_at: null });
    beforeCas = () => {
      row.claimed_at = '2026-10-04T12:00:00.000Z';
    };
    const res = await POST(post(body({ expected: { status: 'processing', attempts: 1 } })));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'item_changed', current: { status: 'processing', statusLabel: 'In progress' } });
    expect(row.status).toBe('processing');
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(auditCalls()).toHaveLength(0);
  });

  it.each([
    ['payment_reminders', 'sent'],
    ['payment_automations', 'completed'],
    ['lead_responses', 'skipped'],
    ['insight_actions', 'sent'],
    ['daily_briefing_sends', 'sent'],
  ] as const)('N-5 %s finished (%s) between load and click → 409 with its label; the CAS never called', async (queue, now) => {
    seed(queue, { status: now });
    const res = await POST(post(body({ queue, expected: { status: 'pending', attempts: 0 } })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: expect.any(String),
      code: 'item_changed',
      current: { status: now, statusLabel: QUEUE_ITEM_STATUS_LABELS[now] },
    });
    expect(mockCancel).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });

  it('an unrecognised current status is labelled "Unrecognised status", never echoed as a label', async () => {
    seed('lead_responses', { status: 'weird_new' });
    const res = await POST(post(body()));
    expect((await res.json()).current).toEqual({ status: 'weird_new', statusLabel: 'Unrecognised status' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('X — stale state, races, double-click, unconfirmed outcome (§D.5)', () => {
  beforeEach(asAdmin);

  it('X-1 stale attempts (ABA: claimed and reaped back to pending) → 409, no CAS, no audit', async () => {
    seed('lead_responses', { status: 'pending', attempts: 1 });
    const res = await POST(post(body({ expected: { status: 'pending', attempts: 0 } })));
    expect(res.status).toBe(409);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });

  it('X-2 stale status (closed by the owner) → 409 "Skipped"', async () => {
    seed('lead_responses', { status: 'skipped' });
    const res = await POST(post(body({ expected: { status: 'failed', attempts: 0 } })));
    expect(res.status).toBe(409);
    expect((await res.json()).current.statusLabel).toBe('Skipped');
  });

  it('X-3 a claim wins the race between the read and the CAS → one CAS, a re-read, 409 "In progress"; the claim stands', async () => {
    const row = seed('lead_responses', { status: 'pending', attempts: 0 });
    beforeCas = () => Object.assign(row, { status: 'processing', attempts: 1, claimed_at: '2026-10-04T12:00:00.000Z' });
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'item_changed', current: { status: 'processing', statusLabel: 'In progress' } });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(order.filter((s) => s === 'cas' || s.startsWith('read:'))).toEqual(['read:lead_responses', 'cas', 'read:lead_responses']);
    expect(row).toMatchObject({ status: 'processing', attempts: 1, claimed_at: '2026-10-04T12:00:00.000Z' });
    expect(row).not.toHaveProperty('skip_reason');
    expect(auditCalls()).toHaveLength(0);
    expect(loggedArgs.some((l) => l.level === 'info' && l.args[1] === 'Queue item cancel lost a race')).toBe(true);
  });

  it('X-4 the row is deleted between the read and the CAS → 404', async () => {
    seed('lead_responses');
    beforeCas = () => store.delete(key('lead_responses', ITEM));
    const res = await POST(post(body()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'item_not_found' });
    expect(auditCalls()).toHaveLength(0);
  });

  it('X-5 double-click, sequential: 200 then 409; one CAS, one audit row', async () => {
    seed('lead_responses');
    const first = await POST(post(body()));
    const second = await POST(post(body()));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).current).toEqual({ status: 'skipped', statusLabel: 'Skipped' });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  });

  it('X-6 two admins at once, both past the pre-check: exactly one 200 and one 409; one patch, one audit row', async () => {
    const row = seed('insight_actions', { status: 'failed', attempts: 2 });
    let release!: () => void;
    readGate = new Promise<void>((resolve) => (release = resolve));
    const requests = [
      POST(post(body({ queue: 'insight_actions', expected: { status: 'failed', attempts: 2 }, reason: 'first admin' }))),
      POST(post(body({ queue: 'insight_actions', expected: { status: 'failed', attempts: 2 }, reason: 'second admin' }))),
    ];
    await until(() => mockRead.mock.calls.length === 2);
    readGate = null;
    release();
    const statuses = (await Promise.all(requests)).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(row.status).toBe('skipped');
    expect(auditCalls()).toHaveLength(1);
  });

  it.each([
    ['a count that is not 0 or 1', { data: null, error: Object.assign(new Error('count'), { code: 'count_unconfirmed' }) }],
    ['a PostgREST error', { data: null, error: Object.assign(new Error('x'), { code: '42703' }) }],
    ['an outcome the route does not know', { data: { outcome: 'maybe' }, error: null }],
    ['no data and no error', { data: null, error: null }],
  ])('X-7 %s → 500 outcome_unknown, an error log with ids, no audit', async (_label, result) => {
    seed('lead_responses');
    mockCancel.mockResolvedValueOnce(result);
    const res = await POST(post(body()));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, code: 'outcome_unknown' });
    expect(json.details).toBeUndefined();
    expect(auditCalls()).toHaveLength(0);
    const errorLog = loggedArgs.find((l) => l.level === 'error');
    expect(errorLog?.args[0]).toMatchObject({ queue: 'lead_responses', itemId: ITEM, adminUserId: ADMIN.id });
  });

  it('X-7 a CAS that throws → 500 outcome_unknown, no audit', async () => {
    seed('lead_responses');
    mockCancel.mockRejectedValueOnce(new Error('socket hang up'));
    const res = await POST(post(body()));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('outcome_unknown');
    expect(auditCalls()).toHaveLength(0);
  });

  it('X-8 the first read fails → 500 action_failed, no CAS', async () => {
    seed('lead_responses');
    mockRead.mockResolvedValueOnce({ data: null, error: Object.assign(new Error('SENTINEL'), { code: '57014' }) });
    const res = await POST(post(body()));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('action_failed');
    expect(mockCancel).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });

  it('X-8 the re-read after a lost CAS fails → 500 action_failed, no second CAS', async () => {
    const row = seed('lead_responses');
    beforeCas = () => Object.assign(row, { status: 'processing', attempts: 1, claimed_at: 'x' });
    mockRead.mockImplementationOnce(async (_c: unknown, queue: string, id: string) => ({ data: mapped(store.get(key(queue, id))!), error: null }));
    mockRead.mockImplementationOnce(async () => ({ data: null, error: new Error('timeout') }));
    const res = await POST(post(body()));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('action_failed');
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(auditCalls()).toHaveLength(0);
  });

  it('X-8 the first read passes its deadline → 500 action_failed, no CAS', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      seed('lead_responses');
      mockRead.mockImplementationOnce(() => new Promise(() => undefined));
      const pending = POST(post(body()));
      await until(() => mockRead.mock.calls.length === 1);
      jest.advanceTimersByTime(5001);
      const res = await pending;
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe('action_failed');
      expect(mockCancel).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('T — tenant isolation (tenant-isolation-guard Step 7)', () => {
  beforeEach(asAdmin);

  it('T-1 the owner passed to the CAS is the row\'s own user_id', async () => {
    seed('daily_briefing_sends', { user_id: 'OWNER-FROM-THE-ROW' });
    await POST(post(body({ queue: 'daily_briefing_sends' })));
    expect(mockCancel.mock.calls[0][1].ownerUserId).toBe('OWNER-FROM-THE-ROW');
    expect(mockCancel.mock.calls[0][1].ownerUserId).not.toBe(ADMIN.id);
  });

  it('T-3 the wrong queue for an id: only that queue is read → 404; the CAS never called', async () => {
    seed('lead_responses');
    const res = await POST(post(body({ queue: 'insight_actions' })));
    expect(res.status).toBe(404);
    expect(mockRead.mock.calls.map((c) => c[1])).toEqual(['insight_actions']);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('T-4 an unknown id → 404; the CAS never called', async () => {
    const res = await POST(post(body()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'item_not_found' });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('T-5 / W7B-6 source: no body spread, no direct table access, no service, no payment event', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/\.\.\.\s*(body|parsed|input|expected|row)\b/);
    expect(code).not.toMatch(/\.from\(/);
    expect(code).not.toMatch(/from\s*'@\/lib\/services\//);
    expect(code).not.toMatch(/emitPaymentEvent|PaymentEventService|reminder\.cancelled/);
    expect(code).not.toMatch(/from\s*'@\/lib\/(cron|admin\/jobs\/runQueueDrain)/);
    expect(code).not.toMatch(/supabaseServer/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('A — the audit row (C7-13, §G, OP-1, W7B-2, W7B-9)', () => {
  beforeEach(asAdmin);

  it('A-1 exactly one row with the §G shape', async () => {
    seed('lead_responses', { status: 'failed', attempts: 2, created_at: '2026-10-04T08:00:00.000Z' });
    await POST(post(body({ expected: { status: 'failed', attempts: 2 } })));
    expect(auditCalls()).toHaveLength(1);
    const [entry, , context] = auditCalls()[0];
    expect(Object.keys(entry).sort()).toEqual(['action', 'actorId', 'changes', 'details', 'entityId', 'entityType', 'request', 'severity', 'userId']);
    expect(entry).toMatchObject({
      action: 'BOS_QUEUE_ITEM_CANCELLED',
      entityType: 'bos_queue_item',
      entityId: ITEM,
      userId: OWNER_A,
      actorId: ADMIN.id,
      severity: 'warning',
    });
    expect(entry.changes).toEqual({ before: { status: 'failed', attempts: 2 }, after: { status: 'skipped' } });
    expect(Object.keys(entry.details).sort()).toEqual(['action', 'correlationId', 'dueAnchor', 'queue', 'reason']);
    expect(entry.details).toEqual({
      reason: 'wrong client',
      queue: 'lead_responses',
      action: 'cancel',
      correlationId: expect.any(String),
      dueAnchor: '2026-10-04T08:00:00.000Z',
    });
    expect(context).toEqual({ reason: expect.any(String), continues: expect.any(String) });
  });

  it('A-2 order: CAS → the "Queue item cancelled" log line → logAndFlush → the response (held until the flush resolves)', async () => {
    seed('lead_responses');
    let releaseFlush!: () => void;
    mockLogAndFlush.mockImplementationOnce(() => {
      order.push('audit');
      return new Promise<void>((resolve) => (releaseFlush = resolve));
    });
    let settled = false;
    const pending = POST(post(body())).then((r) => {
      settled = true;
      return r;
    });
    await until(() => mockLogAndFlush.mock.calls.length > 0);
    await flush();
    expect(settled).toBe(false);
    releaseFlush();
    expect((await pending).status).toBe(200);
    const steps = order.filter((s) => ['cas', 'audit', 'log:Queue item cancelled'].includes(s));
    expect(steps).toEqual(['cas', 'log:Queue item cancelled', 'audit']);
    const line = loggedArgs.find((l) => l.args[1] === 'Queue item cancelled');
    expect(line?.level).toBe('info');
    expect(line?.args[0]).toEqual({ adminUserId: ADMIN.id, queue: 'lead_responses', itemId: ITEM, from: 'pending', to: 'skipped' });
  });

  it('A-3 a flush that "times out" (resolves) still answers 200', async () => {
    seed('lead_responses');
    mockLogAndFlush.mockResolvedValueOnce(undefined);
    expect((await POST(post(body()))).status).toBe(200);
  });

  it('A-4 no audit row on any refusal; 409 and 422 are logged at info', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => POST(post(body({ queue: 'nope' }))),
      async () => POST(post(body({ expected: { status: 'sent', attempts: 0 } }))),
      async () => POST(post(body())), // 404
      async () => {
        seed('lead_responses', { status: 'processing', attempts: 1, claimed_at: 'x' });
        return POST(post(body({ expected: { status: 'processing', attempts: 1 } })));
      },
      async () => {
        seed('lead_responses', { status: 'sent' });
        return POST(post(body()));
      },
    ];
    for (const run of cases) {
      store.clear();
      const res = await run();
      expect([400, 404, 409, 422]).toContain(res.status);
    }
    mockGetUser.mockResolvedValue(null);
    await POST(post(body()));
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    await POST(post(body()));
    expect(auditCalls()).toHaveLength(0);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    for (const message of ['Queue item cancel refused', 'Queue item changed before cancel']) {
      expect(loggedArgs.some((l) => l.level === 'info' && l.args[1] === message)).toBe(true);
    }
  });

  it('A-6 the reason is never logged', async () => {
    seed('lead_responses');
    await POST(post(body({ reason: 'REASON-SENTINEL-TEXT' })));
    expect(auditCalls()[0][0].details.reason).toBe('REASON-SENTINEL-TEXT');
    expect(JSON.stringify(loggedArgs)).not.toContain('REASON-SENTINEL');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('P — no content, account id or reason leaves the route (C7-13, §9)', () => {
  beforeEach(asAdmin);
  const OWNER_SENTINEL = 'OWNER-SENTINEL-ID';

  it.each(ALL_QUEUES)('%s: success, 409, 404 and 422 paths', async (queue) => {
    readExtras = {
      error_message: 'SENTINEL-ERR',
      skip_reason: 'SENTINEL-SKIP',
      payload: { to: 'sentinel@client.test' },
      recommendation: 'SENTINEL-REC',
      contact_id: 'SENTINEL-CONTACT',
      invoice_id: 'SENTINEL-INVOICE',
      booking_id: 'SENTINEL-BOOKING',
      entity_id: 'SENTINEL-ENTITY',
      claimed_by: 'SENTINEL-RUNNER',
      timezone: 'SENTINEL/Zone',
    };
    const bodies: string[] = [];
    const record = async (res: Response) => bodies.push(await res.text());

    seed(queue, { user_id: OWNER_SENTINEL, error_message: 'SENTINEL-STORED' });
    await record(await POST(post(body({ queue }))));
    await record(await POST(post(body({ queue })))); // 409, now closed
    store.clear();
    await record(await POST(post(body({ queue })))); // 404
    seed(queue, { user_id: OWNER_SENTINEL, status: IN_PROGRESS_STATUS[queue], attempts: 1, claimed_at: 'x' });
    await record(await POST(post(body({ queue, expected: { status: IN_PROGRESS_STATUS[queue], attempts: 1 } })))); // 422

    for (const text of bodies) {
      expect(text).not.toMatch(/SENTINEL|sentinel|client\.test|@/);
    }
    const logs = JSON.stringify(loggedArgs);
    expect(logs).not.toMatch(/SENTINEL|sentinel|client\.test/);
    const audits = JSON.stringify(mockLogAndFlush.mock.calls.map(([entry]) => ({ ...entry, request: undefined })));
    expect(audits).not.toMatch(/SENTINEL-(ERR|SKIP|REC|CONTACT|INVOICE|BOOKING|ENTITY|RUNNER|STORED)|sentinel@|client\.test|SENTINEL\/Zone/);
    for (const [, input] of mockCancel.mock.calls) {
      expect(JSON.stringify(input)).not.toMatch(/error_message|SENTINEL-ERR/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('A-5 — registrations (§G, OP-2 option 1)', () => {
  it('the event is registered: warning, SOC2, audience bos, group "Business OS Queues" / "Item Cancelled"', () => {
    expect((AUDIT_EVENTS as Record<string, string>).BOS_QUEUE_ITEM_CANCELLED).toBe('BOS_QUEUE_ITEM_CANCELLED');
    expect(EVENT_METADATA.BOS_QUEUE_ITEM_CANCELLED).toMatchObject({ severity: 'warning', complianceFlags: ['SOC2'] });
    expect(audienceOf('BOS_QUEUE_ITEM_CANCELLED')).toBe('bos');
    expect(classifyAuditEvent('BOS_QUEUE_ITEM_CANCELLED')).toEqual({ group: 'Business OS Queues', label: 'Item Cancelled' });
  });

  it('the entity type is registered and classified operator, so owners never read the admin\'s reason', () => {
    expect(AUDIT_ENTITY_TYPES as readonly string[]).toContain('bos_queue_item');
    expect((AUDIT_ENTITY_OWNER_VISIBILITY as Record<string, string>).bos_queue_item).toBe('operator');
    expect(OWNER_HIDDEN_ENTITY_TYPES as readonly string[]).toContain('bos_queue_item');
    // The drain's own type stays owner-classified: it is written with the admin's id.
    expect(AUDIT_ENTITY_OWNER_VISIBILITY.bos_queue).toBe('owner');
  });
});
