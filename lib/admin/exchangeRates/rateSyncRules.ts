/**
 * Exchange rates admin, slice 1e: the rate sync contract (requirement
 * ADMIN_EXCHANGE_RATES_REQUIREMENT.md §5.7, SA §13.7 SA-1e-4, §13.8 SQ-49,
 * SQ-51, SQ-52).
 *
 * SQ-52: the whole sync contract lives here, so `exchangeRateRules.ts` stays
 * about stored rates and changes only for the PATCH. This module imports from
 * `exchangeRateRules.ts`, never the other way round (no import cycle).
 *
 * Pure: no I/O, no React, no server-only import, so the `'use client'` page may
 * import it. SQ-42: a suggested rate is derived from two rates of one official
 * feed, and a gap compares two rates of one currency; neither takes or makes an
 * amount of money, and nothing here converts or sums one (D-5).
 *
 * SQ-49: the ECB's human page is a constant HERE, outside the page folder, so
 * the page links to it without holding `https://` text. The page may use it
 * only as a link `href`; it can never be fetched from the page, because the
 * page guard (`ALLOWED_FETCH`) accepts only literal `/api/admin/exchange-rates`
 * targets. The XML feed URL is not here: it lives only in the server-only
 * `ecbFeed.ts`.
 *
 * Slice 1f (SA §13.9 SQ-54, SQ-55): the "Rates last checked" tile also names
 * WHO ran that sync. The route reads the actor as a `LastRateSyncRecord` and
 * labels it with the same `editorLabel` rule and the same one lookup as the
 * history (`labelLastSync`); right after a sync the page takes the name from
 * the plain GET's `viewer` (`lastSyncFromSync(answer, viewer)`), with no new
 * request.
 */

import { z } from 'zod';

import { editorLabel, type EditorLookup, type ExchangeRatesPayload } from './exchangeRateRules';

// ── The request ─────────────────────────────────────────────────────────────

/** The sync takes no input: no URL, no currency list, no rate (SQ-39). */
export const syncBodySchema = z.object({}).strict();

// ── The answer (SA-1e-4) ────────────────────────────────────────────────────

/** The outcome strings of the copied fetch shape (SQ-36), plus the parser's `layout_changed`. */
export type RateSyncOutcome =
  | 'ok'
  | 'timeout'
  | 'network_error'
  | 'blocked'
  | 'layout_changed'
  | 'too_large'
  | `http_${number}`;

/** Per synced currency: a usable rate, a code the feed lacks (never 1, D-4), or a result that cannot be stored. */
export type RateSuggestionStatus = 'suggested' | 'not_in_feed' | 'no_usable_rate';

/** Suggested above ours (red), below (green), equal (no colour): BQ-2. */
export type GapDirection = 'up' | 'down' | 'none';

export interface RateSuggestionWire {
  currencyCode: string;
  /** The stored rate the server compared against, as read (SA-1e-1). */
  currentRate: string;
  status: RateSuggestionStatus;
  /** 6 decimals, half-up; null unless `status` is `suggested`. */
  suggestedRate: string | null;
  /** Suggested − current, 6 decimals, `+` when positive. */
  gapAbsolute: string | null;
  /** The gap as a % of the current rate, 2 decimals, signed, with `%`. */
  gapPercent: string | null;
  direction: GapDirection | null;
}

export interface ExchangeRateSyncPayload {
  source: typeof SYNC_SOURCE_LABEL;
  outcome: RateSyncOutcome;
  /** The feed's own rate date (`YYYY-MM-DD`); null when the feed could not be read. */
  rateDate: string | null;
  /** Server clock at the fetch (ISO). */
  fetchedAt: string;
  /** Empty unless `outcome` is `ok`. */
  suggestions: RateSuggestionWire[];
}

// ── Copy ────────────────────────────────────────────────────────────────────

/** The short source name shown with a suggestion. */
export const SYNC_SOURCE_LABEL = 'ECB';

/** One plain sentence per failure outcome. Each says that nothing was changed. */
export const SYNC_OUTCOME_TEXT = {
  ok: 'Rates read from the ECB. Nothing was changed: accept a suggestion row by row.',
  timeout: 'The ECB did not answer in time. No rate was changed. Try again in a moment.',
  network_error: 'The ECB could not be reached. No rate was changed. Try again in a moment.',
  blocked: 'The ECB refused the request. No rate was changed.',
  layout_changed: 'The ECB file was not in the expected format, so no rate was read. No rate was changed.',
  too_large: 'The ECB answer was larger than expected and was not read. No rate was changed.',
} as const satisfies Record<Exclude<RateSyncOutcome, `http_${number}`>, string>;

/** The sentence for any outcome; every `http_*` shares one sentence naming the status. */
export function syncOutcomeText(outcome: RateSyncOutcome): string {
  if (outcome.startsWith('http_')) {
    return `The ECB answered with HTTP status ${outcome.slice('http_'.length)}. No rate was changed.`;
  }
  return SYNC_OUTCOME_TEXT[outcome as keyof typeof SYNC_OUTCOME_TEXT];
}

/** §5.7.5 colour words (BQ-2): always shown with the colour, never colour alone (A-7). */
export const GAP_DIRECTION_WORDS: Readonly<Record<GapDirection, string>> = {
  up: 'Rate up: currency weaker, we are behind',
  down: 'Rate down: currency stronger, in our favour',
  none: 'No change',
};

// ── The source line (D-10 point 1, SQ-49) ───────────────────────────────────

export const ECB_SOURCE_LABEL = 'European Central Bank (euro foreign exchange reference rates)';

/** The ECB's HUMAN page for these rates (not the XML feed). A link target only: never fetched. */
export const ECB_SOURCE_PAGE_URL =
  'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';

export const ECB_SOURCE_NOTE = 'Published by the ECB for information only.';

// ── "Rates last checked" (D-10 point 3, SQ-51) ──────────────────────────────

/**
 * The newest successful sync: three states, which `| null` cannot express
 * (SQ-51 (4)). `none`: no successful sync in the live audit trail (archiving
 * can remove an old one, so the page says "No sync on record", never "Never").
 * `unavailable`: the audit trail could not be read.
 */
export type LastRateSyncWire =
  | {
      status: 'ok';
      checkedAt: string;
      rateDate: string;
      /** The admin who ran the sync (slice 1f, SQ-53); null when the audit entry has no actor. */
      checkedBy: string | null;
      /**
       * Their name, else admin email, else "Unknown user" (`editorLabel`). Null
       * only when the name lookup failed for a known actor; the page then shows
       * the short id (SQ-54).
       */
      checkedByLabel: string | null;
    }
  | { status: 'none' }
  | { status: 'unavailable' };

/**
 * The sync as the route reads it, before the label is resolved (slice 1f,
 * SQ-54): the same three states, `ok` carrying the actor and no label. Only
 * `labelLastSync` turns it into the wire type.
 */
export type LastRateSyncRecord =
  | { status: 'ok'; checkedAt: string; rateDate: string; checkedBy: string | null }
  | { status: 'none' }
  | { status: 'unavailable' };

/**
 * The signed-in admin of the page (slice 1f, SQ-55 (a')): the id from the
 * session gate, never from the request, and its label from the same one
 * lookup (null when that lookup failed).
 */
export interface RateViewerWire {
  userId: string;
  label: string | null;
}

/** The plain GET's answer: today's payload plus `lastSync` and `viewer`. `ExchangeRatesPayload` itself is unchanged. */
export type ExchangeRatesReadPayload = ExchangeRatesPayload & { lastSync: LastRateSyncWire; viewer: RateViewerWire };

/** Label the sync actor with the one lookup (SQ-54). `none` and `unavailable` pass through. */
export function labelLastSync(record: LastRateSyncRecord, lookup: EditorLookup): LastRateSyncWire {
  if (record.status !== 'ok') return record;
  return { ...record, checkedByLabel: editorLabel(record.checkedBy, lookup) };
}

/**
 * The tile's value straight from a sync answer (SQ-51 (5)): `ok` only when the
 * sync succeeded and named its rate date, else null (a failed sync leaves the
 * tile as it was). Slice 1f (SQ-55 (a')): the checker is the page's viewer,
 * because the admin who posts to `/sync` is the signed-in admin of the page,
 * so the tile reads exactly what a reload will show. With no viewer (not
 * reachable: Sync stays disabled until a plain read succeeded) both fields
 * are null, which shows "Unknown user".
 */
export function lastSyncFromSync(
  answer: ExchangeRateSyncPayload,
  viewer: RateViewerWire | null
): LastRateSyncWire | null {
  if (answer.outcome !== 'ok' || answer.rateDate === null) return null;
  return {
    status: 'ok',
    checkedAt: answer.fetchedAt,
    rateDate: answer.rateDate,
    checkedBy: viewer?.userId ?? null,
    checkedByLabel: viewer?.label ?? null,
  };
}
