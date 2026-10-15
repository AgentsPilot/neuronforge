/**
 * The ONLY outbound fetch in the price review (AI model price review slice 5;
 * SA RR-1, RR-8, SC-9).
 *
 * Exactly two fixed public URLs, pinned here as code constants. Nothing a
 * caller sends can choose, extend or redirect them (no SSRF surface):
 *   - redirects are reported (`http_3xx`), never followed;
 *   - only `User-Agent` and `Accept` are sent: no cookie, no auth, no key.
 *
 * Limits per attempt: a 10 s timer that covers the headers AND the body read,
 * a byte cap enforced while streaming (and up front from `content-length`).
 * One retry on a network error or a 5xx; none on a 4xx or a timeout.
 *
 * `fetchLimited` NEVER throws: every path returns an outcome. The page text is
 * returned to the caller and is never logged here or anywhere else.
 */

import 'server-only';

import type { SourceOutcome } from './fetchOutcomes';

/** The official OpenAI pricing page, markdown form (RR-1). Fetched. */
export const OPENAI_PRICING_MARKDOWN_URL = 'https://developers.openai.com/api/docs/pricing.md';
/** The human page, stored as each line's `source_url` (MP-FR-3). Never fetched. */
export const OPENAI_PRICING_PAGE_URL = 'https://developers.openai.com/api/docs/pricing';
/** LiteLLM's public price list: the cross-check only, never a price (MP-FR-6a). */
export const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** An honest User-Agent naming the product (RR-1: no evasion). */
export const PRICE_CHECK_USER_AGENT = 'AgentPilot-PriceCheck/1.0 (admin-triggered model price review; one request per click)';

export const FETCH_TIMEOUT_MS = 10_000;

export interface PriceSource {
  readonly id: 'openai' | 'litellm';
  readonly url: string;
  readonly accept: string;
  /** Content types read as the source text; `text/html` is always `blocked`. */
  readonly contentTypes: readonly string[];
  readonly maxBytes: number;
}

export const PRICE_SOURCES: { readonly openai: PriceSource; readonly litellm: PriceSource } = {
  openai: {
    id: 'openai',
    url: OPENAI_PRICING_MARKDOWN_URL,
    accept: 'text/markdown, text/plain',
    contentTypes: ['text/markdown', 'text/plain'],
    maxBytes: 5 * 1024 * 1024,
  },
  litellm: {
    id: 'litellm',
    url: LITELLM_PRICES_URL,
    accept: 'application/json, text/plain',
    contentTypes: ['text/plain', 'application/json'],
    maxBytes: 8 * 1024 * 1024,
  },
};

export interface FetchResult {
  outcome: SourceOutcome;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  bytes: number;
  durationMs: number;
  attempts: number;
  /** Present only when `outcome` is `ok`. Never log it. */
  text?: string;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchDeps {
  fetchImpl?: FetchImpl;
  now?: () => number;
  timeoutMs?: number;
}

interface AttemptResult {
  outcome: SourceOutcome;
  status: number | null;
  bytes: number;
  text?: string;
  retryable: boolean;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to do: the body is being dropped either way.
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
  abort: () => void
): Promise<{ text: string; bytes: number } | { tooLarge: true; bytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    return bytes > maxBytes ? { tooLarge: true, bytes } : { text, bytes };
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      abort();
      try {
        await reader.cancel();
      } catch {
        // Already aborted.
      }
      return { tooLarge: true, bytes };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes };
}

async function attempt(source: PriceSource, fetchImpl: FetchImpl, timeoutMs: number): Promise<AttemptResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(source.url, {
      method: 'GET',
      headers: { 'User-Agent': PRICE_CHECK_USER_AGENT, Accept: source.accept },
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    const status = response.status;

    if (status === 403) {
      await discardBody(response);
      return { outcome: 'blocked', status, bytes: 0, retryable: false };
    }
    if (status !== 200) {
      await discardBody(response);
      return { outcome: `http_${status}`, status, bytes: 0, retryable: status >= 500 };
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType === 'text/html') {
      await discardBody(response);
      return { outcome: 'blocked', status, bytes: 0, retryable: false };
    }
    if (!source.contentTypes.includes(contentType)) {
      await discardBody(response);
      return { outcome: 'layout_changed', status, bytes: 0, retryable: false };
    }

    const declared = response.headers.get('content-length');
    if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > source.maxBytes) {
      await discardBody(response);
      return { outcome: 'too_large', status, bytes: Number(declared), retryable: false };
    }

    const body = await readCapped(response, source.maxBytes, () => controller.abort());
    if ('tooLarge' in body) return { outcome: 'too_large', status, bytes: body.bytes, retryable: false };
    return { outcome: 'ok', status, bytes: body.bytes, text: body.text, retryable: false };
  } catch {
    if (timedOut) return { outcome: 'timeout', status: null, bytes: 0, retryable: false };
    return { outcome: 'network_error', status: null, bytes: 0, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one pinned source with the RR-1 limits. Never throws. */
export async function fetchLimited(source: PriceSource, deps: FetchDeps = {}): Promise<FetchResult> {
  const fetchImpl: FetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const started = now();
  try {
    let result = await attempt(source, fetchImpl, timeoutMs);
    let attempts = 1;
    if (result.retryable) {
      result = await attempt(source, fetchImpl, timeoutMs);
      attempts = 2;
    }
    return {
      outcome: result.outcome,
      status: result.status,
      bytes: result.bytes,
      durationMs: Math.max(0, now() - started),
      attempts,
      ...(result.text !== undefined ? { text: result.text } : {}),
    };
  } catch {
    return { outcome: 'network_error', status: null, bytes: 0, durationMs: Math.max(0, now() - started), attempts: 1 };
  }
}

/** The `allSettled` backstop (SC-9): a rejected fetch is a `network_error`. */
export function settledToResult(settled: PromiseSettledResult<FetchResult>): FetchResult {
  if (settled.status === 'fulfilled') return settled.value;
  return { outcome: 'network_error', status: null, bytes: 0, durationMs: 0, attempts: 1 };
}
