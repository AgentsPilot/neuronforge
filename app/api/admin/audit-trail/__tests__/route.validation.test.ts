/**
 * GET /api/admin/audit-trail — query validation and the error-detail guard.
 *
 * Auth is deliberately NOT re-tested here: app/api/admin/__tests__/
 * auditAdminGate.test.ts already drives this route through 401 / 403 /
 * admin-check-throws / 200 and asserts no table is read before the gate passes.
 * The one auth-adjacent case below is the ORDERING one, which nothing covered:
 * a non-admin sending an invalid query must still get 403, not 400.
 *
 * The date cases are the load-bearing ones. The page's inputs are
 * `type="datetime-local"`, so they emit `2026-09-01T10:00` — which
 * z.string().datetime() rejects. Validating those away, or "helpfully"
 * normalising them to UTC, breaks both existing date filters while a test that
 * only asserts a 200 stays green. So the tests assert the value reaches .gte()
 * BYTE-FOR-BYTE.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

/** Tables read, in order: proves whether the route reached the database. */
const mockTablesRead: string[] = [];
/** Every PostgREST builder call, so filters can be asserted by name and argument. */
const mockBuilderCalls: Array<{ method: string; args: unknown[] }> = [];
/** When set, the audit_trail query resolves with this error instead of rows. */
let mockQueryError: { message: string } | null = null;

jest.mock('@supabase/supabase-js', () => {
  const builder = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) =>
              resolve(
                mockQueryError
                  ? { data: null, error: mockQueryError, count: null }
                  : { data: [], error: null, count: 0 }
              );
          }
          return (...args: unknown[]) => {
            mockBuilderCalls.push({ method: String(prop), args });
            return builder();
          };
        },
      }
    );
  return {
    createClient: () => ({
      from: (table: string) => {
        mockTablesRead.push(table);
        return builder();
      },
    }),
  };
});

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

const call = (query: string) =>
  GET(new NextRequest(`http://localhost/api/admin/audit-trail${query}`));

const callsTo = (method: string) => mockBuilderCalls.filter((c) => c.method === method).map((c) => c.args);

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
/** NODE_ENV is read at request time, so each test can set it. */
const setNodeEnv = (value: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockTablesRead.length = 0;
  mockBuilderCalls.length = 0;
  mockQueryError = null;
  setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
});

afterAll(() => setNodeEnv(ORIGINAL_NODE_ENV ?? 'test'));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

describe('accepted queries', () => {
  it('filters to AI actions by action and entity type (the Slice A happy path)', async () => {
    asAdmin();
    const res = await call('?action=BUSINESS_AI_ACTION_COMPLETED&entity_type=ai_action&page=1&page_size=20');

    expect(res.status).toBe(200);
    expect(mockTablesRead).toContain('audit_trail');
    expect(callsTo('eq')).toEqual(
      expect.arrayContaining([
        ['action', 'BUSINESS_AI_ACTION_COMPLETED'],
        ['entity_type', 'ai_action'],
      ])
    );
  });

  it('keeps the "all" sentinel meaning "no filter"', async () => {
    asAdmin();
    const res = await call('?action=all&entity_type=all&severity=all&page=1');

    expect(res.status).toBe(200);
    expect(callsTo('eq')).toEqual([]);
  });

  it('accepts a well-formed action that is NOT in the catalogue', async () => {
    // A read filter is not a security boundary, and the live table holds values
    // that were never registered (AGENT_EXECUTED was one until this cycle). An
    // AUDIT_EVENTS enum here would make those rows unreachable in a compliance
    // browser — a regression that no other test would catch.
    asAdmin();
    const res = await call('?action=SOME_LEGACY_EVENT');

    expect(res.status).toBe(200);
    expect(callsTo('eq')).toContainEqual(['action', 'SOME_LEGACY_EVENT']);
  });

  it('accepts a datetime-local value and passes it through unchanged', async () => {
    asAdmin();
    const res = await call('?date_from=2026-09-01T10%3A00&date_to=2026-09-02T18%3A30');

    expect(res.status).toBe(200);
    // Byte-for-byte: created_at is timestamptz, and normalising to ISO/UTC here
    // would silently shift every existing date filter by the server's offset.
    expect(callsTo('gte')).toContainEqual(['created_at', '2026-09-01T10:00']);
    expect(callsTo('lte')).toContainEqual(['created_at', '2026-09-02T18:30']);
  });

  it('still accepts a full ISO timestamp', async () => {
    asAdmin();
    const res = await call('?date_from=2026-09-01T10%3A00%3A00.000Z');

    expect(res.status).toBe(200);
    expect(callsTo('gte')).toContainEqual(['created_at', '2026-09-01T10:00:00.000Z']);
  });

  it('applies the defaults when nothing is sent', async () => {
    asAdmin();
    const res = await call('');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 50 });
  });
});

describe('rejected queries', () => {
  it('rejects a non-numeric page with 400, before any read', async () => {
    // This used to be parseInt('abc') -> NaN -> .range(NaN, NaN) -> a 500.
    asAdmin();
    const res = await call('?page=abc');

    expect(res.status).toBe(400);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('rejects a date that is not a date', async () => {
    asAdmin();
    const res = await call('?date_from=notadate');

    expect(res.status).toBe(400);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('rejects an action that is not a well-formed identifier', async () => {
    asAdmin();
    const res = await call('?action=' + encodeURIComponent("AGENT_CREATED' OR 1=1"));

    expect(res.status).toBe(400);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('rejects an unknown severity', async () => {
    asAdmin();
    const res = await call('?severity=catastrophic');

    expect(res.status).toBe(400);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('rejects a page size above the cap', async () => {
    asAdmin();
    const res = await call('?page_size=5000');

    expect(res.status).toBe(400);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('returns 403 — not 400 — for a non-admin sending an invalid query', async () => {
    // The gate runs first and the parse second. The natural tidy-up ("validate
    // at the top of the handler") inverts this and tells an unauthorised caller
    // what this route validates.
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call('?page=abc&date_from=notadate');

    expect(res.status).toBe(403);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('returns 401 — not 400 — for a signed-out caller sending an invalid query', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call('?page=abc');

    expect(res.status).toBe(401);
    expect(mockIsAdmin).not.toHaveBeenCalled();
    expect(mockTablesRead).toHaveLength(0);
  });
});

describe('error details never leak outside development', () => {
  const SECRET = 'relation "audit_trail" does not exist: connection string postgres://u:p@host';

  it('returns a fixed message in production, with the detail nowhere in the body', async () => {
    asAdmin();
    setNodeEnv('production');
    mockQueryError = { message: SECRET };

    const res = await call('?page=1');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch audit logs');
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('does not exist');
  });

  it('keeps the detail available in development', async () => {
    asAdmin();
    setNodeEnv('development');
    mockQueryError = { message: SECRET };

    const res = await call('?page=1');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch audit logs');
    expect(body.details).toBe(SECRET);
  });

  it('does not reflect the validation issue back in production', async () => {
    asAdmin();
    setNodeEnv('production');

    const res = await call('?page=abc');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid query parameters');
    expect(body.details).toBeUndefined();
  });

  it('reflects the validation issue in development', async () => {
    asAdmin();
    setNodeEnv('development');

    const res = await call('?page=abc');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(typeof body.details).toBe('string');
    expect(body.details.length).toBeGreaterThan(0);
  });
});

// ─── Slice 2c: one account's rows, and the dropdown's hidden events ───────────

describe('the account filter (user_id)', () => {
  const ACCOUNT = '99999999-9999-4999-8999-999999999999';

  it('filters to one account when user_id is a UUID', async () => {
    asAdmin();
    const res = await call(`?action=BUSINESS_AI_ACTION_FAILED&user_id=${ACCOUNT}`);

    expect(res.status).toBe(200);
    expect(callsTo('eq')).toEqual(
      expect.arrayContaining([
        ['action', 'BUSINESS_AI_ACTION_FAILED'],
        ['user_id', ACCOUNT],
      ])
    );
  });

  it('rejects a user_id that is not a UUID with 400, before any read', async () => {
    asAdmin();
    const res = await call('?user_id=abc');

    expect(res.status).toBe(400);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('returns 403 — not 400 — for a non-admin sending a bad user_id', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call('?user_id=abc');

    expect(res.status).toBe(403);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('still filters by an event the operator dropdown hides (the route knows nothing of audiences)', async () => {
    asAdmin();
    const res = await call('?action=AGENT_CREATED');

    expect(res.status).toBe(200);
    expect(callsTo('eq')).toContainEqual(['action', 'AGENT_CREATED']);
  });
});
