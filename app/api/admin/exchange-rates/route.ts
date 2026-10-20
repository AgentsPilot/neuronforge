/**
 * GET /api/admin/exchange-rates — the admin Exchange rates page's one read
 * (Admin Exchange Rates slice 1a, SA-R4; slice 1c.1, SQ-12 / SQ-13).
 *
 *   GET /api/admin/exchange-rates                every currency in `exchange_rates`,
 *                                                the newest HISTORY_LIMIT (10) rows of
 *                                                `exchange_rate_history`, `nameLookup`
 *                                                and the server clock (`readAt`)
 *   GET /api/admin/exchange-rates?currency=XXX   that currency's newest HISTORY_LIMIT
 *                                                rows only (`ExchangeRateHistoryPayload`:
 *                                                never rates, so the page cannot take its
 *                                                KPIs from it)
 *
 * ADMIN ONLY: `requireAdmin` is the first statement (middleware does not
 * protect `/api`); nothing touches the database before it returns.
 *
 * The query string is parsed with Zod right after the gate and before any
 * read: a repeated key, any key other than `currency`, or a code that is not
 * three upper-case letters → 400. A well-formed code with no such currency →
 * 404, and no history is read. The history limit is a fixed constant: nothing
 * from the request reaches it.
 *
 * "Changed by" labels (SQ-13, SA Q-1): the editor ids come only from the
 * history rows this route read, never from the request. Each is turned into
 * the admin's name (`profiles.full_name`), else their admin email (deactivated
 * admins included), else "Unknown user". Both lookups run in parallel; ANY
 * failure, returned or thrown, from either source → still 200, `nameLookup:
 * 'failed'` and no label for any looked-up editor (never a half-resolved
 * list). The two repository calls stay in this file: the caller guard in
 * `lib/repositories/__tests__/adminReadMethods.guard.test.ts` allows them only
 * under `app/api/admin/**` (SA-1c-6). Logs carry counts, the currency code and
 * `nameLookup` only: never a name or an email (SA-1c-7).
 *
 * Data access goes through repositories (CLAUDE.md rule 1); the service role,
 * and why these global tables have no `user_id` to scope by, are documented in
 * `ExchangeRatesRepository`'s header. Rates are sent as the stored decimal
 * strings; nothing here converts money (D-5).
 *
 * Every read must succeed: one 500 for any of them (SA R-3), with the failed
 * read named in the log (`failed: 'rates' | 'history' | 'currency'`).
 * Internal error text is returned only in development. A plain read: no audit
 * row.
 *
 * @module app/api/admin/exchange-rates
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import {
  exchangeRatesQuerySchema,
  historyEditorIds,
  labelHistory,
  type EditorLookup,
  type ExchangeRateHistoryPayload,
  type ExchangeRateHistoryRecord,
  type ExchangeRatesPayload,
  type NameLookupStatus,
} from '@/lib/admin/exchangeRates/exchangeRateRules';
import { createLogger, type Logger } from '@/lib/logger';
import { adminUserRepository } from '@/lib/repositories/AdminUserRepository';
import {
  exchangeRatesRepository,
  toExchangeRateHistoryRecord,
  toExchangeRateWire,
} from '@/lib/repositories/ExchangeRatesRepository';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
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

function badQuery(details?: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: 'Invalid query',
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
    { status: 400 }
  );
}

type LookupSource = 'names' | 'emails';

/**
 * Resolve the editors of `records` (SQ-13). Module-private on purpose: a
 * Next.js `route.ts` may export only handlers and route config. Returns the
 * labelled rows and the lookup status; never throws.
 */
async function resolveLabels(
  records: readonly ExchangeRateHistoryRecord[],
  requestLogger: Logger
): Promise<{ history: ExchangeRatesPayload['history']; nameLookup: NameLookupStatus }> {
  const ids = historyEditorIds(records);
  if (ids.length === 0) {
    return { history: labelHistory(records, { status: 'ok', names: new Map(), emails: new Map() }), nameLookup: 'ok' };
  }

  // Each source: a returned error and a thrown error are the same failure.
  const settle = async <T>(
    source: LookupSource,
    run: () => Promise<{ data: T[] | null; error: Error | null }>
  ): Promise<{ source: LookupSource; rows: T[] | null; err?: unknown }> => {
    try {
      const result = await run();
      if (result.error || !result.data) return { source, rows: null, err: result.error };
      return { source, rows: result.data };
    } catch (err) {
      return { source, rows: null, err };
    }
  };

  const [names, emails] = await Promise.all([
    settle('names', () => userProfileRepository.findAdminNamesByIds(ids)),
    settle('emails', () => adminUserRepository.findEmailsByUserIds(ids)),
  ]);

  const failures = [names, emails].filter((outcome) => outcome.rows === null);
  // `failures.length > 0` decides; the `!names.rows || !emails.rows` clauses add nothing at
  // runtime and are only there so TypeScript narrows both `rows` to non-null below.
  if (failures.length > 0 || !names.rows || !emails.rows) {
    // Counts and the failed sources only: never a name or an email.
    requestLogger.error(
      {
        err: failures[0]?.err,
        failed: failures.map((outcome) => outcome.source),
        requested: ids.length,
        nameLookup: 'failed',
      },
      'Editor name lookup failed; history served without editor labels'
    );
    return { history: labelHistory(records, { status: 'failed' }), nameLookup: 'failed' };
  }

  const nameMap = new Map<string, string>();
  for (const row of names.rows) {
    const name = row.full_name?.trim();
    if (name) nameMap.set(row.id, name);
  }
  const emailMap = new Map<string, string>();
  for (const row of emails.rows) {
    if (row.user_id && row.email) emailMap.set(row.user_id, row.email);
  }

  const lookup: EditorLookup = { status: 'ok', names: nameMap, emails: emailMap };
  requestLogger.debug(
    { requested: ids.length, named: nameMap.size, emailed: emailMap.size, nameLookup: 'ok' },
    'Editor labels resolved'
  );
  return { history: labelHistory(records, lookup), nameLookup: 'ok' };
}

export async function GET(request: NextRequest) {
  // Admin gate. Nothing above this line may touch the database.
  const gate = await requireAdmin(logger.child({ route: 'admin-exchange-rates', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  // The query, before any read (SQ-12). A repeated key is refused outright:
  // `Object.fromEntries` would silently keep only the last value.
  const params = request.nextUrl.searchParams;
  const repeated = [...new Set(params.keys())].some((key) => params.getAll(key).length > 1);
  if (repeated) {
    requestLogger.warn({ reason: 'repeated key' }, 'Exchange rates query refused');
    return badQuery('A query key appears more than once');
  }
  const query = exchangeRatesQuerySchema.safeParse(Object.fromEntries(params));
  if (!query.success) {
    requestLogger.warn({ reason: 'invalid query' }, 'Exchange rates query refused');
    return badQuery(query.error.issues);
  }

  try {
    const currencyCode = query.data.currency;

    if (currencyCode) {
      const currency = await exchangeRatesRepository.findByCode(currencyCode);
      if (currency.error) {
        requestLogger.error({ err: currency.error, failed: 'currency', currencyCode }, 'Exchange rates read failed');
        return readFailed(currency.error);
      }
      if (!currency.data) {
        requestLogger.info({ currencyCode }, 'Exchange rate history for an unknown currency');
        return NextResponse.json({ success: false, error: 'Unknown currency' }, { status: 404 });
      }

      const history = await exchangeRatesRepository.listRecentHistoryForCurrency(currencyCode);
      if (history.error || !history.data) {
        requestLogger.error({ err: history.error, failed: 'history', currencyCode }, 'Exchange rates read failed');
        return readFailed(history.error);
      }

      const labelled = await resolveLabels(history.data.map(toExchangeRateHistoryRecord), requestLogger);
      const payload: ExchangeRateHistoryPayload = {
        currencyCode,
        history: labelled.history,
        nameLookup: labelled.nameLookup,
        readAt: new Date().toISOString(),
      };
      return NextResponse.json({ success: true, data: payload });
    }

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

    const labelled = await resolveLabels(history.data.map(toExchangeRateHistoryRecord), requestLogger);
    const payload: ExchangeRatesPayload = {
      rates: rates.data.map(toExchangeRateWire),
      history: labelled.history,
      nameLookup: labelled.nameLookup,
      readAt: new Date().toISOString(),
    };
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error reading exchange rates');
    return readFailed(error);
  }
}
