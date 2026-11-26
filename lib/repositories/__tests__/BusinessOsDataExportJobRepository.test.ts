/**
 * BusinessOsDataExportJobRepository: the receipt export facts only (module
 * export MX-7, BUSINESS_OS_EXPORT_MX7_WORKPLAN.md §4.5, §7.2 T-6a to T-6h).
 *
 * Until MX-7 this file also pinned the DE-8a ZIP methods of the repository
 * (start, reads, transitions, sweep reads). They went with the table that
 * migration 20261135 drops; `findDeletionFacts` is all that is left, and its
 * path, class, constructor, method and result type are a frozen interface
 * (requirement SR-2, S-3, B.6).
 *
 * A mocked SupabaseClient is injected through the constructor. Every query is
 * recorded, so each test pins the exact reads: both on user_id, through the
 * two module-export repositories with the same client, and never a query to
 * the dropped table.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push(args);
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { BusinessOsDataExportJobRepository, type DataExportDeletionFacts } from '../BusinessOsDataExportJobRepository';
import type { AgentRepositoryResult as RepositoryResult } from '../types';

type Call = { method: string; args: unknown[] };

const repo = (c: SupabaseClient) => new BusinessOsDataExportJobRepository(c);

const OWNER = '11111111-1111-4111-8111-111111111111';
const OLD_TABLE = 'business_os_data_exports';

beforeEach(() => {
  logged.length = 0;
});

/**
 * findDeletionFacts runs its two reads together, so the order in which a fake
 * hands out results is not the order the queries were built in. This fake
 * gives every `.from()` its own query record and answers each one by its
 * table, never by position.
 */
type FactsQuery = 'moduleJobs' | 'adminRequests';
type FactsAnswer = { data?: unknown; error: unknown; count?: number | null };
type Query = { table: string; calls: Call[] };

function kindOf(query: Query): FactsQuery {
  if (query.table === 'business_os_export_module_jobs') return 'moduleJobs';
  if (query.table === 'business_os_export_requests') return 'adminRequests';
  throw new Error(`findDeletionFacts must not read ${query.table}`);
}

function factsClient(answers: Partial<Record<FactsQuery, FactsAnswer>>) {
  const queries: Query[] = [];
  const fallback: Record<FactsQuery, FactsAnswer> = {
    moduleJobs: { data: [], error: null },
    adminRequests: { data: null, error: null, count: 0 },
  };
  const c = {
    from: (table: string) => {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
        try {
          const kind = kindOf(query);
          resolve(answers[kind] ?? fallback[kind]);
        } catch (err) {
          reject(err);
        }
      };
      return builder;
    },
    rpc: () => {
      throw new Error('findDeletionFacts must not call an rpc');
    },
  } as unknown as SupabaseClient;
  const byKind = (kind: FactsQuery) => queries.filter((query) => kindOf(query) === kind);
  return { c, queries, byKind };
}

const sentJob = (sentAt: string, origin: string = 'owner') => ({ data: [{ sent_at: sentAt, business_os_export_requests: { origin } }], error: null });
const headCount = (count: number | null) => ({ data: null, error: null, count });
const NONE = { ownerLastExportReadyAt: null, ownerExportDownloadedAt: null, adminExportExisted: false };

describe('findDeletionFacts after MX-7: the new tables only (XC-12, B.6, SA-Q5)', () => {
  it('T-6a: two reads, each pinned, both on user_id, never `*`, and no query to the dropped table', async () => {
    const { c, queries, byKind } = factsClient({});
    expect(await repo(c).findDeletionFacts(OWNER)).toEqual({ data: NONE, error: null });
    expect(queries.map((query) => query.table).sort()).toEqual(['business_os_export_module_jobs', 'business_os_export_requests']);
    expect(queries.map((query) => query.table)).not.toContain(OLD_TABLE);

    // SA C-1 / C-3 (MX-4a): the embed selects a real column, and the origin and
    // status filters are exactly these calls.
    const [moduleJobs] = byKind('moduleJobs');
    expect(moduleJobs.calls).toEqual([
      { method: 'select', args: ['sent_at, business_os_export_requests!inner(origin)'] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'eq', args: ['status', 'sent'] },
      { method: 'eq', args: ['business_os_export_requests.origin', 'owner'] },
      { method: 'order', args: ['sent_at', { ascending: false }] },
      { method: 'limit', args: [1] },
    ]);

    const [adminRequests] = byKind('adminRequests');
    expect(adminRequests.calls).toEqual([
      { method: 'select', args: ['id', { count: 'exact', head: true }] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'eq', args: ['origin', 'admin'] },
    ]);

    for (const query of queries) {
      expect(query.calls.some((call) => call.method === 'select' && String(call.args[0]).includes('*'))).toBe(false);
    }
  });

  it('T-6a: the source makes no `.from(` of its own and never names the dropped table or its start function', () => {
    const source = readFileSync(join(__dirname, '..', 'BusinessOsDataExportJobRepository.ts'), 'utf8');
    const code = source
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/*'))
      .join('\n');
    expect(code).not.toContain('.from(');
    expect(code).not.toContain('.rpc(');
    expect(code).not.toContain(OLD_TABLE);
    expect(code).not.toContain('business_os_data_export_start');
    expect(code).not.toContain('jobPolicy');
    // Non-vacuous: the code lines are really there.
    expect(code).toContain('findLatestOwnerSentAt(userId)');
    expect(code).toContain('hasAdminOriginRequest(userId)');
  });

  it('T-6b: nothing on record: null, null, false', async () => {
    const { c } = factsClient({});
    expect((await repo(c).findDeletionFacts(OWNER)).data).toEqual(NONE);
  });

  it('T-6c: an owner module job sent: its sent_at as the database returns it, and no download', async () => {
    const { c } = factsClient({ moduleJobs: sentJob('2026-11-01T09:00:00.123456+00:00') });
    expect((await repo(c).findDeletionFacts(OWNER)).data).toEqual({
      ownerLastExportReadyAt: '2026-11-01T09:00:00.123456+00:00',
      ownerExportDownloadedAt: null,
      adminExportExisted: false,
    });
  });

  it.each([
    ['an admin-origin request only', { adminRequests: headCount(1) }, true],
    ['several admin-origin requests', { adminRequests: headCount(3) }, true],
    ['none', {}, false],
  ] as const)('T-6d: adminExportExisted with %s', async (_name, answers, expected) => {
    const { c } = factsClient(answers);
    expect((await repo(c).findDeletionFacts(OWNER)).data?.adminExportExisted).toBe(expected);
  });

  it('T-6d: an admin send never sets ownerLastExportReadyAt (the owner-origin filter is the read, SA Q-2)', async () => {
    // The admin-origin request exists and the owner read finds no owner job.
    const { c, byKind } = factsClient({ adminRequests: headCount(1) });
    expect((await repo(c).findDeletionFacts(OWNER)).data).toEqual({
      ownerLastExportReadyAt: null,
      ownerExportDownloadedAt: null,
      adminExportExisted: true,
    });
    expect(byKind('moduleJobs')[0].calls).toContainEqual({ method: 'eq', args: ['business_os_export_requests.origin', 'owner'] });
  });

  it('T-6c: with both facts, ownerExportDownloadedAt is still null (no download exists)', async () => {
    const { c } = factsClient({ moduleJobs: sentJob('2026-10-31T08:00:00+00:00'), adminRequests: headCount(2) });
    expect((await repo(c).findDeletionFacts(OWNER)).data).toEqual({
      ownerLastExportReadyAt: '2026-10-31T08:00:00+00:00',
      ownerExportDownloadedAt: null,
      adminExportExisted: true,
    });
  });

  it('T-6e: invalid id: an error without a database call', async () => {
    const { c, queries } = factsClient({});
    expect((await repo(c).findDeletionFacts('nope')).error).toBeInstanceOf(Error);
    expect(queries).toEqual([]);
  });

  it.each(['moduleJobs', 'adminRequests'] as const)('T-6f: the %s read failing makes the whole call an error, never partial facts', async (failing) => {
    const { c } = factsClient({
      moduleJobs: sentJob('2026-10-31T08:00:00Z'),
      adminRequests: headCount(1),
      [failing]: { data: null, error: { message: 'boom', code: '57014', details: 'secret row' } },
    });
    expect(await repo(c).findDeletionFacts(OWNER)).toEqual({ data: null, error: expect.any(Error) });
    expect(JSON.stringify(logged)).toContain('findDeletionFacts');
    expect(JSON.stringify(logged)).not.toContain('secret row');
  });

  it('T-6f: an admin request count that comes back without a count is an error, never "no"', async () => {
    const { c } = factsClient({ adminRequests: headCount(null) });
    expect(await repo(c).findDeletionFacts(OWNER)).toEqual({ data: null, error: expect.any(Error) });
  });

  it('T-6f (SA C-1): a sent job whose embedded origin is not owner is an error, not a fact', async () => {
    const { c } = factsClient({ moduleJobs: sentJob('2026-10-31T08:00:00Z', 'admin') });
    expect(await repo(c).findDeletionFacts(OWNER)).toEqual({ data: null, error: expect.any(Error) });
  });

  it('T-6g (SA Q-5): an unparseable sent_at makes the whole call an error naming the field, never the value', async () => {
    const { c } = factsClient({ moduleJobs: sentJob('not a time') });
    const result = await repo(c).findDeletionFacts(OWNER);
    expect(result).toEqual({ data: null, error: expect.any(Error) });
    expect(result.error?.message).toBe('Unparseable timestamp: module job sent_at');
    expect(JSON.stringify(logged)).not.toContain('not a time');
  });

  it('T-6h: the frozen contract: optional client, RepositoryResult<DataExportDeletionFacts>, exactly three keys', async () => {
    // The constructor still takes an optional client (the default is the mocked supabaseServer).
    expect(new BusinessOsDataExportJobRepository()).toBeInstanceOf(BusinessOsDataExportJobRepository);
    const { c } = factsClient({ moduleJobs: sentJob('2026-10-31T08:00:00+00:00') });
    // Type-level pin: this assignment stops compiling if the method's result type moves.
    const result: RepositoryResult<DataExportDeletionFacts> = await repo(c).findDeletionFacts(OWNER);
    const facts: DataExportDeletionFacts = {
      ownerLastExportReadyAt: null,
      ownerExportDownloadedAt: null,
      adminExportExisted: false,
    };
    expect(Object.keys(result.data ?? {}).sort()).toEqual(Object.keys(facts).sort());
    expect(Object.keys(facts).sort()).toEqual(['adminExportExisted', 'ownerExportDownloadedAt', 'ownerLastExportReadyAt']);
    expect(typeof BusinessOsDataExportJobRepository.prototype.findDeletionFacts).toBe('function');
  });
});
