/**
 * QA (admin reorganisation slice 2b): PostgREST filter injection through the
 * Businesses list search, tested at the WIRE.
 *
 * The existing route test mocks the repositories, and the repository test
 * records builder calls. This suite runs the real route over the REAL
 * repositories and the REAL supabase-js client, with only `fetch` replaced, so
 * it asserts what would actually be sent to PostgREST: every search term must
 * arrive as the operand of one single-operator filter, and no hostile string may
 * add a parameter (`or=`, `id=`, `and=` …) that the code did not write.
 */

import { NextRequest } from 'next/server';

type Captured = { url: URL; method: string };
const mockRequests: Captured[] = [];

/** Every request goes here: PostgREST reads return [], the auth admin API an empty page. */
const mockFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  mockRequests.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
  const body = url.pathname.startsWith('/auth/v1/admin/users') ? { users: [], aud: 'authenticated' } : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
});

// supabase-js captures `fetch` when a client is created, so it is installed
// before any module that creates one is loaded.
(globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

jest.mock('@/lib/supabaseServer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ES imports
  const { createClient } = require('@supabase/supabase-js');
  return {
    supabaseServer: createClient('http://pg.test', 'service-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (...args: unknown[]) => (globalThis.fetch as (...a: unknown[]) => unknown)(...args) },
    }),
  };
});

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

// Loaded after the fetch stub, on purpose.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../route') as typeof import('../route');

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

const call = (search: string) =>
  GET(new NextRequest(`http://localhost/api/admin/users?search=${encodeURIComponent(search)}`));

const restReads = () => mockRequests.filter((r) => r.url.pathname.startsWith('/rest/v1/'));

/** The parameter names the route + repositories are allowed to send. */
const ALLOWED_PARAMS = new Set(['select', 'full_name', 'company', 'company_name', 'id', 'order', 'limit', 'offset']);

/**
 * What the repository must send for a term: `ilike.%<escaped>%`. A `*` is sent
 * as `_` (Dev, QA E-1 fix): PostgREST turns every `*` into `%`, so it cannot
 * be sent as itself; the repository then keeps only literal matches.
 */
const escaped = (term: string) =>
  `ilike.%${term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/\*/g, '_')}%`;

beforeEach(() => {
  mockRequests.length = 0;
  mockFetch.mockClear();
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
});

const HOSTILE = [
  ['comma', 'acme,id.neq.0'],
  ['closing parenthesis', 'acme)'],
  ['opening parenthesis', '(acme'],
  ['or= group', 'or=(id.neq.0)'],
  ['full .or() breakout', 'acme%),id.neq.(x'],
  ['logic tree', 'x,and(id.gt.0,id.lt.z)'],
  ['percent', '%'],
  ['underscore', '_'],
  ['backslash', 'a\\b'],
  ['asterisk', '*'],
  ['ampersand + extra param', 'x&or=(id.gt.0)&id=eq.1'],
  ['double quotes', '"acme","x"'],
  ['pre-encoded comma', 'acme%2Cid.neq.0'],
  ['dotted operator', 'full_name.eq.x'],
] as const;

describe('hostile search terms reach PostgREST only as single-operator operands', () => {
  it.each(HOSTILE)('%s: %s', async (_name, term) => {
    const res = await call(term);
    expect(res.status).toBe(200);

    const reads = restReads();
    // business-name search + full_name ILIKE + company ILIKE (no UUID, no business match).
    expect(reads.map((r) => r.url.pathname).sort()).toEqual([
      '/rest/v1/business_profiles',
      '/rest/v1/profiles',
      '/rest/v1/profiles',
    ]);

    for (const { url, method } of reads) {
      expect(method).toBe('GET');
      const keys = [...url.searchParams.keys()];
      // No parameter the code did not write: in particular no `or`/`and`.
      for (const key of keys) expect(ALLOWED_PARAMS).toContain(key);
      expect(keys).not.toContain('or');
      expect(keys).not.toContain('and');
      // Never a wildcard select.
      expect(url.searchParams.get('select')).not.toBe('*');
    }

    // The term arrives byte-for-byte as ONE ilike operand, escaped.
    const operands = reads.flatMap(({ url }) =>
      ['full_name', 'company', 'company_name'].flatMap((col) => url.searchParams.getAll(col))
    );
    expect(operands).toEqual([escaped(term), escaped(term), escaped(term)]);
    // And no `id` filter was added by a non-UUID term.
    for (const { url } of reads) expect(url.searchParams.getAll('id')).toEqual([]);
  });

  it('a full account id adds exactly one id=eq.<uuid> read, nothing else', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect((await call(id)).status).toBe(200);
    const idFilters = restReads().flatMap(({ url }) => url.searchParams.getAll('id'));
    expect(idFilters).toEqual([`eq.${id}`]);
  });

  it('a UUID followed by filter syntax is NOT treated as an id', async () => {
    expect((await call('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,id.neq.0')).status).toBe(200);
    expect(restReads().flatMap(({ url }) => url.searchParams.getAll('id'))).toEqual([]);
  });
});

describe('validation before any read', () => {
  it.each([
    ['101 characters', 'x'.repeat(101)],
    ['a control character', 'acme\u0000'],
    ['a newline', 'acme\nid=eq.1'],
  ])('400 for %s, with no request sent', async (_name, term) => {
    const res = await call(term);
    expect(res.status).toBe(400);
    expect(mockRequests).toHaveLength(0);
  });

  it('401 signed out with a hostile search: no request of any kind is sent', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call('acme,id.neq.0')).status).toBe(401);
    expect(mockRequests).toHaveLength(0);
  });

  it('403 for a non-admin with a hostile search: no request of any kind is sent', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('acme,id.neq.0')).status).toBe(403);
    expect(mockRequests).toHaveLength(0);
  });
});
