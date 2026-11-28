/**
 * IssueReportRepository (issue reporting slice 1.1b; workplan
 * BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md §3, §7, §8; SA RC-7, RC-8, Q5).
 *
 * A recording SupabaseClient is injected through the constructor, so each test
 * pins the exact query: the explicit insert payload (RC-8), the reference
 * retry on `issue_reports_reference_key` only (§3), the tenant filter (id AND
 * user_id) on the read, and that invalid input never reaches the database.
 * `@/lib/supabaseServer` is mocked so the default singleton reaches nothing.
 * No network.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push([level, ...args]);
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  ISSUE_REPORT_COLUMNS,
  ISSUE_REPORT_CREATE_MAX_ATTEMPTS,
  ISSUE_REPORT_ERROR,
  IssueReportRepository,
  issueReportRepository,
} from '../IssueReportRepository';
import { ISSUE_REPORT_REFERENCE_PATTERN } from '@/lib/business-os/issue-reports/issueReportModel';
import type { CreateIssueReportInput } from '../types';

type Call = { method: string; args: unknown[] };
type Result = { data?: unknown; error: unknown };

/** A recording client. `results` are handed out one per awaited query, in order. */
function client(...results: Result[]) {
  const calls: Call[] = [];
  let next = 0;
  const take = () => results[Math.min(next++, results.length - 1)] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(take());
  const c = {
    from: (table: string) => (calls.push({ method: 'from', args: [table] }), builder),
    rpc: (name: string, params: unknown) => {
      calls.push({ method: 'rpc', args: [name, params] });
      return Promise.resolve(take());
    },
  } as unknown as SupabaseClient;
  return { c, calls };
}

/** A generator that hands out the given references in order. */
function refs(...values: string[]) {
  const handed: string[] = [];
  let next = 0;
  const gen = () => {
    const value = values[Math.min(next++, values.length - 1)];
    handed.push(value);
    return value;
  };
  return { gen, handed };
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REPORT = '44444444-4444-4444-8444-444444444444';
const T = '2026-11-27T10:00:00.000Z';
const SECRET_MESSAGE = 'The invoice page crashes when I press save with my card 4242';
const SECRET_PAGE = '/business-os/clients/very-private-client-name';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REPORT,
    user_id: OWNER,
    reference: 'R-7K3M9Q2X',
    message: SECRET_MESSAGE,
    category_hint: 'bug',
    page: SECRET_PAGE,
    area: 'clients',
    environment: 'production',
    status: 'submitted',
    closed_reason: null,
    context: null,
    screenshot_path: null,
    problem_id: null,
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

const input = (overrides: Partial<CreateIssueReportInput> & Record<string, unknown> = {}): CreateIssueReportInput =>
  ({
    userId: OWNER,
    message: SECRET_MESSAGE,
    categoryHint: 'bug',
    page: SECRET_PAGE,
    area: 'clients',
    environment: 'production',
    ...overrides,
  }) as CreateIssueReportInput;

const inserts = (calls: Call[]) => calls.filter((c) => c.method === 'insert').map((c) => c.args[0] as Record<string, unknown>);
const eqs = (calls: Call[]) => calls.filter((c) => c.method === 'eq').map((c) => c.args);
const dbCalls = (calls: Call[]) => calls.filter((c) => c.method === 'from' || c.method === 'rpc');

const collision = (constraint = 'issue_reports_reference_key') => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${constraint}"`,
  details: 'Key (reference)=(R-AAAAAAAA) already exists.',
});

beforeEach(() => {
  logged.length = 0;
});

describe('IssueReportRepository.create', () => {
  it('happy path: inserts exactly the allow-listed fields plus the generated reference, and returns the parsed row', async () => {
    const { c, calls } = client({ data: row({ reference: 'R-0Z0ZAJV1' }), error: null });
    const { gen } = refs('R-0Z0ZAJV1');
    const result = await new IssueReportRepository(c, gen).create(input());

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: REPORT, user_id: OWNER, reference: 'R-0Z0ZAJV1', status: 'submitted' });

    expect(calls[0]).toEqual({ method: 'from', args: ['issue_reports'] });
    const [payload] = inserts(calls);
    // RC-8: the keys exactly, in the order the repository builds them.
    expect(Object.keys(payload)).toEqual(['user_id', 'reference', 'message', 'category_hint', 'page', 'area', 'environment']);
    expect(payload).toEqual({
      user_id: OWNER,
      reference: 'R-0Z0ZAJV1',
      message: SECRET_MESSAGE,
      category_hint: 'bug',
      page: SECRET_PAGE,
      area: 'clients',
      environment: 'production',
    });
    expect(calls.find((x) => x.method === 'select')?.args).toEqual([ISSUE_REPORT_COLUMNS]);
    expect(calls.some((x) => x.method === 'single')).toBe(true);
    // SA Q5: report-only, no outbox write and no RPC.
    expect(dbCalls(calls)).toEqual([{ method: 'from', args: ['issue_reports'] }]);
  });

  it('an optional hint and area left out are written as NULL', async () => {
    const { c, calls } = client({ data: row({ category_hint: null, area: null }), error: null });
    const result = await new IssueReportRepository(c, refs('R-7K3M9Q2X').gen).create(
      input({ categoryHint: undefined, area: undefined }),
    );
    expect(result.error).toBeNull();
    expect(inserts(calls)[0]).toMatchObject({ category_hint: null, area: null });
  });

  it('the default generator gives a reference that matches the DB CHECK pattern', async () => {
    const { c, calls } = client({ data: row(), error: null });
    await new IssueReportRepository(c).create(input());
    const reference = inserts(calls)[0].reference as string;
    expect(ISSUE_REPORT_REFERENCE_PATTERN.test(reference)).toBe(true);
  });

  it('drops an injected user_id, id, status, reference, context, screenshot_path, problem_id and timestamps (tenant isolation step 7)', async () => {
    const { c, calls } = client({ data: row(), error: null });
    await new IssueReportRepository(c, refs('R-7K3M9Q2X').gen).create(
      input({
        user_id: OTHER,
        id: REPORT,
        status: 'resolved',
        reference: 'R-ZZZZZZZZ',
        context: { a: 1 },
        screenshot_path: `${OTHER}/${REPORT}/x.png`,
        problem_id: REPORT,
        created_at: T,
        updated_at: T,
      }),
    );
    const [payload] = inserts(calls);
    expect(payload.user_id).toBe(OWNER);
    expect(payload.reference).toBe('R-7K3M9Q2X');
    for (const key of ['id', 'status', 'context', 'screenshot_path', 'problem_id', 'created_at', 'updated_at', 'userId']) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it('retries once on a collision on issue_reports_reference_key, with a fresh reference, then succeeds', async () => {
    const { c, calls } = client({ data: null, error: collision() }, { data: row({ reference: 'R-BBBBBBBB' }), error: null });
    const { gen, handed } = refs('R-AAAAAAAA', 'R-BBBBBBBB');
    const result = await new IssueReportRepository(c, gen).create(input());

    expect(result.error).toBeNull();
    expect(result.data?.reference).toBe('R-BBBBBBBB');
    expect(handed).toEqual(['R-AAAAAAAA', 'R-BBBBBBBB']);
    expect(inserts(calls).map((p) => p.reference)).toEqual(['R-AAAAAAAA', 'R-BBBBBBBB']);
  });

  it(`stops after ${ISSUE_REPORT_CREATE_MAX_ATTEMPTS} collisions in total and returns an error without throwing`, async () => {
    expect(ISSUE_REPORT_CREATE_MAX_ATTEMPTS).toBe(3);
    const { c, calls } = client({ data: null, error: collision() });
    const { gen, handed } = refs('R-AAAAAAAA', 'R-BBBBBBBB', 'R-CCCCCCCC', 'R-DDDDDDDD');
    const result = await new IssueReportRepository(c, gen).create(input());

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error & { code?: string }).code).toBe('23505');
    expect(inserts(calls)).toHaveLength(3);
    expect(handed).toEqual(['R-AAAAAAAA', 'R-BBBBBBBB', 'R-CCCCCCCC']);
    expect(logged.some((entry) => entry[0] === 'error' && entry[2] === 'reference_collision_exhausted')).toBe(true);
  });

  it('a 23505 on another constraint is not retried', async () => {
    const { c, calls } = client({ data: null, error: { ...collision('issue_reports_pkey'), details: 'Key (id)=(x) already exists.' } });
    const result = await new IssueReportRepository(c, refs('R-AAAAAAAA', 'R-BBBBBBBB').gen).create(input());
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('23505');
    expect(inserts(calls)).toHaveLength(1);
  });

  it('error path: another database error returns { data: null, error } after one attempt, with no details copied', async () => {
    const { c, calls } = client({ data: null, error: { code: '23514', message: 'violates check constraint', details: 'Failing row contains (secret)' } });
    const result = await new IssueReportRepository(c, refs('R-AAAAAAAA').gen).create(input());
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('violates check constraint');
    expect((result.error as Error & { code?: string }).code).toBe('23514');
    expect(result.error).not.toHaveProperty('details');
    expect(inserts(calls)).toHaveLength(1);
  });

  it('a row of an unexpected shape is an error, not a wrong object', async () => {
    const { c } = client({ data: row({ status: 'archived' }), error: null });
    const result = await new IssueReportRepository(c, refs('R-7K3M9Q2X').gen).create(input());
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('a generator that throws returns an error and never reaches the database', async () => {
    const { c, calls } = client({ data: row(), error: null });
    const result = await new IssueReportRepository(c, () => {
      throw new Error('no entropy');
    }).create(input());
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('no entropy');
    expect(dbCalls(calls)).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an empty message', { message: '' }],
    ['a message over 5000 characters', { message: 'x'.repeat(5001) }],
    ['a category outside the chips', { categoryHint: 'complaint' }],
    ['a page without a leading slash', { page: 'business-os' }],
    ['a page with a query string', { page: '/business-os?token=abc' }],
    ['a page with a fragment', { page: '/business-os#top' }],
    ['a page over 512 characters', { page: `/${'a'.repeat(512)}` }],
    ['an area of the wrong shape', { area: 'Clients' }],
    ['an environment of the wrong shape', { environment: 'PROD' }],
    ['a missing environment', { environment: undefined }],
    ['a user id that is not a uuid', { userId: 'not-a-uuid' }],
  ])('invalid input (%s) returns invalid_input and makes no database call', async (_name, overrides) => {
    const { c, calls } = client({ data: row(), error: null });
    const result = await new IssueReportRepository(c, refs('R-7K3M9Q2X').gen).create(input(overrides));
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe(ISSUE_REPORT_ERROR.INVALID);
    expect(dbCalls(calls)).toHaveLength(0);
  });

  it('accepts a message of exactly 5000 characters counted as code points (as char_length counts)', async () => {
    const { c, calls } = client({ data: row(), error: null });
    // 5000 astral characters: 10000 UTF-16 units, 5000 code points.
    const message = String.fromCodePoint(0x1f600).repeat(5000);
    const result = await new IssueReportRepository(c, refs('R-7K3M9Q2X').gen).create(input({ message }));
    expect(result.error).toBeNull();
    expect(inserts(calls)).toHaveLength(1);
  });

  it('logs carry ids and the reference only, never the message or the page (CR-7)', async () => {
    const { c } = client({ data: null, error: collision() }, { data: row(), error: null });
    await new IssueReportRepository(c, refs('R-AAAAAAAA', 'R-7K3M9Q2X').gen).create(input());
    const { c: c2 } = client({ data: null, error: { code: 'XX000', message: 'boom' } });
    await new IssueReportRepository(c2, refs('R-AAAAAAAA').gen).create(input());

    expect(logged.length).toBeGreaterThan(0);
    const text = JSON.stringify(logged.map((entry) => entry.map((part) => (part instanceof Error ? part.message : part))));
    expect(text).not.toContain(SECRET_MESSAGE);
    expect(text).not.toContain(SECRET_PAGE);
    expect(text).toContain(REPORT);
    expect(text).toContain('R-7K3M9Q2X');
  });
});

describe('IssueReportRepository.findByIdForUser', () => {
  it('found: filters by id AND user_id and returns the parsed row', async () => {
    const { c, calls } = client({ data: row(), error: null });
    const result = await new IssueReportRepository(c).findByIdForUser(REPORT, OWNER);

    expect(result).toEqual({ data: expect.objectContaining({ id: REPORT, user_id: OWNER }), error: null });
    expect(calls[0]).toEqual({ method: 'from', args: ['issue_reports'] });
    expect(calls.find((x) => x.method === 'select')?.args).toEqual([ISSUE_REPORT_COLUMNS]);
    expect(eqs(calls)).toEqual([
      ['id', REPORT],
      ['user_id', OWNER],
    ]);
    expect(calls.some((x) => x.method === 'maybeSingle')).toBe(true);
  });

  it("another account's id (or no such row) gives { data: null, error: null }, scoped to the caller's user_id", async () => {
    const { c, calls } = client({ data: null, error: null });
    const result = await new IssueReportRepository(c).findByIdForUser(REPORT, OTHER);
    expect(result).toEqual({ data: null, error: null });
    expect(eqs(calls)).toContainEqual(['user_id', OTHER]);
    expect(eqs(calls)).not.toContainEqual(['user_id', OWNER]);
  });

  it.each([
    ['a report id that is not a uuid', 'R-7K3M9Q2X', OWNER],
    ['a user id that is not a uuid', REPORT, 'owner'],
    ['an empty user id', REPORT, ''],
  ])('%s returns invalid_input and makes no query', async (_name, id, userId) => {
    const { c, calls } = client({ data: row(), error: null });
    const result = await new IssueReportRepository(c).findByIdForUser(id, userId);
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe(ISSUE_REPORT_ERROR.INVALID);
    expect(dbCalls(calls)).toHaveLength(0);
  });

  it('error path: a database error returns { data: null, error } and never throws', async () => {
    const { c } = client({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    const result = await new IssueReportRepository(c).findByIdForUser(REPORT, OWNER);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('relation does not exist');
  });

  it('a row of an unexpected shape is an error', async () => {
    const { c } = client({ data: row({ reference: 'not-a-reference' }), error: null });
    const result = await new IssueReportRepository(c).findByIdForUser(REPORT, OWNER);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('IssueReportRepository surface', () => {
  it('has exactly the two methods 1.2 to 1.5 call, and a singleton', () => {
    const methods = Object.getOwnPropertyNames(IssueReportRepository.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(['create', 'findByIdForUser']);
    expect(issueReportRepository).toBeInstanceOf(IssueReportRepository);
  });
});
