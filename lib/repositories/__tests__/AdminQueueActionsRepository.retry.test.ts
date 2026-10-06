/**
 * AdminQueueActionsRepository.retryQueueItemAllAccounts (ADMIN_BOS_CLEANUP
 * slice 7c; SA C7-2, C7-3, C7-4, C7-5, C7-9, C7-12, W7C-4, W7C-6, W7C-9,
 * W7C-11; workplan §2.3 and §5.11 R-1..R-9).
 *
 * A retry ADDS one send to a real client, so the write is pinned exactly:
 *   R-1..R-3 the patch per queue is a frozen constant (+ the reminder's
 *            server-computed time): back to `pending`, the claim cleared,
 *            and NOTHING else (no attempts reset, no error text cleared);
 *   R-4      the ONE compare-and-set chain, in order: id, the row's own
 *            user_id, status 'failed', attempts, sent_at IS NULL, then the
 *            queue's window bound from retryWriteBound; count exact; no
 *            select / or / single / rpc;
 *   R-5      only count === 1 is a win;
 *   R-6      refusals make no request (incl. payment automations and the
 *            lead-retry hold);
 *   R-7      logs carry ids and the outcome only;
 *   R-8      source pins (constants imported from the eligibility module;
 *            no service, event, LLM or credit import).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
let mockHeld = false;
jest.mock('@/lib/admin/jobs/retryHolds', () => ({
  get LEAD_RETRY_HELD() {
    return mockHeld;
  },
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

import {
  ADMIN_QUEUE_ACTION_TABLES,
  ADMIN_QUEUE_RETRY_PATCH,
  AdminQueueActionsRepository,
  type RetryQueueItemInput,
} from '../AdminQueueActionsRepository';
import { RETRY_ANCHOR_COLUMN, type RetryableQueueId, type RetryWriteBound } from '@/lib/admin/jobs/queueItemEligibility';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown; count?: number | null };

const CTX = { correlationId: 'corr-retry', adminId: 'admin-1' };
const ITEM = 'abcdef12-3456-4789-8abc-def012345678';
const OWNER = 'OWNER-SENTINEL-7c';
const NEXT = '2026-10-05T08:00:00.000Z';
const REPO_FILE = 'lib/repositories/AdminQueueActionsRepository.ts';
const RETRYABLE: RetryableQueueId[] = ['payment_reminders', 'daily_briefing_sends', 'lead_responses', 'insight_actions'];

const BOUND: Record<RetryableQueueId, RetryWriteBound> = {
  payment_reminders: { column: 'scheduled_at', gte: '2026-10-02T08:00:00.000Z' },
  daily_briefing_sends: { column: 'briefing_date', eq: '2026-10-04' },
  lead_responses: { column: 'created_at', gte: '2026-10-01T12:00:00.000Z' },
  insight_actions: { column: 'created_at', gte: '2026-10-01T12:00:00.000Z' },
};

function recordingClient(result: () => Result = () => ({ data: null, error: null, count: 1 })) {
  const queries: Call[][] = [];
  const chain = (calls: Call[]) => {
    const builder: Record<string, unknown> = {};
    for (const method of [
      'select', 'eq', 'neq', 'lte', 'lt', 'gte', 'gt', 'is', 'in', 'not', 'or', 'order', 'limit', 'range', 'single',
      'maybeSingle', 'abortSignal', 'insert', 'update', 'upsert', 'delete', 'match', 'filter',
    ]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void) => resolve(result());
    return builder;
  };
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      queries.push(calls);
      return chain(calls);
    },
    rpc: (name: string, params: unknown) => {
      const calls: Call[] = [{ method: 'rpc', args: [name, params] }];
      queries.push(calls);
      return chain(calls);
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

function input(queue: RetryableQueueId, overrides: Partial<RetryQueueItemInput> = {}): RetryQueueItemInput {
  return {
    queue,
    itemId: ITEM,
    ownerUserId: OWNER,
    expected: { status: 'failed', attempts: 3 },
    bound: BOUND[queue],
    nextAttemptAt: queue === 'payment_reminders' ? NEXT : null,
    ...overrides,
  };
}

const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

beforeEach(() => {
  jest.clearAllMocks();
  mockHeld = false;
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-1..R-3: the retry patch (C7-4)', () => {
  it('R-1 equals the §1.2 table exactly; no payment_automations key; frozen at both levels', () => {
    expect(ADMIN_QUEUE_RETRY_PATCH).toEqual({
      payment_reminders: { status: 'pending', claimed_by: null, claimed_at: null },
      daily_briefing_sends: { status: 'pending', claimed_by: null, claimed_at: null, next_attempt_at: null },
      lead_responses: { status: 'pending', claimed_by: null, claimed_at: null, next_attempt_at: null },
      insight_actions: { status: 'pending', claimed_by: null, claimed_at: null, next_attempt_at: null },
    });
    expect(ADMIN_QUEUE_RETRY_PATCH).not.toHaveProperty('payment_automations');
    expect(Object.isFrozen(ADMIN_QUEUE_RETRY_PATCH)).toBe(true);
    for (const queue of RETRYABLE) expect(Object.isFrozen(ADMIN_QUEUE_RETRY_PATCH[queue])).toBe(true);
  });

  it.each(RETRYABLE)('R-2 %s: status always pending, claim always cleared, nothing that would re-arm more than once or lose evidence', (queue) => {
    const patch = ADMIN_QUEUE_RETRY_PATCH[queue] as Record<string, unknown>;
    expect(patch.status).toBe('pending');
    expect(patch.claimed_by).toBeNull();
    expect(patch.claimed_at).toBeNull();
    for (const column of [
      'attempts', 'error_message', 'skip_reason', 'scheduled_at', 'sent_at', 'user_id', 'id', 'briefing_date', 'timezone',
      'payload', 'kind', 'dedupe_key', 'contact_id', 'invoice_id', 'installment_id', 'entity_id', 'metadata', 'channel', 'created_at',
    ]) {
      expect(patch).not.toHaveProperty(column);
    }
  });

  it('R-3 reminders: the sent patch carries next_attempt_at = input.nextAttemptAt; others: null', async () => {
    for (const queue of RETRYABLE) {
      const { client, queries } = recordingClient();
      await new AdminQueueActionsRepository(client).retryQueueItemAllAccounts(CTX, input(queue));
      const sent = queries[0][1].args[0] as Record<string, unknown>;
      expect(sent.next_attempt_at).toBe(queue === 'payment_reminders' ? NEXT : null);
      expect(sent).not.toBe(ADMIN_QUEUE_RETRY_PATCH[queue]);
      expect(sent).toEqual({ ...ADMIN_QUEUE_RETRY_PATCH[queue], next_attempt_at: queue === 'payment_reminders' ? NEXT : null });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe.each(RETRYABLE)('R-4: the one compare-and-set chain on %s (W7C-4)', (queue) => {
  it('from, update(patch, count exact), eq id, eq user_id, eq status failed, eq attempts, is sent_at null, then the bound; nothing else', async () => {
    const { client, queries } = recordingClient();
    const result = await new AdminQueueActionsRepository(client).retryQueueItemAllAccounts(CTX, input(queue));
    expect(result).toEqual({ data: { outcome: 'retried' }, error: null });
    expect(queries).toHaveLength(1);
    const bound = BOUND[queue];
    expect(queries[0]).toEqual([
      { method: 'from', args: [ADMIN_QUEUE_ACTION_TABLES[queue]] },
      {
        method: 'update',
        args: [{ ...ADMIN_QUEUE_RETRY_PATCH[queue], next_attempt_at: queue === 'payment_reminders' ? NEXT : null }, { count: 'exact' }],
      },
      { method: 'eq', args: ['id', ITEM] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'eq', args: ['status', 'failed'] },
      { method: 'eq', args: ['attempts', 3] },
      { method: 'is', args: ['sent_at', null] },
      'eq' in bound ? { method: 'eq', args: [bound.column, bound.eq] } : { method: 'gte', args: [bound.column, bound.gte] },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-5: only count === 1 is a win', () => {
  const run = (result: Result) =>
    new AdminQueueActionsRepository(recordingClient(() => result).client).retryQueueItemAllAccounts(CTX, input('insight_actions'));

  it('count 1 → retried; count 0 → not_matched', async () => {
    expect(await run({ data: null, error: null, count: 1 })).toEqual({ data: { outcome: 'retried' }, error: null });
    expect(await run({ data: null, error: null, count: 0 })).toEqual({ data: { outcome: 'not_matched' }, error: null });
  });

  it.each([[null], [undefined], [2], [-1], [1.5]])('count %p → count_unconfirmed, never a win', async (count) => {
    const result = await run({ data: null, error: null, count: count as number | null });
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('count_unconfirmed');
  });

  it('a PostgREST error is returned with its code (not a win even with count 1); the message is never logged', async () => {
    const result = await run({ data: null, error: { message: 'SENTINEL detail', code: '42703' }, count: 1 });
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('42703');
    expect(JSON.stringify(mockLog.error.mock.calls)).not.toContain('SENTINEL');
  });

  it('a thrown client is returned, not thrown', async () => {
    const client = { from: () => { throw new Error('boom SENTINEL'); } } as unknown as SupabaseClient;
    const result = await new AdminQueueActionsRepository(client).retryQueueItemAllAccounts(CTX, input('lead_responses'));
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(mockLog.error.mock.calls)).not.toContain('SENTINEL');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-6: refusals make no request', () => {
  async function expectRefused(context: unknown, value: unknown) {
    const { client, queries } = recordingClient();
    const result = await new AdminQueueActionsRepository(client).retryQueueItemAllAccounts(context as typeof CTX, value as RetryQueueItemInput);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toEqual([]);
  }

  it('a missing or partial context; an unknown queue; no input', async () => {
    await expectRefused(undefined, input('lead_responses'));
    await expectRefused({ correlationId: 'c' }, input('lead_responses'));
    await expectRefused(CTX, { ...input('lead_responses'), queue: 'nope' });
    await expectRefused(CTX, { ...input('lead_responses'), queue: 'toString' });
    await expectRefused(CTX, undefined);
  });

  it('C7-5: payment automations, whatever else is sent', async () => {
    await expectRefused(CTX, { ...input('lead_responses'), queue: 'payment_automations' });
    await expectRefused(CTX, { ...input('lead_responses'), queue: 'payment_automations', bound: { column: 'scheduled_at', gte: NEXT } });
  });

  it.each(RETRYABLE)('%s: every status other than failed', async (queue) => {
    for (const status of ['pending', 'processing', 'sent', 'skipped', 'cancelled', 'dead_letter', 'running', 'zzz', '', 'FAILED']) {
      await expectRefused(CTX, input(queue, { expected: { status, attempts: 3 } }));
    }
  });

  it('attempts that are not a non-negative integer', async () => {
    for (const attempts of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown as number]) {
      await expectRefused(CTX, input('lead_responses', { expected: { status: 'failed', attempts } }));
    }
  });

  it('an empty item id or owner id', async () => {
    await expectRefused(CTX, input('lead_responses', { itemId: '' }));
    await expectRefused(CTX, input('lead_responses', { ownerUserId: '' }));
    await expectRefused(CTX, input('lead_responses', { ownerUserId: undefined as unknown as string }));
  });

  it('a bound on the wrong column for the queue, a missing bound, or an unparseable one', async () => {
    await expectRefused(CTX, input('payment_reminders', { bound: { column: 'created_at', gte: '2026-10-01T12:00:00.000Z' } }));
    await expectRefused(CTX, input('lead_responses', { bound: { column: 'scheduled_at', gte: '2026-10-01T12:00:00.000Z' } }));
    await expectRefused(CTX, input('insight_actions', { bound: { column: 'briefing_date', eq: '2026-10-04' } }));
    await expectRefused(CTX, input('daily_briefing_sends', { bound: { column: 'created_at', gte: '2026-10-01T12:00:00.000Z' } }));
    await expectRefused(CTX, input('lead_responses', { bound: undefined as unknown as RetryWriteBound }));
    await expectRefused(CTX, input('lead_responses', { bound: { column: 'created_at', gte: 'yesterday' } }));
    await expectRefused(CTX, input('lead_responses', { bound: { column: 'created_at', gte: '' } }));
    await expectRefused(CTX, input('daily_briefing_sends', { bound: { column: 'briefing_date', eq: '2026-02-31' } }));
    await expectRefused(CTX, input('daily_briefing_sends', { bound: { column: 'briefing_date', eq: '2026-10-04T00:00:00Z' } }));
    // A bound shaped for both forms at once.
    await expectRefused(CTX, input('lead_responses', { bound: { column: 'created_at', gte: '2026-10-01T12:00:00.000Z', eq: 'x' } as unknown as RetryWriteBound }));
  });

  it('reminders need a valid next time; the other queues may not carry one', async () => {
    await expectRefused(CTX, input('payment_reminders', { nextAttemptAt: null }));
    await expectRefused(CTX, input('payment_reminders', { nextAttemptAt: 'tomorrow' }));
    await expectRefused(CTX, input('payment_reminders', { nextAttemptAt: '' }));
    for (const queue of ['daily_briefing_sends', 'lead_responses', 'insight_actions'] as const) {
      await expectRefused(CTX, input(queue, { nextAttemptAt: NEXT }));
    }
  });

  it('LEAD_RETRY_HELD = true: lead replies are refused here too (the write is the last line); other queues unaffected', async () => {
    mockHeld = true;
    await expectRefused(CTX, input('lead_responses'));
    const { client, queries } = recordingClient();
    const result = await new AdminQueueActionsRepository(client).retryQueueItemAllAccounts(CTX, input('insight_actions'));
    expect(result.data).toEqual({ outcome: 'retried' });
    expect(queries).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-7: logs', () => {
  it('info carries exactly correlationId, adminUserId, queue, itemId, from, outcome: never the owner, the bound or the patch', async () => {
    const { client } = recordingClient();
    await new AdminQueueActionsRepository(client).retryQueueItemAllAccounts(CTX, input('payment_reminders'));
    expect(mockLog.info).toHaveBeenCalledTimes(1);
    const [fields] = mockLog.info.mock.calls[0];
    expect(fields).toEqual({
      correlationId: CTX.correlationId,
      adminUserId: CTX.adminId,
      queue: 'payment_reminders',
      itemId: ITEM,
      from: 'failed',
      outcome: 'retried',
    });
    const everything = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    expect(everything).not.toContain(OWNER);
    expect(everything).not.toContain(NEXT);
    expect(everything).not.toContain(BOUND.payment_reminders.column === 'scheduled_at' ? '2026-10-02T08:00' : 'x');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-8: source pins on the repository file (comments stripped)', () => {
  const code = codeOf(fs.readFileSync(path.join(process.cwd(), REPO_FILE), 'utf8'));

  it('imports RETRY_FROM_STATUSES, RETRY_ANCHOR_COLUMN and LEAD_RETRY_HELD; never redeclares them', () => {
    expect(code).toMatch(/import\s*\{[^}]*\bRETRY_FROM_STATUSES\b[^}]*\}\s*from\s*'@\/lib\/admin\/jobs\/queueItemEligibility'/);
    expect(code).toMatch(/import\s*\{[^}]*\bRETRY_ANCHOR_COLUMN\b[^}]*\}\s*from\s*'@\/lib\/admin\/jobs\/queueItemEligibility'/);
    expect(code).toMatch(/import\s*\{[^}]*\bLEAD_RETRY_HELD\b[^}]*\}\s*from\s*'@\/lib\/admin\/jobs\/retryHolds'/);
    expect(code).not.toMatch(/(?:const|let|var)\s+(?:RETRY_FROM_STATUSES|RETRY_ANCHOR_COLUMN|LEAD_RETRY_HELD)\b/);
  });

  it('the retry write filters sent_at IS NULL and the status from the input that was checked against RETRY_FROM_STATUSES', () => {
    expect(code).toMatch(/\.is\('sent_at', null\)/);
    expect(code).toMatch(/RETRY_FROM_STATUSES\[queue\]\.includes\(expected\.status\)/);
  });

  it('next_attempt_at is assigned only from input.nextAttemptAt; no patch is built from a spread of input, expected or bound', () => {
    expect(code.match(/next_attempt_at:/g)?.length).toBeGreaterThanOrEqual(1);
    for (const m of code.matchAll(/next_attempt_at:\s*([^,}\n]+)/g)) {
      expect(['null', 'nextAttemptAt', 'input.nextAttemptAt']).toContain(m[1].trim());
    }
    expect(code).not.toMatch(/\.\.\.\s*(input|expected|bound)\b/);
  });

  it('W7C-9 / W7C-11: no service, payment event, LLM or credit import', () => {
    expect(code).not.toMatch(/from\s*'@\/lib\/services\//);
    expect(code).not.toMatch(/emitPaymentEvent|PaymentEventService|runAiAction|getProviderFactory/);
    expect(code).not.toMatch(/from\s*'@\/lib\/(ai|business-os\/(llm|credits))\b/);
  });

  it('RETRY_ANCHOR_COLUMN is the column the bound must name', () => {
    expect(RETRY_ANCHOR_COLUMN.payment_reminders).toBe('scheduled_at');
    expect(code).toMatch(/RETRY_ANCHOR_COLUMN\[queue\]/);
  });
});
