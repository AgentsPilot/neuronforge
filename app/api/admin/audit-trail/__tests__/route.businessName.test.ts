/**
 * GET /api/admin/audit-trail — the business-name enrichment.
 *
 * Three things are load-bearing and none of them is visible from a 200:
 *
 *  1. It is ONE batched repository call for the page, not one per row. The
 *     single-user `findByUserId` would be N+1 on a 20-row page, which is why the
 *     already-chunked `findAdminIdentitiesByUserIds` is used instead. A later
 *     "simplification" to the per-user method would still return correct data
 *     and would still be green without this assertion.
 *  2. An account with NO business profile gets `business: null`, never a
 *     placeholder string. The page renders nothing for it, and a `''` or an
 *     '—' arriving from the route would defeat that.
 *  3. A failing lookup does not fail the request — for a returned error AND for
 *     a rejected promise. This page is the compliance browser; the audit rows
 *     are the point, the name is a convenience.
 *  4. A failed lookup is distinguishable from "no business": the row has no
 *     `business` key and the body carries `businessLookup: 'failed'`. A
 *     blanket `business: null` would tell an operator these accounts have no
 *     business when the truth is that the lookup broke.
 *  5. AC-B13 — no business name reaches any log line, on any path.
 *
 * Auth is not re-tested here — app/api/admin/__tests__/auditAdminGate.test.ts
 * drives this route through 401 / 403 / 200 and asserts nothing is read before
 * the gate passes.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

/**
 * A real spy per level, not a throwaway. AC-B13 says a business name appears in
 * NO log line, and the only way a future edit that logs one gets caught is if a
 * test reads what was actually passed to the logger.
 */
const mockLoggerFns = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('@/lib/logger', () => {
  // The route creates its logger at module load and `.child()`s it per request,
  // so both must land on the same spies.
  const logger: Record<string, unknown> = {
    info: (...args: unknown[]) => mockLoggerFns.info(...args),
    warn: (...args: unknown[]) => mockLoggerFns.warn(...args),
    error: (...args: unknown[]) => mockLoggerFns.error(...args),
    debug: (...args: unknown[]) => mockLoggerFns.debug(...args),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

/** Everything the route passed to the logger this test, across all levels. */
const allLogArgs = (): unknown[] =>
  [mockLoggerFns.info, mockLoggerFns.warn, mockLoggerFns.error, mockLoggerFns.debug].flatMap(
    (fn) => fn.mock.calls.flat()
  );

/** The batched read. Recorded by call so N+1 is detectable, not just wrong data. */
const mockFindIdentities = jest.fn();
/** Proves the single-user method is never reached from this route. */
const mockFindByUserId = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findAdminIdentitiesByUserIds: (...args: unknown[]) => mockFindIdentities(...args),
    findByUserId: (...args: unknown[]) => mockFindByUserId(...args),
  },
}));

/**
 * Person names (slice 4) are covered by route.userName.test.ts. Mocked here so
 * this suite stays about business names and never builds the real repository.
 */
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: {
    findAdminNamesByIds: async () => ({ data: [], error: null }),
  },
}));

/** Rows the mocked `audit_trail` select resolves with. */
let mockAuditRows: Array<Record<string, unknown>> = [];

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
  return { createClient: () => ({ from: (table: string) => builder(table) }) };
});

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const BUSINESS_ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const PLATFORM_ACCOUNT = '99999999-9999-4999-8999-999999999999';

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

const call = () => GET(new NextRequest('http://localhost/api/admin/audit-trail?page=1&page_size=20'));

beforeEach(() => {
  mockGetUser.mockReset().mockResolvedValue(ADMIN);
  mockIsAdmin.mockReset().mockResolvedValue(true);
  mockFindIdentities.mockReset().mockResolvedValue({ data: [], error: null });
  mockFindByUserId.mockReset();
  mockLoggerFns.info.mockReset();
  mockLoggerFns.warn.mockReset();
  mockLoggerFns.error.mockReset();
  mockLoggerFns.debug.mockReset();
  mockAuditRows = [];
});

describe('business name enrichment', () => {
  it('attaches company_name to every row of the account it belongs to', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT), auditRow('r2', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({
      data: [{ user_id: BUSINESS_ACCOUNT, company_name: 'Acme Dental', vertical: 'health', sub_vertical: null }],
      error: null,
    });

    const body = await (await call()).json();

    expect(body.success).toBe(true);
    expect(body.logs).toHaveLength(2);
    for (const log of body.logs) {
      expect(log.business).toEqual({ company_name: 'Acme Dental' });
    }
  });

  it('reads the whole page in ONE batched repository call, never one per row', async () => {
    mockAuditRows = [
      auditRow('r1', BUSINESS_ACCOUNT),
      auditRow('r2', BUSINESS_ACCOUNT),
      auditRow('r3', PLATFORM_ACCOUNT),
    ];

    await call();

    expect(mockFindIdentities).toHaveBeenCalledTimes(1);
    // Deduplicated by the route's existing unique-user-id set.
    const [ids] = mockFindIdentities.mock.calls[0] as [string[]];
    expect([...ids].sort()).toEqual([BUSINESS_ACCOUNT, PLATFORM_ACCOUNT].sort());
    // The N+1 shape must stay unreachable from this route.
    expect(mockFindByUserId).not.toHaveBeenCalled();
  });

  it('gives an account with no business profile business: null, not a placeholder', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT), auditRow('r2', PLATFORM_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({
      data: [{ user_id: BUSINESS_ACCOUNT, company_name: 'Acme Dental', vertical: 'health', sub_vertical: null }],
      error: null,
    });

    const body = await (await call()).json();

    const byId = Object.fromEntries(body.logs.map((l: { id: string }) => [l.id, l]));
    expect(byId.r1.business).toEqual({ company_name: 'Acme Dental' });
    expect(byId.r2.business).toBeNull();
  });

  it('carries a null company_name through rather than inventing one', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({
      data: [{ user_id: BUSINESS_ACCOUNT, company_name: null, vertical: 'health', sub_vertical: null }],
      error: null,
    });

    const body = await (await call()).json();

    expect(body.logs[0].business).toEqual({ company_name: null });
  });

  it('does not look up business names when the page is empty', async () => {
    mockAuditRows = [];

    const body = await (await call()).json();

    expect(body.logs).toEqual([]);
    expect(mockFindIdentities).not.toHaveBeenCalled();
  });

  it('reports businessLookup: ok on the happy path', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({
      data: [{ user_id: BUSINESS_ACCOUNT, company_name: 'Acme Dental', vertical: 'health', sub_vertical: null }],
      error: null,
    });

    const body = await (await call()).json();

    expect(body.businessLookup).toBe('ok');
  });
});

/**
 * A failed lookup must not be served as "this account has no business". Both
 * shapes below (an error result, and a rejected promise) produce rows with NO
 * `business` key plus `businessLookup: 'failed'` — not `business: null`, which
 * is byte-identical to a legitimate agent-platform row.
 */
describe('when the name lookup fails', () => {
  it('serves the audit rows anyway, and says the business is unknown rather than absent', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({ data: null, error: new Error('boom') });

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.logs).toHaveLength(1);
    expect(body.businessLookup).toBe('failed');
    // undefined is dropped by JSON serialisation: the key is absent, and
    // absent !== null. A regression to `null` would pass `toBeFalsy()`, so
    // assert the key itself.
    expect('business' in body.logs[0]).toBe(false);
  });

  it('logs the failure at error level', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({ data: null, error: new Error('boom') });

    await call();

    expect(mockLoggerFns.error).toHaveBeenCalledTimes(1);
    const [context, message] = mockLoggerFns.error.mock.calls[0] as [{ err?: unknown }, string];
    expect(message).toMatch(/business name lookup failed/i);
    expect(context.err).toBeInstanceOf(Error);
  });

  it('survives a REJECTED lookup, not only an error result', async () => {
    // The repository returns its failures today, so this path is unreachable
    // through it — which is the point. The route's "a name failure is not
    // fatal" posture must not depend on another file's internals: without the
    // try/catch this returns 500 and the audit rows are lost.
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockRejectedValue(new Error('connection reset'));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.logs).toHaveLength(1);
    expect(body.businessLookup).toBe('failed');
    expect('business' in body.logs[0]).toBe(false);

    expect(mockLoggerFns.error).toHaveBeenCalledTimes(1);
    const [, message] = mockLoggerFns.error.mock.calls[0] as [unknown, string];
    expect(message).toMatch(/business name lookup threw/i);
  });
});

/**
 * AC-B13: a business name appears in NO log line. Compliance was verified by
 * hand at review time; this pins it, so an added `companyName` in a log payload
 * fails here instead of shipping.
 */
describe('AC-B13 — business names are never logged', () => {
  const COMPANY = 'Acme Dental';

  it('keeps the name out of every log payload on the happy path', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT), auditRow('r2', PLATFORM_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({
      data: [{ user_id: BUSINESS_ACCOUNT, company_name: COMPANY, vertical: 'health', sub_vertical: null }],
      error: null,
    });

    const body = await (await call()).json();
    // The name really did flow through this request — otherwise the assertion
    // below would pass for the wrong reason.
    expect(body.logs[0].business).toEqual({ company_name: COMPANY });

    const logged = allLogArgs();
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain(COMPANY);
  });

  it('keeps it out when the lookup fails', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockResolvedValue({ data: null, error: new Error('permission denied') });

    await call();

    // JSON.stringify(new Error(...)) is '{}', so unwrap any Error's message
    // before searching — otherwise this assertion could not see a name that
    // arrived inside the failure itself. (The route logs `err` verbatim, so
    // keeping owner data out of repository error text is the repository's job;
    // nothing this route does can launder it.)
    const flattened = JSON.stringify(
      allLogArgs().map((arg) => (arg instanceof Error ? arg.message : arg))
    );
    expect(flattened).not.toContain(COMPANY);
  });

  it('keeps it out when the lookup throws', async () => {
    mockAuditRows = [auditRow('r1', BUSINESS_ACCOUNT)];
    mockFindIdentities.mockRejectedValue(new Error('connection reset'));

    await call();

    expect(JSON.stringify(allLogArgs())).not.toContain(COMPANY);
  });
});
