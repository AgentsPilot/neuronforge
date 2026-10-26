/**
 * POST /api/admin/exchange-rates/sync — "Sync rates" (Admin Exchange Rates
 * slice 1e; requirement §5.7, FR-35 to FR-44; SA §13.7 SQ-35, SQ-39, SQ-47,
 * SA-1e-7).
 *
 * One click reads the ECB daily reference rates, derives a per-USD rate for
 * every ENABLED currency except USD, and answers with a suggestion and a gap
 * per currency. It is READ-ONLY: nothing is written to `exchange_rates` or
 * `exchange_rate_history` (no repository write method is imported), and a rate
 * changes only when an admin accepts one row through the existing PATCH.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST (nothing above it reads the body, the database or the
 *   network) → correlationId child logger → body read as text (empty → `{}`,
 *   not JSON → 400) → strict empty object (400 `invalid_input`) → `listAll()`
 *   (an error → 500, and NO fetch is made) → one fetch of the pinned ECB URL →
 *   parse (anchors E1 to E5) → per-USD rates → gap per suggested row → audit
 *   `EXCHANGE_RATE_SYNC_RUN` (logAndFlush) → one Pino line → answer. No server
 *   cache and no refusal window (SQ-46): every answer is a fresh fetch.
 *
 * ── Security ─────────────────────────────────────────────────────────────
 *   No input: no URL, currency list, rate or source can be supplied. The one
 *   URL is a constant in the server-only `ecbFeed.ts`. The feed body is never
 *   logged or audited. The currencies and their current rates come from the
 *   server (`exchange_rates` is a global, admin-only table; the rule 4
 *   exemption is documented in `ExchangeRatesRepository`). No LLM reads the
 *   feed (RR-1), and there is no caller-supplied id or tenant.
 *
 * ── Answers ──────────────────────────────────────────────────────────────
 *   200 the sync ran: `outcome` is `ok` with suggestions, or a source failure
 *   (`timeout`, `http_*`, `blocked`, `layout_changed`, …) with none · 400 a
 *   body that is not an empty object · 401 signed out · 403 not an admin ·
 *   500 anything unexpected (details only in development).
 *
 * SQ-42: the suggested rate is derived from two rates of one official feed,
 * and the gap compares two rates of one currency. No amount of money is
 * converted or summed, and the answer carries no amount (D-5).
 *
 * @module app/api/admin/exchange-rates/sync
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { parseEcbDaily, perUsdRates, type EcbAnchor } from '@/lib/admin/exchangeRates/ecbRates';
import { fetchEcbDaily } from '@/lib/admin/exchangeRates/ecbFeed';
import { BASE_CURRENCY } from '@/lib/admin/exchangeRates/exchangeRateRules';
import { rateGap } from '@/lib/admin/exchangeRates/rateMath';
import {
  SYNC_SOURCE_LABEL,
  syncBodySchema,
  type ExchangeRateSyncPayload,
  type RateSuggestionWire,
  type RateSyncOutcome,
} from '@/lib/admin/exchangeRates/rateSyncRules';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import { exchangeRatesRepository, toExchangeRateWire } from '@/lib/repositories/ExchangeRatesRepository';

// Node: Pino, the repositories and the streamed read are Node-only. Two 10 s
// attempts plus margin (SQ-39). An admin- and cookie-dependent POST is never cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const logger = createLogger({ module: 'AdminExchangeRatesSync' });

function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

function noInput() {
  return NextResponse.json(
    { success: false, error: 'This action takes no input.', code: 'invalid_input' },
    { status: 400 }
  );
}

function syncFailed(error: unknown) {
  return NextResponse.json(
    { success: false, error: 'Failed to sync exchange rates', details: devDetails(error) },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  // Admin gate. Nothing above this line may touch the body, the database or the network.
  const gate = await requireAdmin(logger.child({ route: 'admin-exchange-rates-sync', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const adminId = gate.user.id;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    // An empty body is `{}` (the page sends `{}`; a bare POST is the same request).
    const text = await request.text().catch(() => '');
    let input: unknown = {};
    if (text.trim() !== '') {
      try {
        input = JSON.parse(text);
      } catch {
        requestLogger.warn({ reason: 'not JSON' }, 'Exchange rate sync refused: it takes no input');
        return noInput();
      }
    }
    if (!syncBodySchema.safeParse(input).success) {
      requestLogger.warn({ reason: 'unexpected input' }, 'Exchange rate sync refused: it takes no input');
      return noInput();
    }

    const rates = await exchangeRatesRepository.listAll();
    if (rates.error || !rates.data) {
      requestLogger.error({ err: rates.error, failed: 'rates' }, 'Exchange rate sync: rates read failed');
      return syncFailed(rates.error);
    }
    const current = rates.data
      .map(toExchangeRateWire)
      .filter((rate) => rate.isEnabled && rate.currencyCode !== BASE_CURRENCY);
    const currentByCode = new Map(current.map((rate) => [rate.currencyCode, rate.rateToUsd]));

    const fetchedAt = new Date().toISOString();
    const feed = await fetchEcbDaily();

    let outcome: RateSyncOutcome = feed.outcome;
    let anchor: EcbAnchor | null = null;
    let rateDate: string | null = null;
    let suggestions: RateSuggestionWire[] = [];
    if (feed.outcome === 'ok') {
      const parsed = parseEcbDaily(feed.text ?? '');
      if (!parsed.ok) {
        outcome = 'layout_changed';
        anchor = parsed.anchor;
      } else {
        rateDate = parsed.rateDate;
        suggestions = perUsdRates(
          parsed.perEur,
          current.map((rate) => rate.currencyCode)
        ).map((derived): RateSuggestionWire => {
          const currentRate = currentByCode.get(derived.currencyCode) ?? '';
          if (derived.status !== 'suggested' || derived.suggestedRate === null) {
            return {
              currencyCode: derived.currencyCode,
              currentRate,
              status: derived.status,
              suggestedRate: null,
              gapAbsolute: null,
              gapPercent: null,
              direction: null,
            };
          }
          const gap = rateGap(currentRate, derived.suggestedRate);
          return {
            currencyCode: derived.currencyCode,
            currentRate,
            status: 'suggested',
            suggestedRate: derived.suggestedRate,
            gapAbsolute: gap.gapAbsolute,
            gapPercent: gap.gapPercent,
            direction: gap.direction,
          };
        });
      }
    }

    // SQ-47: one entry per accepted POST, success and source failure alike. What
    // the feed said, bounded by the enabled currencies; never the body.
    await logAndFlush(
      {
        action: AUDIT_EVENTS.EXCHANGE_RATE_SYNC_RUN,
        entityType: 'exchange_rate',
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        details: {
          source: 'ecb',
          outcome,
          rateDate,
          durationMs: feed.durationMs,
          attempts: feed.attempts,
          bytes: feed.bytes,
          currencies: suggestions.map((suggestion) => ({
            currencyCode: suggestion.currencyCode,
            currentRate: suggestion.currentRate,
            suggestedRate: suggestion.suggestedRate,
            status: suggestion.status,
          })),
        },
        request,
      },
      requestLogger,
      { reason: 'exchange rate sync', continues: 'the suggestions are still shown' }
    );

    // One line per sync: counts and the outcome only, never the feed text.
    const summary = {
      outcome,
      status: feed.status,
      durationMs: feed.durationMs,
      attempts: feed.attempts,
      bytes: feed.bytes,
      currencies: current.length,
      anchor,
    };
    if (outcome === 'ok') requestLogger.info(summary, 'Exchange rate sync read the ECB rates');
    else requestLogger.warn(summary, 'Exchange rate sync could not read the ECB rates');

    const payload: ExchangeRateSyncPayload = {
      source: SYNC_SOURCE_LABEL,
      outcome,
      rateDate,
      fetchedAt,
      suggestions,
    };
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error syncing exchange rates');
    return syncFailed(error);
  }
}
