/**
 * PATCH /api/admin/exchange-rates/<CODE> — set ONE currency's rate to USD, or
 * switch ONE currency on or off (Admin Exchange Rates slice 1a; requirement
 * §13 SQ-3, SQ-5 as amended by SA O-1, SA-R6 to SA-R10).
 *
 *   { "field": "rate", "rate": "3.71" }       a decimal string, never a number
 *   { "field": "enabled", "isEnabled": false }
 *
 * Order, and nothing written before the last write step:
 *   requireAdmin (401 / 403) → 400 path code (`^[A-Z]{3}$`) → 400 body (JSON,
 *   then a strict discriminated union: unknown keys refused, so no
 *   `updated_by` can be smuggled in) → 400 base currency (USD: the rate is
 *   fixed at 1 and it cannot be disabled; pure, before any read) → pre-read
 *   (500 / 404 unknown code) → 409 a stale `expectedRate` (slice 1e) → ONE
 *   update carrying the change,
 *   `last_updated_at` and `updated_by` = the admin from `requireAdmin` (SA-R7)
 *   → audit with logAndFlush (WC-7) → 200.
 *
 * A save of the stored value is allowed and means "confirmed for this month"
 * (SA-R7): the date refreshes, the database trigger writes no history row,
 * and the audit records oldValue equal to newValue. The answer says
 * `unchanged: true`.
 *
 * Accepting a synced suggestion (slice 1e, SA §13.7 SQ-43 / SQ-44, §13.8
 * SQ-50): the `rate` body may carry two optional keys.
 *   { "field": "rate", "rate": "3.121505", "expectedRate": "3.09",
 *     "origin": { "kind": "sync", "source": "ecb", "rateDate": "2026-10-23" } }
 *   - `expectedRate` is the rate the sync compared against. After the
 *     pre-read, a stored rate that is not the same number → 409
 *     `{ code: 'rate_changed' }` "This rate changed since you synced. Sync
 *     again.", with NO write and NO audit. (The sub-second gap between the
 *     pre-read and the update is accepted, SQ-44.)
 *   - `origin` requires `expectedRate` (400 otherwise). With it, the save is
 *     audited as `EXCHANGE_RATE_SUGGESTION_ACCEPTED` INSTEAD of
 *     `EXCHANGE_RATE_UPDATED` (one save, one entry), with details
 *     `{ currencyCode, field, oldValue, newValue, unchanged, origin, gap }`: a
 *     superset of the sibling's. `gap` is computed HERE from the pre-read and
 *     the stored value, never taken from the page; `origin` is page-reported
 *     and kept for the record only. "Confirm (no change)" is the same event
 *     with `unchanged: true`.
 *   - Without either key the request and its audit are exactly as before: a
 *     manual edit still writes `EXCHANGE_RATE_UPDATED`.
 *
 * The currency code comes ONLY from the path. Logs carry the code and field,
 * never an email or a body. Nothing here converts money (D-5).
 *
 * @module app/api/admin/exchange-rates/[currencyCode]
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import {
  BASE_CURRENCY,
  currencyCodeSchema,
  patchBodySchema,
  sameRate,
  type ExchangeRatePatchResult,
} from '@/lib/admin/exchangeRates/exchangeRateRules';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { rateGap, type RateGap } from '@/lib/admin/exchangeRates/rateMath';
import { createLogger, type Logger } from '@/lib/logger';
import { exchangeRatesRepository, toExchangeRateWire } from '@/lib/repositories/ExchangeRatesRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminExchangeRatesAPI' });

function devDetails(error: unknown): unknown {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : error;
}

function fail(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error, details: process.env.NODE_ENV === 'development' ? details : undefined },
    { status }
  );
}

/**
 * The server's own gap for the accept entry (SQ-50 (1)). The stored rates are
 * always above 0 (the column's CHECK), so this cannot fail in practice; if it
 * ever did, the saved change must still stand, so the entry carries null.
 */
function acceptedGap(oldValue: string, newValue: string, requestLogger: Logger, currencyCode: string): RateGap | null {
  try {
    return rateGap(oldValue, newValue);
  } catch (err) {
    requestLogger.warn({ err, currencyCode }, 'Accepted exchange rate gap could not be computed');
    return null;
  }
}

export async function PATCH(request: NextRequest, context: { params: { currencyCode: string } }) {
  // Admin gate. Nothing above this line may touch a request body or the database.
  const gate = await requireAdmin(logger.child({ route: 'admin-exchange-rates', method: 'PATCH' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const parsedCode = currencyCodeSchema.safeParse(context.params.currencyCode);
    if (!parsedCode.success) {
      return fail(400, 'Invalid currency code');
    }
    const currencyCode = parsedCode.data;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'Invalid input', 'Request body is not valid JSON');
    }
    const parsed = patchBodySchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ currencyCode, issues: parsed.error.flatten() }, 'Invalid exchange rate change');
      return fail(400, 'Invalid input', parsed.error.flatten());
    }
    const change = parsed.data;

    // SA-R8: the base currency. Pure, so nothing is read for a refused request.
    if (currencyCode === BASE_CURRENCY) {
      if (change.field === 'rate') {
        return fail(400, 'The USD rate is fixed at 1 and cannot be edited');
      }
      if (!change.isEnabled) {
        return fail(400, 'USD cannot be disabled');
      }
    }

    const before = await exchangeRatesRepository.findByCode(currencyCode);
    if (before.error) {
      requestLogger.error({ err: before.error, currencyCode, field: change.field }, 'Exchange rate pre-read failed');
      return fail(500, 'Failed to update the exchange rate', devDetails(before.error));
    }
    if (!before.data) {
      requestLogger.info({ currencyCode, field: change.field }, 'Exchange rate change refused: unknown currency');
      return fail(404, 'Unknown currency');
    }
    const previous = before.data;

    // SQ-44: an accept made against a base that has since changed is refused,
    // before any write and with no audit. A manual edit never sends expectedRate.
    if (change.field === 'rate' && change.expectedRate !== undefined && !sameRate(previous.rate_to_usd, change.expectedRate)) {
      requestLogger.info({ currencyCode, field: change.field }, 'Exchange rate accept refused: the rate changed since the sync');
      return NextResponse.json(
        { success: false, error: 'This rate changed since you synced. Sync again.', code: 'rate_changed' },
        { status: 409 }
      );
    }

    const after =
      change.field === 'rate'
        ? await exchangeRatesRepository.updateRate(currencyCode, change.rate, adminId)
        : await exchangeRatesRepository.setEnabled(currencyCode, change.isEnabled, adminId);
    if (after.error) {
      requestLogger.error({ err: after.error, currencyCode, field: change.field }, 'Exchange rate update failed');
      return fail(500, 'Failed to update the exchange rate', devDetails(after.error));
    }
    if (!after.data) {
      requestLogger.warn({ currencyCode, field: change.field }, 'Exchange rate row vanished before the update');
      return fail(404, 'Unknown currency');
    }
    const updated = after.data;

    // SA-R9: oldValue from the pre-read, RAW (a null enabled flag stays null);
    // the trigger's history row is the atomic record of the true old rate.
    const oldValue = change.field === 'rate' ? previous.rate_to_usd : previous.is_enabled;
    const newValue = change.field === 'rate' ? updated.rate_to_usd : updated.is_enabled;
    const unchanged =
      change.field === 'rate'
        ? sameRate(previous.rate_to_usd, updated.rate_to_usd)
        : previous.is_enabled === updated.is_enabled;

    // SQ-50: an accepted suggestion is its own event; anything else is exactly as before.
    const accepted = change.field === 'rate' && change.origin !== undefined ? change.origin : null;
    await logAndFlush(
      {
        action: accepted
          ? AUDIT_EVENTS.EXCHANGE_RATE_SUGGESTION_ACCEPTED
          : change.field === 'rate'
            ? AUDIT_EVENTS.EXCHANGE_RATE_UPDATED
            : AUDIT_EVENTS.EXCHANGE_RATE_ENABLED_CHANGED,
        entityType: 'exchange_rate',
        entityId: currencyCode,
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        details: accepted
          ? {
              currencyCode,
              field: change.field,
              oldValue,
              newValue,
              unchanged,
              origin: accepted,
              gap: acceptedGap(previous.rate_to_usd, updated.rate_to_usd, requestLogger, currencyCode),
            }
          : { currencyCode, field: change.field, oldValue, newValue },
        request,
      },
      requestLogger,
      { reason: 'exchange rate change', continues: 'the saved change stands' }
    );

    requestLogger.info({ currencyCode, field: change.field, unchanged, accepted: accepted !== null }, 'Exchange rate changed');
    const result: ExchangeRatePatchResult = { rate: toExchangeRateWire(updated), unchanged };
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error changing an exchange rate');
    return fail(500, 'Failed to update the exchange rate', devDetails(error));
  }
}
