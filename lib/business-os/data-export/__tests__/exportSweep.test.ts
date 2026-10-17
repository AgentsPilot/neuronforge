/**
 * DE-8b T-13 (workplan §12; SA DE-8a Q-12; SA DE-8b Q-6, C-10, C-11, C-12):
 * the daily sweep. Repositories and the file source are injected fakes.
 */
import { runExportSweep, SWEEP_LIMITS, type ExportSweepDeps } from '../exportSweep';
import { EXPORT_LIMITS } from '../limits';
import type { ExportFileSource, FileInventory } from '../fileManifest';

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const J1 = '11111111-1111-4111-8111-111111111111';
const J2 = '22222222-2222-4222-8222-222222222222';
const J3 = '33333333-3333-4333-8333-333333333333';
const J4 = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-10-18T05:25:00.000Z');
const OLD = new Date(NOW - 60 * 60_000).toISOString();
const YOUNG = new Date(NOW - 2 * 60_000).toISOString();

const inv = (bytes: number, count: number): FileInventory => ({
  files: Array.from({ length: count }, (_, i) => ({ bucket: 'website-images', key: `${A}/${i}`, entryPath: `files/website-images/${i}`, folder: 'website-images', sizeBytes: 0, contentType: 'image/png', recordSection: '' as const, recordId: '' })),
  totalBytes: bytes,
  recordsWithoutFile: 0,
  orphanSkipped: 0,
  filesWithoutRecord: 0,
  rejectedPaths: 0,
});

function harness() {
  const jobs = {
    listStaleRunning: jest.fn(async () => ({ data: [] as Array<{ id: string; user_id: string }>, error: null as Error | null })),
    markFailed: jest.fn(async () => ({ data: { id: 'x' } as unknown, error: null as Error | null })),
    listDueForExpiry: jest.fn(async () => ({ data: [] as Array<{ id: string; user_id: string }>, error: null as Error | null })),
    markExpired: jest.fn(async () => ({ data: true as boolean | null, error: null as Error | null })),
    findJobsByIds: jest.fn(async () => ({ data: [] as Array<{ id: string; user_id: string; status: string }>, error: null as Error | null })),
  };
  const storage = {
    remove: jest.fn(async () => ({ data: true as true | null, error: null as Error | null })),
    listForSweep: jest.fn(async () => ({ data: { objects: [] as Array<{ userId: string; jobId: string; createdAt: string | null }>, unexpected: 0, truncated: false }, error: null as Error | null })),
  };
  const files = {
    includedBuckets: () => [
      { bucket: 'contact-documents', folder: 'client-documents' },
      { bucket: 'website-images', folder: 'website-images' },
    ],
    listOwnerFolders: jest.fn(async () => ({ owners: [] as string[], skipped: 0, truncated: false })),
    inventory: jest.fn(async (owner: string) => (void owner, { ok: true as const, inventory: inv(0, 0) })),
    download: jest.fn(),
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const deps: ExportSweepDeps = {
    jobs: jobs as unknown as ExportSweepDeps['jobs'],
    storage: storage as unknown as ExportSweepDeps['storage'],
    files: files as unknown as ExportFileSource,
    now: () => NOW,
  };
  return { deps, jobs, storage, files, log, run: () => runExportSweep(deps, log) };
}

describe('nothing to do', () => {
  it('all counts zero, no incomplete step, no audit', async () => {
    const h = harness();
    const result = await h.run();
    expect(result).toEqual({
      staleReaped: 0,
      expired: 0,
      expireFailed: 0,
      orphansRemoved: 0,
      orphansKept: 0,
      orphansUnexpected: 0,
      accountsWatched: 0,
      accountsNearCeiling: 0,
      accountsOverCeiling: 0,
      incompleteSteps: 0,
      auditEntries: [],
    });
  });
});

describe('1 reap (SA DE-8a Q-12)', () => {
  it('uses the 90 s cut; marks failed/timeout per row own user; removes; audits as system with no actor id', async () => {
    const h = harness();
    h.jobs.listStaleRunning.mockResolvedValueOnce({ data: [{ id: J1, user_id: A }], error: null });
    const result = await h.run();
    expect((h.jobs.listStaleRunning.mock.calls[0] as unknown[])[0]).toEqual(new Date(NOW - 90_000));
    expect(h.jobs.markFailed).toHaveBeenCalledWith(J1, A, 'timeout');
    expect(h.storage.remove).toHaveBeenCalledWith(A, J1);
    expect(result.staleReaped).toBe(1);
    expect(result.auditEntries).toEqual([
      expect.objectContaining({
        action: 'DATA_EXPORT_FAILED',
        userId: A,
        entityId: A,
        actorId: null,
        details: { job_id: J1, reason: 'timeout', actor_kind: 'system' },
      }),
    ]);
  });

  it('a row already settled (markFailed null) is left alone: no remove, no audit', async () => {
    const h = harness();
    h.jobs.listStaleRunning.mockResolvedValueOnce({ data: [{ id: J1, user_id: A }], error: null });
    h.jobs.markFailed.mockResolvedValueOnce({ data: null, error: null });
    const result = await h.run();
    expect(h.storage.remove).not.toHaveBeenCalled();
    expect(result.staleReaped).toBe(0);
    expect(result.auditEntries).toEqual([]);
  });
});

describe('2 expire', () => {
  it('removes the object FIRST, then marks expired and audits retention', async () => {
    const h = harness();
    const order: string[] = [];
    h.jobs.listDueForExpiry.mockResolvedValueOnce({ data: [{ id: J1, user_id: A }], error: null });
    h.storage.remove.mockImplementationOnce(async () => (order.push('remove'), { data: true, error: null }));
    h.jobs.markExpired.mockImplementationOnce(async () => (order.push('mark'), { data: true, error: null }));
    const result = await h.run();
    expect(order).toEqual(['remove', 'mark']);
    expect(h.jobs.markExpired).toHaveBeenCalledWith(J1, A);
    expect(result.expired).toBe(1);
    expect(result.auditEntries[0]).toMatchObject({ action: 'DATA_EXPORT_EXPIRED', userId: A, details: { job_id: J1, reason: 'retention' } });
  });

  it('a failed remove keeps the row ready (no markExpired) and the run is partly done', async () => {
    const h = harness();
    h.jobs.listDueForExpiry.mockResolvedValueOnce({ data: [{ id: J1, user_id: A }], error: null });
    h.storage.remove.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const result = await h.run();
    expect(h.jobs.markExpired).not.toHaveBeenCalled();
    expect(result.expireFailed).toBe(1);
    expect(result.auditEntries).toEqual([]);
  });

  it('a full page (500) counts as an incomplete step (backlog visible)', async () => {
    const h = harness();
    h.jobs.listDueForExpiry.mockResolvedValueOnce({ data: Array.from({ length: 500 }, () => ({ id: J1, user_id: A })), error: null });
    h.jobs.markExpired.mockResolvedValue({ data: false, error: null });
    expect((await h.run()).incompleteSteps).toBe(1);
  });
});

describe('3 orphans (SA Q-6, C-10)', () => {
  it('keeps same-user running/ready; removes the rest once older than 10 minutes, by the folder ids', async () => {
    const h = harness();
    h.storage.listForSweep.mockResolvedValueOnce({
      data: {
        objects: [
          { userId: A, jobId: J1, createdAt: OLD }, // A's ready job: kept
          { userId: A, jobId: J2, createdAt: OLD }, // job belongs to B: removed (user mismatch)
          { userId: A, jobId: J3, createdAt: OLD }, // expired (replaced, remove failed earlier): removed
          { userId: A, jobId: J4, createdAt: YOUNG }, // no row, young: kept
          { userId: B, jobId: J4, createdAt: null }, // no created_at: kept
        ],
        unexpected: 2,
        truncated: false,
      },
      error: null,
    });
    h.jobs.findJobsByIds.mockResolvedValueOnce({
      data: [
        { id: J1, user_id: A, status: 'ready' },
        { id: J2, user_id: B, status: 'ready' },
        { id: J3, user_id: A, status: 'expired' },
      ],
      error: null,
    });
    const result = await h.run();
    expect(h.storage.remove.mock.calls).toEqual([
      [A, J2],
      [A, J3],
    ]);
    expect(result.orphansRemoved).toBe(2);
    expect(result.orphansKept).toBe(3);
    expect(result.orphansUnexpected).toBe(2);
    expect(h.log.warn.mock.calls.some((c) => (c[0] as { event?: string }).event === 'data_export_bucket_unexpected_objects')).toBe(true);
  });

  it('the grace is exactly 10 minutes', () => {
    expect(SWEEP_LIMITS.ORPHAN_GRACE_MS).toBe(600_000);
  });

  it('a truncated listing still sweeps what it saw, and counts an incomplete step', async () => {
    const h = harness();
    h.storage.listForSweep.mockResolvedValueOnce({ data: { objects: [{ userId: A, jobId: J1, createdAt: OLD }], unexpected: 0, truncated: true }, error: null });
    const result = await h.run();
    expect(result.orphansRemoved).toBe(1);
    expect(result.incompleteSteps).toBe(1);
  });
});

describe('4 size watch (SA C-11)', () => {
  it('uses the export inventory per owner (union of both buckets), flags near (>= 60%) and over, ids only', async () => {
    const h = harness();
    h.files.listOwnerFolders.mockResolvedValueOnce({ owners: [A], skipped: 1, truncated: false });
    h.files.listOwnerFolders.mockResolvedValueOnce({ owners: [A, B], skipped: 2, truncated: false });
    h.files.inventory.mockImplementation(async (owner: string) =>
      owner === A
        ? { ok: true as const, inventory: inv(Math.ceil(EXPORT_LIMITS.FILE_BYTES_CEILING * 0.6), 3) }
        : { ok: true as const, inventory: inv(1, EXPORT_LIMITS.FILE_COUNT_CEILING + 1) }
    );
    const result = await h.run();
    expect(h.files.inventory).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ accountsWatched: 2, accountsNearCeiling: 1, accountsOverCeiling: 1, incompleteSteps: 0 });
    const warn = h.log.warn.mock.calls.find((c) => (c[0] as { event?: string }).event === 'data_export_accounts_near_ceiling');
    expect(warn![0]).toEqual({ event: 'data_export_accounts_near_ceiling', accountsNearCeiling: 1, accountsOverCeiling: 1, nearUserIds: [A], overUserIds: [B] });
  });

  it('document orphans never inflate the watch: it reads the inventory totals, not the raw bucket', async () => {
    const h = harness();
    h.files.listOwnerFolders.mockResolvedValue({ owners: [A], skipped: 0, truncated: false });
    // The inventory (after the live-row filter) is small, whatever the bucket holds.
    h.files.inventory.mockResolvedValue({ ok: true as const, inventory: inv(10, 1) });
    const result = await h.run();
    expect(result.accountsNearCeiling).toBe(0);
    expect(result.accountsOverCeiling).toBe(0);
  });

  it('a budget hit is an incomplete step', async () => {
    const h = harness();
    h.files.listOwnerFolders.mockResolvedValue({ owners: [A, B], skipped: 0, truncated: false });
    h.files.inventory.mockResolvedValue({ ok: false as const, reason: 'truncated' as const } as never);
    expect((await h.run()).incompleteSteps).toBe(1);
  });
});

describe('robustness', () => {
  it('a step that throws is counted and the next steps still run', async () => {
    const h = harness();
    h.jobs.listStaleRunning.mockRejectedValueOnce(new Error('boom'));
    h.jobs.listDueForExpiry.mockResolvedValueOnce({ data: [{ id: J1, user_id: A }], error: null });
    const result = await h.run();
    expect(result.incompleteSteps).toBe(1);
    expect(result.expired).toBe(1);
  });

  it('a read error is an incomplete step, never a throw', async () => {
    const h = harness();
    h.jobs.listStaleRunning.mockResolvedValueOnce({ data: null as never, error: new Error('x') });
    h.storage.listForSweep.mockResolvedValueOnce({ data: null as never, error: new Error('x') });
    expect((await h.run()).incompleteSteps).toBe(2);
  });
});
