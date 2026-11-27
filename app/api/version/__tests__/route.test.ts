/**
 * GET /api/version (app version stamp R19; §5.4; SA-V5, SA-V7).
 *
 * The public route in place of the skill's 401/400 pair (SA-V7): it has no
 * session and takes no input, so the cases are "no session still answers",
 * "query parameters are ignored", "an extra field never leaves", "a malformed
 * value becomes null" and the 500 path. Every environment value here is a
 * made-up fixture, injected through the reader's literal-read seam.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

import type { AppVersionSource } from '@/lib/version/readAppVersion';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => void logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

let fixture: AppVersionSource = {};
let override: ((source: AppVersionSource) => unknown) | null = null;
jest.mock('@/lib/version/readAppVersion', () => {
  const actual = jest.requireActual('@/lib/version/readAppVersion');
  return {
    ...actual,
    currentAppVersionSource: () => fixture,
    appVersionOf: (source: AppVersionSource) => (override ? override(source) : actual.appVersionOf(source)),
  };
});

import { GET } from '../route';

const FAKE_SHA = '0123456789abcdef0123456789abcdef01234567';
const FAKE_TIME = '2026-01-02T03:04:05.000Z';
const STAGING: AppVersionSource = {
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'main',
  NODE_ENV: 'production',
  APP_BUILD_COMMIT: FAKE_SHA,
  APP_BUILD_TIME: FAKE_TIME,
};

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/version${query}`, { method: 'GET' });
}

const originalNodeEnv = process.env.NODE_ENV;
function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  fixture = { ...STAGING };
  override = null;
  logged.length = 0;
  mockGetUser.mockReset();
});
afterAll(() => setNodeEnv(originalNodeEnv));

describe('GET /api/version', () => {
  it('V-1 happy path: the three fields, the short SHA, no-store', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { environment: 'staging', commit: '0123456', builtAt: FAKE_TIME },
    });
  });

  it('V-2 answers with no session, and the route imports no auth module (SA-C-3)', async () => {
    mockGetUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(200);
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(imports.filter((spec) => /auth|supabase|admin\/require/i.test(spec))).toEqual([]);
  });

  it('V-3 the body holds exactly the three fields, and no correlation id', async () => {
    const response = await GET(new NextRequest('http://localhost/api/version', { headers: { 'x-correlation-id': 'corr-fixture' } }));
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'success']);
    expect(Object.keys(body.data).sort()).toEqual(['builtAt', 'commit', 'environment']);
    expect(JSON.stringify(body)).not.toContain('corr-fixture');
  });

  it('V-4 query parameters are ignored', async () => {
    const plain = await (await GET(request())).json();
    const withQuery = await (await GET(request('?environment=production&commit=fffffff&debug=1'))).json();
    expect(withQuery).toEqual(plain);
  });

  it('V-5 Production only on the production environment AND the production branch', async () => {
    fixture = { ...STAGING, VERCEL_GIT_COMMIT_REF: 'production' };
    expect((await (await GET(request())).json()).data.environment).toBe('production');
    fixture = { ...STAGING, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'production' };
    expect((await (await GET(request())).json()).data.environment).toBe('unknown');
  });

  it.each([
    ['a short SHA', '0123456'],
    ['a non-hex SHA', 'z'.repeat(40)],
    ['an empty SHA', ''],
    ['a missing SHA', undefined],
  ])('V-6 %s gives commit null, still 200', async (_case, commit) => {
    fixture = { ...STAGING, APP_BUILD_COMMIT: commit };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.commit).toBeNull();
  });

  it.each([
    ['garbage', 'not-a-time'],
    ['an empty value', ''],
    ['a missing value', undefined],
  ])('V-7 a build time that is %s gives builtAt null, still 200', async (_case, builtAt) => {
    fixture = { ...STAGING, APP_BUILD_TIME: builtAt };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.builtAt).toBeNull();
  });

  it('V-8 an extra field fails the strict parse: 500, and the field never leaves', async () => {
    setNodeEnv('production');
    override = () => ({ environment: 'staging', commit: '0123456', builtAt: FAKE_TIME, secretish: 'fixture-extra' });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Version unavailable' });
    expect(JSON.stringify(body)).not.toContain('fixture-extra');
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
  });

  it('V-9 the 500 carries details only in development', async () => {
    override = () => {
      throw new Error('fixture failure');
    };
    setNodeEnv('development');
    const dev = await (await GET(request())).json();
    expect(dev.details).toBe('fixture failure');
    setNodeEnv('production');
    const prod = await (await GET(request())).json();
    expect(prod.details).toBeUndefined();
  });

  it('V-10 logs at debug only on success', async () => {
    await GET(request());
    expect(logged.map((entry) => entry.level)).toEqual(['debug']);
  });
});
