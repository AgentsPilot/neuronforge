/**
 * The one read of a model's price history (AI model price review slice 9).
 *
 * The drawer's reader for `useDrawerResource`: the key is
 * `{kind}:{provider}:{model}` (`priceHistoryKey`; a model id never holds a
 * colon), the query is built with `URLSearchParams` (SA SC9-8), the body goes
 * through `readAdminResponse` and is then checked against the shared response
 * schema, so a price can never arrive as a number. It never throws: a rejected
 * fetch comes back as the shared network words (ignored by the hook after an
 * abort). Kept out
 * of `page.tsx`, so the page's one `fetch(` stays the pricing GET (NW-1).
 */

import { PriceHistoryDataSchema, type PriceHistoryData } from '@/lib/ai/pricing-research/priceHistorySchema';
import { clientLogger } from '@/lib/logger/client';

import type { DrawerRead } from '@/app/admin/components/layout/useDrawerResource';
import { ADMIN_NETWORK_ERROR, adminReadFallback, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { HISTORY_WORDS } from '@/app/admin/system-config/priceReviewCopy';

const logger = clientLogger.child({ module: 'AdminPriceHistoryRead' });

export const PRICE_HISTORY_URL = '/api/admin/model-pricing/history';

/** The drawer key of one model. */
export function priceHistoryKey(kind: 'token' | 'image', provider: string, modelName: string): string {
  return `${kind}:${provider}:${modelName}`;
}

export async function readPriceHistory(key: string, signal: AbortSignal): Promise<DrawerRead<PriceHistoryData>> {
  const [kind, provider, model, ...rest] = key.split(':');
  if (!kind || !provider || !model || rest.length > 0) {
    logger.error({ key }, 'Price history key is malformed');
    return { ok: false, message: adminReadFallback(HISTORY_WORDS.reading) };
  }
  const params = new URLSearchParams({ kind, provider, model });
  try {
    const response = await fetch(`${PRICE_HISTORY_URL}?${params.toString()}`, { method: 'GET', cache: 'no-store', signal });
    const result = await readAdminResponse<unknown>(response, { what: HISTORY_WORDS.reading, sessionEndedCopy: true });
    if (!result.ok) return { ok: false, message: result.message };
    const parsed = PriceHistoryDataSchema.safeParse(result.data);
    if (!parsed.success) {
      logger.error({ status: result.status }, 'Price history body did not match the schema');
      return { ok: false, message: adminReadFallback(HISTORY_WORDS.reading) };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    // After an abort (close, key change) the hook ignores whatever this answers.
    if (!signal.aborted) logger.warn({ err }, 'Price history read threw');
    return { ok: false, message: ADMIN_NETWORK_ERROR };
  }
}
