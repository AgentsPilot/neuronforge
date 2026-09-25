/**
 * GET /api/admin/users — the Businesses list (admin reorganisation slice 2b).
 *
 * Pins what touching this route required (user decision, 2026-09-25): Zod on
 * the inputs, no error text in production, business names from ONE batched
 * read, and the search passed to the repository as data (the repository no
 * longer builds an `.or()` string from it).
 */

import * as fs from 'fs';
import * as path from 'path';
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

const mockListUsers = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { listUsers: () => mockListUsers() } } }),
}));

const mockListForAdmin = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { listForAdmin: (...a: unknown[]) => mockListForAdmin(...a) },
}));

const mockIdentities = jest.fn();
const mockSearchBusinesses = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findAdminIdentitiesByUserIds: (...a: unknown[]) => mockIdentities(...a),
    searchForAdmin: (...a: unknown[]) => mockSearchBusinesses(...a),
  },
}));

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const WITH_BUSINESS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WITHOUT_BUSINESS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/users${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const setNodeEnv = (value: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
  mockListForAdmin.mockResolvedValue({
    data: [
      { id: WITH_BUSINESS, full_name: 'Dana Cohen', company: null, created_at: '2026-09-01T00:00:00Z', updated_at: null },
      { id: WITHOUT_BUSINESS, full_name: 'Agent Only', company: null, created_at: '2026-08-01T00:00:00Z', updated_at: null },
    ],
    error: null,
  });
  mockIdentities.mockResolvedValue({
    data: [{ user_id: WITH_BUSINESS, company_name: 'Acme Therapy', vertical: 'therapist', sub_vertical: null }],
    error: null,
  });
  mockSearchBusinesses.mockResolvedValue({ data: [], error: null });
  mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });
});

afterAll(() => setNodeEnv(ORIGINAL_NODE_ENV ?? 'test'));

describe('gate', () => {
  it('401 signed out, before any read', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mockListForAdmin).not.toHaveBeenCalled();
  });

  it('403 for a non-admin, before any read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mockListForAdmin).not.toHaveBeenCalled();
  });
});

describe('the list', () => {
  it('returns each login with its business name, looked up in ONE batched read', async () => {
    asAdmin();
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockIdentities).toHaveBeenCalledTimes(1);
    expect(mockIdentities).toHaveBeenCalledWith([WITH_BUSINESS, WITHOUT_BUSINESS]);

    const byId = Object.fromEntries(body.data.map((u: { id: string }) => [u.id, u]));
    expect(byId[WITH_BUSINESS].business).toEqual({ companyName: 'Acme Therapy', vertical: 'therapist' });
    expect(byId[WITH_BUSINESS].full_name).toBe('Dana Cohen');
    expect(byId[WITHOUT_BUSINESS].business).toBeNull();
  });

  it('leaves business undefined (not null) when the lookup fails, so the page says "unknown"', async () => {
    asAdmin();
    mockIdentities.mockResolvedValue({ data: null, error: new Error('boom') });
    const body = await (await call()).json();
    expect(body.success).toBe(true);
    for (const u of body.data) expect(u).not.toHaveProperty('business');
  });

  it('passes the search to the repository as data, and adds accounts whose business name matched', async () => {
    asAdmin();
    mockSearchBusinesses.mockResolvedValue({ data: [{ user_id: WITH_BUSINESS, company_name: 'Acme' }], error: null });
    await call('?search=' + encodeURIComponent('acme%),id.neq.(x'));
    expect(mockListForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'acme%),id.neq.(x', extraIds: [WITH_BUSINESS] })
    );
  });
});

describe('validation and error detail', () => {
  it.each([['?status=everyone'], ['?sortBy=password'], ['?sortOrder=up'], ['?search=' + 'x'.repeat(101)], ['?search=%01']])(
    '400 for %s',
    async (query) => {
      asAdmin();
      const res = await call(query);
      expect(res.status).toBe(400);
      expect(mockListForAdmin).not.toHaveBeenCalled();
    }
  );

  it('does not send the database error text in production', async () => {
    asAdmin();
    setNodeEnv('production');
    mockListForAdmin.mockResolvedValue({ data: null, error: new Error('relation "profiles" secret detail') });
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });

  it('keeps the detail in development only', async () => {
    asAdmin();
    setNodeEnv('development');
    mockListForAdmin.mockResolvedValue({ data: null, error: new Error('dev detail') });
    const body = await (await call()).json();
    expect(body.details).toBe('dev detail');
  });
});

describe('source', () => {
  // Code only: the header comment names what was removed.
  const source = fs
    .readFileSync(path.join(process.cwd(), 'app/api/admin/users/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('has no console.* and no .or( filter string', () => {
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/\.or\(/);
  });
});
