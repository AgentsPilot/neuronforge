import 'server-only';

/**
 * The exchange rates for the client payments approximate-dollar figure (FIN
 * BD-56; requirement ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md, SA-RR-CPU
 * SA-Q-1; workplan docs/workplans/CLIENT_PAYMENTS_USD_1A_WORKPLAN.md §2.2).
 *
 * WHY HERE: the finance lib may never read a rate (CUR-3). As MRR enters
 * Finance through `lib/admin/billing/financeMrr`, rates enter through this one
 * wiring, which the finance route calls in the same request as the payments
 * (SA-Q-8: no cache), and the pure converter `clientPaymentsUsd.ts` uses.
 *
 * READ: the existing `listAll` (every currency, enabled or not, rates as
 * text; bounded reference data, one row per currency). No new method.
 *
 * NEVER THROWS: a failed read is `{ status: 'failed' }`; the figure then
 * counts US-dollar payments only and says "at least".
 *
 * Server-only: the repository holds the service-role client. The one caller
 * is the admin finance route, after `requireAdmin` (pinned by
 * clientPaymentsUsd.source.guard). Logs carry the error or a row count only,
 * never a rate or a code (EX-4).
 *
 * @module lib/admin/exchangeRates/clientPaymentRates
 */

import { createLogger } from '@/lib/logger';
import {
  exchangeRatesRepository,
  toExchangeRateWire,
  type ExchangeRatesRepository,
} from '@/lib/repositories/ExchangeRatesRepository';

import type { ClientPaymentRate, ClientPaymentRatesRead } from './clientPaymentsUsd';

const logger = createLogger({ module: 'AdminClientPaymentRates' });

/** For tests; production uses the repository singleton. */
export interface ClientPaymentRatesDeps {
  reader?: Pick<ExchangeRatesRepository, 'listAll'>;
}

/** The current rates, narrowed field by field. */
export async function readClientPaymentRates(deps: ClientPaymentRatesDeps = {}): Promise<ClientPaymentRatesRead> {
  const reader = deps.reader ?? exchangeRatesRepository;
  try {
    const result = await reader.listAll();
    if (result.error || !result.data) {
      logger.warn({ err: result.error ?? new Error('no data') }, 'Exchange rates read failed for client payments');
      return { status: 'failed' };
    }
    const rates: ClientPaymentRate[] = result.data.map((row) => {
      // One rule for a null is_enabled (disabled), the admin API's own.
      const wire = toExchangeRateWire(row);
      return { code: wire.currencyCode, rate: wire.rateToUsd, enabled: wire.isEnabled, lastUpdatedAt: wire.lastUpdatedAt };
    });
    logger.debug({ rows: result.data.length }, 'Exchange rates read for client payments');
    return { status: 'ok', rates };
  } catch (err) {
    logger.warn({ err }, 'Exchange rates read failed for client payments');
    return { status: 'failed' };
  }
}
