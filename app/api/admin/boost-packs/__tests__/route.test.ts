/**
 * /api/admin/boost-packs after the standards refactor (repository, Zod, Pino,
 * dev-only error details). Pins: the happy path of all four handlers with the
 * response shapes the admin page reads, a 403 from `requireAdmin` before any
 * repository call, a 400 for invalid bodies (and that unknown keys the page
 * posts are stripped, not rejected), and no internal error text outside
 * development. The full denial matrix (401 / 403 / fail-closed) lives in
 * `app/api/admin/__tests__/adminGate.writes.test.ts`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';

const mockRequireAdmin = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockRepo = {
  listAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deleteById: jest.fn(),
};
jest.mock('@/lib/repositories/BoostPackRepository', () => ({
  boostPackRepository: {
    listAll: (...a: unknown[]) => mockRepo.listAll(...a),
    create: (...a: unknown[]) => mockRepo.create(...a),
    update: (...a: unknown[]) => mockRepo.update(...a),
    deleteById: (...a: unknown[]) => mockRepo.deleteById(...a),
  },
}));

import { GET, POST, PUT, DELETE } from '../route';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const PACK = {
  id: '11111111-1111-4111-8111-111111111111',
  pack_key: 'boost_quick',
  pack_name: 'Quick Boost',
  display_name: 'Quick Boost',
  description: 'Perfect for a quick credit refill',
  price_usd: 5,
  bonus_percentage: 0,
  credits_amount: 10417,
  bonus_credits: 0,
  badge_text: null,
  is_active: true,
};
/** The pack as the page posts a NEW one: every field except `id`. */
const NEW_PACK: Omit<typeof PACK, 'id'> = Object.fromEntries(
  Object.entries(PACK).filter(([key]) => key !== 'id')
) as Omit<typeof PACK, 'id'>;

function request(method: string, body?: unknown, raw?: string) {
  return new NextRequest('http://localhost/api/admin/boost-packs', {
    method,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-test' },
    ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const forbidden = () => NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

const ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = ENV.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ user: ADMIN });
  ENV.NODE_ENV = 'test';
});

afterAll(() => {
  ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('happy path — response shapes the admin page reads are unchanged', () => {
  it('GET returns { success, data } with the rows', async () => {
    mockRepo.listAll.mockResolvedValue({ data: [PACK], error: null });

    const res = await GET(request('GET'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [PACK] });
  });

  it('POST creates from the page body and returns the stored row', async () => {
    mockRepo.create.mockResolvedValue({ data: PACK, error: null });

    const res = await POST(request('POST', NEW_PACK));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: PACK });
    expect(mockRepo.create).toHaveBeenCalledWith(NEW_PACK);
  });

  it('PUT strips the extra keys the page posts (created_at, ...) and updates by id', async () => {
    mockRepo.update.mockResolvedValue({ data: PACK, error: null });

    const res = await PUT(request('PUT', { ...PACK, created_at: '2025-01-01T00:00:00Z', updated_at: 'x' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: PACK });
    expect(mockRepo.update).toHaveBeenCalledWith(PACK.id, NEW_PACK);
  });

  it('PUT stays a partial update: only id is required', async () => {
    mockRepo.update.mockResolvedValue({ data: PACK, error: null });

    const res = await PUT(request('PUT', { id: PACK.id, is_active: false }));

    expect(res.status).toBe(200);
    expect(mockRepo.update).toHaveBeenCalledWith(PACK.id, { is_active: false });
  });

  it('DELETE takes { id } in the body and returns { success: true }', async () => {
    mockRepo.deleteById.mockResolvedValue({ data: true, error: null });

    const res = await DELETE(request('DELETE', { id: PACK.id }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockRepo.deleteById).toHaveBeenCalledWith(PACK.id);
  });
});

describe('auth failure — requireAdmin refuses before anything else runs', () => {
  it.each([
    ['GET', () => GET(request('GET'))],
    ['POST', () => POST(request('POST', NEW_PACK))],
    ['PUT', () => PUT(request('PUT', PACK))],
    ['DELETE', () => DELETE(request('DELETE', { id: PACK.id }))],
  ])('%s returns the 403 untouched and never reaches the repository', async (_name, call) => {
    mockRequireAdmin.mockResolvedValue(forbidden());

    const res = await call();

    expect(res.status).toBe(403);
    for (const fn of Object.values(mockRepo)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('invalid input — 400 in the standard error format, no repository call', () => {
  it.each([
    ['POST missing description', () => POST(request('POST', { ...NEW_PACK, description: undefined }))],
    ['POST empty pack_key', () => POST(request('POST', { ...NEW_PACK, pack_key: '' }))],
    ['POST price as text', () => POST(request('POST', { ...NEW_PACK, price_usd: '5' }))],
    ['POST malformed JSON', () => POST(request('POST', undefined, '{not json'))],
    ['PUT missing id', () => PUT(request('PUT', NEW_PACK))],
    ['PUT is_active as text', () => PUT(request('PUT', { id: PACK.id, is_active: 'yes' }))],
    ['DELETE missing id', () => DELETE(request('DELETE', {}))],
    ['DELETE empty body', () => DELETE(request('DELETE'))],
  ])('%s', async (_name, call) => {
    const res = await call();

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid input');
    // Outside development the validation detail never leaves the server.
    expect(body.details).toBeUndefined();
    for (const fn of Object.values(mockRepo)) expect(fn).not.toHaveBeenCalled();
  });

  it('includes the validation detail in development only', async () => {
    ENV.NODE_ENV = 'development';

    const res = await POST(request('POST', { ...NEW_PACK, pack_key: '' }));

    expect(res.status).toBe(400);
    expect((await res.json()).details).toBeDefined();
  });
});

describe('repository failure — friendly message, no internal text outside development', () => {
  it.each([
    ['GET', () => mockRepo.listAll, () => GET(request('GET')), 'Failed to fetch boost packs'],
    ['POST', () => mockRepo.create, () => POST(request('POST', NEW_PACK)), 'Failed to create boost pack'],
    ['PUT', () => mockRepo.update, () => PUT(request('PUT', PACK)), 'Failed to update boost pack'],
    ['DELETE', () => mockRepo.deleteById, () => DELETE(request('DELETE', { id: PACK.id })), 'Failed to delete boost pack'],
  ])('%s', async (_name, repoFn, call, message) => {
    repoFn().mockResolvedValue({ data: null, error: new Error('relation secret_internal_name does not exist') });

    const res = await call();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: message });
    expect(JSON.stringify(body)).not.toContain('secret_internal_name');
  });

  it('returns the internal text as details in development', async () => {
    ENV.NODE_ENV = 'development';
    mockRepo.listAll.mockResolvedValue({ data: null, error: new Error('db down') });

    const res = await GET(request('GET'));

    expect(await res.json()).toEqual({ success: false, error: 'Failed to fetch boost packs', details: 'db down' });
  });
});

describe('source guard — the route stays on the standards', () => {
  const source = readFileSync(join(process.cwd(), 'app', 'api', 'admin', 'boost-packs', 'route.ts'), 'utf8');

  it('holds no Supabase client and no direct table access (rule 1)', () => {
    expect(source).not.toMatch(/@supabase\/supabase-js|createClient\(|\.from\(/);
  });

  it('never logs through console (rule 3)', () => {
    expect(source).not.toMatch(/console\./);
  });

  it('calls requireAdmin as the first statement of each of the four handlers', () => {
    const handlers = source.split(/export async function (?:GET|POST|PUT|DELETE)\(/).slice(1);
    expect(handlers).toHaveLength(4);
    for (const body of handlers) {
      const beforeGate = body.slice(0, body.indexOf('await requireAdmin('));
      expect(beforeGate).not.toMatch(/request\.json|boostPackRepository|readJson/);
    }
  });
});

describe('QA contract — the exact payloads app/admin/agentspilot-billing/page.tsx sends', () => {
  // Mirrors the page's calculateBoostPackCredits with its default cost.
  const COST = 0.00048;
  const credits = (price: number, bonusPct: number) => {
    const base = Math.round(price / COST);
    return { credits_amount: base, bonus_credits: Math.round(base * (bonusPct / 100)) };
  };
  /** A row exactly as GET returns it from the DB (timestamps included). */
  const DB_ROW = {
    ...PACK,
    price_usd: 9.99,
    bonus_percentage: 12.5,
    badge_text: 'POPULAR',
    created_at: '2025-01-27T10:00:00.123456+00:00',
    updated_at: '2025-01-27T10:00:00.123456+00:00',
  };
  const DB_FIELDS = {
    ...NEW_PACK, price_usd: 9.99, bonus_percentage: 12.5, badge_text: 'POPULAR',
  };

  it('Add: the page initial state + typed text, credits computed client-side', async () => {
    mockRepo.create.mockResolvedValue({ data: PACK, error: null });
    const body = {
      pack_key: 'boost_x', pack_name: 'X', display_name: 'X', description: 'd',
      price_usd: 10, bonus_percentage: 0, badge_text: null, is_active: true, ...credits(10, 0),
    };

    const res = await POST(request('POST', body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: PACK });
    expect(mockRepo.create).toHaveBeenCalledWith(body);
  });

  it('Add: price cleared to 0 by the input (parseFloat || 0) is still accepted', async () => {
    mockRepo.create.mockResolvedValue({ data: PACK, error: null });
    const res = await POST(request('POST', { ...NEW_PACK, price_usd: 0, bonus_percentage: 0, ...credits(0, 0) }));
    expect(res.status).toBe(200);
  });

  it('Edit: full DB row round-tripped (timestamps, decimals, badge) with recomputed credits', async () => {
    mockRepo.update.mockResolvedValue({ data: DB_ROW, error: null });
    const body = { ...DB_ROW, ...credits(9.99, 12.5) };

    const res = await PUT(request('PUT', body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: DB_ROW });
    expect(mockRepo.update).toHaveBeenCalledWith(DB_ROW.id, { ...DB_FIELDS, ...credits(9.99, 12.5) });
  });

  it('Edit: badge cleared (null) and active toggled off via the checkbox', async () => {
    mockRepo.update.mockResolvedValue({ data: PACK, error: null });
    const res = await PUT(request('PUT', { ...DB_ROW, badge_text: null, is_active: false, ...credits(9.99, 12.5) }));
    expect(res.status).toBe(200);
    expect(mockRepo.update.mock.calls[0][1]).toMatchObject({ badge_text: null, is_active: false });
  });

  it('Edit: a stored row with is_active NULL (nullable column) still saves, as before the refactor', async () => {
    mockRepo.update.mockResolvedValue({ data: { ...PACK, is_active: null }, error: null });
    const res = await PUT(request('PUT', { ...DB_ROW, is_active: null }));
    expect(res.status).toBe(200);
    expect(mockRepo.update.mock.calls[0][1]).toMatchObject({ is_active: null });
  });

  it('POST and PUT still refuse null for a NOT NULL column (price_usd)', async () => {
    const put = await PUT(request('PUT', { id: DB_ROW.id, price_usd: null }));
    const post = await POST(request('POST', { ...NEW_PACK, price_usd: null }));
    expect([put.status, post.status]).toEqual([400, 400]);
    expect(mockRepo.update).not.toHaveBeenCalled();
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it('Delete: { id } as the page sends it', async () => {
    mockRepo.deleteById.mockResolvedValue({ data: true, error: null });
    const res = await DELETE(request('DELETE', { id: DB_ROW.id }));
    expect(await res.json()).toEqual({ success: true });
  });

  it('a repository that THROWS yields 500 with no internal text outside development', async () => {
    mockRepo.listAll.mockRejectedValue(new Error('secret_internal_name'));
    const res = await GET(request('GET'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Unexpected error occurred' });
  });

  it('NaN/Infinity cannot reach the DB: JSON turns them into null, which is a 400', async () => {
    const res = await PUT(request('PUT', { ...DB_ROW, credits_amount: Infinity, bonus_credits: NaN }));
    expect(res.status).toBe(400);
    expect(mockRepo.update).not.toHaveBeenCalled();
  });
});
