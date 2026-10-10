/**
 * The shared JSON read helpers (Admin Layout Standard C-4, §5.10).
 *
 * RC-2 probe: every response here is a Proxy over `{ ok, status, json }` that
 * throws on any other string key, so a read of `headers`, `text`, `clone` or
 * `statusText` fails the test. Per SA W-3 it returns undefined for `then` and
 * passes symbol keys through, so promise resolution or Jest's printer cannot
 * produce a false failure.
 */

import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';

const ALLOWED = new Set(['ok', 'status', 'json']);

function probeResponse(status: number, json: () => Promise<unknown>): Response {
  const target = { ok: status >= 200 && status < 300, status, json };
  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(obj, key, receiver);
      if (key === 'then') return undefined;
      if (!ALLOWED.has(key)) throw new Error(`RC-2: the helper read response.${key}`);
      return Reflect.get(obj, key, receiver);
    },
  });
  return proxy as unknown as Response;
}

const withBody = (status: number, body: unknown) => probeResponse(status, async () => body);
const withHtml = (status: number) =>
  probeResponse(status, async () => {
    throw new SyntaxError("Unexpected token '<' in JSON at position 0");
  });

const WHAT = 'the thing';
const FALLBACK = 'Could not read the thing. Try again in a moment.';
const SESSION = 'Your admin session has ended. Sign in again.';

describe('the RC-2 probe itself (no dead probe)', () => {
  it('throws on a read outside ok, status and json', () => {
    const response = withBody(200, {});
    expect(() => response.headers).toThrow('RC-2');
    expect(() => response.statusText).toThrow('RC-2');
    expect(() => response.text).toThrow('RC-2');
    expect(() => response.clone).toThrow('RC-2');
    expect(response.status).toBe(200);
  });
});

describe('readJsonBody', () => {
  it('returns a JSON object', async () => {
    expect(await readJsonBody(withBody(200, { success: true, data: 1 }))).toEqual({ success: true, data: 1 });
  });

  it('returns null for an array, a JSON null, a primitive and an unparseable body', async () => {
    expect(await readJsonBody(withBody(200, [1, 2]))).toBeNull();
    expect(await readJsonBody(withBody(200, null))).toBeNull();
    expect(await readJsonBody(withBody(200, 'text'))).toBeNull();
    expect(await readJsonBody(withHtml(502))).toBeNull();
  });
});

describe('readAdminResponse', () => {
  it('a 200 with success true gives the data', async () => {
    const result = await readAdminResponse<{ n: number }>(withBody(200, { success: true, data: { n: 3 } }), { what: WHAT });
    expect(result).toEqual({ ok: true, status: 200, data: { n: 3 } });
  });

  it('a 2xx counts only when success is literally true', async () => {
    const truthy = await readAdminResponse(withBody(200, { success: 1, data: {} }), { what: WHAT });
    expect(truthy).toEqual({ ok: false, status: 200, message: FALLBACK });
  });

  it('a 200 with success false shows the route error verbatim', async () => {
    const result = await readAdminResponse(withBody(200, { success: false, error: 'Window too wide' }), { what: WHAT });
    expect(result).toEqual({ ok: false, status: 200, message: 'Window too wide' });
  });

  it('a non-2xx is a failure even when the body claims success (status first)', async () => {
    const result = await readAdminResponse(withBody(500, { success: true, data: {} }), { what: WHAT });
    expect(result).toEqual({ ok: false, status: 500, message: FALLBACK });
  });

  it('a 403 with "Forbidden" shows "Forbidden" when the session copy is off (the default)', async () => {
    const result = await readAdminResponse(withBody(403, { success: false, error: 'Forbidden' }), { what: WHAT });
    expect(result).toEqual({ ok: false, status: 403, message: 'Forbidden' });
  });

  it.each([401, 403])('a %i with sessionEndedCopy shows the session copy (RC-4)', async (status) => {
    const result = await readAdminResponse(withBody(status, { success: false, error: 'Forbidden' }), {
      what: WHAT,
      sessionEndedCopy: true,
    });
    expect(result).toEqual({ ok: false, status, message: SESSION });
  });

  it('sessionEndedCopy does not touch a 500', async () => {
    const result = await readAdminResponse(withBody(500, { success: false, error: 'Boom' }), {
      what: WHAT,
      sessionEndedCopy: true,
    });
    expect(result).toEqual({ ok: false, status: 500, message: 'Boom' });
  });

  it('an HTML error page gives the fixed fallback, never the parser text', async () => {
    const result = await readAdminResponse(withHtml(502), { what: WHAT });
    expect(result).toEqual({ ok: false, status: 502, message: FALLBACK });
    expect(JSON.stringify(result)).not.toMatch(/Unexpected token|JSON/);
  });

  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['a number', 42],
    ['an object', { message: 'x' }],
    ['missing', undefined],
  ])('a %s error field gives the fixed fallback', async (_label, error) => {
    const result = await readAdminResponse(withBody(500, { success: false, error }), { what: WHAT });
    expect(result).toEqual({ ok: false, status: 500, message: FALLBACK });
  });

  it('the network copy is the fixed §5.10 rule 3 text', () => {
    expect(ADMIN_NETWORK_ERROR).toBe('Could not reach the server. Check your connection and try again.');
  });
});
