/**
 * The pinned outbound fetch (AI model price review slice 5; SA RR-1, SC-9).
 * Every case answers through an injected `fetchImpl`; the real network is
 * forbidden (SC-16).
 */

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import {
  LITELLM_PRICES_URL,
  OPENAI_PRICING_MARKDOWN_URL,
  OPENAI_PRICING_PAGE_URL,
  PRICE_CHECK_USER_AGENT,
  PRICE_SOURCES,
  fetchLimited,
  settledToResult,
  type FetchImpl,
  type PriceSource,
} from '../fetchSources';

forbidRealNetwork();

const MARKDOWN = { 'content-type': 'text/markdown; charset=utf-8' };

function answering(...replies: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetchImpl, calls };
}

const small: PriceSource = { ...PRICE_SOURCES.openai, maxBytes: 16 };

describe('pinned sources', () => {
  it('are exactly the two literal URLs', () => {
    expect(Object.keys(PRICE_SOURCES)).toEqual(['openai', 'litellm']);
    expect(PRICE_SOURCES.openai.url).toBe('https://developers.openai.com/api/docs/pricing.md');
    expect(PRICE_SOURCES.litellm.url).toBe(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
    );
    expect(OPENAI_PRICING_MARKDOWN_URL).toBe(PRICE_SOURCES.openai.url);
    expect(LITELLM_PRICES_URL).toBe(PRICE_SOURCES.litellm.url);
    expect(OPENAI_PRICING_PAGE_URL).toBe('https://developers.openai.com/api/docs/pricing');
    expect(PRICE_SOURCES.openai.maxBytes).toBe(5 * 1024 * 1024);
    expect(PRICE_SOURCES.litellm.maxBytes).toBe(8 * 1024 * 1024);
  });
});

describe('fetchLimited', () => {
  it('ok: returns the text, sends only User-Agent and Accept, never follows a redirect', async () => {
    const { fetchImpl, calls } = answering(new Response('# Pricing', { status: 200, headers: MARKDOWN }));
    const result = await fetchLimited(PRICE_SOURCES.openai, { fetchImpl });
    expect(result).toMatchObject({ outcome: 'ok', status: 200, bytes: 9, attempts: 1, text: '# Pricing' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OPENAI_PRICING_MARKDOWN_URL);
    expect(calls[0].init.headers).toEqual({ 'User-Agent': PRICE_CHECK_USER_AGENT, Accept: 'text/markdown, text/plain' });
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(PRICE_CHECK_USER_AGENT).toMatch(/^AgentPilot-PriceCheck[/][0-9]+[.][0-9]+ /);
  });

  it('LiteLLM accepts text/plain and application/json', async () => {
    for (const type of ['text/plain; charset=utf-8', 'application/json']) {
      const { fetchImpl } = answering(new Response('{}', { status: 200, headers: { 'content-type': type } }));
      expect((await fetchLimited(PRICE_SOURCES.litellm, { fetchImpl })).outcome).toBe('ok');
    }
  });

  it('a timeout is `timeout`, with no retry, and covers the body read too', async () => {
    const hang: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const calls: string[] = [];
    const result = await fetchLimited(PRICE_SOURCES.openai, {
      fetchImpl: (url, init) => {
        calls.push(url);
        return hang(url, init);
      },
      timeoutMs: 20,
    });
    expect(result).toMatchObject({ outcome: 'timeout', status: null, attempts: 1 });
    expect(calls).toHaveLength(1);

    const slowBody: FetchImpl = async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('# Pri'));
            init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
          },
        }),
        { status: 200, headers: MARKDOWN }
      );
    expect((await fetchLimited(PRICE_SOURCES.openai, { fetchImpl: slowBody, timeoutMs: 20 })).outcome).toBe('timeout');
  });

  it('a 5xx is retried once, then ok', async () => {
    const { fetchImpl, calls } = answering(
      new Response('', { status: 503 }),
      new Response('# Pricing', { status: 200, headers: MARKDOWN })
    );
    expect(await fetchLimited(PRICE_SOURCES.openai, { fetchImpl })).toMatchObject({ outcome: 'ok', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('a 5xx twice is `http_5xx` after one retry', async () => {
    const { fetchImpl, calls } = answering(new Response('', { status: 502 }), new Response('', { status: 500 }));
    expect(await fetchLimited(PRICE_SOURCES.openai, { fetchImpl })).toMatchObject({ outcome: 'http_500', status: 500, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it.each([
    [404, 'http_404'],
    [429, 'http_429'],
    [403, 'blocked'],
    [301, 'http_301'],
  ])('a %s is %s, never retried', async (status, outcome) => {
    const { fetchImpl, calls } = answering(new Response(null, { status }), new Response('', { status: 200 }));
    expect((await fetchLimited(PRICE_SOURCES.openai, { fetchImpl })).outcome).toBe(outcome);
    expect(calls).toHaveLength(1);
  });

  it('an HTML answer is `blocked` (a challenge page), for either source', async () => {
    for (const source of [PRICE_SOURCES.openai, PRICE_SOURCES.litellm]) {
      const { fetchImpl } = answering(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
      expect((await fetchLimited(source, { fetchImpl })).outcome).toBe('blocked');
    }
  });

  it('an unexpected content type is `layout_changed`', async () => {
    const { fetchImpl } = answering(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect((await fetchLimited(PRICE_SOURCES.openai, { fetchImpl })).outcome).toBe('layout_changed');
  });

  it('too large: from content-length before reading, or while streaming', async () => {
    const declared = answering(new Response('x', { status: 200, headers: { ...MARKDOWN, 'content-length': '17' } }));
    expect(await fetchLimited(small, { fetchImpl: declared.fetchImpl })).toMatchObject({ outcome: 'too_large', bytes: 17 });

    const streamed = answering(new Response('0123456789abcdefXYZ', { status: 200, headers: MARKDOWN }));
    const result = await fetchLimited(small, { fetchImpl: streamed.fetchImpl });
    expect(result.outcome).toBe('too_large');
    expect(result.text).toBeUndefined();
  });

  it('a network error is retried once, then `network_error`; it never throws', async () => {
    const { fetchImpl, calls } = answering(new TypeError('fetch failed'), new TypeError('fetch failed'));
    expect(await fetchLimited(PRICE_SOURCES.litellm, { fetchImpl })).toMatchObject({ outcome: 'network_error', status: null, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('settledToResult maps a rejected promise to `network_error`', () => {
    expect(settledToResult({ status: 'rejected', reason: new Error('x') }).outcome).toBe('network_error');
  });
});
