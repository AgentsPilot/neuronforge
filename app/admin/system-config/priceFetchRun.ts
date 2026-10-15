/**
 * The browser side of "Check provider prices" (AI model price review slice 5).
 * The only file that names `/api/admin/model-pricing/fetch-runs` (slice 4 rule:
 * one file per route URL, `page.tsx` names none).
 *
 * Neither call throws: a rejected fetch comes back as a failure with the
 * shared network words. The server's own message is shown verbatim (a 409
 * already says how many seconds to wait), so this file parses no number.
 */

import type { FetchRunSummary, FetchStatus } from '@/lib/ai/pricing-research/fetchOutcomes';
import { clientLogger } from '@/lib/logger/client';

import { ADMIN_NETWORK_ERROR, readAdminResponse, type AdminReadResult } from '@/app/admin/components/layout/readAdminResponse';

const logger = clientLogger.child({ module: 'AdminPriceFetchRun' });

export const PRICE_FETCH_RUNS_URL = '/api/admin/model-pricing/fetch-runs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function runPriceFetch(): Promise<AdminReadResult<FetchRunSummary>> {
  try {
    const response = await fetch(PRICE_FETCH_RUNS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    const result = await readAdminResponse<FetchRunSummary>(response, { what: 'the provider price check', sessionEndedCopy: true });
    if (result.ok && !(isRecord(result.data) && isRecord(result.data.providerOutcomes) && isRecord(result.data.providerOutcomes.openai))) {
      logger.error({ status: result.status }, 'Price check body had no outcomes');
      return { ok: false, status: result.status, message: 'Could not read the provider price check. Try again in a moment.' };
    }
    return result;
  } catch (err) {
    logger.warn({ err }, 'Provider price check request threw');
    return { ok: false, status: 0, message: ADMIN_NETWORK_ERROR };
  }
}

export async function readFetchStatus(): Promise<AdminReadResult<FetchStatus>> {
  try {
    const response = await fetch(PRICE_FETCH_RUNS_URL, { method: 'GET', cache: 'no-store' });
    const result = await readAdminResponse<FetchStatus>(response, { what: 'the provider price check status', sessionEndedCopy: true });
    // A body without both monitored sources is never drawn (as the comparison read checks `rows`).
    if (result.ok && !(isRecord(result.data) && isRecord(result.data.openai) && isRecord(result.data.litellm) && Array.isArray(result.data.manualProviders))) {
      logger.error({ status: result.status }, 'Price check status body had no sources');
      return { ok: false, status: result.status, message: 'Could not read the provider price check status. Try again in a moment.' };
    }
    return result;
  } catch (err) {
    logger.warn({ err }, 'Provider price check status read threw');
    return { ok: false, status: 0, message: ADMIN_NETWORK_ERROR };
  }
}
