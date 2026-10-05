/**
 * AdminQueueActionsRepository (ADMIN_BOS_CLEANUP slice 7b; SA C7-2, C7-3,
 * C7-6, C7-9, C7-12; workplan §2.3, §5.9 R-1..R-10 and conditions W7B-6).
 *
 * The first repository that WRITES to a live Business OS queue. What is pinned:
 *   R-1..R-3  the per-queue patch is exactly the C7-6 table, frozen, and can
 *             never re-open a row or touch the error text;
 *   R-4       the queue → table map equals the read repository's;
 *   R-5       the ONE compare-and-set chain, in order: id, the row's own
 *             user_id, status, attempts (+ claimed_at IS NULL for an orphaned
 *             in-progress row), `count: 'exact'`, no select / or / single;
 *   R-6       only `count === 1` is a win; 0 is "not matched"; anything else
 *             is an error;
 *   R-7       refusals make no request;
 *   R-8       logs carry ids and the outcome, never the owner id;
 *   R-9       only the action route may name it;
 *   R-10      source pins (no other write, no payment event, the eligibility
 *             constants imported, not copied).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
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
  ADMIN_QUEUE_CANCEL_PATCH,
  AdminQueueActionsRepository,
  type CancelQueueItemInput,
} from '../AdminQueueActionsRepository';
import { ADMIN_QUEUE_SPECS } from '../AdminJobsQueuesRepository';
import { CANCEL_FROM_STATUSES, IN_PROGRESS_STATUS } from '@/lib/admin/jobs/queueItemEligibility';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown; count?: number | null };

const CTX = { correlationId: 'corr-cancel', adminId: 'admin-1' };
const ITEM = 'abcdef12-3456-4789-8abc-def012345678';
const OWNER = 'OWNER-SENTINEL-7b';
const QUEUES: BosQueueId[] = BOS_QUEUES.map((q) => q.id);
const REPO_FILE = 'lib/repositories/AdminQueueActionsRepository.ts';
const ROUTE_FILE = 'app/api/admin/jobs-queues/items/action/route.ts';

/** Records every builder call; resolves with `result`. */
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

function input(queue: BosQueueId, overrides: Partial<CancelQueueItemInput> = {}): CancelQueueItemInput {
  return { queue, itemId: ITEM, ownerUserId: OWNER, expected: { status: 'pending', attempts: 0 }, ...overrides };
}

const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────
describe('R-1..R-3: the patch per queue is the C7-6 table, and nothing else', () => {
  it('R-1 equals the C7-6 table exactly, per queue', () => {
    expect(ADMIN_QUEUE_CANCEL_PATCH).toEqual({
      payment_reminders: { status: 'cancelled' },
      payment_automations: { status: 'cancelled' },
      daily_briefing_sends: { status: 'skipped', skip_reason: 'cancelled_by_admin' },
      lead_responses: { status: 'skipped', skip_reason: 'cancelled_by_admin' },
      insight_actions: { status: 'skipped', skip_reason: 'cancelled_by_admin' },
    });
  });

  it('R-1 is frozen at both levels', () => {
    expect(Object.isFrozen(ADMIN_QUEUE_CANCEL_PATCH)).toBe(true);
    for (const queue of QUEUES) expect(Object.isFrozen(ADMIN_QUEUE_CANCEL_PATCH[queue])).toBe(true);
  });

  it('R-2 skip_reason only on the three non-payment tables; the payment patches have exactly one key, status', () => {
    expect(Object.keys(ADMIN_QUEUE_CANCEL_PATCH.payment_reminders)).toEqual(['status']);
    expect(Object.keys(ADMIN_QUEUE_CANCEL_PATCH.payment_automations)).toEqual(['status']);
    for (const queue of ['daily_briefing_sends', 'lead_responses', 'insight_actions'] as const) {
      expect(Object.keys(ADMIN_QUEUE_CANCEL_PATCH[queue]).sort()).toEqual(['skip_reason', 'status']);
    }
  });

  it.each(QUEUES)('R-3 / N-4 %s: never re-opens a row, never touches the error text, claim, attempts or owner', (queue) => {
    const patch = ADMIN_QUEUE_CANCEL_PATCH[queue] as Record<string, string>;
    expect(['pending', 'processing', 'running']).not.toContain(patch.status);
    for (const column of ['error_message', 'attempts', 'claimed_at', 'claimed_by', 'next_attempt_at', 'updated_at', 'user_id', 'id']) {
      expect(patch).not.toHaveProperty(column);
    }
  });
});

describe('R-4: the queue → table map (OP-8)', () => {
  it('equals the read repository spec for every queue, with exactly the five BOS queue ids', () => {
    expect(Object.keys(ADMIN_QUEUE_ACTION_TABLES).sort()).toEqual([...QUEUES].sort());
    for (const queue of QUEUES) expect(ADMIN_QUEUE_ACTION_TABLES[queue]).toBe(ADMIN_QUEUE_SPECS[queue].table);
    expect(Object.isFrozen(ADMIN_QUEUE_ACTION_TABLES)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe.each(QUEUES)('R-5: the compare-and-set chain on %s (C7-3)', (queue) => {
  it.each(CANCEL_FROM_STATUSES[queue].filter((s) => s !== IN_PROGRESS_STATUS[queue]))(
    'from %s: from, update(patch, count exact), eq id, eq user_id, eq status, eq attempts; nothing else',
    async (status) => {
      const { client, queries } = recordingClient();
      const result = await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(
        CTX,
        input(queue, { expected: { status, attempts: 3 } })
      );
      expect(result).toEqual({ data: { outcome: 'cancelled' }, error: null });
      expect(queries).toHaveLength(1);
      expect(queries[0]).toEqual([
        { method: 'from', args: [ADMIN_QUEUE_SPECS[queue].table] },
        { method: 'update', args: [{ ...ADMIN_QUEUE_CANCEL_PATCH[queue] }, { count: 'exact' }] },
        { method: 'eq', args: ['id', ITEM] },
        { method: 'eq', args: ['user_id', OWNER] },
        { method: 'eq', args: ['status', status] },
        { method: 'eq', args: ['attempts', 3] },
      ]);
    }
  );

  it(`from ${IN_PROGRESS_STATUS[queue]} (orphaned): the same chain plus claimed_at IS NULL, in the write itself (C7-2)`, async () => {
    const { client, queries } = recordingClient();
    await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(
      CTX,
      input(queue, { expected: { status: IN_PROGRESS_STATUS[queue], attempts: 1 } })
    );
    expect(queries[0]).toEqual([
      { method: 'from', args: [ADMIN_QUEUE_SPECS[queue].table] },
      { method: 'update', args: [{ ...ADMIN_QUEUE_CANCEL_PATCH[queue] }, { count: 'exact' }] },
      { method: 'eq', args: ['id', ITEM] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'eq', args: ['status', IN_PROGRESS_STATUS[queue]] },
      { method: 'eq', args: ['attempts', 1] },
      { method: 'is', args: ['claimed_at', null] },
    ]);
  });

  it('the patch sent is a copy: mutating it cannot change the frozen constant', async () => {
    const { client, queries } = recordingClient();
    await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(CTX, input(queue));
    const sent = queries[0][1].args[0] as Record<string, string>;
    expect(sent).not.toBe(ADMIN_QUEUE_CANCEL_PATCH[queue]);
    expect(sent).toEqual(ADMIN_QUEUE_CANCEL_PATCH[queue]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-6: only count === 1 is a win', () => {
  const run = (result: Result) =>
    new AdminQueueActionsRepository(recordingClient(() => result).client).cancelQueueItemAllAccounts(CTX, input('lead_responses'));

  it('count 1 → cancelled', async () => {
    expect(await run({ data: null, error: null, count: 1 })).toEqual({ data: { outcome: 'cancelled' }, error: null });
  });

  it('count 0 → not_matched (lost the race, or the row moved)', async () => {
    expect(await run({ data: null, error: null, count: 0 })).toEqual({ data: { outcome: 'not_matched' }, error: null });
  });

  it.each([[null], [undefined], [2], [-1], [1.5]])('count %p → an error with code count_unconfirmed, never a win', async (count) => {
    const result = await run({ data: null, error: null, count: count as number | null });
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('count_unconfirmed');
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'count_unconfirmed', queue: 'lead_responses', itemId: ITEM }),
      expect.any(String)
    );
  });

  it('a PostgREST error is returned with its code (and is not a win even with count 1)', async () => {
    const result = await run({ data: null, error: { message: 'column "x" does not exist SENTINEL', code: '42703' }, count: 1 });
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('42703');
    expect(JSON.stringify(mockLog.error.mock.calls)).not.toContain('SENTINEL');
  });

  it('a thrown client is returned, not thrown', async () => {
    const client = {
      from: () => {
        throw new Error('boom SENTINEL');
      },
    } as unknown as SupabaseClient;
    const result = await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(CTX, input('insight_actions'));
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(mockLog.error.mock.calls)).not.toContain('SENTINEL');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-7: refusals make no request', () => {
  async function expectRefused(context: unknown, value: unknown) {
    const { client, queries } = recordingClient();
    const result = await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(
      context as typeof CTX,
      value as CancelQueueItemInput
    );
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toEqual([]);
  }

  it('a missing or partial context', async () => {
    await expectRefused(undefined, input('lead_responses'));
    await expectRefused({ correlationId: 'c' }, input('lead_responses'));
    await expectRefused({ adminId: 'a' }, input('lead_responses'));
  });

  it('an unknown queue, including a prototype key', async () => {
    await expectRefused(CTX, { ...input('lead_responses'), queue: 'nope' });
    await expectRefused(CTX, { ...input('lead_responses'), queue: 'toString' });
    await expectRefused(CTX, undefined);
  });

  it.each(QUEUES)('%s: every status outside its Cancel column', async (queue) => {
    const outside = ['sent', 'completed', 'skipped', 'cancelled', 'zzz', '', 'PENDING', 'dead_letter', 'running', 'processing'].filter(
      (s) => !CANCEL_FROM_STATUSES[queue].includes(s)
    );
    expect(outside.length).toBeGreaterThan(4);
    for (const status of outside) await expectRefused(CTX, input(queue, { expected: { status, attempts: 0 } }));
  });

  it('attempts that are not a non-negative integer', async () => {
    for (const attempts of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown as number]) {
      await expectRefused(CTX, input('lead_responses', { expected: { status: 'pending', attempts } }));
    }
  });

  it('an empty item id or owner id', async () => {
    await expectRefused(CTX, input('lead_responses', { itemId: '' }));
    await expectRefused(CTX, input('lead_responses', { ownerUserId: '' }));
    await expectRefused(CTX, input('lead_responses', { ownerUserId: undefined as unknown as string }));
  });
});

describe('R-8: logs', () => {
  it('info carries exactly correlationId, adminUserId, queue, itemId, from, outcome; never the owner id', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 1 }));
    await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(CTX, input('daily_briefing_sends'));
    expect(mockLog.info).toHaveBeenCalledTimes(1);
    const [fields] = mockLog.info.mock.calls[0];
    expect(Object.keys(fields).sort()).toEqual(['adminUserId', 'correlationId', 'from', 'itemId', 'outcome', 'queue']);
    expect(fields).toEqual({
      correlationId: CTX.correlationId,
      adminUserId: CTX.adminId,
      queue: 'daily_briefing_sends',
      itemId: ITEM,
      from: 'pending',
      outcome: 'cancelled',
    });
    const everything = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    expect(everything).not.toContain(OWNER);
  });

  it('not_matched is logged at info; refusals and errors never carry the owner id', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null, count: 0 }));
    await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(CTX, input('lead_responses'));
    expect(mockLog.info.mock.calls[0][0]).toMatchObject({ outcome: 'not_matched' });
    await new AdminQueueActionsRepository(client).cancelQueueItemAllAccounts(CTX, input('lead_responses', { expected: { status: 'sent', attempts: 0 } }));
    const everything = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    expect(everything).not.toContain(OWNER);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('R-9: isolation — only the action route names the write repository', () => {
  const ROOT = process.cwd();
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', '.git', '.claude', 'coverage', 'out', 'archive'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
    return out;
  }
  const files = ['app', 'lib', 'components', 'hooks', 'scripts']
    .filter((d) => fs.existsSync(path.join(ROOT, d)))
    .flatMap((d) => walk(path.join(ROOT, d)));

  it('scanned a real tree, with the file and its one caller in it', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(REPO_FILE);
    expect(files).toContain(ROUTE_FILE);
  });

  it('no file other than the action route names it (tests, the barrel and the file itself excepted)', () => {
    const namers = files.filter((file) => {
      if (file === REPO_FILE || file === 'lib/repositories/index.ts') return false;
      if (file.includes('/__tests__/')) return false;
      return /AdminQueueActionsRepository|adminQueueActionsRepository/.test(codeOf(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    });
    expect(namers).toEqual([ROUTE_FILE]);
  });
});

describe('R-10 / W7B-6: source pins on the repository file (comments stripped)', () => {
  const code = codeOf(fs.readFileSync(path.join(process.cwd(), REPO_FILE), 'utf8'));

  // Amended by slice 7c (OP-16, R-8): exactly TWO updates, cancel and retry,
  // each with count exact. Nothing else may write.
  it('exactly two .update( (cancel, retry), each with count exact; no other write, select, or, single or rpc', () => {
    expect(code.match(/\.update\(/g)).toHaveLength(2);
    expect(code.match(/\.update\([^)]*\{\s*count:\s*'exact'\s*\}\)/g)).toHaveLength(2);
    for (const forbidden of [/\.or\(/, /\.select\(/, /\.insert\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/, /\.single\(/, /\.maybeSingle\(/]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it('never names the error text, never spreads its input', () => {
    expect(code).not.toMatch(/error_message/);
    expect(code).not.toMatch(/\.\.\.\s*input\b/);
    expect(code).not.toMatch(/\.\.\.\s*expected\b/);
  });

  it('imports CANCEL_FROM_STATUSES and IN_PROGRESS_STATUS from the eligibility module, and never redeclares them (C7-9)', () => {
    expect(code).toMatch(
      /import\s*\{[^}]*\bCANCEL_FROM_STATUSES\b[^}]*\bIN_PROGRESS_STATUS\b[^}]*\}\s*from\s*'@\/lib\/admin\/jobs\/queueItemEligibility'/
    );
    expect(code).not.toMatch(/(?:const|let|var)\s+(?:CANCEL_FROM_STATUSES|IN_PROGRESS_STATUS)\b/);
  });

  it('W7B-6: emits no payment or domain event and imports nothing from lib/services', () => {
    expect(code).not.toMatch(/emitPaymentEvent|PaymentEventService|emit\w*Event/);
    expect(code).not.toMatch(/from\s*'@\/lib\/services\//);
    expect(code).not.toMatch(/reminder\.cancelled/);
  });
});
