/**
 * GET /api/admin/chat-usage (Layer 1.5 F-1, FR-24, AC-18, WC-9).
 *
 * The gate order 401 → 403 → 400 is unchanged; a failed read is 503 and never
 * `200 { success: true }` with zeros; a truncated read is 200 with `truncated`
 * and `cap`, in the body and in the info log.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }) },
}));

const logInfo = jest.fn();
const logError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => logInfo(...a),
      warn: jest.fn(),
      error: (...a: unknown[]) => logError(...a),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const getChatUsage = jest.fn();
jest.mock('@/lib/business-os/bizql/telemetry/usageReport', () => ({
  getChatUsage: (...a: unknown[]) => getChatUsage(...a),
}));

import { GET } from '../route';

const ADMIN = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'admin@example.com' };

function req(qs = '?days=7'): NextRequest {
  return new NextRequest(`http://localhost/api/admin/chat-usage${qs}`);
}

const REPORT = { from: 'a', to: 'b', turns: 3, calls: 4, costPerTurnUsd: 0.001, truncated: false, cap: 10_000 };

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  getChatUsage.mockResolvedValue({ ok: true, report: REPORT });
});

describe('GET /api/admin/chat-usage', () => {
  it('401 when signed out, before any read', async () => {
    getUser.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(getChatUsage).not.toHaveBeenCalled();
  });

  it('403 for a non-admin, before any read', async () => {
    isAdmin.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(403);
    expect(getChatUsage).not.toHaveBeenCalled();
  });

  it('400 for an invalid query, before any read', async () => {
    expect((await GET(req('?days=500'))).status).toBe(400);
    expect(getChatUsage).not.toHaveBeenCalled();
  });

  it('200 with the report on a good read', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: REPORT });
  });

  it('503 on a failed read — never 200 { success: true } with zeros', async () => {
    getChatUsage.mockResolvedValue({ ok: false, error: 'Chat usage could not be read' });
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });

  it('surfaces a truncated read in the body and in the info log', async () => {
    getChatUsage.mockResolvedValue({ ok: true, report: { ...REPORT, truncated: true } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ truncated: true, cap: 10_000 });
    expect(logInfo).toHaveBeenCalledWith(expect.objectContaining({ truncated: true, cap: 10_000 }), 'Chat usage reported');
  });
});
