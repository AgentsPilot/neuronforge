/**
 * The one read of the price comparison (AI model price review slice 4).
 *
 * Kept out of `page.tsx` so the page's source guard (which counts the pricing
 * route literals and bans other `/api/` strings there) is unchanged. It never
 * throws: a rejected fetch comes back as a failure with the shared network
 * words, so the page can say WHICH read failed (SA N-4).
 */

import type { ComparisonModel } from '@/lib/ai/pricing-research/comparisonModel';
import { clientLogger } from '@/lib/logger/client';

import { ADMIN_NETWORK_ERROR, readAdminResponse, type AdminReadResult } from '@/app/admin/components/layout/readAdminResponse';

const logger = clientLogger.child({ module: 'AdminPriceComparisonRead' });

export const PRICE_COMPARISON_URL = '/api/admin/model-pricing/comparison';

export async function readPriceComparison(): Promise<AdminReadResult<ComparisonModel>> {
  try {
    const response = await fetch(PRICE_COMPARISON_URL, { method: 'GET', cache: 'no-store' });
    const result = await readAdminResponse<ComparisonModel>(response, { what: 'the price comparison', sessionEndedCopy: true });
    if (result.ok && !Array.isArray(result.data?.rows)) {
      logger.error({ status: result.status }, 'Price comparison body had no rows');
      return { ok: false, status: result.status, message: 'Could not read the price comparison. Try again in a moment.' };
    }
    return result;
  } catch (err) {
    logger.warn({ err }, 'Price comparison read threw');
    return { ok: false, status: 0, message: ADMIN_NETWORK_ERROR };
  }
}
