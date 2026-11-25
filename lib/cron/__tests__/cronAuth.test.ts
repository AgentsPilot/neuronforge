/**
 * PROD-1b (A5), workplan 11.5: the one cron auth check fails closed.
 */

import type { Logger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';

const SECRET = 'cron-auth-test-secret-0123456789';
const ENV = { ...process.env };

const logged: unknown[][] = [];
const logger = {
  error: (...args: unknown[]) => logged.push(['error', ...args]),
  warn: (...args: unknown[]) => logged.push(['warn', ...args]),
  info: (...args: unknown[]) => logged.push(['info', ...args]),
} as unknown as Logger;

function setEnv(nodeEnv: string, vercelEnv: string | undefined, secret: string | undefined): void {
  process.env = { ...ENV };
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
}

function request(authorization?: string): Request {
  return new Request('https://app.example/api/cron/x', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(() => {
  logged.length = 0;
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('isAuthorizedCronRequest', () => {
  it('production with the right secret: allowed (happy path)', () => {
    setEnv('production', 'production', SECRET);
    expect(isAuthorizedCronRequest(request(`Bearer ${SECRET}`), logger)).toBe(true);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('secret %s: refused, one error line with the existing message (fail closed)', (_label, secret) => {
    setEnv('production', 'production', secret);
    expect(isAuthorizedCronRequest(request(`Bearer ${secret ?? ''}`), logger)).toBe(false);
    expect(logged).toEqual([['error', 'CRON_SECRET not configured - refusing cron request (fail-closed)']]);
  });

  it('unset secret and the header "Bearer undefined": refused', () => {
    setEnv('production', 'production', undefined);
    expect(isAuthorizedCronRequest(request('Bearer undefined'), logger)).toBe(false);
  });

  it('empty secret and the header "Bearer ": refused', () => {
    setEnv('production', 'production', '');
    expect(isAuthorizedCronRequest(request('Bearer '), logger)).toBe(false);
  });

  it.each([
    ['same length, wrong', `Bearer ${'x'.repeat(SECRET.length)}`],
    ['different length', 'Bearer short'],
    ['with a suffix', `Bearer ${SECRET}x`],
    ['lower-case bearer', `bearer ${SECRET}`],
    ['no header', undefined],
  ])('wrong header (%s): refused', (_label, header) => {
    setEnv('production', 'preview', SECRET);
    expect(isAuthorizedCronRequest(request(header), logger)).toBe(false);
  });

  it('local development (no VERCEL_ENV), no secret: allowed for manual triggering', () => {
    setEnv('development', undefined, undefined);
    expect(isAuthorizedCronRequest(request(), logger)).toBe(true);
  });

  it.each(['preview', 'development', 'production'])(
    'NODE_ENV development on a Vercel deployment (VERCEL_ENV=%s), no secret: refused (D-8)',
    (vercelEnv) => {
      setEnv('development', vercelEnv, undefined);
      expect(isAuthorizedCronRequest(request(), logger)).toBe(false);
    }
  );

  it('NODE_ENV test, no secret: refused', () => {
    setEnv('test', undefined, undefined);
    expect(isAuthorizedCronRequest(request(), logger)).toBe(false);
  });

  it('never logs the header or the secret', () => {
    setEnv('production', 'production', SECRET);
    isAuthorizedCronRequest(request('Bearer guessed-value'), logger);
    isAuthorizedCronRequest(request(`Bearer ${SECRET}`), logger);
    setEnv('production', 'production', undefined);
    isAuthorizedCronRequest(request('Bearer guessed-value'), logger);
    const text = JSON.stringify(logged);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('guessed-value');
  });

  it('a request whose headers throw is refused, not a 500', () => {
    setEnv('production', 'production', SECRET);
    const broken = { headers: { get: () => { throw new Error('boom'); } } } as unknown as Request;
    expect(isAuthorizedCronRequest(broken, logger)).toBe(false);
  });
});
