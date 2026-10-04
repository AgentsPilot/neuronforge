/**
 * GET /api/admin/audit-trail — search, filters and person names together
 * (ADMIN_BOS_CLEANUP slice 4, QA 2026-10-04).
 *
 * Slice 4 changed the search placeholder to "Search by email, action, resource
 * or entity ID…" (FR-AT3). No route test exercised the in-memory search, so the
 * placeholder's claims rested on reading the code. This suite pins them:
 *
 *  Q-1  search matches `user_email`, `action`, `resource_name` and `entity_id`
 *       (case-insensitive), and the matched rows still carry their person name.
 *  Q-2  search does NOT match a person's name (names are attached after
 *       filtering), which is why the placeholder does not offer "name".
 *  Q-3  the name lookup receives only the ids of the rows that survived search.
 *  Q-4  a non-empty page whose rows have no `user_id` makes no name lookup and
 *       serves `users: null` with `userLookup: 'ok'`.
 *  Q-5  the account filter (`user_id`) still reaches the query, and the filtered
 *       rows carry the person name.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

jest.mock('@/lib/logger', () => {
  const log: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  log.child = () => log;
  return { createLogger: () => log };
});

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

let mockAuditRows: Array<Record<string, unknown>> = [];
/** Every builder method call on the inline client, as [method, ...args]. */
const mockCalls: unknown[][] = [];

jest.mock('@supabase/supabase-js', () => {
  const builder = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) =>
              resolve({ data: mockAuditRows, error: null, count: mockAuditRows.length });
          }
          return (...args: unknown[]) => {
            mockCalls.push([String(prop), ...args]);
            return builder();
          };
        },
      }
    );
  return { createClient: () => ({ from: () => builder() }) };
});

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const DANA = '2f734ed5-3681-4049-880d-3de7b096bea3';
const AVI = '33333333-3333-4333-8333-333333333333';

const row = (id: string, userId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: userId,
  user_email: null,
  action: 'SOMETHING_HAPPENED',
  entity_type: 'thing',
  entity_id: `e-${id}`,
  resource_name: null,
  details: null,
  changes: null,
  severity: 'info',
  created_at: '2026-09-28T10:00:00.000Z',
  compliance_flags: [],
  ...extra,
});

const ROWS = [
  row('by-email', DANA, { user_email: 'dana@clinic.test' }),
  row('by-action', AVI, { action: 'SECURITY_UNAUTHORIZED_ACCESS' }),
  row('by-resource', DANA, { resource_name: 'Invoice Template Alpha' }),
  row('by-entity', AVI, { entity_id: 'ENT-7f3c-unique' }),
  row('noise', AVI),
];

const NAMES = [
  { id: DANA, full_name: 'Dana Cohen' },
  { id: AVI, full_name: 'Avi Levi' },
];

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/admin/audit-trail?page=1&page_size=20&${qs}`));

beforeEach(() => {
  mockGetUser.mockReset().mockResolvedValue(ADMIN);
  mockIsAdmin.mockReset().mockResolvedValue(true);
  mockFindIdentities.mockReset().mockResolvedValue({ data: [], error: null });
  mockFindNames.mockReset().mockImplementation(async (ids: string[]) => ({
    data: NAMES.filter((n) => ids.includes(n.id)),
    error: null,
  }));
  mockCalls.length = 0;
  mockAuditRows = ROWS;
});

describe('Q-1 — search matches the fields the placeholder names, and names still attach', () => {
  it.each([
    ['email', 'DANA@CLINIC', 'by-email', 'Dana Cohen'],
    ['action', 'unauthorized_access', 'by-action', 'Avi Levi'],
    ['resource', 'template alpha', 'by-resource', 'Dana Cohen'],
    ['entity ID', 'ent-7f3c', 'by-entity', 'Avi Levi'],
  ])('%s', async (_field, term, expectedId, expectedName) => {
    const body = await (await get(`search=${encodeURIComponent(term)}`)).json();

    expect(body.success).toBe(true);
    expect(body.logs.map((l: { id: string }) => l.id)).toEqual([expectedId]);
    expect(body.logs[0].users).toEqual({ full_name: expectedName });
    expect(body.userLookup).toBe('ok');
  });
});

describe('Q-2 — search does not match a person name', () => {
  it('a name that is on the rows finds nothing', async () => {
    const body = await (await get('search=Cohen')).json();

    expect(body.success).toBe(true);
    expect(body.logs).toEqual([]);
    expect(mockFindNames).not.toHaveBeenCalled();
  });
});

describe('Q-3 — the name lookup sees only the rows that survived search', () => {
  it('passes only the matched row’s account id', async () => {
    await get('search=dana%40clinic');

    expect(mockFindNames).toHaveBeenCalledTimes(1);
    expect(mockFindNames.mock.calls[0][0]).toEqual([DANA]);
  });
});

describe('Q-4 — a page whose rows have no user_id', () => {
  it('makes no name lookup, serves users: null, and reports ok', async () => {
    mockAuditRows = [row('sys-1', null), row('sys-2', null)];

    const body = await (await get('')).json();

    expect(body.logs).toHaveLength(2);
    expect(mockFindNames).not.toHaveBeenCalled();
    for (const log of body.logs) {
      expect('users' in log).toBe(true);
      expect(log.users).toBeNull();
    }
    expect(body.userLookup).toBe('ok');
  });
});

describe('Q-5 — the account filter combined with names', () => {
  it('filters by user_id in the query and the rows carry the name', async () => {
    mockAuditRows = [row('d1', DANA), row('d2', DANA)];

    const body = await (await get(`user_id=${DANA}&severity=info`)).json();

    expect(mockCalls).toEqual(expect.arrayContaining([['eq', 'user_id', DANA], ['eq', 'severity', 'info']]));
    expect(mockFindNames).toHaveBeenCalledTimes(1);
    expect(mockFindNames.mock.calls[0][0]).toEqual([DANA]);
    for (const log of body.logs) expect(log.users).toEqual({ full_name: 'Dana Cohen' });
  });
});
