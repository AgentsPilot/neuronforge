/**
 * GET /api/admin/agents — admin-gated cross-user agent list for the calibration
 * test picker. Covers auth (401), admin gate (403), happy path + owner-email
 * enrichment, and non-fatal enrichment failure.
 */

const getUser = jest.fn();
jest.mock('@/lib/supabaseServerAuth', () => ({
  createAuthenticatedServerClient: async () => ({ auth: { getUser: () => getUser() } }),
}));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

const findAllForAdmin = jest.fn();
jest.mock('@/lib/repositories/AgentRepository', () => ({
  AgentRepository: jest.fn().mockImplementation(() => ({
    findAllForAdmin: (o: unknown) => findAllForAdmin(o),
  })),
}));

const listUsers = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { auth: { admin: { listUsers: (o: unknown) => listUsers(o) } } },
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';

function makeRequest(qs = '') {
  return new NextRequest(`http://localhost/api/admin/agents${qs}`, { method: 'GET' });
}

describe('GET /api/admin/agents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listUsers.mockResolvedValue({ data: { users: [] } });
  });

  it('returns 401 when not authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(findAllForAdmin).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u2', email: 'u2@x.com' } }, error: null });
    isAdmin.mockResolvedValue(false);

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(findAllForAdmin).not.toHaveBeenCalled();
  });

  it('returns 200 with agents + owner-email enrichment for an admin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@x.com' } }, error: null });
    isAdmin.mockResolvedValue(true);
    findAllForAdmin.mockResolvedValue({
      data: [{ id: 'a1', agent_name: 'Leads', user_id: 'owner1' }],
      error: null,
    });
    listUsers.mockResolvedValue({ data: { users: [{ id: 'owner1', email: 'owner@x.com' }] } });

    const res = await GET(makeRequest('?search=lead&limit=10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].owner_email).toBe('owner@x.com');
    expect(findAllForAdmin).toHaveBeenCalledWith({ search: 'lead', limit: 10 });
  });

  it('still returns 200 (owner_email null) when enrichment fails', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@x.com' } }, error: null });
    isAdmin.mockResolvedValue(true);
    findAllForAdmin.mockResolvedValue({ data: [{ id: 'a1', agent_name: 'X', user_id: 'owner1' }], error: null });
    listUsers.mockRejectedValue(new Error('auth admin down'));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].owner_email).toBeNull();
  });

  it('clamps the limit to the 1..500 range', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@x.com' } }, error: null });
    isAdmin.mockResolvedValue(true);
    findAllForAdmin.mockResolvedValue({ data: [], error: null });

    await GET(makeRequest('?limit=99999'));
    expect(findAllForAdmin).toHaveBeenCalledWith({ search: undefined, limit: 500 });
  });
});
