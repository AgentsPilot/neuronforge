/**
 * POST /api/admin/jobs-queues/items/action with `action: 'retry'`
 * (ADMIN_BOS_CLEANUP slice 7c; workplan §5.1–§5.10; SA W7C-4..W7C-12).
 *
 * A retry ADDS one more send attempt to a real client, so double-send safety
 * is the whole job. The repositories are factory mocks over a MUTABLE store:
 * the read returns the row as it is now, and the retry compare-and-set applies
 * every real predicate (id, the row's own user_id, status, attempts,
 * sent_at IS NULL and the window bound) to that state. The eligibility module
 * is the real one, wrapped in spies, so the clock it is given can be checked.
 *
 *   G  the gate comes first; nothing read, called or flushed on a denial
 *   Z  strict Zod: no time, owner or account field can be sent
 *   S  every allowed cell → 200, back to pending, attempts and evidence kept
 *   N  every refused cell → 422 / 409, no write
 *   B  the 72 h window, the sending hours, the real clock
 *   BM the briefing across midnight (route side; P1 guards the dispatcher)
 *   X  races, double-click, two admins, retry vs cancel, sent_at fence
 *   T  tenant isolation
 *   A  one audit row, after the win
 *   P  no content, account id or reason leaves the route
 *   H  LEAD_RETRY_HELD, both states (SA fallback (b) for BL-7a)
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
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const order: string[] = [];

// ── Logger ───────────────────────────────────────────────────────────────
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

const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args) }));

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

// ── The sending-hours helper (the one service call, via lib/admin) ───────
const mockRetryTime = jest.fn();
jest.mock('@/lib/admin/jobs/reminderRetryTime', () => ({
  reminderRetryTime: (...args: unknown[]) => mockRetryTime(...args),
}));

// ── The lead-retry hold, switchable per test ─────────────────────────────
let mockHeld = false;
jest.mock('@/lib/admin/jobs/retryHolds', () => ({
  get LEAD_RETRY_HELD() {
    return mockHeld;
  },
}));

// ── The real eligibility module, observed ────────────────────────────────
const mockEligibilityCalls: unknown[][] = [];
const mockBoundCalls: unknown[][] = [];
let mockBoundOverride: { value: unknown } | null = null;
jest.mock('@/lib/admin/jobs/queueItemEligibility', () => {
  const actual = jest.requireActual('@/lib/admin/jobs/queueItemEligibility');
  return {
    ...actual,
    queueItemEligibility: (...args: unknown[]) => {
      mockEligibilityCalls.push(args);
      return actual.queueItemEligibility(...args);
    },
    retryWriteBound: (...args: unknown[]) => {
      mockBoundCalls.push(args);
      if (mockBoundOverride) return mockBoundOverride.value;
      return actual.retryWriteBound(...args);
    },
  };
});

// ── The two repositories, over a mutable store ───────────────────────────
const mockRead = jest.fn();
const mockCancel = jest.fn();
const mockRetry = jest.fn();
jest.mock('@/lib/repositories/AdminJobsQueuesRepository', () => ({
  adminJobsQueuesRepository: { readQueueItemAllAccounts: (...a: unknown[]) => mockRead(...a) },
}));
jest.mock('@/lib/repositories/AdminQueueActionsRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/AdminQueueActionsRepository');
  return {
    ...actual,
    adminQueueActionsRepository: {
      cancelQueueItemAllAccounts: (...a: unknown[]) => mockCancel(...a),
      retryQueueItemAllAccounts: (...a: unknown[]) => mockRetry(...a),
    },
  };
});

import { POST } from '../route';
import { ADMIN_QUEUE_CANCEL_PATCH, ADMIN_QUEUE_RETRY_PATCH } from '@/lib/repositories/AdminQueueActionsRepository';
import { IN_PROGRESS_STATUS, retryWriteBound, type RetryWriteBound } from '@/lib/admin/jobs/queueItemEligibility';
import { QUEUE_ITEM_STATUS_LABELS } from '@/lib/admin/jobs/buildQueueItemsView';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import { AUDIT_EVENTS, EVENT_METADATA } from '@/lib/audit/events';
import { audienceOf } from '@/lib/audit/eventAudience';
import { classifyAuditEvent } from '@/lib/audit/filterOptions';
import { OWNER_HIDDEN_ENTITY_TYPES } from '@/lib/audit/ownerVisibility';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };
const OWNER_A = '33333333-3333-4333-8333-333333333333';
const ITEM = 'abcdef12-3456-4789-8abc-def012345678';
const URL_ACTION = 'http://localhost/api/admin/jobs-queues/items/action';
const NOW = new Date('2026-10-04T12:00:00.000Z');
const HOUR = 3600 * 1000;
const WINDOW_MS = 72 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const DEAD_MARKER = 'dead-letter: max attempts';
type RetryableQueueId = Exclude<BosQueueId, 'payment_automations'>;
const RETRYABLE: RetryableQueueId[] = ['payment_reminders', 'daily_briefing_sends', 'lead_responses', 'insight_actions'];
const ROUTE_FILE = path.join(__dirname, '..', 'route.ts');
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

type Stored = Record<string, unknown> & {
  id: string;
  user_id: string;
  status: string;
  attempts: number;
  claimed_at: string | null;
  sent_at: string | null;
  error_message: string | null;
};

const store = new Map<string, Stored>();
const key = (queue: string, id: string) => `${queue}:${id}`;
let beforeCas: (() => void) | null = null;
let readGate: Promise<void> | null = null;
let readExtras: Record<string, unknown> = {};

function seed(queue: BosQueueId, overrides: Partial<Stored> = {}): Stored {
  const payment = queue === 'payment_reminders' || queue === 'payment_automations';
  const row: Stored = {
    id: ITEM,
    user_id: OWNER_A,
    status: 'failed',
    attempts: 3,
    claimed_at: null,
    claimed_by: null,
    created_at: iso(NOW.getTime() - HOUR),
    scheduled_at: payment ? iso(NOW.getTime() - HOUR) : null,
    next_attempt_at: null,
    kind: queue === 'lead_responses' ? 'chase' : queue === 'insight_actions' ? 'chase_invoice' : null,
    briefing_date: queue === 'daily_briefing_sends' ? '2026-10-04' : null,
    timezone: queue === 'daily_briefing_sends' ? 'UTC' : null,
    sent_at: null,
    error_message: 'provider 500',
    ...(payment ? {} : { skip_reason: null }),
    ...overrides,
  };
  store.set(key(queue, row.id), row);
  return row;
}

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

/** Postgres's view of the bound, on the stored text. */
function boundMatches(row: Stored, bound: RetryWriteBound): boolean {
  const value = row[bound.column] as string | null | undefined;
  if ('eq' in bound) return value === bound.eq;
  return typeof value === 'string' && Date.parse(value) >= Date.parse(bound.gte);
}

type RetryInput = {
  queue: RetryableQueueId;
  itemId: string;
  ownerUserId: string;
  expected: { status: string; attempts: number };
  bound: RetryWriteBound;
  nextAttemptAt: string | null;
};

function installStoreModel() {
  mockRead.mockImplementation(async (_ctx: unknown, queue: string, itemId: string) => {
    order.push(`read:${queue}`);
    if (readGate) await readGate;
    const row = store.get(key(queue, itemId));
    return { data: row ? { ...mapped(row), ...readExtras } : null, error: null };
  });
  mockRetry.mockImplementation(async (_ctx: unknown, input: RetryInput) => {
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
      row.sent_at === null &&
      boundMatches(row, input.bound);
    if (!matches) return { data: { outcome: 'not_matched' }, error: null };
    Object.assign(row, ADMIN_QUEUE_RETRY_PATCH[input.queue], { next_attempt_at: input.nextAttemptAt });
    return { data: { outcome: 'retried' }, error: null };
  });
  mockCancel.mockImplementation(async (_ctx: unknown, input: { queue: BosQueueId; itemId: string; ownerUserId: string; expected: { status: string; attempts: number } }) => {
    order.push('cancel-cas');
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
  });
}

function post(payload: unknown, init: { raw?: string } = {}): NextRequest {
  const text = init.raw !== undefined ? init.raw : payload === undefined ? undefined : JSON.stringify(payload);
  return new NextRequest(URL_ACTION, {
    method: 'POST',
    ...(text === undefined ? {} : { body: text }),
    headers: { 'content-type': 'application/json' },
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    queue: 'lead_responses',
    itemId: ITEM,
    action: 'retry',
    expected: { status: 'failed', attempts: 3 },
    reason: 'client asked again',
    ...overrides,
  };
}

function asAdmin() {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
}

const retryAudits = () => mockLogAndFlush.mock.calls.filter(([entry]) => entry?.action === 'BOS_QUEUE_ITEM_RETRIED');
const flush = () => new Promise((r) => setImmediate(r));
async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) await flush();
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.clearAllMocks();
  order.length = 0;
  loggedArgs.length = 0;
  mockTablesTouched.length = 0;
  mockEligibilityCalls.length = 0;
  mockBoundCalls.length = 0;
  mockBoundOverride = null;
  mockHeld = false;
  store.clear();
  beforeCas = null;
  readGate = null;
  readExtras = {};
  installStoreModel();
  // Inside sending hours by default: the next sending time is now.
  mockRetryTime.mockImplementation(async (_owner: string, now: Date) => new Date(now.getTime()));
  mockLogAndFlush.mockImplementation(async () => {
    order.push('audit');
  });
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────
describe('G — the gate comes first', () => {
  function expectNothingRan() {
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockRetry).not.toHaveBeenCalled();
    expect(mockRetryTime).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockTablesTouched).toEqual([]);
  }

  it('G-1 signed out → 401; the body is never read', async () => {
    mockGetUser.mockResolvedValue(null);
    const request = post(body({ queue: 'payment_reminders' }));
    const jsonSpy = jest.spyOn(request, 'json');
    expect((await POST(request)).status).toBe(401);
    expect(jsonSpy).not.toHaveBeenCalled();
    expectNothingRan();
  });

  it('G-2 not an admin → 403; G-3 the admin check throws → 403; G-4 auth throws → 401', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await POST(post(body({ queue: 'payment_reminders' })))).status).toBe(403);
    mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));
    expect((await POST(post(body())))).toHaveProperty('status', 403);
    mockGetUser.mockRejectedValue(new Error('cookie jar'));
    expect((await POST(post(body())))).toHaveProperty('status', 401);
    expectNothingRan();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Z — strict Zod: the client cannot choose a time, an owner or an account', () => {
  beforeEach(asAdmin);

  it.each([
    ['nextAttemptAt', { nextAttemptAt: iso(NOW.getTime()) }],
    ['retryAt', { retryAt: iso(NOW.getTime()) }],
    ['scheduledAt', { scheduledAt: iso(NOW.getTime()) }],
    ['sendAt', { sendAt: iso(NOW.getTime()) }],
    ['userId', { userId: OWNER_A }],
    ['accountId', { accountId: OWNER_A }],
    ['ownerUserId', { ownerUserId: OWNER_A }],
    ['expected.sentAt', { expected: { status: 'failed', attempts: 3, sentAt: null } }],
    ['expected.nextAttemptAt', { expected: { status: 'failed', attempts: 3, nextAttemptAt: null } }],
  ])('Z-2 / T-2 an extra key (%s) → 400; nothing read; the helper never called', async (_label, overrides) => {
    seed('payment_reminders');
    const res = await POST(post(body({ queue: 'payment_reminders', ...overrides })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'invalid_input' });
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockRetryTime).not.toHaveBeenCalled();
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it.each([
    ['a two-character reason', { reason: 'ab' }],
    ['a 501-character reason', { reason: 'x'.repeat(501) }],
    ['negative attempts', { expected: { status: 'failed', attempts: -1 } }],
    ['an unknown action', { action: 'requeue' }],
  ])('Z-3 %s → 400', async (_label, overrides) => {
    const res = await POST(post(body(overrides)));
    expect(res.status).toBe(400);
    expect(mockRead).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
type Cell = { queue: RetryableQueueId; label: string; row: Partial<Stored> };
const CELLS: Cell[] = [
  { queue: 'payment_reminders', label: 'failed by its runner (claim still set)', row: { attempts: 1, claimed_at: iso(NOW.getTime() - 2 * HOUR), claimed_by: 'runner-9' } },
  { queue: 'payment_reminders', label: 'failed dead-lettered', row: { attempts: 5, error_message: DEAD_MARKER } },
  { queue: 'daily_briefing_sends', label: 'failed, today', row: { attempts: 3, skip_reason: null } },
  { queue: 'lead_responses', label: 'failed dead-lettered', row: { attempts: 3, error_message: DEAD_MARKER } },
  { queue: 'insight_actions', label: 'failed dead-lettered', row: { attempts: 5, error_message: DEAD_MARKER } },
];

describe('S — every allowed cell (C7-1, C7-16)', () => {
  beforeEach(asAdmin);

  it.each(CELLS.map((c) => [c.queue, c.label, c] as const))('%s / %s → 200; back to pending; attempts, error text and anchors kept', async (_q, _l, cell) => {
    const row = seed(cell.queue, cell.row);
    const before = { ...row };
    const res = await POST(post(body({ queue: cell.queue, expected: { status: 'failed', attempts: row.attempts } })));
    expect(res.status).toBe(200);
    const json = await res.json();
    const nextAttemptAt = cell.queue === 'payment_reminders' ? NOW.toISOString() : null;
    expect(Object.keys(json.data).sort()).toEqual(['action', 'after', 'before', 'itemId', 'nextAttemptAt', 'queue']);
    expect(json.data).toEqual({
      queue: cell.queue,
      itemId: ITEM,
      action: 'retry',
      before: { status: 'failed', statusLabel: QUEUE_ITEM_STATUS_LABELS.failed },
      after: { status: 'pending', statusLabel: 'Waiting' },
      nextAttemptAt,
    });
    expect(mockRetry).toHaveBeenCalledTimes(1);
    const [ctx, input] = mockRetry.mock.calls[0];
    expect(ctx).toEqual({ correlationId: expect.any(String), adminId: ADMIN.id });
    expect(input).toEqual({
      queue: cell.queue,
      itemId: ITEM,
      ownerUserId: OWNER_A,
      expected: { status: 'failed', attempts: before.attempts },
      bound: retryWriteBound(cell.queue, { status: 'failed', claimedAt: before.claimed_at, scheduledAt: (before.scheduled_at as string | null) ?? null, createdAt: before.created_at as string, briefingDate: (before.briefing_date as string | null) ?? null, timezone: (before.timezone as string | null) ?? null }, NOW, NOW),
      nextAttemptAt,
    });
    // The stored row: back to pending, claim cleared; NOTHING else moved (C7-4).
    expect(row.status).toBe('pending');
    expect(row.claimed_at).toBeNull();
    expect(row.claimed_by).toBeNull();
    expect(row.next_attempt_at).toBe(nextAttemptAt);
    for (const column of ['attempts', 'error_message', 'skip_reason', 'scheduled_at', 'created_at', 'sent_at', 'briefing_date', 'timezone', 'kind', 'user_id']) {
      expect([column, row[column]]).toEqual([column, before[column]]);
    }
    expect(retryAudits()).toHaveLength(1);
    // Only reminders need the sending-hours helper, and only for the ROW's owner.
    if (cell.queue === 'payment_reminders') expect(mockRetryTime.mock.calls).toEqual([[OWNER_A, NOW]]);
    else expect(mockRetryTime).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('N — refused cells', () => {
  beforeEach(asAdmin);

  it.each(['pending', 'failed', 'dead_letter', 'running', 'completed', 'cancelled', 'zzz'])(
    'N-1 payment_automations / %s → 422 retry_not_offered; nothing read, the helper and the CAS never called',
    async (status) => {
      seed('payment_automations', { status });
      const res = await POST(post(body({ queue: 'payment_automations', expected: { status, attempts: 3 } })));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ success: false, code: 'retry_not_offered' });
      expect(mockRead).not.toHaveBeenCalled();
      expect(mockRetryTime).not.toHaveBeenCalled();
      expect(mockRetry).not.toHaveBeenCalled();
      expect(retryAudits()).toHaveLength(0);
    }
  );

  it.each(RETRYABLE.flatMap((q) => ['pending', 'processing', 'sent', 'skipped', 'cancelled', 'running', 'dead_letter', 'zzz'].map((s) => [q, s] as const)))(
    'N-2 / N-3 / N-4 %s / expected %s → 422 not_retryable_state; nothing read',
    async (queue, status) => {
      seed(queue, { status, claimed_at: status === 'processing' ? null : null });
      const res = await POST(post(body({ queue, expected: { status, attempts: 3 } })));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ success: false, code: 'not_retryable_state' });
      expect(mockRead).not.toHaveBeenCalled();
      expect(mockRetry).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['payment_reminders', 'sent'],
    ['lead_responses', 'skipped'],
    ['insight_actions', 'sent'],
    ['daily_briefing_sends', 'pending'],
  ] as const)('N-5 %s finished or moved (%s) between load and click → 409 with its label; the CAS never called', async (queue, now) => {
    seed(queue, { status: now });
    const res = await POST(post(body({ queue })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: 'This item changed since the list was loaded. Nothing was retried.',
      code: 'item_changed',
      current: { status: now, statusLabel: QUEUE_ITEM_STATUS_LABELS[now] },
    });
    expect(mockRetry).not.toHaveBeenCalled();
    expect(retryAudits()).toHaveLength(0);
  });

  it('N-6 a reminder with no scheduled_at → 422 no_due_time, anchorAt null; the CAS never called', async () => {
    seed('payment_reminders', { scheduled_at: null });
    const res = await POST(post(body({ queue: 'payment_reminders' })));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'no_due_time', anchorAt: null });
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('N-7 a briefing with a malformed briefing_date → 422 no_due_time', async () => {
    seed('daily_briefing_sends', { briefing_date: '2026-02-31' });
    const res = await POST(post(body({ queue: 'daily_briefing_sends' })));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('no_due_time');
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('the retry sentences never say "cancelled"; the 7b cancel sentences are unchanged', async () => {
    seed('lead_responses', { status: 'sent' });
    const retry = await (await POST(post(body()))).json();
    expect(retry.error).toBe('This item changed since the list was loaded. Nothing was retried.');
    seed('lead_responses', { status: 'sent' });
    const cancel = await (await POST(post(body({ action: 'cancel', expected: { status: 'pending', attempts: 3 } })))).json();
    expect(cancel.error).toBe('This item changed since the list was loaded. Nothing was cancelled.');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — the 72 h window, sending hours, the real clock', () => {
  beforeEach(asAdmin);

  it('B-1 lead reply queued exactly 72 h ago → allowed; the bound is gte created_at = now − 72 h', async () => {
    seed('lead_responses', { created_at: iso(NOW.getTime() - WINDOW_MS) });
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    expect(mockRetry.mock.calls[0][1].bound).toEqual({ column: 'created_at', gte: iso(NOW.getTime() - WINDOW_MS) });
  });

  it('B-2 one millisecond older → 422 retry_window_passed with anchorAt; the CAS never called', async () => {
    seed('insight_actions', { created_at: iso(NOW.getTime() - WINDOW_MS - 1) });
    const res = await POST(post(body({ queue: 'insight_actions' })));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: 'This item is more than 72 hours past when it was due, so it can be cancelled but not retried. Nothing was changed.',
      code: 'retry_window_passed',
      anchorAt: iso(NOW.getTime() - WINDOW_MS - 1),
    });
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('B-3 reminder inside sending hours, due exactly 72 h ago → allowed; retryAt = now; bound = now − 72 h', async () => {
    seed('payment_reminders', { scheduled_at: iso(NOW.getTime() - WINDOW_MS) });
    const res = await POST(post(body({ queue: 'payment_reminders' })));
    expect(res.status).toBe(200);
    expect(mockRetry.mock.calls[0][1]).toMatchObject({
      bound: { column: 'scheduled_at', gte: iso(NOW.getTime() - WINDOW_MS) },
      nextAttemptAt: NOW.toISOString(),
    });
  });

  it('B-4 reminder due 70 h ago, at 21:30 local: the next sending time is past due + 72 h → 422 retry_window_passed (the ELIGIBLE time decides, not now)', async () => {
    seed('payment_reminders', { scheduled_at: iso(NOW.getTime() - 70 * HOUR) });
    mockRetryTime.mockResolvedValueOnce(new Date(NOW.getTime() + 10.5 * HOUR)); // the next 08:00
    const res = await POST(post(body({ queue: 'payment_reminders' })));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'retry_window_passed', anchorAt: iso(NOW.getTime() - 70 * HOUR) });
    expect(mockRetry).not.toHaveBeenCalled();
    expect(retryAudits()).toHaveLength(0);
  });

  it('B-5 reminder due 60 h ago, at 02:00 local: retryAt = 08:00 → allowed; next_attempt_at = retryAt; bound = retryAt − 72 h, NOT now − 72 h', async () => {
    const row = seed('payment_reminders', { scheduled_at: iso(NOW.getTime() - 60 * HOUR) });
    const retryAt = new Date(NOW.getTime() + 6 * HOUR);
    mockRetryTime.mockResolvedValueOnce(retryAt);
    const res = await POST(post(body({ queue: 'payment_reminders' })));
    expect(res.status).toBe(200);
    expect((await res.json()).data.nextAttemptAt).toBe(retryAt.toISOString());
    const input = mockRetry.mock.calls[0][1];
    expect(input.bound).toEqual({ column: 'scheduled_at', gte: iso(retryAt.getTime() - WINDOW_MS) });
    expect(input.bound.gte).not.toBe(iso(NOW.getTime() - WINDOW_MS));
    expect(input.nextAttemptAt).toBe(retryAt.toISOString());
    expect(row.next_attempt_at).toBe(retryAt.toISOString());
    expect(row.scheduled_at).toBe(iso(NOW.getTime() - 60 * HOUR));
  });

  it('B-5b the bound uses retryAt: a reminder whose retryAt is near the window edge still matches its own CAS', async () => {
    // Due 71 h ago; retryAt is now + 1 h, exactly the limit. With a now − 72 h
    // bound the CAS would also match here, so this pins the other direction:
    // the CAS bound moves WITH retryAt.
    seed('payment_reminders', { scheduled_at: iso(NOW.getTime() - 71 * HOUR) });
    const retryAt = new Date(NOW.getTime() + HOUR);
    mockRetryTime.mockResolvedValueOnce(retryAt);
    expect((await POST(post(body({ queue: 'payment_reminders' })))).status).toBe(200);
    expect(mockRetry.mock.calls[0][1].bound.gte).toBe(iso(NOW.getTime() - 71 * HOUR));
  });

  it('B-8 the real clock: one Date reaches the helper, the eligibility check and the bound', async () => {
    seed('payment_reminders');
    jest.setSystemTime(new Date('2026-10-04T12:00:59.999Z')); // NOT a whole minute: a floored clock would differ
    await POST(post(body({ queue: 'payment_reminders' })));
    const helperNow = mockRetryTime.mock.calls[0][1] as Date;
    const eligibilityNow = mockEligibilityCalls[0][2] as Date;
    const boundNow = mockBoundCalls[0][2] as Date;
    expect(helperNow.toISOString()).toBe('2026-10-04T12:00:59.999Z');
    expect(eligibilityNow).toBe(helperNow);
    expect(boundNow).toBe(helperNow);
    expect(mockBoundCalls[0][3]).toBe(mockEligibilityCalls[0][3] && (mockEligibilityCalls[0][3] as { retryAt: Date }).retryAt);
  });

  it('B-8 source: retryItem calls new Date() exactly once and imports no list clock', () => {
    const code = codeOf(fs.readFileSync(ROUTE_FILE, 'utf8'));
    const start = code.indexOf('async function retryItem(');
    expect(start).toBeGreaterThan(0);
    const next = code.indexOf('\nasync function ', start + 10);
    const nextFn = code.indexOf('\nfunction ', start + 10);
    const end = [next, nextFn, code.length].filter((i) => i > start).sort((a, b) => a - b)[0];
    const retryItem = code.slice(start, end);
    expect(retryItem.match(/new Date\(\)/g)).toHaveLength(1);
    expect(code).not.toMatch(/floor\w*Minute|minuteFloor|listClock|flooredNow/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('BM — the briefing across midnight (route side; the dispatcher guard is P1)', () => {
  beforeEach(asAdmin);

  it.each([
    ['America/Los_Angeles', '2026-10-05T06:59:59.999Z', '2026-10-05T07:00:00.000Z'],
    ['Asia/Kolkata', '2026-10-04T18:29:59.999Z', '2026-10-04T18:30:00.000Z'],
    ['Pacific/Chatham', '2026-10-04T10:14:59.999Z', '2026-10-04T10:15:00.000Z'],
  ])('BM-1..BM-3 %s: allowed at 23:59:59.999 local (CAS eq briefing_date D); refused at 00:00 local', async (zone, before, after) => {
    seed('daily_briefing_sends', { timezone: zone, briefing_date: '2026-10-04' });
    jest.setSystemTime(new Date(before));
    expect((await POST(post(body({ queue: 'daily_briefing_sends' })))).status).toBe(200);
    expect(mockRetry.mock.calls[0][1].bound).toEqual({ column: 'briefing_date', eq: '2026-10-04' });

    seed('daily_briefing_sends', { timezone: zone, briefing_date: '2026-10-04' });
    jest.setSystemTime(new Date(after));
    const res = await POST(post(body({ queue: 'daily_briefing_sends' })));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'briefing_not_today',
      error: "This briefing's day has passed in the business's time zone, so it can be cancelled but not retried. Nothing was changed.",
    });
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('BM-4 a null or invalid zone: the route and the bound both use UTC', async () => {
    for (const timezone of [null, 'Not/AZone']) {
      jest.clearAllMocks();
      installStoreModel();
      seed('daily_briefing_sends', { timezone, briefing_date: '2026-10-04' });
      jest.setSystemTime(new Date('2026-10-04T23:59:59.999Z'));
      expect((await POST(post(body({ queue: 'daily_briefing_sends' })))).status).toBe(200);
      expect(mockRetry.mock.calls[0][1].bound).toEqual({ column: 'briefing_date', eq: '2026-10-04' });
    }
  });

  it('BM-5 the race: the check passes, the CAS evaluates "today" as D+1 → count 0, unchanged re-read, fresh clock → 422 briefing_not_today; no audit', async () => {
    seed('daily_briefing_sends', { briefing_date: '2026-10-04' });
    jest.setSystemTime(new Date('2026-10-04T23:59:59.990Z'));
    mockRetry.mockImplementationOnce(async () => {
      order.push('cas');
      jest.setSystemTime(new Date('2026-10-05T00:00:00.010Z'));
      return { data: { outcome: 'not_matched' }, error: null };
    });
    const res = await POST(post(body({ queue: 'daily_briefing_sends' })));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'briefing_not_today' });
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(retryAudits()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('X — races, double-click, the double-send test', () => {
  beforeEach(asAdmin);

  it('X-1 stale attempts (retried and failed again in between) → 409; no CAS, no audit', async () => {
    seed('lead_responses', { attempts: 4 });
    const res = await POST(post(body({ expected: { status: 'failed', attempts: 3 } })));
    expect(res.status).toBe(409);
    expect(mockRetry).not.toHaveBeenCalled();
    expect(retryAudits()).toHaveLength(0);
  });

  it('X-2 another admin cancelled it → 409 "Skipped"', async () => {
    seed('lead_responses', { status: 'skipped' });
    const res = await POST(post(body()));
    expect((await res.json()).current).toEqual({ status: 'skipped', statusLabel: 'Skipped' });
  });

  it('X-3 another admin retries between our read and our CAS → one CAS, a re-read, 409 "Waiting"; exactly one retry applied', async () => {
    const row = seed('lead_responses');
    beforeCas = () => Object.assign(row, ADMIN_QUEUE_RETRY_PATCH.lead_responses);
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'item_changed', current: { status: 'pending', statusLabel: 'Waiting' } });
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(order.filter((s) => s === 'cas' || s.startsWith('read:'))).toEqual(['read:lead_responses', 'cas', 'read:lead_responses']);
    expect(row.attempts).toBe(3);
    expect(retryAudits()).toHaveLength(0);
  });

  it('X-4 deleted between the read and the CAS → 404', async () => {
    seed('lead_responses');
    beforeCas = () => store.delete(key('lead_responses', ITEM));
    const res = await POST(post(body()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'item_not_found', error: 'This item is no longer in this queue. Nothing was retried.' });
  });

  it('X-5 double-click, sequential: 200 then 409 "Waiting"; one CAS, one audit row', async () => {
    seed('insight_actions');
    const first = await POST(post(body({ queue: 'insight_actions' })));
    const second = await POST(post(body({ queue: 'insight_actions' })));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).current).toEqual({ status: 'pending', statusLabel: 'Waiting' });
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  });

  it('X-6 two admins at once, both past the pre-check: exactly one 200 and one 409; one patch, one audit row', async () => {
    const row = seed('payment_reminders');
    let release!: () => void;
    readGate = new Promise<void>((resolve) => (release = resolve));
    const requests = [
      POST(post(body({ queue: 'payment_reminders', reason: 'first admin' }))),
      POST(post(body({ queue: 'payment_reminders', reason: 'second admin' }))),
    ];
    await until(() => mockRead.mock.calls.length === 2);
    readGate = null;
    release();
    const statuses = (await Promise.all(requests)).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(mockRetry).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ status: 'pending', attempts: 3 });
    expect(retryAudits()).toHaveLength(1);
  });

  it('X-7 the §9 double-send test: after a winning retry the row is claimable exactly once, and a second retry is refused', async () => {
    const row = seed('lead_responses');
    expect((await POST(post(body()))).status).toBe(200);
    // Model the claim: FOR UPDATE SKIP LOCKED on pending rows, attempts + 1.
    const claim = () => {
      if (row.status !== 'pending') return null;
      Object.assign(row, { status: 'processing', attempts: row.attempts + 1, claimed_at: NOW.toISOString(), claimed_by: 'runner' });
      return row.id;
    };
    const claims = [claim(), claim()];
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(row).toMatchObject({ status: 'processing', attempts: 4 });
    // A second retry with the original expectation cannot re-arm it.
    const again = await POST(post(body()));
    expect(again.status).toBe(409);
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(retryAudits()).toHaveLength(1);
  });

  it('X-8 retry versus another admin\'s cancel: whichever CAS lands first wins; never both', async () => {
    const row = seed('insight_actions');
    let release!: () => void;
    readGate = new Promise<void>((resolve) => (release = resolve));
    const requests = [
      POST(post(body({ queue: 'insight_actions' }))),
      POST(post(body({ queue: 'insight_actions', action: 'cancel' }))),
    ];
    await until(() => mockRead.mock.calls.length === 2);
    readGate = null;
    release();
    const statuses = (await Promise.all(requests)).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(['pending', 'skipped']).toContain(row.status);
    const audits = mockLogAndFlush.mock.calls.map(([entry]) => entry.action);
    expect(audits).toHaveLength(1);
  });

  it.each([
    ['a count that is not 0 or 1', { data: null, error: Object.assign(new Error('count'), { code: 'count_unconfirmed' }) }],
    ['a PostgREST error', { data: null, error: Object.assign(new Error('x'), { code: '42703' }) }],
    ['an unknown outcome', { data: { outcome: 'maybe' }, error: null }],
    ['the cancel outcome word', { data: { outcome: 'cancelled' }, error: null }],
    ['no data and no error', { data: null, error: null }],
  ])('X-9 %s → 500 outcome_unknown; error log with ids; no audit', async (_label, result) => {
    seed('lead_responses');
    mockRetry.mockResolvedValueOnce(result);
    const res = await POST(post(body()));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      code: 'outcome_unknown',
      error: "The retry could not be confirmed. Check the item's status before trying again.",
    });
    expect(retryAudits()).toHaveLength(0);
    expect(loggedArgs.find((l) => l.level === 'error')?.args[0]).toMatchObject({ queue: 'lead_responses', itemId: ITEM, adminUserId: ADMIN.id });
  });

  it('X-9 a CAS that throws → 500 outcome_unknown; no audit', async () => {
    seed('lead_responses');
    mockRetry.mockRejectedValueOnce(new Error('socket hang up'));
    const res = await POST(post(body()));
    expect((await res.json()).code).toBe('outcome_unknown');
    expect(retryAudits()).toHaveLength(0);
  });

  it('X-10 the first read fails → 500 action_failed; the re-read after a lost CAS fails → 500 action_failed; no second CAS', async () => {
    seed('lead_responses');
    mockRead.mockResolvedValueOnce({ data: null, error: new Error('timeout') });
    let res = await POST(post(body()));
    expect(await res.json()).toMatchObject({ code: 'action_failed', error: 'Could not read the item just now. Nothing was retried.' });
    expect(mockRetry).not.toHaveBeenCalled();

    const row = seed('lead_responses');
    beforeCas = () => Object.assign(row, { status: 'processing' });
    mockRead.mockImplementationOnce(async (_c: unknown, q: string, id: string) => ({ data: mapped(store.get(key(q, id))!), error: null }));
    mockRead.mockImplementationOnce(async () => ({ data: null, error: new Error('timeout') }));
    res = await POST(post(body()));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('action_failed');
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(retryAudits()).toHaveLength(0);
  });

  it('X-11 the sending-hours helper rejects → 500 action_failed; the CAS never called', async () => {
    seed('payment_reminders');
    mockRetryTime.mockRejectedValueOnce(new Error('zone read SENTINEL'));
    const res = await POST(post(body({ queue: 'payment_reminders' })));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('action_failed');
    expect(mockRetry).not.toHaveBeenCalled();
    expect(retryAudits()).toHaveLength(0);
    expect(JSON.stringify(loggedArgs)).not.toContain('SENTINEL');
  });

  it('X-11 the helper passes its 5 s deadline → 500 action_failed; the CAS never called', async () => {
    seed('payment_reminders');
    mockRetryTime.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = POST(post(body({ queue: 'payment_reminders' })));
    await until(() => mockRetryTime.mock.calls.length === 1);
    jest.advanceTimersByTime(5001);
    const res = await pending;
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('action_failed');
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('X-11 the helper returns an invalid time → 500 action_failed; the CAS never called', async () => {
    seed('payment_reminders');
    mockRetryTime.mockResolvedValueOnce(new Date('nope'));
    const res = await POST(post(body({ queue: 'payment_reminders' })));
    expect(res.status).toBe(500);
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it.each(RETRYABLE)('X-12 %s: the sent_at fence. A failed row with a recorded send → count 0, unchanged re-read → 422 not_retryable_state, warn write_predicate; no audit; the row unchanged', async (queue) => {
    const row = seed(queue, { sent_at: iso(NOW.getTime() - 30 * 60 * 1000) });
    const before = { ...row };
    const res = await POST(post(body({ queue })));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: 'This item can no longer be retried. Nothing was changed.',
      code: 'not_retryable_state',
    });
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(row).toEqual(before);
    expect(retryAudits()).toHaveLength(0);
    expect(loggedArgs.some((l) => l.level === 'warn' && (l.args[0] as { cause?: string }).cause === 'write_predicate')).toBe(true);
    // OP-7 as clarified: no second helper call.
    expect(mockRetryTime).toHaveBeenCalledTimes(queue === 'payment_reminders' ? 1 : 0);
  });

  it('X-13 the window closes between the check and the write (clock moves, CAS misses) → 422 retry_window_passed; no audit', async () => {
    seed('lead_responses', { created_at: iso(NOW.getTime() - WINDOW_MS) });
    mockRetry.mockImplementationOnce(async () => {
      order.push('cas');
      jest.setSystemTime(new Date(NOW.getTime() + 1000));
      return { data: { outcome: 'not_matched' }, error: null };
    });
    const res = await POST(post(body()));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'retry_window_passed', anchorAt: iso(NOW.getTime() - WINDOW_MS) });
    expect(retryAudits()).toHaveLength(0);
  });

  it('X-13b a lost reminder CAS is re-judged with the SAME retryAt (OP-7): the clock moving past the window does not change the answer; no second helper call', async () => {
    // Due exactly 72 h ago, inside sending hours: retryAt = now, the limit.
    // The reminder bound is retryAt − 72 h, which does not move with the
    // clock, so an unchanged row can only have hit the sent_at fence.
    seed('payment_reminders', { scheduled_at: iso(NOW.getTime() - WINDOW_MS) });
    mockRetry.mockImplementationOnce(async () => {
      order.push('cas');
      jest.setSystemTime(new Date(NOW.getTime() + 1000));
      return { data: { outcome: 'not_matched' }, error: null };
    });
    const res = await POST(post(body({ queue: 'payment_reminders' })));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: 'This item can no longer be retried. Nothing was changed.',
      code: 'not_retryable_state',
    });
    expect(mockRetryTime).toHaveBeenCalledTimes(1);
    const recheck = mockEligibilityCalls[mockEligibilityCalls.length - 1];
    expect((recheck[3] as { retryAt?: Date }).retryAt?.toISOString()).toBe(NOW.toISOString());
    expect(retryAudits()).toHaveLength(0);
  });

  it('a null bound (impossible after the check) → 500 action_failed; nothing written', async () => {
    seed('lead_responses');
    mockBoundOverride = { value: null };
    const res = await POST(post(body()));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('action_failed');
    expect(mockRetry).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('T — tenant isolation', () => {
  beforeEach(asAdmin);

  it('T-1 the CAS owner and the helper\'s owner are both the ROW\'s user_id (never the admin)', async () => {
    seed('payment_reminders', { user_id: 'OWNER-FROM-THE-ROW' });
    await POST(post(body({ queue: 'payment_reminders' })));
    expect(mockRetry.mock.calls[0][1].ownerUserId).toBe('OWNER-FROM-THE-ROW');
    expect(mockRetryTime.mock.calls[0][0]).toBe('OWNER-FROM-THE-ROW');
    expect(mockRetryTime.mock.calls[0][0]).not.toBe(ADMIN.id);
  });

  it('T-3 an id that exists in lead_responses, sent as insight_actions → 404; only insight_actions read', async () => {
    seed('lead_responses');
    const res = await POST(post(body({ queue: 'insight_actions' })));
    expect(res.status).toBe(404);
    expect(mockRead.mock.calls.map((c) => c[1])).toEqual(['insight_actions']);
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('T-4 an unknown id → 404', async () => {
    const res = await POST(post(body()));
    expect(res.status).toBe(404);
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('T-5 / W7B-6 / W7C-9 / W7C-11 source: no service, no send path, no payment event, no AI or credit call', () => {
    const code = codeOf(fs.readFileSync(ROUTE_FILE, 'utf8'));
    expect(code).not.toMatch(/from\s*'@\/lib\/services\//);
    expect(code).toMatch(/from\s*'@\/lib\/admin\/jobs\/reminderRetryTime'/);
    expect(code).not.toMatch(/paymentReminderService|nextSendableAt/);
    expect(code).not.toMatch(/processDue|drain|claim_due|\.rpc\(/i);
    expect(code).not.toMatch(/emitPaymentEvent|PaymentEventService/);
    expect(code).not.toMatch(/runAiAction|getProviderFactory|from\s*'@\/lib\/(ai|business-os\/(llm|credits))\b/);
    expect(code).not.toMatch(/\.\.\.\s*(body|parsed|input|expected|row)\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('A — the audit row (W7C-10)', () => {
  beforeEach(asAdmin);

  it.each(RETRYABLE)('A-1 %s: exactly one row with the §2.7 shape', async (queue) => {
    const row = seed(queue);
    await POST(post(body({ queue })));
    expect(retryAudits()).toHaveLength(1);
    const [entry, , context] = retryAudits()[0];
    expect(Object.keys(entry).sort()).toEqual(['action', 'actorId', 'changes', 'details', 'entityId', 'entityType', 'request', 'severity', 'userId']);
    expect(entry).toMatchObject({
      action: 'BOS_QUEUE_ITEM_RETRIED',
      entityType: 'bos_queue_item',
      entityId: ITEM,
      userId: OWNER_A,
      actorId: ADMIN.id,
      severity: 'warning',
    });
    expect(entry.changes).toEqual({
      before: { status: 'failed', attempts: 3 },
      after: { status: 'pending', next_attempt_at: queue === 'payment_reminders' ? NOW.toISOString() : null },
    });
    expect(Object.keys(entry.details).sort()).toEqual(['action', 'correlationId', 'dueAnchor', 'queue', 'reason']);
    expect(entry.details).toMatchObject({ reason: 'client asked again', queue, action: 'retry', correlationId: expect.any(String) });
    expect(entry.details.dueAnchor).toBe(
      queue === 'daily_briefing_sends' ? '2026-10-04T00:00:00.000Z' : queue === 'payment_reminders' ? row.scheduled_at : row.created_at
    );
    expect(entry.details).not.toHaveProperty('deadLettered');
    expect(context).toEqual({ reason: expect.any(String), continues: expect.any(String) });
  });

  it('A-2 order: CAS → "Queue item retried" (info) → logAndFlush → the response, held until the flush resolves', async () => {
    seed('payment_reminders');
    let releaseFlush!: () => void;
    mockLogAndFlush.mockImplementationOnce(() => {
      order.push('audit');
      return new Promise<void>((resolve) => (releaseFlush = resolve));
    });
    let settled = false;
    const pending = POST(post(body({ queue: 'payment_reminders' }))).then((r) => {
      settled = true;
      return r;
    });
    await until(() => mockLogAndFlush.mock.calls.length > 0);
    await flush();
    expect(settled).toBe(false);
    releaseFlush();
    expect((await pending).status).toBe(200);
    expect(order.filter((s) => ['cas', 'audit', 'log:Queue item retried'].includes(s))).toEqual(['cas', 'log:Queue item retried', 'audit']);
    const line = loggedArgs.find((l) => l.args[1] === 'Queue item retried');
    expect(line?.level).toBe('info');
    expect(line?.args[0]).toEqual({
      adminUserId: ADMIN.id,
      queue: 'payment_reminders',
      itemId: ITEM,
      from: 'failed',
      to: 'pending',
      nextAttemptAt: NOW.toISOString(),
    });
  });

  it('A-3 a flush that "times out" (resolves) still answers 200', async () => {
    seed('lead_responses');
    mockLogAndFlush.mockResolvedValueOnce(undefined);
    expect((await POST(post(body()))).status).toBe(200);
  });

  it('A-4 no audit row on any refusal (400, 401, 403, 404, 409, 422, 500)', async () => {
    const runs: Array<() => Promise<Response>> = [
      async () => POST(post(body({ queue: 'nope' }))),
      async () => POST(post(body({ queue: 'payment_automations' }))),
      async () => POST(post(body({ expected: { status: 'pending', attempts: 3 } }))),
      async () => POST(post(body())), // 404
      async () => {
        seed('lead_responses', { status: 'sent' });
        return POST(post(body()));
      },
      async () => {
        seed('lead_responses', { created_at: iso(NOW.getTime() - 100 * HOUR) });
        return POST(post(body()));
      },
      async () => {
        seed('lead_responses', { sent_at: NOW.toISOString() });
        return POST(post(body()));
      },
      async () => {
        seed('lead_responses');
        mockRetry.mockResolvedValueOnce({ data: null, error: new Error('x') });
        return POST(post(body()));
      },
    ];
    for (const run of runs) {
      store.clear();
      const res = await run();
      expect([400, 404, 409, 422, 500]).toContain(res.status);
    }
    mockGetUser.mockResolvedValue(null);
    await POST(post(body()));
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    await POST(post(body()));
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    for (const message of ['Queue item retry refused', 'Queue item changed before retry']) {
      expect(loggedArgs.some((l) => l.level === 'info' && l.args[1] === message)).toBe(true);
    }
  });

  it('A-6 the reason is never logged', async () => {
    seed('lead_responses');
    await POST(post(body({ reason: 'REASON-SENTINEL-TEXT' })));
    expect(retryAudits()[0][0].details.reason).toBe('REASON-SENTINEL-TEXT');
    expect(JSON.stringify(loggedArgs)).not.toContain('REASON-SENTINEL');
  });

  it('A-5 registration: warning, SOC2, audience bos, "Business OS Queues" / "Item Retried", owner-hidden entity type', () => {
    expect((AUDIT_EVENTS as Record<string, string>).BOS_QUEUE_ITEM_RETRIED).toBe('BOS_QUEUE_ITEM_RETRIED');
    expect(EVENT_METADATA.BOS_QUEUE_ITEM_RETRIED).toMatchObject({ severity: 'warning', complianceFlags: ['SOC2'] });
    expect(audienceOf('BOS_QUEUE_ITEM_RETRIED')).toBe('bos');
    expect(classifyAuditEvent('BOS_QUEUE_ITEM_RETRIED')).toEqual({ group: 'Business OS Queues', label: 'Item Retried' });
    expect(OWNER_HIDDEN_ENTITY_TYPES as readonly string[]).toContain('bos_queue_item');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('P — no content, account id or reason leaves the route', () => {
  beforeEach(asAdmin);
  const OWNER_SENTINEL = 'OWNER-SENTINEL-ID';

  it.each(RETRYABLE)('%s: 200, 409, 404 and 422 paths', async (queue) => {
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
      sent_at: 'SENTINEL-SENT',
      ...(queue === 'daily_briefing_sends' ? {} : { timezone: 'SENTINEL/Zone' }),
    };
    const bodies: string[] = [];
    const record = async (res: Response) => bodies.push(await res.text());

    seed(queue, { user_id: OWNER_SENTINEL, error_message: 'SENTINEL-STORED' });
    await record(await POST(post(body({ queue })))); // 200
    await record(await POST(post(body({ queue })))); // 409, now pending
    store.clear();
    await record(await POST(post(body({ queue })))); // 404
    seed(queue, { user_id: OWNER_SENTINEL, created_at: iso(NOW.getTime() - 100 * HOUR), scheduled_at: iso(NOW.getTime() - 100 * HOUR), briefing_date: '2026-09-30' });
    await record(await POST(post(body({ queue })))); // 422

    expect(bodies.map((b) => JSON.parse(b).success)).toEqual([true, false, false, false]);
    for (const text of bodies) expect(text).not.toMatch(/SENTINEL|sentinel|client\.test|@/);
    const logs = JSON.stringify(loggedArgs);
    expect(logs).not.toMatch(/SENTINEL|sentinel|client\.test/);
    const audits = JSON.stringify(mockLogAndFlush.mock.calls.map(([entry]) => ({ ...entry, request: undefined })));
    expect(audits).not.toMatch(/SENTINEL-(ERR|SKIP|REC|CONTACT|INVOICE|BOOKING|ENTITY|RUNNER|STORED|SENT)|sentinel@|client\.test|SENTINEL\/Zone/);
    for (const [, input] of mockRetry.mock.calls) {
      expect(JSON.stringify(input)).not.toMatch(/error_message|skip_reason|sent_at|SENTINEL-(ERR|SENT)/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('H — LEAD_RETRY_HELD (SA fallback (b) for BL-7a), both states', () => {
  beforeEach(asAdmin);

  it('held: a lead-reply retry → 422 retry_held with a plain sentence; nothing read, nothing written, no audit', async () => {
    mockHeld = true;
    const row = seed('lead_responses');
    const before = { ...row };
    const res = await POST(post(body()));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Retrying lead replies is paused for now, until a fix to how they are sent is live. Nothing was changed.',
      code: 'retry_held',
    });
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockRetry).not.toHaveBeenCalled();
    expect(row).toEqual(before);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('held: the other queues retry as normal, and a lead reply can still be cancelled', async () => {
    mockHeld = true;
    for (const queue of ['payment_reminders', 'daily_briefing_sends', 'insight_actions'] as const) {
      seed(queue);
      expect((await POST(post(body({ queue })))).status).toBe(200);
    }
    seed('lead_responses');
    expect((await POST(post(body({ action: 'cancel' })))).status).toBe(200);
  });

  it('not held (the default): a lead-reply retry is allowed', async () => {
    mockHeld = false;
    seed('lead_responses');
    expect((await POST(post(body()))).status).toBe(200);
    expect(retryAudits()).toHaveLength(1);
  });
});
