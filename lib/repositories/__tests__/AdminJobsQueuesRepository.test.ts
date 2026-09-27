/**
 * AdminJobsQueuesRepository (admin reorganisation slice 5; SA SC-9): the read
 * context is required, every select is a head count or a due/claim timestamp,
 * error_message appears only in filters, "due now" mirrors each claim
 * function, the retry-time assumption is stated and pinned, and only
 * app/api/admin/** may call it.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockInfo = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: (...a: unknown[]) => mockInfo(...a), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  ADMIN_QUEUE_SELECTABLE_COLUMNS,
  ADMIN_QUEUE_SPECS,
  AdminJobsQueuesRepository,
  DEAD_LETTER_MARKER,
  quoteFilterValue,
  type AdminQueueId,
} from '../AdminJobsQueuesRepository';

type Call = { method: string; args: unknown[] };

const CTX = { correlationId: 'corr-1', adminId: 'admin-1' };
const NOW = new Date('2026-09-27T12:00:00.000Z');
const QUEUES = Object.keys(ADMIN_QUEUE_SPECS) as AdminQueueId[];

/** Each query recorded; each resolves with `result(calls)`. */
function recordingClient(result: (calls: Call[]) => { data: unknown; error: unknown; count?: number | null }) {
  const queries: Call[][] = [];
  const chain = (calls: Call[]) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lte', 'lt', 'gte', 'gt', 'is', 'in', 'not', 'or', 'order', 'limit', 'abortSignal']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void) => resolve(result(calls));
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

const zero = () => ({ data: [], error: null, count: 0 });

describe('the read context is first and required (SC-9(a))', () => {
  it('refuses a read with no context, and makes no request', async () => {
    const { client, queries } = recordingClient(zero);
    const repo = new AdminJobsQueuesRepository(client);
    const a = await repo.readQueueFiguresAllAccounts(undefined as never, 'lead_responses', NOW);
    const b = await repo.summariseCronRunsAllJobs({ correlationId: '', adminId: 'x' }, ['j'], NOW, 10);
    expect(a.error).toBeTruthy();
    expect(b.error).toBeTruthy();
    expect(queries).toHaveLength(0);
  });
});

describe.each(QUEUES)('readQueueFiguresAllAccounts: %s', (queue) => {
  const spec = ADMIN_QUEUE_SPECS[queue];

  it('reads only its own table, and selects only ids (head counts) or due/claim timestamps (SC-9(b), (c))', async () => {
    const { client, queries } = recordingClient(zero);
    await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, queue, NOW);
    expect(queries.length).toBeGreaterThanOrEqual(11);
    for (const q of queries) {
      expect(q[0]).toEqual({ method: 'from', args: [spec.table] });
      const select = q.find((c) => c.method === 'select')!;
      const columns = String(select.args[0]).split(',').map((c) => c.trim());
      for (const column of columns) expect(ADMIN_QUEUE_SELECTABLE_COLUMNS).toContain(column);
      if (columns.length === 1 && columns[0] === 'id') {
        expect(select.args[1]).toEqual({ count: 'exact', head: true });
      }
    }
  });

  it('never selects error_message: it appears only inside filters (SC-9(d))', async () => {
    const { client, queries } = recordingClient(zero);
    await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, queue, NOW);
    for (const q of queries) {
      const select = q.find((c) => c.method === 'select')!;
      expect(String(select.args[0])).not.toMatch(/error_message|payload|recommendation|skip_reason|user_id|contact_id/);
    }
  });

  it('"due now" mirrors the claim function it cites (SC-9(e))', async () => {
    const { client, queries } = recordingClient(zero);
    await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, queue, NOW);
    const due = queries[0];
    expect(due).toContainEqual({ method: 'eq', args: ['status', 'pending'] });
    expect(due).toContainEqual({ method: 'or', args: [`next_attempt_at.is.null,next_attempt_at.lte."${NOW.toISOString()}"`] });
    if (spec.hasScheduledAt) expect(due).toContainEqual({ method: 'lte', args: ['scheduled_at', NOW.toISOString()] });
    else expect(due.some((c) => c.method === 'lte' && c.args[0] === 'scheduled_at')).toBe(false);

    // The citation points at a real claim predicate with the same shape.
    const [, fileAndLines] = spec.claimCitation.split(', ');
    const [file, lines] = fileAndLines.split(':');
    const [from, to] = lines.split('-').map(Number);
    const sql = fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\n').slice(from - 1, to).join(' ');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('next_attempt_at IS NULL OR next_attempt_at <= now()');
    expect(sql.includes('scheduled_at <= now()')).toBe(spec.hasScheduledAt);
  });

  it('dead-lettered uses the fixed marker (or the dead_letter status), never shows it', async () => {
    const { client, queries } = recordingClient(zero);
    const result = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, queue, NOW);
    const flat = JSON.stringify(queries);
    if (spec.deadLetterByMarker) {
      expect(queries.some((q) => q.some((c) => c.method === 'eq' && c.args[0] === 'error_message' && c.args[1] === DEAD_LETTER_MARKER))).toBe(true);
    } else {
      expect(flat).toContain('"dead_letter"');
    }
    expect(JSON.stringify(result)).not.toContain(DEAD_LETTER_MARKER);
  });

  it('any failed request fails the whole queue read, and the error text is not logged', async () => {
    let n = 0;
    const { client } = recordingClient(() => (n++ === 3 ? { data: null, error: { message: 'secret detail a@b.c' } } : zero()));
    mockInfo.mockClear();
    const result = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, queue, NOW);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('a@b.c');
  });
});

describe('the marker is quoted for PostgREST (SC-9(d))', () => {
  it('failed-not-dead excludes the marker, null-safe, with the value double-quoted', async () => {
    const { client, queries } = recordingClient(zero);
    await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'lead_responses', NOW);
    const orArgs = queries.flatMap((q) => q.filter((c) => c.method === 'or').map((c) => String(c.args[0])));
    expect(orArgs).toContain(`error_message.is.null,error_message.not.in.(${quoteFilterValue(DEAD_LETTER_MARKER)})`);
    expect(quoteFilterValue(DEAD_LETTER_MARKER)).toBe('"dead-letter: max attempts"');
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it('payment automations: guardrail skips are excluded from failures and counted apart', async () => {
    const { client, queries } = recordingClient(zero);
    await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'payment_automations', NOW);
    const flat = JSON.stringify(queries);
    expect(flat).toContain('\\"max executions reached\\"');
    expect(queries.some((q) => q.some((c) => c.method === 'in' && c.args[0] === 'error_message'))).toBe(true);
  });
});

describe('figures', () => {
  it('stuck = in progress with a claim older than 90 s + 10 min (or none)', async () => {
    const { client, queries } = recordingClient(zero);
    await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'insight_actions', NOW);
    const stuckBefore = new Date(NOW.getTime() - 690_000).toISOString();
    expect(JSON.stringify(queries)).toContain(`claimed_at.is.null,claimed_at.lt.\\"${stuckBefore}\\"`);
  });

  it('returns the counts, and the oldest due of the two candidates', async () => {
    const { client } = recordingClient((calls) => {
      const select = String(calls.find((c) => c.method === 'select')!.args[0]);
      if (select === 'id') return { data: null, error: null, count: 2 };
      if (select === 'created_at') return { data: [{ created_at: '2026-09-27T09:00:00.000Z' }], error: null };
      return { data: [{ next_attempt_at: '2026-09-27T08:00:00.000Z' }], error: null };
    });
    const result = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'daily_briefing_sends', NOW);
    expect(result.data).toMatchObject({ dueNow: 2, stuck: 2, skipped7d: 2, noDueTime: null, guardrailSkips7d: null });
    expect(result.data!.oldestDueAt).toBe('2026-09-27T08:00:00.000Z');
  });

  it('SC-9(f): the retry-time assumption. A payment row with next_attempt_at >= scheduled_at is due since next_attempt_at', async () => {
    // Retried row: scheduled 06:00, retry gate 07:00 → due since 07:00 (max of the two).
    const { client } = recordingClient((calls) => {
      const select = String(calls.find((c) => c.method === 'select')!.args[0]);
      if (select === 'id') return { data: null, error: null, count: 0 };
      if (select === 'scheduled_at') return { data: [], error: null };
      return { data: [{ next_attempt_at: '2026-09-27T07:00:00.000Z', scheduled_at: '2026-09-27T06:00:00.000Z' }], error: null };
    });
    const result = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'payment_reminders', NOW);
    expect(result.data!.oldestDueAt).toBe('2026-09-27T07:00:00.000Z');
  });

  it('SC-9(f): documents the edge the assumption excludes (next_attempt_at < scheduled_at is read as due since scheduled_at)', async () => {
    const { client } = recordingClient((calls) => {
      const select = String(calls.find((c) => c.method === 'select')!.args[0]);
      if (select === 'id') return { data: null, error: null, count: 0 };
      if (select === 'scheduled_at') return { data: [], error: null };
      return { data: [{ next_attempt_at: '2026-09-27T05:00:00.000Z', scheduled_at: '2026-09-27T06:00:00.000Z' }], error: null };
    });
    const result = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'payment_reminders', NOW);
    expect(result.data!.oldestDueAt).toBe('2026-09-27T06:00:00.000Z');
  });
});

describe('summariseCronRunsAllJobs', () => {
  it('calls the summary function once with the jobs, the clock and the limit, with the signal', async () => {
    const { client, queries } = recordingClient(() => ({ data: [{ job: 'a' }], error: null }));
    const signal = new AbortController().signal;
    const result = await new AdminJobsQueuesRepository(client).summariseCronRunsAllJobs(CTX, ['a', 'b'], NOW, 10, { signal });
    expect(result).toEqual({ data: [{ job: 'a' }], error: null });
    expect(queries[0][0]).toEqual({
      method: 'rpc',
      args: ['admin_bos_cron_run_summary', { p_jobs: ['a', 'b'], p_now: NOW.toISOString(), p_recent: 10 }],
    });
    expect(queries[0]).toContainEqual({ method: 'abortSignal', args: [signal] });
  });

  it('passes the error through (the orchestrator classifies "not installed")', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    const result = await new AdminJobsQueuesRepository(client).summariseCronRunsAllJobs(CTX, ['a'], NOW, 10);
    expect((result.error as Error & { code?: string }).code).toBe('PGRST202');
  });
});

describe('isolation: only app/api/admin/** uses the admin jobs & queues repository', () => {
  const ROOT = process.cwd();
  const REPO_FILE = 'lib/repositories/AdminJobsQueuesRepository.ts';
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

  it('scanned a real tree', () => {
    expect(files).toContain(REPO_FILE);
  });

  it('no file outside app/api/admin/** (tests, the barrel and the file itself excepted) names it', () => {
    const offenders = files.filter((file) => {
      if (file === REPO_FILE || file === 'lib/repositories/index.ts') return false;
      if (file.includes('/__tests__/')) return false;
      if (file.startsWith('app/api/admin/')) return false;
      const code = fs
        .readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return /AdminJobsQueuesRepository|adminJobsQueuesRepository/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
