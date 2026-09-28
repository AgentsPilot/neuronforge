/**
 * GDPR erasure and export reach the archive (Admin Archiving Slice 3, workplan
 * §5.2, S-1 to S-8).
 *
 * The properties that matter:
 *  - anonymise clears every personal field, including the three C-17 named;
 *  - erasure runs LIVE FIRST, then deletes the archive (SA Q-1), and is never
 *    silently half-done: `DATA_ANONYMIZED` only on complete erasure;
 *  - export includes archived rows, labelled, and fails rather than omit them.
 */

const order: string[] = [];
const loggedErrors: unknown[] = [];

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'debug']) logger[level] = () => undefined;
    logger.error = (ctx: unknown, msg: unknown) => loggedErrors.push({ ctx, msg });
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The live side: the service's own client over audit_trail.
const live: {
  updateResult: { data: unknown; error: unknown };
  selectResult: { data: unknown; error: unknown };
  updates: unknown[];
  filters: Array<[string, unknown]>;
} = { updateResult: { data: [], error: null }, selectResult: { data: [], error: null }, updates: [], filters: [] };

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let isUpdate = false;
      const builder: Record<string, unknown> = {};
      builder.update = (payload: unknown) => {
        isUpdate = true;
        live.updates.push(payload);
        order.push('live-anonymise');
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        live.filters.push([column, value]);
        return builder;
      };
      for (const method of ['select', 'order', 'insert']) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(isUpdate ? live.updateResult : live.selectResult).then(resolve);
      return builder;
    },
  }),
}));

const deleteArchivedForUser = jest.fn();
const listArchivedForUser = jest.fn();
jest.mock('@/lib/repositories/ArchiveRepository', () => ({
  archiveRepository: {
    deleteArchivedForUser: (...args: unknown[]) => {
      order.push('archive-delete');
      return deleteArchivedForUser(...args);
    },
    listArchivedForUser: (...args: unknown[]) => listArchivedForUser(...args),
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import { AuditTrail, ErasureIncompleteError } from '../AuditTrailService';

const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
let logSpy: jest.SpyInstance;

beforeEach(() => {
  order.length = 0;
  loggedErrors.length = 0;
  live.updates.length = 0;
  live.filters.length = 0;
  live.updateResult = { data: [{ id: 'r1' }, { id: 'r2' }], error: null };
  live.selectResult = { data: [], error: null };
  deleteArchivedForUser.mockReset().mockResolvedValue({ data: 3, error: null });
  listArchivedForUser.mockReset().mockResolvedValue({ data: [], error: null });
  logSpy = jest.spyOn(AuditTrail, 'log').mockResolvedValue(undefined as never);
});

afterEach(() => logSpy.mockRestore());

const anonymisedEvents = () =>
  logSpy.mock.calls.filter(([input]) => (input as { action: string }).action === 'DATA_ANONYMIZED');

describe('anonymizeUserData (erasure)', () => {
  it('S-1: clears every personal field, user_email, changes and resource_name included, for that account only', async () => {
    await AuditTrail.anonymizeUserData(USER);

    expect(live.updates).toEqual([
      {
        user_id: null,
        actor_id: null,
        ip_address: null,
        user_agent: null,
        session_id: null,
        user_email: null,
        changes: null,
        resource_name: null,
        details: { anonymized: true },
      },
    ]);
    expect(live.filters).toEqual([['user_id', USER]]);
  });

  it('S-2: live first, then the archive; returns both counts; the event carries both', async () => {
    const result = await AuditTrail.anonymizeUserData(USER);

    expect(order).toEqual(['live-anonymise', 'archive-delete']);
    expect(deleteArchivedForUser).toHaveBeenCalledWith(USER);
    expect(result).toEqual({ anonymized: 2, archivedDeleted: 3 });
    expect(anonymisedEvents()).toHaveLength(1);
    expect(anonymisedEvents()[0][0]).toMatchObject({
      entityId: USER,
      userId: null,
      details: { recordsAnonymized: 2, archivedRecordsDeleted: 3 },
    });
  });

  it('S-3: a failed live anonymise throws before the archive is touched, and writes no event', async () => {
    live.updateResult = { data: null, error: { message: 'db down' } };

    await expect(AuditTrail.anonymizeUserData(USER)).rejects.toThrow('db down');
    expect(order).toEqual(['live-anonymise']);
    expect(deleteArchivedForUser).not.toHaveBeenCalled();
    expect(anonymisedEvents()).toHaveLength(0);
  });

  it('S-4: a failed archive delete is loud: ErasureIncompleteError, an error log, and no DATA_ANONYMIZED', async () => {
    deleteArchivedForUser.mockResolvedValue({ data: null, error: new Error('archive down') });

    const attempt = AuditTrail.anonymizeUserData(USER);

    await expect(attempt).rejects.toBeInstanceOf(ErasureIncompleteError);
    await expect(attempt).rejects.toMatchObject({ anonymized: 2 });
    expect(loggedErrors).toHaveLength(1);
    expect(anonymisedEvents()).toHaveLength(0);
  });

  it('S-4b (SA CR-2): a re-run after a failed archive delete completes it; the event is written once, counting only that run', async () => {
    deleteArchivedForUser
      .mockResolvedValueOnce({ data: null, error: new Error('archive down') })
      .mockResolvedValueOnce({ data: 3, error: null });

    await expect(AuditTrail.anonymizeUserData(USER)).rejects.toBeInstanceOf(ErasureIncompleteError);
    // The first attempt anonymised the live rows, so the re-run finds none.
    live.updateResult = { data: [], error: null };
    const second = await AuditTrail.anonymizeUserData(USER);

    expect(deleteArchivedForUser).toHaveBeenCalledTimes(2);
    expect(second).toEqual({ anonymized: 0, archivedDeleted: 3 });
    expect(anonymisedEvents()).toHaveLength(1);
    expect(anonymisedEvents()[0][0]).toMatchObject({
      details: { recordsAnonymized: 0, archivedRecordsDeleted: 3 },
    });
  });

  it('S-5: refuses a non-UUID before any query', async () => {
    await expect(AuditTrail.anonymizeUserData('not-a-uuid')).rejects.toThrow('UUID');
    expect(order).toEqual([]);
  });
});

describe('exportUserData', () => {
  it('S-6: merges live and archived rows newest first, labelled, and counts both', async () => {
    live.selectResult = {
      data: [
        { id: 'l2', action: 'A', entity_type: 'agent', created_at: '2026-09-01T00:00:00Z', user_id: USER },
        { id: 'l1', action: 'B', entity_type: 'agent', created_at: '2026-06-01T00:00:00Z', user_id: USER },
      ],
      error: null,
    };
    listArchivedForUser.mockResolvedValue({
      data: [
        {
          source_id: 'a1',
          archived_at: '2026-09-27T00:00:00Z',
          payload: { id: 'a1', action: 'A', entity_type: 'user', created_at: '2024-01-01T00:00:00Z', user_id: USER },
        },
      ],
      error: null,
    });

    const result = await AuditTrail.exportUserData(USER);

    expect(listArchivedForUser).toHaveBeenCalledWith(USER, 'audit_trail');
    expect(result.logs.map((log) => [log.id, log.archived])).toEqual([
      ['l2', false],
      ['l1', false],
      ['a1', true],
    ]);
    expect(result.logs[2].archivedAt).toBe('2026-09-27T00:00:00Z');
    expect(result.totalEvents).toBe(3);
    expect(result.archivedEvents).toBe(1);
    expect(result.dateRange).toEqual({ from: '2024-01-01T00:00:00Z', to: '2026-09-01T00:00:00Z' });
    expect(result.summary.actionsPerformed).toEqual({ A: 2, B: 1 });
    expect(result.summary.entitiesModified).toEqual({ agent: 2, user: 1 });
  });

  it('S-7: an archived read failure throws; there is no partial export', async () => {
    listArchivedForUser.mockResolvedValue({ data: null, error: new Error('archive down') });

    await expect(AuditTrail.exportUserData(USER)).rejects.toThrow('archive down');
  });

  it('S-5: refuses a non-UUID before any query', async () => {
    await expect(AuditTrail.exportUserData('')).rejects.toThrow('UUID');
    expect(listArchivedForUser).not.toHaveBeenCalled();
  });
});

describe('S-8: archive access goes through the repository (C-7)', () => {
  it('AuditTrailService.ts never queries archived_records itself', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'AuditTrailService.ts'), 'utf8');
    // Comments may name the table; a query may not (C-7).
    expect(source).not.toMatch(/from\(\s*['"`]archived_records/);
  });
});
