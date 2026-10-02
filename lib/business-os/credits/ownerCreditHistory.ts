/**
 * The owner's credit history — one page of it (credit deduction slice 7a,
 * workplan §4.6; FR-26, FR-8, FR-28; SA SQ-29 to SQ-34, SQ-38).
 *
 * ── WHAT IT ANSWERS ──────────────────────────────────────────────────────────
 * Every charged action of the CARD'S OWN window — the current period, the
 * whole trial, or the calendar month with no plan row — newest first, 50 a
 * page, each with when, area, label, "you" / "automatic", whether it failed
 * and its exact credits. The first page also carries the summary: the
 * window's total and its split, which are the card's own figures.
 *
 * ── ONE WINDOW (SA SQ-30) ────────────────────────────────────────────────────
 * The window comes from `resolveOwnerCreditWindow` in `ownerCreditUsage.ts`.
 * The ledger rows are read with that window's `ledger` predicate, the one the
 * totals were read with, so the lines are exactly the rows the total sums. The
 * window is re-resolved on every page; a cursor made for another window is
 * answered `{ restart: true }`, never a page under the wrong summary.
 *
 * ── THIS FILE AND THE ENTITLEMENTS MODULE (SA C-S7-1) ───────────────────────
 * It imports NOTHING from the module, type-only included. The labels it sends
 * use the local `{ en, he, es }` type of `effectiveFields.ts`.
 *
 * ── CORRECTIONS (SA SQ-32, C-S7-2) ───────────────────────────────────────────
 * A correction is its own signed line, shown under the service, area, label
 * and trigger of the charge it corrects (`effectiveFields.ts`). Its charge is
 * always in the same window (4c stamps the original's period) but may be on
 * another page: it is then fetched by action id. One that cannot be resolved
 * is still a line and still counted, with no area, label or trigger.
 *
 * ── NO RUNTIME RECONCILIATION (SA C-S7-3) ────────────────────────────────────
 * The summary total is the window's `used` (the totals row), never a sum of
 * the page. That the lines add up to it is proven by tests, and checked in
 * production by the operator Costs & credits report.
 *
 * ── TENANT ISOLATION ─────────────────────────────────────────────────────────
 * The account comes from the session user only, through the window function's
 * `resolveAccountId`. The ledger is read with the caller's RLS client.
 *
 * @module lib/business-os/credits/ownerCreditHistory
 */

import 'server-only';

import type {
  BusinessOsCreditOwnerReadRepository,
  OwnerDiaryRow,
} from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { displayInstantIso } from './creditPeriod';
import { decodeHistoryCursor, encodeHistoryCursor, historyWindowTag, type HistoryCursor } from './creditHistoryCursor';
import type { CreditHistoryLine, OwnerCreditHistoryPage } from './creditHistoryTypes';
import { diaryLabelFor, resolveEffectiveFields, type EffectiveFieldsInput } from './effectiveFields';
import {
  resolveOwnerCreditWindow,
  type OwnerCreditUsageDeps,
  type OwnerCreditUsageLogger,
  type OwnerCreditWindow,
} from './ownerCreditUsage';

type Result<T> = { data: T | null; error: Error | null };

/** Lines per page (D-m / §1 of the scoping: the first 50, then "Show more"). */
export const CREDIT_HISTORY_PAGE_SIZE = 50;

export interface OwnerCreditHistoryLogger extends OwnerCreditUsageLogger {
  info: (ctx: Record<string, unknown>, msg: string) => void;
}

export interface OwnerCreditHistoryDeps extends OwnerCreditUsageDeps {
  /** The owner repository, built on the CALLER'S RLS client. */
  ledger: Pick<BusinessOsCreditOwnerReadRepository, 'listLedgerRowsForWindow' | 'findChargesByActionIds'>;
}

class OwnerCreditHistoryError extends Error {
  constructor(
    readonly code: 'rows_read_failed' | 'originals_read_failed' | 'unreadable_figure' | 'unreadable_time',
    message: string,
    readonly readError?: unknown
  ) {
    super(message);
    this.name = 'OwnerCreditHistoryError';
  }
}

/** A line's credits. `numeric` may arrive as a string; anything not finite is an ERROR, never 0. */
function lineCredits(value: number | string): number {
  const parsed = typeof value === 'number' ? value : value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new OwnerCreditHistoryError('unreadable_figure', 'Unreadable credit figure');
  return Math.round(parsed * 1e6) / 1e6;
}

function displayTime(iso: string): string {
  const at = displayInstantIso(iso);
  if (at === null) throw new OwnerCreditHistoryError('unreadable_time', 'Unreadable ledger time');
  return at;
}

function whoOf(trigger: string | null): CreditHistoryLine['who'] {
  if (trigger === 'owner') return 'you';
  if (trigger === 'scheduled' || trigger === 'external') return 'automatic';
  return null;
}

/** The charges the page's corrections point at: from the page when there, else read by action id. */
async function originalsFor(
  accountId: string,
  rows: readonly OwnerDiaryRow[],
  deps: OwnerCreditHistoryDeps
): Promise<Map<string, EffectiveFieldsInput>> {
  const byActionId = new Map<string, EffectiveFieldsInput>();
  for (const row of rows) {
    if (row.kind === 'charge' && row.action_id) byActionId.set(row.action_id, row);
  }
  const missing = [
    ...new Set(
      rows
        .filter((row) => row.kind === 'adjustment' && row.adjusts_action_id && !byActionId.has(row.adjusts_action_id))
        .map((row) => row.adjusts_action_id as string)
    ),
  ];
  if (missing.length > 0) {
    const originals = await deps.ledger.findChargesByActionIds(accountId, missing);
    if (originals.error || !originals.data) {
      throw new OwnerCreditHistoryError('originals_read_failed', 'Could not read the corrected charges', originals.error);
    }
    for (const charge of originals.data) {
      if (charge.action_id) byActionId.set(charge.action_id, charge);
    }
  }
  return byActionId;
}

function toLine(row: OwnerDiaryRow, originals: ReadonlyMap<string, EffectiveFieldsInput>): {
  line: CreditHistoryLine;
  resolved: boolean;
} {
  const effective = resolveEffectiveFields(row, originals);
  return {
    resolved: effective.resolved,
    line: {
      id: row.id,
      at: displayTime(row.created_at),
      area: effective.effectiveArea,
      label: diaryLabelFor(effective.effectiveService, effective.effectiveActionType),
      who: whoOf(effective.effectiveTrigger),
      didNotComplete: row.kind === 'charge' && row.outcome === 'failed',
      isCorrection: row.kind === 'adjustment',
      credits: lineCredits(row.credits),
    },
  };
}

function summaryOf(window: OwnerCreditWindow) {
  return {
    period: {
      kind: window.kind,
      // Display only; the keys themselves never pass through a Date.
      startsOn: displayTime(window.kind === 'trial_total' && window.anchor !== null ? window.anchor : window.periodStart),
      // The card's `resetsOn`, the same value from the same place (SA W7-5).
      endsBefore: window.resetsOn,
    },
    used: window.used,
    usedByOwner: window.usedByOwner,
    usedAutomatic: window.usedAutomatic,
  };
}

/** One page of the owner's credit history. Never throws; `{ data, error }`. */
export async function readOwnerCreditHistory(
  userId: string,
  cursor: HistoryCursor | null,
  deps: OwnerCreditHistoryDeps,
  log: OwnerCreditHistoryLogger
): Promise<Result<OwnerCreditHistoryPage>> {
  const windowRead = await resolveOwnerCreditWindow(userId, deps, log);
  if (windowRead.error || !windowRead.data) {
    return { data: null, error: windowRead.error ?? new Error('No credit window') };
  }
  const window = windowRead.data;
  const accountId = window.accountId;
  const tag = historyWindowTag(window.kind, window.key);

  // Exact string equality: the window this cursor was made for is gone.
  if (cursor !== null && cursor.w !== tag) {
    log.info({ accountId, periodKind: window.kind }, 'Credit history cursor is for another window; restart');
    return { data: { restart: true }, error: null };
  }

  try {
    const page = await deps.ledger.listLedgerRowsForWindow(
      accountId,
      window.ledger,
      cursor ? { createdAt: cursor.t, id: cursor.i } : null,
      CREDIT_HISTORY_PAGE_SIZE
    );
    if (page.error || !page.data) {
      throw new OwnerCreditHistoryError('rows_read_failed', 'Could not read the credit history', page.error);
    }
    const rows = page.data.rows;
    const originals = await originalsFor(accountId, rows, deps);

    let unresolved = 0;
    const lines = rows.map((row) => {
      const { line, resolved } = toLine(row, originals);
      if (!resolved) unresolved += 1;
      return line;
    });
    if (unresolved > 0) {
      // Still lines, still counted; never guessed.
      log.warn({ accountId, unresolved }, 'Credit history corrections with no resolvable charge');
    }

    const last = rows[rows.length - 1];
    let nextCursor: string | null = null;
    if (page.data.hasMore && last) {
      const encoded = encodeHistoryCursor({ w: tag, t: last.created_at, i: last.id });
      // SA CR7-3: the route decodes every cursor strictly. One its own decoder
      // would refuse (a key or time in a shape the pattern does not know)
      // would turn "Show more" into a 400 — so it is never sent: paging ends
      // here, loudly in the log, and the lines already read are still shown.
      if (decodeHistoryCursor(encoded) === null) {
        log.error(
          { accountId, periodKind: window.kind, code: 'cursor_not_decodable' },
          'Credit history cursor would not decode; paging ended at this page'
        );
      } else {
        nextCursor = encoded;
      }
    }

    return {
      data: {
        ...(cursor === null ? { summary: summaryOf(window) } : {}),
        lines,
        nextCursor,
      },
      error: null,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error(
      {
        err,
        accountId,
        code: error instanceof OwnerCreditHistoryError ? error.code : 'unexpected',
        readError: error instanceof OwnerCreditHistoryError ? error.readError : undefined,
      },
      'Owner credit history read failed'
    );
    return { data: null, error: err };
  }
}
