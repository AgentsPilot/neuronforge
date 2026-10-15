/**
 * GET /api/design-system/v2-custom-tokens (performance slice TH-1, SA RC-16).
 *
 * Integration through the real reader (`readV2CustomTokensWithStatus`), with
 * only the repository and the logger mocked:
 *   - happy path: 200, the sanitized tokens, no-store;
 *   - unknown state: 503, never `{}` with a 200, no-store;
 *   - a poisoned repository value: only allow-listed, grammar-valid keys leave.
 * There is no auth-failure or invalid-input case: the route is public by design
 * and takes no input (see its header).
 */

import { NextRequest } from 'next/server';

const getByKey = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  systemConfigRepository: { getByKey: (...args: unknown[]) => getByKey(...args) },
}));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { GET } from '../route';
import { __resetV2CustomTokensCacheForTests } from '@/lib/design-system-v2/server/readV2CustomTokens';

const req = () => new NextRequest('http://localhost/api/design-system/v2-custom-tokens', { method: 'GET' });
const row = (value: unknown) => ({ data: { key: 'v2_custom_tokens', value }, error: null });

beforeEach(() => {
  __resetV2CustomTokensCacheForTests();
  getByKey.mockReset();
});

describe('GET /api/design-system/v2-custom-tokens', () => {
  it('happy path: 200 with the tokens, not cacheable', async () => {
    getByKey.mockResolvedValue(row({ colors: { primary: '#0000A1', secondary: '#0000A2' } }));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: true, data: { colors: { primary: '#0000A1', secondary: '#0000A2' } } });
  });

  it('a known reset (no row) is 200 with {}', async () => {
    getByKey.mockResolvedValue({ data: null, error: null });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: {} });
  });

  it('unknown state (the read failed, nothing known): 503, never a 200 with {}', async () => {
    getByKey.mockResolvedValue({ data: null, error: new Error('db down') });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: false, error: 'Theme unavailable' });
  });

  it('a poisoned repository value: only allow-listed, valid keys leave the server', async () => {
    getByKey.mockResolvedValue(row({
      colors: { primary: 'red;}body{display:none', secondary: '#0000A2', evil: '#000' },
      '--v2-bg': { x: '#000' },
      shadows: { card: 'url(javascript:alert(1))' },
      __proto__: { polluted: true },
    }));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { colors: { secondary: '#0000A2' } } });
    expect(JSON.stringify(body)).not.toMatch(/display|javascript|evil|polluted/);
  });
});
