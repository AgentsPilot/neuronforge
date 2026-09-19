/**
 * The three admin audit reads are admin-only (Layer 3 step 0, Q-3, FR-23):
 * 401 signed out, 403 for a signed-in non-admin (or a failing admin check),
 * and the read runs only for an admin. Admin identity comes from
 * AdminAccessService, never a user-writable role.
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
jest.mock('@supabase/supabase-js', () => {
  // A PostgREST builder that accepts any chain and resolves to an empty result.
  const builder = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
          }
          return () => builder();
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

import { GET as auditTrailGET } from '../audit-trail/route';
import { GET as userAuditLogsGET } from '../users/[id]/audit-logs/route';
import { GET as loginStatsGET } from '../users/[id]/login-stats/route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const TARGET = '99999999-9999-4999-8999-999999999999';
const ctx = { params: { id: TARGET } };

const routes: Array<[string, () => Promise<Response>]> = [
  ['/api/admin/audit-trail', () => auditTrailGET(new NextRequest('http://localhost/api/admin/audit-trail?page=1'))],
  ['/api/admin/users/[id]/audit-logs', () => userAuditLogsGET(new NextRequest(`http://localhost/api/admin/users/${TARGET}/audit-logs`), ctx)],
  ['/api/admin/users/[id]/login-stats', () => loginStatsGET(new Request(`http://localhost/api/admin/users/${TARGET}/login-stats`), ctx)],
];

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockTablesRead.length = 0;
});

describe.each(routes)('%s', (_name, call) => {
  it('returns 401 when signed out, before any read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockIsAdmin).not.toHaveBeenCalled();
    expect(mockTablesRead).toHaveLength(0);
  });

  it('returns 403 for a signed-in non-admin, before any read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockIsAdmin).toHaveBeenCalledWith({ id: OWNER.id, email: OWNER.email });
    expect(mockTablesRead).toHaveLength(0);
  });

  it('fails closed with 403 when the admin check throws', async () => {
    mockGetUser.mockResolvedValue(ADMIN);
    mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockTablesRead).toHaveLength(0);
  });

  it('reads the audit data for an admin', async () => {
    mockGetUser.mockResolvedValue(ADMIN);
    mockIsAdmin.mockResolvedValue(true);
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockTablesRead).toContain('audit_trail');
  });
});
