/**
 * The archive runner (Slice 2b): X-1 to X-4 and X-6. A fake repository and a
 * fake clock; no database.
 */

import type { Logger } from '@/lib/logger';
import type { ArchiveRunRow } from '@/lib/repositories/ArchiveRepository';
import { runArchive } from '../runArchive';

const quietLogger = (): Logger => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return logger as unknown as Logger;
};

const RUN: ArchiveRunRow = {
  id: '33333333-3333-4333-8333-333333333333',
  source: 'audit_trail',
  status: 'running',
  retention_days: 365,
  cutoff: '2025-09-26T12:00:00.123+00:00',
  rows_archived: 0,
  batches: 0,
  started_by: 'admin-1',
  started_at: '2026-09-26T12:00:00.000Z',
  last_batch_at: null,
  finished_at: null,
  error_code: null,
};

const counts = (n: number) => ({ data: { selected: n, inserted: n, deleted: n }, error: null });

function setup(
  batches: Array<ReturnType<typeof counts> | { data: null; error: Error }>,
  msPerBatch = 1_000,
  run: ArchiveRunRow = RUN
) {
  let now = 0;
  const runBatchAllAccounts = jest.fn(async () => {
    now += msPerBatch;
    return batches.shift() ?? counts(0);
  });
  const finishRun = jest.fn(async (_id: string, outcome: { status: string }) => ({
    data: { ...RUN, status: outcome.status, rows_archived: 2000, batches: 2 },
    error: null,
  }));
  return {
    repo: { runBatchAllAccounts, finishRun },
    clock: () => now,
    run: () =>
      runArchive({
        repo: { runBatchAllAccounts, finishRun } as never,
        run,
        budgetMs: 45_000,
        clock: () => now,
        logger: quietLogger(),
      }),
  };
}

it('X-1: batches until one selects nothing, then finishes succeeded', async () => {
  const { repo, run } = setup([counts(1000), counts(1000), counts(0)]);

  const result = await run();

  expect(result.outcome).toBe('succeeded');
  expect(repo.runBatchAllAccounts).toHaveBeenCalledTimes(3);
  expect(repo.finishRun).toHaveBeenCalledWith(RUN.id, expect.objectContaining({ status: 'succeeded', errorCode: null }));
  expect(result.run?.status).toBe('succeeded');
});

it('X-2: when the budget is spent no new batch starts, and the run finishes partial', async () => {
  // 20 s per batch: batches at 0 s and 20 s and 40 s start; at 60 s the budget is spent.
  const { repo, run } = setup(Array.from({ length: 10 }, () => counts(1000)), 20_000);

  const result = await run();

  expect(result.outcome).toBe('partial');
  expect(repo.runBatchAllAccounts).toHaveBeenCalledTimes(3);
  expect(repo.finishRun).toHaveBeenCalledWith(RUN.id, expect.objectContaining({ status: 'partial', errorCode: null }));
});

it('X-3: a failed batch stops the run as failed / batch_failed', async () => {
  const { repo, run } = setup([counts(1000), { data: null, error: new Error('rolled back') }, counts(1000)]);

  const result = await run();

  expect(result.outcome).toBe('failed');
  expect(repo.runBatchAllAccounts).toHaveBeenCalledTimes(2);
  expect(repo.finishRun).toHaveBeenCalledWith(
    RUN.id,
    expect.objectContaining({ status: 'failed', errorCode: 'batch_failed' })
  );
});

it("X-4: every batch gets the run's stored cutoff string and the registry batch size", async () => {
  const { repo, run } = setup([counts(1000), counts(0)]);

  await run();

  for (const call of repo.runBatchAllAccounts.mock.calls as unknown[][]) {
    expect(call).toEqual(['audit_trail', RUN.id, RUN.cutoff, 1000]);
  }
});

it('X-7 (SA L-1): an unknown source runs no batch and is recorded failed / batch_failed, not left running', async () => {
  const { repo, run } = setup([counts(1000)], 1_000, { ...RUN, source: 'agent_logs' });

  const result = await run();

  expect(result.outcome).toBe('failed');
  expect(repo.runBatchAllAccounts).not.toHaveBeenCalled();
  expect(repo.finishRun).toHaveBeenCalledWith(
    RUN.id,
    expect.objectContaining({ status: 'failed', errorCode: 'batch_failed' })
  );
});

it('X-6: a failed finish is reported as run: null, never thrown', async () => {
  const { repo, run } = setup([counts(0)]);
  repo.finishRun.mockResolvedValueOnce({ data: null, error: new Error('network') } as never);

  const result = await run();

  expect(result).toEqual({ outcome: 'succeeded', run: null });
});
