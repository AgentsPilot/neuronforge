/**
 * The ONLY outbound fetch of the exchange rate sync (Admin Exchange Rates slice
 * 1e; SA §13.7 SQ-35, SQ-36; the price review's RR-8 shape).
 *
 * Copy of the price review's `fetchLimited` (`lib/ai/pricing-research/
 * fetchSources.ts`), SA §13.7 SQ-36: `attempt`, `readCapped`, `discardBody`
 * and the retry loop are copied as-is, with this file's own types, and NOTHING
 * is imported from that module. A fix in one must be looked for in the other.
 * Follow-up FU-1e-1: when a third outbound consumer is proposed, lift both
 * copies into one shared server-only helper in that slice, under its own SA
 * review. In that lift, also cap the `readCapped` fallback for a response
 * with no readable body stream: it calls `response.text()` uncapped and only
 * measures afterwards (both copies; Node's fetch always gives a stream, so it
 * is left as copied here; SA code review note).
 *
 * Exactly one fixed public URL is fetched, approved under RR-8 for this
 * feature only (SQ-35): the ECB's daily reference-rate XML. Nothing a caller
 * sends can choose, extend or redirect it (no SSRF surface):
 *   - redirects are reported (`http_3xx`), never followed;
 *   - only `User-Agent` and `Accept` are sent: no cookie, no auth, no key.
 *
 * Limits per attempt: a 10 s timer that covers the headers AND the body read,
 * and a 64 KB byte cap (the file is about 1.8 KB) enforced while streaming
 * and up front from `content-length`. One retry on a network error or a 5xx;
 * none on a 4xx or a timeout. 403 and `text/html` are `blocked`; any content
 * type other than XML is `layout_changed`.
 *
 * `fetchEcbDaily` NEVER throws and logs nothing: every path returns an outcome,
 * and the route logs the summary. The body is returned to the caller and is
 * never logged or audited here or anywhere else.
 */

import 'server-only';

import type { RateSyncOutcome } from './rateSyncRules';

/** The ECB daily reference rates (SQ-35). The one URL this feature may fetch. */
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** An honest User-Agent naming the product (RR-1: no evasion). */
export const RATE_CHECK_USER_AGENT =
  'AgentPilot-RateCheck/1.0 (admin-triggered exchange rate review; one request per click)';

export const ECB_FETCH_TIMEOUT_MS = 10_000;

export interface EcbSource {
  readonly url: string;
  readonly accept: string;
  /** Content types read as the feed text; `text/html` is always `blocked`. */
  readonly contentTypes: readonly string[];
  readonly maxBytes: number;
}

export const ECB_SOURCE: EcbSource = {
  url: ECB_DAILY_URL,
  accept: 'application/xml, text/xml',
  contentTypes: ['text/xml', 'application/xml'],
  maxBytes: 64 * 1024,
};

/**
 * The same outcome strings as the price review's fetch. Here `layout_changed`
 * means an unlisted content type; the parser's anchors decide it later too.
 */
export type EcbFetchOutcome = RateSyncOutcome;

export interface EcbFetchResult {
  outcome: EcbFetchOutcome;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  bytes: number;
  durationMs: number;
  attempts: number;
  /** Present only when `outcome` is `ok`. Never log it. */
  text?: string;
}

export type EcbFetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface EcbFetchDeps {
  fetchImpl?: EcbFetchImpl;
  now?: () => number;
  timeoutMs?: number;
}

interface AttemptResult {
  outcome: EcbFetchOutcome;
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

async function attempt(source: EcbSource, fetchImpl: EcbFetchImpl, timeoutMs: number): Promise<AttemptResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(source.url, {
      method: 'GET',
      headers: { 'User-Agent': RATE_CHECK_USER_AGENT, Accept: source.accept },
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

/** Fetch the ECB daily file with the SQ-35 limits. Never throws, logs nothing. */
export async function fetchEcbDaily(deps: EcbFetchDeps = {}): Promise<EcbFetchResult> {
  const fetchImpl: EcbFetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? ECB_FETCH_TIMEOUT_MS;
  const started = now();
  try {
    let result = await attempt(ECB_SOURCE, fetchImpl, timeoutMs);
    let attempts = 1;
    if (result.retryable) {
      result = await attempt(ECB_SOURCE, fetchImpl, timeoutMs);
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
