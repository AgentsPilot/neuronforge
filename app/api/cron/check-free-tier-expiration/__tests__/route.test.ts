/**
 * The free-tier expiration job after plan payments P-10 (TK-3, BQ-P8): inert.
 * Every exported HTTP method checks the cron secret (fail closed), then
 * returns 410 with an `error` + `alert: true` line. No database client is ever
 * created (SA P10-C6).
 */

import { NextRequest } from 'next/server';

const mockError = jest.fn();
const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: (...a: unknown[]) => mockWarn(...a),
      error: (...a: unknown[]) => mockError(...a),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => mockCreateClient(...a) }));
jest.mock('@/lib/supabaseServer', () => {
  mockCreateClient('supabaseServer');
  return { supabaseServer: {} };
});

import * as route from '../route';

const SECRET = 'cron-secret-for-test';
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type Handler = (request: NextRequest) => Promise<Response>;

const exported = HTTP_METHODS.filter((m) => typeof (route as Record<string, unknown>)[m] === 'function');

function call(method: string, authorization?: string): Promise<Response> {
  const handler = (route as unknown as Record<string, Handler>)[method];
  const headers: Record<string, string> = authorization ? { authorization } : {};
  return handler(new NextRequest('http://localhost/api/cron/check-free-tier-expiration', { method, headers }));
}

const originalSecret = process.env.CRON_SECRET;
beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  mockError.mockClear();
  mockWarn.mockClear();
});
afterAll(() => {
  process.env.CRON_SECRET = originalSecret;
});

describe('GET /api/cron/check-free-tier-expiration (permanently disabled)', () => {
  it('exports GET, the only method it ever had', () => {
    expect(exported).toEqual(['GET']);
  });

  it('creates no database client at module load', () => {
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  describe.each(exported)('%s', (method) => {
    it('without the secret → 401, no alert', async () => {
      const res = await call(method);
      expect(res.status).toBe(401);
      expect(mockError).not.toHaveBeenCalled();
    });

    it('with a wrong secret → 401', async () => {
      const res = await call(method, 'Bearer not-the-secret');
      expect(res.status).toBe(401);
    });

    it('fails closed when CRON_SECRET is not configured, even for "Bearer undefined"', async () => {
      delete process.env.CRON_SECRET;
      expect((await call(method, 'Bearer undefined')).status).toBe(401);
      expect((await call(method, 'Bearer ')).status).toBe(401);
    });

    it('with the secret → 410, an error line with alert: true, and nothing read or written', async () => {
      const res = await call(method, `Bearer ${SECRET}`);
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ success: false, error: 'Permanently disabled' });
      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'free_tier_expiration_disabled', alert: true }),
        expect.any(String)
      );
      expect(mockCreateClient).not.toHaveBeenCalled();
    });
  });
});
