/**
 * GET /api/admin/exchange-rates — the admin Exchange rates page's one read
 * (Admin Exchange Rates slice 1a, SA-R4; slice 1c.1, SQ-12 / SQ-13; slice 1d,
 * SQ-26 to SQ-31; slice 1e, SA §13.8 SQ-51).
 *
 *   GET /api/admin/exchange-rates[?from=&to=]    every currency in `exchange_rates`,
 *                                                the newest HISTORY_LIMIT (10) rows of
 *                                                `exchange_rate_history` INSIDE the
 *                                                window, `lastChange` (the newest row
 *                                                of all time, whatever the window),
 *                                                `nameLookup`, the server clock
 *                                                (`readAt`), `lastSync` (the newest
 *                                                successful rate sync, slice 1e, and
 *                                                who ran it, slice 1f) and `viewer`
 *                                                (the signed-in admin, slice 1f)
 *   GET /api/admin/exchange-rates?currency=XXX[&from=&to=]
 *                                                that currency's newest HISTORY_LIMIT
 *                                                rows inside the window only
 *                                                (`ExchangeRateHistoryPayload`: never
 *                                                rates and never `lastChange`, so the
 *                                                page cannot take its KPIs from it)
 *
 * ADMIN ONLY: `requireAdmin` is the first statement (middleware does not
 * protect `/api`); nothing touches the database before it returns.
 *
 * The query string is parsed with Zod right after the gate and before any
 * read: a repeated key, any key other than `currency` / `from` / `to`, a code
 * that is not three upper-case letters, or a bad window → 400. The window is
 * two whole UTC dates `from` / `to` (inclusive), both or neither, `from` not
 * after `to`, each a real date in 2000-01-01..2999-12-31 (SA-1d-3). With
 * neither, the window is This month at the server clock (SQ-26). The dates are
 * turned into half-open instants on UTC midnights by `historyWindowBounds`
 * (SQ-28) and used for nothing else. A well-formed code with no such currency
 * → 404, and no history is read. The history limit is a fixed constant:
 * nothing from the request reaches it.
 *
 * "Changed by" labels (SQ-13, SA Q-1; slice 1d, SQ-31; slice 1f, SA §13.9
 * SQ-54, SQ-55): the ids come only from what this route read (the windowed
 * history rows plus `lastChange`; on the plain read also the last sync's
 * actor from its audit entry and the caller's id from the session gate),
 * never from the request. ONE lookup covers them all, so one admin reads the
 * same in every place and a failure is all or nothing. On the plain read the
 * caller is always in it, so the lookup always runs there. The caller comes
 * back as `viewer`, so the page can name the admin of a sync it just ran
 * without a new request (SQ-55 (a')). Each id is turned into the admin's name
 * (`profiles.full_name`), else their admin email (deactivated admins
 * included), else "Unknown user". Both lookups run in parallel; ANY failure,
 * returned or thrown, from either source → still 200, `nameLookup: 'failed'`
 * and no label for any looked-up id anywhere (never a half-resolved
 * answer). The two repository calls stay in this file: the caller guard in
 * `lib/repositories/__tests__/adminReadMethods.guard.test.ts` allows them only
 * under `app/api/admin/**` (SA-1c-6). Logs carry counts, the currency code,
 * the window dates (debug) and `nameLookup` only: never a name or an email
 * (SA-1c-7, SA-1d-9).
 *
 * Data access goes through repositories (CLAUDE.md rule 1); the service role,
 * and why these global tables have no `user_id` to scope by, are documented in
 * `ExchangeRatesRepository`'s header. Rates are sent as the stored decimal
 * strings; nothing here converts money (D-5).
 *
 * Every read must succeed: one 500 for any of them (SA R-3), with the failed
 * read named in the log (`failed: 'rates' | 'history' | 'lastChange' |
 * 'currency'`). Internal error text is returned only in development. A plain
 * read: no audit row.
 *
 * THE ONE EXCEPTION (slice 1e, SQ-51 (3)): `lastSync`, the "Rates last checked"
 * tile, is the fourth member of the plain read's `Promise.all` (no added
 * latency), read from the audit trail through
 * `AuditTrailRepository.findLatestAdminExchangeRateSync` (its only caller,
 * pinned by adminReadMethods.guard.test.ts). Its failure, returned or thrown,
 * is `{ status: 'unavailable' }` with a warn naming `failed: 'lastSync'`, and
 * NEVER a 500: the rates page works without the tile. The `?currency=` read
 * never reads it.
 *
 * @module app/api/admin/exchange-rates
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import {
  defaultHistoryWindowDates,
  editorLabel,
  exchangeRatesQuerySchema,
  historyEditorIds,
  historyWindowBounds,
  labelHistory,
  type EditorLookup,
  type ExchangeRateHistoryPayload,
  type NameLookupStatus,
} from '@/lib/admin/exchangeRates/exchangeRateRules';
import {
  labelLastSync,
  type ExchangeRatesReadPayload,
  type LastRateSyncRecord,
} from '@/lib/admin/exchangeRates/rateSyncRules';
import { createLogger, type Logger } from '@/lib/logger';
import { adminUserRepository } from '@/lib/repositories/AdminUserRepository';
import { auditTrailRepository } from '@/lib/repositories/AuditTrailRepository';
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
 * Resolve every admin id of the answer once (SQ-13; slice 1d, SQ-31; slice 1f,
 * SQ-54): the caller passes the distinct ids of everything it will send (the
 * history editors, the `lastChange` editor and, on the plain read, the sync
 * actor and the caller), then labels each with the same lookup, so they are
 * all-or-nothing together. Module-private on purpose: a Next.js `route.ts`
 * may export only handlers and route config. Never throws; logs counts only.
 */
async function resolveLookup(
  ids: readonly string[],
  requestLogger: Logger
): Promise<{ lookup: EditorLookup; nameLookup: NameLookupStatus }> {
  if (ids.length === 0) {
    return { lookup: { status: 'ok', names: new Map(), emails: new Map() }, nameLookup: 'ok' };
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
    return { lookup: { status: 'failed' }, nameLookup: 'failed' };
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

  requestLogger.debug(
    { requested: ids.length, named: nameMap.size, emailed: emailMap.size, nameLookup: 'ok' },
    'Editor labels resolved'
  );
  return { lookup: { status: 'ok', names: nameMap, emails: emailMap }, nameLookup: 'ok' };
}

/**
 * The "Rates last checked" tile's value (SQ-51 (3)), with the actor still
 * unlabelled (slice 1f, SQ-54: `labelLastSync` labels it with the one lookup).
 * A returned error and a thrown error are the same failure: `unavailable`,
 * logged as a warn, never a 500. Module-private on purpose (a `route.ts` may
 * export only handlers).
 */
async function settleLastSync(adminId: string, correlationId: string, requestLogger: Logger): Promise<LastRateSyncRecord> {
  try {
    const result = await auditTrailRepository.findLatestAdminExchangeRateSync({ correlationId, adminId });
    if (result.error) {
      requestLogger.warn({ err: result.error, failed: 'lastSync' }, 'Last rate sync read failed; the tile shows unavailable');
      return { status: 'unavailable' };
    }
    return result.data
      ? { status: 'ok', checkedAt: result.data.checkedAt, rateDate: result.data.rateDate, checkedBy: result.data.checkedBy }
      : { status: 'none' };
  } catch (err) {
    requestLogger.warn({ err, failed: 'lastSync' }, 'Last rate sync read failed; the tile shows unavailable');
    return { status: 'unavailable' };
  }
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
    // The schema guarantees both dates or neither (SQ-26); neither → This month now.
    const dates =
      query.data.from !== undefined && query.data.to !== undefined
        ? { from: query.data.from, to: query.data.to }
        : defaultHistoryWindowDates(new Date());
    const bounds = historyWindowBounds(dates);
    // Whole dates are not personal data (SA-1d-9).
    requestLogger.debug({ from: dates.from, to: dates.to, currencyCode }, 'Exchange rates history window');

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

      const history = await exchangeRatesRepository.listRecentHistoryForCurrency(currencyCode, bounds);
      if (history.error || !history.data) {
        requestLogger.error({ err: history.error, failed: 'history', currencyCode }, 'Exchange rates read failed');
        return readFailed(history.error);
      }

      const records = history.data.map(toExchangeRateHistoryRecord);
      const { lookup, nameLookup } = await resolveLookup(historyEditorIds(records), requestLogger);
      const payload: ExchangeRateHistoryPayload = {
        currencyCode,
        history: labelHistory(records, lookup),
        nameLookup,
        readAt: new Date().toISOString(),
      };
      return NextResponse.json({ success: true, data: payload });
    }

    const [rates, history, latest, lastSyncRecord] = await Promise.all([
      exchangeRatesRepository.listAll(),
      exchangeRatesRepository.listRecentHistory(bounds),
      exchangeRatesRepository.findLatestChange(),
      // Slice 1e (SQ-51 (3)): never rejects, never a 500.
      settleLastSync(gate.user.id, correlationId, requestLogger),
    ]);

    if (rates.error || !rates.data) {
      requestLogger.error({ err: rates.error, failed: 'rates' }, 'Exchange rates read failed');
      return readFailed(rates.error);
    }
    if (history.error || !history.data) {
      requestLogger.error({ err: history.error, failed: 'history' }, 'Exchange rates read failed');
      return readFailed(history.error);
    }
    if (latest.error) {
      requestLogger.error({ err: latest.error, failed: 'lastChange' }, 'Exchange rates read failed');
      return readFailed(latest.error);
    }

    const records = history.data.map(toExchangeRateHistoryRecord);
    const latestRecord = latest.data ? toExchangeRateHistoryRecord(latest.data) : null;
    const allRecords = latestRecord ? [...records, latestRecord] : records;
    // One lookup over every id of the answer (SQ-31; slice 1f, SQ-54, SQ-55): the
    // history editors, the "Last rate change" editor, the sync actor and the
    // caller. The same admin is labelled the same everywhere.
    const ids = [
      ...new Set([
        ...historyEditorIds(allRecords),
        ...(lastSyncRecord.status === 'ok' && lastSyncRecord.checkedBy ? [lastSyncRecord.checkedBy] : []),
        gate.user.id,
      ]),
    ];
    const { lookup, nameLookup } = await resolveLookup(ids, requestLogger);
    const payload: ExchangeRatesReadPayload = {
      rates: rates.data.map(toExchangeRateWire),
      history: labelHistory(records, lookup),
      lastChange: latestRecord ? labelHistory([latestRecord], lookup)[0] : null,
      nameLookup,
      readAt: new Date().toISOString(),
      lastSync: labelLastSync(lastSyncRecord, lookup),
      // SQ-55 (a'): the session's admin, never an id from the request.
      viewer: { userId: gate.user.id, label: editorLabel(gate.user.id, lookup) },
    };
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error reading exchange rates');
    return readFailed(error);
  }
}
