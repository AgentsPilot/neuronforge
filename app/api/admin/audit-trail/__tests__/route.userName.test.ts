/**
 * GET /api/admin/audit-trail — the person-name enrichment (ADMIN_BOS_CLEANUP
 * slice 4, FR-AT1 / FR-AT2).
 *
 * The route used to read names from `public.users`, a table that does not exist
 * (measured live: 42P01). It discarded the error, so every row arrived with no
 * name and the page printed the account id. Names now come from
 * `profiles.full_name` through `UserProfileRepository.findAdminNamesByIds`.
 *
 * What is pinned here, none of it visible from a bare 200:
 *
 *  1. ONE batched repository call per page, with the unique ids (U-3).
 *  2. A row gets `users: { full_name }` and nothing else, only when a non-empty
 *     name exists; otherwise `users: null`, never a placeholder (U-1, U-2).
 *  3. A failed lookup, returned OR thrown, is logged on the request logger with
 *     the exact error, the rows are still served, and "unknown" is not served as
 *     "no name": the `users` key is dropped and `userLookup: 'failed'` (U-4, U-5).
 *  4. The two lookups are independent (U-6).
 *  5. No person's name reaches any log line, including when names WERE loaded
 *     and the business lookup then failed (U-7).
 *  6. The inline client reads `audit_trail` only, never `users` (U-8).
 *  7. The failure is logged on the child logger bound to the request's
 *     correlation id (U-9).
 *
 * Auth is not re-tested here — app/api/admin/__tests__/auditAdminGate.test.ts
 * drives this route through 401 / 403 / 200.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

/**
 * Two loggers with separate spies: the module logger and the per-request child.
 * Keeping them apart is what lets U-9 prove a failure is logged on the child that
 * carries the correlation id, rather than on a logger that merely exists.
 */
const mockRootFns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockChildFns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockChild = jest.fn();
jest.mock('@/lib/logger', () => {
  const levels = (fns: typeof mockRootFns): Record<string, unknown> => ({
    info: (...args: unknown[]) => fns.info(...args),
    warn: (...args: unknown[]) => fns.warn(...args),
    error: (...args: unknown[]) => fns.error(...args),
    debug: (...args: unknown[]) => fns.debug(...args),
  });
  const child = levels(mockChildFns);
  child.child = () => child;
  const root = levels(mockRootFns);
  root.child = (...args: unknown[]) => {
    mockChild(...args);
    return child;
  };
  return { createLogger: () => root };
});

/** Everything passed to any logger this test, across both loggers and all levels. */
const allLogArgs = (): unknown[] =>
  [...Object.values(mockRootFns), ...Object.values(mockChildFns)].flatMap((fn) => fn.mock.calls.flat());

/** Error messages unwrapped, since JSON.stringify(new Error('x')) is '{}'. */
const flattenedLogs = (): string =>
  JSON.stringify(allLogArgs().map((arg) => (arg instanceof Error ? arg.message : arg)));

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: {
    findAdminNamesByIds: (...args: unknown[]) => mockFindNames(...args),
  },
}));

const mockFindIdentities = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findAdminIdentitiesByUserIds: (...args: unknown[]) => mockFindIdentities(...args),
  },
}));

/** Rows the mocked `audit_trail` select resolves with. */
let mockAuditRows: Array<Record<string, unknown>> = [];
/** Every table the route's inline client was asked for, in order. */
const mockFromTables: string[] = [];

jest.mock('@supabase/supabase-js', () => {
  const builder = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => {
              if (table === 'audit_trail') {
                resolve({ data: mockAuditRows, error: null, count: mockAuditRows.length });
              } else {
                resolve({ data: [], error: null, count: 0 });
              }
            };
          }
          return () => builder(table);
        },
      }
    );
  return {
    createClient: () => ({
      from: (table: string) => {
        mockFromTables.push(table);
        return builder(table);
      },
    }),
  };
});

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const NAMED = '2f734ed5-3681-4049-880d-3de7b096bea3';
const PADDED = '33333333-3333-4333-8333-333333333333';
const NO_PROFILE = '99999999-9999-4999-8999-999999999999';
const NULL_NAME = '44444444-4444-4444-8444-444444444444';
const EMPTY_NAME = '55555555-5555-4555-8555-555555555555';
const BLANK_NAME = '66666666-6666-4666-8666-666666666666';

const PERSON = 'Dana Cohen';
const PADDED_PERSON = 'Avi Levi';
const COMPANY = 'Acme Dental';
const CORRELATION_ID = 'corr-slice4-user-names';

const auditRow = (id: string, userId: string) => ({
  id,
  user_id: userId,
  action: 'BUSINESS_AI_ACTION_COMPLETED',
  entity_type: 'ai_action',
  entity_id: `e-${id}`,
  resource_name: null,
  details: null,
  changes: null,
  severity: 'info',
  created_at: '2026-09-28T10:00:00.000Z',
  compliance_flags: [],
});

const NAME_ROWS = [
  { id: NAMED, full_name: PERSON },
  { id: PADDED, full_name: `  ${PADDED_PERSON}  ` },
  { id: NULL_NAME, full_name: null },
  { id: EMPTY_NAME, full_name: '' },
  { id: BLANK_NAME, full_name: '   ' },
];

const call = () =>
  GET(
    new NextRequest('http://localhost/api/admin/audit-trail?page=1&page_size=20', {
      headers: { 'x-correlation-id': CORRELATION_ID },
    })
  );

beforeEach(() => {
  mockGetUser.mockReset().mockResolvedValue(ADMIN);
  mockIsAdmin.mockReset().mockResolvedValue(true);
  mockFindNames.mockReset().mockResolvedValue({ data: [], error: null });
  mockFindIdentities.mockReset().mockResolvedValue({ data: [], error: null });
  for (const fn of [...Object.values(mockRootFns), ...Object.values(mockChildFns)]) fn.mockReset();
  mockChild.mockReset();
  mockFromTables.length = 0;
  mockAuditRows = [];
});

describe('person names from profiles (FR-AT1)', () => {
  it('U-1: attaches { full_name } and nothing else to every row of a named account', async () => {
    mockAuditRows = [auditRow('r1', NAMED), auditRow('r2', NAMED)];
    mockFindNames.mockResolvedValue({ data: [{ id: NAMED, full_name: PERSON }], error: null });

    const body = await (await call()).json();

    expect(body.success).toBe(true);
    expect(body.logs).toHaveLength(2);
    for (const log of body.logs) {
      expect(log.users).toEqual({ full_name: PERSON });
      // No email, no id, nothing beyond the name (§8 Privacy).
      expect(Object.keys(log.users)).toEqual(['full_name']);
    }
  });

  it('U-2: no profile, a null name, an empty name and a blank name all give users: null; a padded name is trimmed', async () => {
    mockAuditRows = [
      auditRow('named', NAMED),
      auditRow('padded', PADDED),
      auditRow('none', NO_PROFILE),
      auditRow('null', NULL_NAME),
      auditRow('empty', EMPTY_NAME),
      auditRow('blank', BLANK_NAME),
    ];
    mockFindNames.mockResolvedValue({ data: NAME_ROWS, error: null });

    const body = await (await call()).json();
    const byId = Object.fromEntries(body.logs.map((l: { id: string }) => [l.id, l]));

    expect(byId.named.users).toEqual({ full_name: PERSON });
    expect(byId.padded.users).toEqual({ full_name: PADDED_PERSON });
    for (const id of ['none', 'null', 'empty', 'blank']) {
      // `null`, not a missing key: the lookup worked and there is no name.
      expect('users' in byId[id]).toBe(true);
      expect(byId[id].users).toBeNull();
    }
  });

  it('U-2: the debug count of resolved names counts real names only', async () => {
    mockAuditRows = NAME_ROWS.map((r) => auditRow(`r-${r.id}`, r.id));
    mockFindNames.mockResolvedValue({ data: NAME_ROWS, error: null });

    await call();

    const fetched = mockChildFns.debug.mock.calls.find(([, msg]) => msg === 'Audit logs fetched');
    expect(fetched?.[0]).toEqual(expect.objectContaining({ userNamesResolved: 2, userLookup: 'ok' }));
  });

  it('U-3: ONE batched call for the page, with the unique ids', async () => {
    mockAuditRows = [auditRow('r1', NAMED), auditRow('r2', NAMED), auditRow('r3', NO_PROFILE)];

    await call();

    expect(mockFindNames).toHaveBeenCalledTimes(1);
    const [ids] = mockFindNames.mock.calls[0] as [string[]];
    expect([...ids].sort()).toEqual([NAMED, NO_PROFILE].sort());
  });

  it('U-3: no lookup for an empty page', async () => {
    mockAuditRows = [];

    const body = await (await call()).json();

    expect(body.logs).toEqual([]);
    expect(mockFindNames).not.toHaveBeenCalled();
    expect(body.userLookup).toBe('ok');
  });
});

describe('a failed name lookup (FR-AT2)', () => {
  it('U-4: an error result — rows served, no users key, userLookup failed, the exact error logged', async () => {
    const dbError = new Error('permission denied for table profiles');
    mockAuditRows = [auditRow('r1', NAMED), auditRow('r2', NO_PROFILE)];
    mockFindNames.mockResolvedValue({ data: null, error: dbError });

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.logs).toHaveLength(2);
    expect(body.userLookup).toBe('failed');
    for (const log of body.logs) {
      // Absent, not null: null would claim "this account has no name".
      expect('users' in log).toBe(false);
    }

    expect(mockChildFns.error).toHaveBeenCalledTimes(1);
    const [context, message] = mockChildFns.error.mock.calls[0] as [{ err?: unknown }, string];
    expect(message).toMatch(/user name lookup failed/i);
    expect(context.err).toBe(dbError);
  });

  it('U-5: a REJECTED lookup — same outcome, the exact rejection logged', async () => {
    const rejection = new Error('connection reset');
    mockAuditRows = [auditRow('r1', NAMED)];
    mockFindNames.mockRejectedValue(rejection);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.logs).toHaveLength(1);
    expect(body.userLookup).toBe('failed');
    expect('users' in body.logs[0]).toBe(false);

    expect(mockChildFns.error).toHaveBeenCalledTimes(1);
    const [context, message] = mockChildFns.error.mock.calls[0] as [{ err?: unknown }, string];
    expect(message).toMatch(/user name lookup threw/i);
    expect(context.err).toBe(rejection);
  });
});

describe('the two lookups are independent (U-6)', () => {
  it('reports userLookup: ok on the happy path, with business names attached', async () => {
    mockAuditRows = [auditRow('r1', NAMED)];
    mockFindNames.mockResolvedValue({ data: [{ id: NAMED, full_name: PERSON }], error: null });
    mockFindIdentities.mockResolvedValue({
      data: [{ user_id: NAMED, company_name: COMPANY, vertical: 'health', sub_vertical: null }],
      error: null,
    });

    const body = await (await call()).json();

    expect(body.userLookup).toBe('ok');
    expect(body.businessLookup).toBe('ok');
    expect(body.logs[0].users).toEqual({ full_name: PERSON });
    expect(body.logs[0].business).toEqual({ company_name: COMPANY });
  });

  it('a failed name lookup leaves business names intact', async () => {
    mockAuditRows = [auditRow('r1', NAMED)];
    mockFindNames.mockResolvedValue({ data: null, error: new Error('boom') });
    mockFindIdentities.mockResolvedValue({
      data: [{ user_id: NAMED, company_name: COMPANY, vertical: 'health', sub_vertical: null }],
      error: null,
    });

    const body = await (await call()).json();

    expect(body.userLookup).toBe('failed');
    expect(body.businessLookup).toBe('ok');
    expect(body.logs[0].business).toEqual({ company_name: COMPANY });
  });

  it('a failed business lookup leaves person names intact', async () => {
    mockAuditRows = [auditRow('r1', NAMED)];
    mockFindNames.mockResolvedValue({ data: [{ id: NAMED, full_name: PERSON }], error: null });
    mockFindIdentities.mockRejectedValue(new Error('boom'));

    const body = await (await call()).json();

    expect(body.userLookup).toBe('ok');
    expect(body.businessLookup).toBe('failed');
    expect(body.logs[0].users).toEqual({ full_name: PERSON });
  });
});

/**
 * U-7: no person's name in any log line. The paths that can actually fail this
 * are the ones where names were LOADED and something then logs: the happy-path
 * debug line, and a business lookup that fails or throws afterwards (SA W4-3a).
 * Each of those first proves the name really flowed through the request.
 */
describe('U-7 — person names are never logged', () => {
  const namesLoaded = () =>
    mockFindNames.mockResolvedValue({
      data: [
        { id: NAMED, full_name: PERSON },
        { id: PADDED, full_name: `  ${PADDED_PERSON}  ` },
      ],
      error: null,
    });

  it.each([
    ['the happy path', () => mockFindIdentities.mockResolvedValue({ data: [], error: null })],
    [
      'names loaded, business lookup returns an error',
      () => mockFindIdentities.mockResolvedValue({ data: null, error: new Error('business read failed') }),
    ],
    ['names loaded, business lookup throws', () => mockFindIdentities.mockRejectedValue(new Error('socket hang up'))],
  ])('%s', async (_label, arrangeBusiness) => {
    mockAuditRows = [auditRow('r1', NAMED), auditRow('r2', PADDED)];
    namesLoaded();
    arrangeBusiness();

    const body = await (await call()).json();
    const byId = Object.fromEntries(body.logs.map((l: { id: string }) => [l.id, l]));
    expect(byId.r1.users).toEqual({ full_name: PERSON });
    expect(byId.r2.users).toEqual({ full_name: PADDED_PERSON });

    expect(allLogArgs().length).toBeGreaterThan(0);
    const logged = flattenedLogs();
    expect(logged).not.toContain(PERSON);
    expect(logged).not.toContain(PADDED_PERSON);
  });

  it.each([
    ['the name lookup returns an error', () => mockFindNames.mockResolvedValue({ data: null, error: new Error('x') })],
    ['the name lookup throws', () => mockFindNames.mockRejectedValue(new Error('y'))],
  ])('%s', async (_label, arrangeNames) => {
    mockAuditRows = [auditRow('r1', NAMED)];
    arrangeNames();

    await call();

    expect(flattenedLogs()).not.toContain(PERSON);
  });
});

describe('U-8 — the route never reads `users`', () => {
  it.each([
    ['a named page', () => mockFindNames.mockResolvedValue({ data: NAME_ROWS, error: null })],
    ['a failed name lookup', () => mockFindNames.mockResolvedValue({ data: null, error: new Error('x') })],
    ['a thrown name lookup', () => mockFindNames.mockRejectedValue(new Error('y'))],
  ])('%s: the inline client is asked for audit_trail only', async (_label, arrange) => {
    mockAuditRows = [auditRow('r1', NAMED), auditRow('r2', NO_PROFILE)];
    arrange();

    await call();

    expect(mockFromTables).toEqual(['audit_trail']);
  });

  it('an empty page: audit_trail only', async () => {
    await call();
    expect(mockFromTables).toEqual(['audit_trail']);
  });
});

describe('U-9 — the failure carries the request correlation id', () => {
  it('binds the request header to the child logger, and logs the failure on that child', async () => {
    const dbError = new Error('boom');
    mockAuditRows = [auditRow('r1', NAMED)];
    mockFindNames.mockResolvedValue({ data: null, error: dbError });

    await call();

    expect(mockChild).toHaveBeenCalledWith(expect.objectContaining({ correlationId: CORRELATION_ID }));
    expect(mockChildFns.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: dbError }),
      expect.stringMatching(/user name lookup failed/i)
    );
    // Not on the module logger, which has no correlation id.
    expect(mockRootFns.error).not.toHaveBeenCalled();
  });
});
