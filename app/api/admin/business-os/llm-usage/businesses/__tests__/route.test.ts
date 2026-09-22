/**
 * GET /api/admin/business-os/llm-usage/businesses — Layer 1.1 AC-1, AC-2, AC-3, AC-15.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

const logs: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: unknown, msg: unknown) => logs.push({ level, ctx, msg });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const searchForAdmin = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { searchForAdmin: (...a: unknown[]) => searchForAdmin(...a) },
}));

import { GET } from '../route';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };
const ZERO = '00000000-0000-0000-0000-000000000000';
const SYS = '22222222-2222-4222-8222-222222222222';

function req(search?: string) {
  const qs = search === undefined ? '' : `?${new URLSearchParams({ search }).toString()}`;
  return new NextRequest(`http://localhost/api/admin/business-os/llm-usage/businesses${qs}`, { method: 'GET' });
}

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  delete process.env.SYSTEM_ADMIN_USER_ID;
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  searchForAdmin.mockResolvedValue({
    data: [
      { user_id: 'u-1', company_name: 'Acme Coaching' },
      { user_id: 'u-2', company_name: null },
    ],
    error: null,
  });
});

describe('GET /api/admin/business-os/llm-usage/businesses', () => {
  it('401 when signed out', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(searchForAdmin).not.toHaveBeenCalled();
  });

  it('403 for a non-admin, logged at warn', async () => {
    isAdmin.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(searchForAdmin).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ level: 'warn', ctx: { userId: ADMIN.id } }));
  });

  it('403 when the admin check throws (fail closed)', async () => {
    isAdmin.mockRejectedValue(new Error('boom'));
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(searchForAdmin).not.toHaveBeenCalled();
  });

  it('403, not 400, for a non-admin with an over-long search', async () => {
    isAdmin.mockResolvedValue(false);
    const res = await GET(req('x'.repeat(101)));
    expect(res.status).toBe(403);
  });

  it('400 for a search over 100 characters, with no read', async () => {
    const res = await GET(req('x'.repeat(101)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Search must be at most 100 characters');
    expect(searchForAdmin).not.toHaveBeenCalled();
  });

  it('200 with ids and names only, capped at 50, plus the platform account ids', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    const res = await GET(req('  acme  '));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);

    expect(body).toEqual({
      success: true,
      data: {
        businesses: [
          { userId: 'u-1', companyName: 'Acme Coaching' },
          { userId: 'u-2', companyName: null },
        ],
        limit: 50,
        platformAccountIds: [ZERO, SYS],
        platformAccountEnvIgnored: false,
      },
    });
    expect(searchForAdmin).toHaveBeenCalledWith('acme', 50);
    expect(text).not.toMatch(/email|@/);
  });

  it('logs the search length, never the search text or names', async () => {
    await GET(req('Acme Coaching'));
    const served = logs.find((l) => l.msg === 'LLM usage business list served');
    expect(served?.level).toBe('info');
    expect(served?.ctx).toEqual({ adminUserId: ADMIN.id, searchLength: 13, resultCount: 2 });
    expect(JSON.stringify(logs)).not.toContain('Acme');
  });

  it('flags a non-UUID SYSTEM_ADMIN_USER_ID without returning it (WC-9)', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'weird-value';
    const res = await GET(req());
    const text = await res.text();
    expect(JSON.parse(text).data).toMatchObject({ platformAccountIds: [ZERO], platformAccountEnvIgnored: true });
    expect(text).not.toContain('weird-value');
    expect(logs.filter((l) => l.level === 'warn')).toHaveLength(1);
  });

  it('500 with a generic message when the repository fails', async () => {
    searchForAdmin.mockResolvedValue({ data: null, error: new Error('relation does not exist') });
    const res = await GET(req());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Could not load businesses' });
    expect(text).not.toContain('relation');
  });
});
