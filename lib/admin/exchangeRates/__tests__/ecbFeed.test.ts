/**
 * The ECB fetch (Admin Exchange Rates slice 1e; SA §13.7 SQ-35, SQ-36). Every
 * case answers through an injected `fetchImpl`; the real network is forbidden.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import {
  ECB_DAILY_URL,
  ECB_FETCH_TIMEOUT_MS,
  ECB_SOURCE,
  RATE_CHECK_USER_AGENT,
  fetchEcbDaily,
  type EcbFetchImpl,
} from '../ecbFeed';

forbidRealNetwork();

const FIXTURE = readFileSync(join(__dirname, '..', '__fixtures__', 'ecb-eurofxref-daily-2026-10-23.xml'), 'utf8');
const XML = { 'content-type': 'text/xml' };
const CAP = 64 * 1024;

function answering(...replies: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: EcbFetchImpl = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetchImpl, calls };
}

describe('the pinned source (SQ-35)', () => {
  it('is the one ECB daily URL, XML only, 64 KB, an honest User-Agent', () => {
    expect(ECB_DAILY_URL).toBe('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
    expect(ECB_SOURCE).toEqual({
      url: ECB_DAILY_URL,
      accept: 'application/xml, text/xml',
      contentTypes: ['text/xml', 'application/xml'],
      maxBytes: CAP,
    });
    expect(RATE_CHECK_USER_AGENT).toBe(
      'AgentPilot-RateCheck/1.0 (admin-triggered exchange rate review; one request per click)'
    );
    expect(ECB_FETCH_TIMEOUT_MS).toBe(10_000);
  });
});

describe('fetchEcbDaily', () => {
  it('ok: returns the text; sends only User-Agent and Accept; manual redirect; no-store; the pinned URL', async () => {
    const { fetchImpl, calls } = answering(new Response(FIXTURE, { status: 200, headers: XML }));
    const result = await fetchEcbDaily({ fetchImpl });
    expect(result).toMatchObject({ outcome: 'ok', status: 200, attempts: 1, text: FIXTURE });
    expect(result.bytes).toBe(Buffer.byteLength(FIXTURE, 'utf8'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ECB_DAILY_URL);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toEqual({ 'User-Agent': RATE_CHECK_USER_AGENT, Accept: 'application/xml, text/xml' });
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.cache).toBe('no-store');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(calls[0].init).sort()).toEqual(['cache', 'headers', 'method', 'redirect', 'signal']);
  });

  it('application/xml with a charset is read too', async () => {
    const { fetchImpl } = answering(
      new Response(FIXTURE, { status: 200, headers: { 'content-type': 'application/xml; charset=UTF-8' } })
    );
    expect((await fetchEcbDaily({ fetchImpl })).outcome).toBe('ok');
  });

  it('a 301 is http_301 and the redirect is not followed', async () => {
    const { fetchImpl, calls } = answering(
      new Response(null, { status: 301, headers: { location: 'https://example.invalid/rates.xml' } }),
      new Response(FIXTURE, { status: 200, headers: XML })
    );
    const result = await fetchEcbDaily({ fetchImpl });
    expect(result).toMatchObject({ outcome: 'http_301', status: 301, attempts: 1 });
    expect(result.text).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('a 403 is blocked', async () => {
    const { fetchImpl, calls } = answering(new Response(null, { status: 403 }));
    expect(await fetchEcbDaily({ fetchImpl })).toMatchObject({ outcome: 'blocked', status: 403, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('text/html is blocked (a challenge page)', async () => {
    const { fetchImpl } = answering(
      new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    );
    expect((await fetchEcbDaily({ fetchImpl })).outcome).toBe('blocked');
  });

  it('application/json is layout_changed', async () => {
    const { fetchImpl } = answering(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect((await fetchEcbDaily({ fetchImpl })).outcome).toBe('layout_changed');
  });

  it('500 then 200 is ok in 2 attempts', async () => {
    const { fetchImpl, calls } = answering(new Response('', { status: 500 }), new Response(FIXTURE, { status: 200, headers: XML }));
    expect(await fetchEcbDaily({ fetchImpl })).toMatchObject({ outcome: 'ok', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('500 twice is http_500 in 2 attempts', async () => {
    const { fetchImpl, calls } = answering(new Response('', { status: 500 }), new Response('', { status: 500 }));
    expect(await fetchEcbDaily({ fetchImpl })).toMatchObject({ outcome: 'http_500', status: 500, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('a 404 is one attempt', async () => {
    const { fetchImpl, calls } = answering(new Response(null, { status: 404 }), new Response(FIXTURE, { status: 200, headers: XML }));
    expect(await fetchEcbDaily({ fetchImpl })).toMatchObject({ outcome: 'http_404', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('a network error then ok', async () => {
    const { fetchImpl, calls } = answering(new TypeError('fetch failed'), new Response(FIXTURE, { status: 200, headers: XML }));
    expect(await fetchEcbDaily({ fetchImpl })).toMatchObject({ outcome: 'ok', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('two network errors are network_error; it never throws', async () => {
    const { fetchImpl } = answering(new TypeError('fetch failed'), new TypeError('fetch failed'));
    expect(await fetchEcbDaily({ fetchImpl })).toMatchObject({ outcome: 'network_error', status: null, attempts: 2 });
  });

  describe('a timeout (fake timers)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('is timeout after 10 s, with no retry', async () => {
      const calls: string[] = [];
      const hang: EcbFetchImpl = (url, init) => {
        calls.push(url);
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      };
      const pending = fetchEcbDaily({ fetchImpl: hang });
      await jest.advanceTimersByTimeAsync(ECB_FETCH_TIMEOUT_MS);
      expect(await pending).toMatchObject({ outcome: 'timeout', status: null, attempts: 1 });
      expect(calls).toHaveLength(1);
    });

    it('covers the body read too', async () => {
      const slowBody: EcbFetchImpl = async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('<?xml'));
              init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
            },
          }),
          { status: 200, headers: XML }
        );
      const pending = fetchEcbDaily({ fetchImpl: slowBody });
      await jest.advanceTimersByTimeAsync(ECB_FETCH_TIMEOUT_MS);
      expect((await pending).outcome).toBe('timeout');
    });
  });

  it('a declared content-length over 64 KB is too_large, and the body is not read', async () => {
    let read = false;
    // highWaterMark 0: `pull` runs only when somebody reads, so `read` proves a read.
    const body = new ReadableStream(
      {
        pull(controller) {
          read = true;
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const { fetchImpl } = answering(
      new Response(body, { status: 200, headers: { ...XML, 'content-length': String(CAP + 1) } })
    );
    const result = await fetchEcbDaily({ fetchImpl });
    expect(result).toMatchObject({ outcome: 'too_large', bytes: CAP + 1 });
    expect(result.text).toBeUndefined();
    expect(read).toBe(false);
  });

  it('a streamed body over 64 KB is too_large', async () => {
    const { fetchImpl } = answering(new Response('x'.repeat(CAP + 1), { status: 200, headers: XML }));
    const result = await fetchEcbDaily({ fetchImpl });
    expect(result.outcome).toBe('too_large');
    expect(result.text).toBeUndefined();
  });

  it('exactly 64 KB is still read', async () => {
    const { fetchImpl } = answering(new Response('x'.repeat(CAP), { status: 200, headers: XML }));
    expect(await fetchEcbDaily({ fetchImpl })).toMatchObject({ outcome: 'ok', bytes: CAP });
  });

  it('no cache: two calls make two fetches', async () => {
    const { fetchImpl, calls } = answering(
      new Response(FIXTURE, { status: 200, headers: XML }),
      new Response(FIXTURE, { status: 200, headers: XML })
    );
    await fetchEcbDaily({ fetchImpl });
    await fetchEcbDaily({ fetchImpl });
    expect(calls).toHaveLength(2);
  });

  it('reports the duration from the injected clock', async () => {
    const ticks = [1000, 1250];
    const { fetchImpl } = answering(new Response(FIXTURE, { status: 200, headers: XML }));
    expect((await fetchEcbDaily({ fetchImpl, now: () => ticks.shift() ?? 1250 })).durationMs).toBe(250);
  });
});
