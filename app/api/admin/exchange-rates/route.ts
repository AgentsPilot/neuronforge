/**
 * GET /api/admin/exchange-rates — every currency in `exchange_rates`, the
 * newest 50 rows of `exchange_rate_history`, and the server clock (`readAt`)
 * for the admin Exchange rates page (Admin Exchange Rates slice 1a, SA-R4).
 *
 * ADMIN ONLY: `requireAdmin` is the first statement (middleware does not
 * protect `/api`); nothing touches the database before it returns. No query
 * string is read.
 *
 * Data access goes through `exchangeRatesRepository` (CLAUDE.md rule 1); the
 * service role, and why these global tables have no `user_id` to scope by,
 * are documented in the repository's header. Rates are sent as the stored
 * decimal strings; nothing here converts money (D-5).
 *
 * Both reads must succeed: one 500 for either (SA R-3), with the failed read
 * named in the log (`failed: 'rates' | 'history'`). Internal error text is
 * returned only in development. A plain read: no audit row.
 *
 * @module app/api/admin/exchange-rates
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import type { ExchangeRatesPayload } from '@/lib/admin/exchangeRates/exchangeRateRules';
import { createLogger } from '@/lib/logger';
import {
  exchangeRatesRepository,
  toExchangeRateHistoryWire,
  toExchangeRateWire,
} from '@/lib/repositories/ExchangeRatesRepository';

// Node: Pino and the repository are Node-only. An admin- and cookie-dependent
// GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminExchangeRatesAPI' });

function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

function readFailed(error: unknown) {
  return NextResponse.json(
    { success: false, error: 'Failed to read exchange rates', details: devDetails(error) },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  // Admin gate. Nothing above this line may touch the database.
  const gate = await requireAdmin(logger.child({ route: 'admin-exchange-rates', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const [rates, history] = await Promise.all([
      exchangeRatesRepository.listAll(),
      exchangeRatesRepository.listRecentHistory(),
    ]);

    if (rates.error || !rates.data) {
      requestLogger.error({ err: rates.error, failed: 'rates' }, 'Exchange rates read failed');
      return readFailed(rates.error);
    }
    if (history.error || !history.data) {
      requestLogger.error({ err: history.error, failed: 'history' }, 'Exchange rates read failed');
      return readFailed(history.error);
    }

    const payload: ExchangeRatesPayload = {
      rates: rates.data.map(toExchangeRateWire),
      history: history.data.map(toExchangeRateHistoryWire),
      readAt: new Date().toISOString(),
    };
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error reading exchange rates');
    return readFailed(error);
  }
}
