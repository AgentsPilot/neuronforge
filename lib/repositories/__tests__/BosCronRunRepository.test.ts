/**
 * BosCronRunRepository (admin reorganisation slice 5, part B): the explicit
 * field allow-list on insert, the "only a running row" finish guard, the
 * retention delete, the missing-table classification, and WHO may call it.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { BosCronRunRepository, isMissingRelationError } from '../BosCronRunRepository';

type Call = { method: string; args: unknown[] };

function recordingClient(result: { error: unknown; data?: unknown } = { error: null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['insert', 'update', 'delete', 'eq', 'lt', 'select', 'abortSignal']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const START = new Date('2026-09-27T10:00:00.000Z');

describe('startRun', () => {
  it('inserts exactly the allow-listed fields, with the recorder\'s id', async () => {
    const { client, calls } = recordingClient();
    const result = await new BosCronRunRepository(client).startRun({
      id: 'run-1',
      job: 'lead-response',
      source: 'vercel_cron',
      startedAt: START,
      deadlineAt: new Date(START.getTime() + 150_000),
      // A caller-injected field must never be forwarded.
      ...({ outcome: 'succeeded', counts: { x: 1 } } as object),
    } as Parameters<BosCronRunRepository['startRun']>[0]);
    expect(result).toEqual({ data: true, error: null });
    expect(calls[0]).toEqual({ method: 'from', args: ['bos_cron_runs'] });
    expect(calls.find((c) => c.method === 'insert')?.args[0]).toEqual({
      id: 'run-1',
      job: 'lead-response',
      source: 'vercel_cron',
      started_at: START.toISOString(),
      deadline_at: '2026-09-27T10:02:30.000Z',
    });
  });

  it('attaches the deadline signal', async () => {
    const { client, calls } = recordingClient();
    const signal = new AbortController().signal;
    await new BosCronRunRepository(client).startRun(
      { id: 'r', job: 'lead-response', source: 'other', startedAt: START, deadlineAt: START },
      { signal }
    );
    expect(calls).toContainEqual({ method: 'abortSignal', args: [signal] });
  });

  it('returns { data: null, error } on a database error, never throws', async () => {
    const { client } = recordingClient({ error: { code: '42P01', message: 'relation "bos_cron_runs" does not exist' } });
    const result = await new BosCronRunRepository(client).startRun({
      id: 'r', job: 'lead-response', source: 'other', startedAt: START, deadlineAt: START,
    });
    expect(result.data).toBeNull();
    expect(isMissingRelationError(result.error)).toBe(true);
  });
});

describe('finishRun', () => {
  it('updates only a row that is still running, by its id', async () => {
    const { client, calls } = recordingClient();
    await new BosCronRunRepository(client).finishRun('run-1', {
      finishedAt: START,
      outcome: 'partial',
      durationMs: 1234.6,
      httpStatus: 200,
      errorClass: null,
      counts: { failed: 1 },
    });
    expect(calls.find((c) => c.method === 'update')?.args[0]).toEqual({
      finished_at: START.toISOString(),
      outcome: 'partial',
      duration_ms: 1235,
      http_status: 200,
      error_class: null,
      counts: { failed: 1 },
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', 'run-1'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['outcome', 'running'] });
    expect(calls).toContainEqual({ method: 'select', args: ['id'] });
  });

  it('SA-4: returns how many rows it updated (1 = recorded; 0 = no running row matched)', async () => {
    const input = { finishedAt: START, outcome: 'succeeded' as const, durationMs: 1, httpStatus: 200, errorClass: null, counts: {} };
    const one = recordingClient({ error: null, data: [{ id: 'run-1' }] });
    expect(await new BosCronRunRepository(one.client).finishRun('run-1', input)).toEqual({ data: 1, error: null });
    const none = recordingClient({ error: null, data: [] });
    expect(await new BosCronRunRepository(none.client).finishRun('run-1', input)).toEqual({ data: 0, error: null });
  });
});

describe('deleteRunsStartedBefore', () => {
  it('deletes by start time only', async () => {
    const { client, calls } = recordingClient();
    await new BosCronRunRepository(client).deleteRunsStartedBefore(START);
    expect(calls.some((c) => c.method === 'delete')).toBe(true);
    expect(calls).toContainEqual({ method: 'lt', args: ['started_at', START.toISOString()] });
  });

  it('returns the error on failure', async () => {
    const { client } = recordingClient({ error: { message: 'x' } });
    expect((await new BosCronRunRepository(client).deleteRunsStartedBefore(START)).error).toBeTruthy();
  });
});

describe('isMissingRelationError', () => {
  it.each([
    [{ code: '42P01' }, true],
    [{ code: 'PGRST205' }, true],
    [{ code: 'PGRST202' }, true],
    [{ message: "Could not find the table 'public.bos_cron_runs' in the schema cache" }, true],
    [{ message: 'relation "public.bos_cron_runs" does not exist' }, true],
    [{ code: '42P01', message: 'relation "public.bos_cron_runs" does not exist' }, true],
    // SA-2: a missing COLUMN is a real defect, never "not installed yet".
    [{ code: '42703', message: 'column bos_cron_runs.deadline_at does not exist' }, false],
    [{ message: 'column "deadline_at" does not exist' }, false],
    [{ code: 'PGRST204', message: "Could not find the 'deadline_at' column of 'bos_cron_runs' in the schema cache" }, false],
    [{ message: "Could not find the 'deadline_at' column of 'bos_cron_runs' in the schema cache" }, false],
    [{ code: '23514', message: 'check violation' }, false],
    [null, false],
    ['text', false],
  ])('%j → %s', (error, expected) => {
    expect(isMissingRelationError(error)).toBe(expected);
  });
});

describe('who may call it: only the recorder', () => {
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

  it('scanned a real tree', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('no file other than lib/cron/cronRunRecorder.ts (tests and the barrel excepted) names it', () => {
    const offenders = files.filter((file) => {
      if (file === 'lib/repositories/BosCronRunRepository.ts' || file === 'lib/repositories/index.ts') return false;
      if (file === 'lib/cron/cronRunRecorder.ts' || file.includes('/__tests__/')) return false;
      const code = fs
        .readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return /BosCronRunRepository|bosCronRunRepository/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
