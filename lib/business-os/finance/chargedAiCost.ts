/**
 * One charged AI cost (Money MK-2, SA-RR-MK SA-1): the ledger read Finance's
 * Section 3 and K-1 use, and the window figure Charge checks shows, from ONE
 * read function and ONE builder, so "same window, same number" holds by
 * construction.
 *
 * - `readChargedLedger`: R-a (every account, deleted accounts included, FIN
 *   SA-Q6) or R-a′ (one account), by `created_at`, half-open, paged at 1,000.
 * - `readChargedWindow`: the selected window clamped to the charging cut-over,
 *   exactly as Section 3 reads it.
 * - `buildChargedAiCostInWindow`: that read, then Finance's own builder
 *   (`summariseAiCost`). Plan groups and the adjusted charges outside the read
 *   ("originals") are not passed: they change only the trigger and group
 *   breakdowns, never the total or the deleted bucket (`aiCost.ts`).
 *
 * - `recordedInWindow` (Money MK-3, SA-3, C-7): the window's recorded AI cost
 *   and "Recorded above charged", through Finance's own builder
 *   (`buildRecordedAiCost`) against the charged UNITS of the same window, so
 *   it equals Finance's `aiCost.recorded` by construction. The usage-log read
 *   itself is bound and run by the route (`recordedReads.ts`, under its
 *   deadline); this module names no usage-log reader and reads no clock.
 *
 * READ-ONLY. Repositories only; no new repository method. Callers: the Finance
 * builder and the admin-gated cost report route (after `requireAdmin`, Zod and
 * the platform-account refusal). With an account given only R-a′ is called,
 * with exactly that id.
 *
 * @module lib/business-os/finance/chargedAiCost
 */

import type {
  BusinessOsCreditLedgerReadRepository,
  CreditLedgerPagedResult,
  CreditLedgerRow,
  CreditPeriodStartRange,
} from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { cutoverClamp, settle } from '@/lib/business-os/credits/aiActivity';
import type { AiActivityCoverage } from '@/lib/business-os/credits/aiActivityTypes';
import type { CreditReportChargedInWindow } from '@/lib/business-os/credits/creditReportTypes';
import { summariseAiCost } from './aiCost';
import { buildRecordedAiCost, type RecordedReadInput } from './recordedCost';
import type { FinanceRecordedAiCost } from './financeTypes';

type RepoResult<T> = { data: T | null; error: Error | null };

/** R-a's paging: pages of 1,000 (the range-cap rule), a 20,000-row ceiling reached with `>=`. */
export const CHARGED_LEDGER_READ = { pageSize: 1000, ceiling: 20_000 } as const;

export type ChargedLedgerReads = Pick<
  BusinessOsCreditLedgerReadRepository,
  'listRowsOfAllAccountsCreatedInRange' | 'listRowsForAccountCreatedInRange'
>;

export type ChargedLedgerResult = RepoResult<CreditLedgerPagedResult<CreditLedgerRow>>;

/** An empty span, or one entirely before the cut-over, has nothing to read: an exact 0. */
export const EMPTY_CHARGED_READ: ChargedLedgerResult = { data: { rows: [], reachedCeiling: false }, error: null };

/** R-a′ with an account, else R-a. Settled: a throw becomes a failed result, never a rejection. */
export function readChargedLedger(
  ledger: ChargedLedgerReads,
  accountId: string | null,
  range: CreditPeriodStartRange
): Promise<ChargedLedgerResult> {
  return settle(() =>
    accountId !== null
      ? ledger.listRowsForAccountCreatedInRange(accountId, range, CHARGED_LEDGER_READ)
      : ledger.listRowsOfAllAccountsCreatedInRange(range, CHARGED_LEDGER_READ)
  );
}

/** Section 3's read: the window `[start, end)`, from the cut-over when it starts earlier. */
export function readChargedWindow(
  ledger: ChargedLedgerReads,
  accountId: string | null,
  window: { start: Date; end: Date }
): { coverage: AiActivityCoverage; result: Promise<ChargedLedgerResult> } {
  const clamp = cutoverClamp(window.start, window.end);
  return {
    coverage: clamp.coverage,
    result:
      clamp.readFrom === null
        ? Promise.resolve(EMPTY_CHARGED_READ)
        : readChargedLedger(ledger, accountId, { from: clamp.readFrom, to: window.end }),
  };
}

export interface ChargedAiCostInput {
  /** Half-open instants: the same `[start, end)` Finance resolves for the same window. */
  window: { start: Date; end: Date };
  accountId: string | null;
}

export interface ChargedAiCostLogger {
  error: (ctx: Record<string, unknown>, msg: string) => void;
}

export interface ChargedAiCostDeps {
  /** Injected, as in the Finance builder: the route passes the read repository (this module imports types only). */
  ledger: ChargedLedgerReads;
}

/**
 * NON-WIRE (MK-3): the charged figure plus its integer units (`COST_SCALE`),
 * which `recordedInWindow` needs to take the difference exactly, as Finance
 * does. `units` is null when the read failed.
 */
export interface ChargedAiCostWithUnits {
  charged: CreditReportChargedInWindow;
  units: { totalUnits: number; deletedUnits: number } | null;
}

/** Charge checks' cost tile and deleted accounts line: Finance's Section 3 total for this window. */
export async function buildChargedAiCostInWindow(
  input: ChargedAiCostInput,
  logger: ChargedAiCostLogger,
  deps: ChargedAiCostDeps
): Promise<CreditReportChargedInWindow> {
  return (await buildChargedAiCostInWindowWithUnits(input, logger, deps)).charged;
}

/** The same build, keeping the units for `recordedInWindow` (MK-3). */
export async function buildChargedAiCostInWindowWithUnits(
  input: ChargedAiCostInput,
  logger: ChargedAiCostLogger,
  deps: ChargedAiCostDeps
): Promise<ChargedAiCostWithUnits> {
  const read = readChargedWindow(deps.ledger, input.accountId, input.window);
  const result = await read.result;

  if (result.error || !result.data) {
    logger.error({ err: result.error, read: 'ledger_window' }, 'Charged AI cost read failed');
    return {
      units: null,
      charged: {
        status: 'unknown',
        coverage: read.coverage,
        costUsd: null,
        credits: null,
        charges: null,
        rows: null,
        deleted: null,
        unreadableAmounts: 0,
      },
    };
  }

  const { figures, units } = summariseAiCost({
    rows: result.data.rows,
    reachedCeiling: result.data.reachedCeiling,
    originals: [],
    groupOf: null,
    groupsComplete: true,
    tierLabelOf: () => null,
    isPlatform: () => false,
  });

  return {
    units: { totalUnits: units.total.cost, deletedUnits: units.deleted.cost },
    charged: {
      // Finance's rule (Section 3): exact only with no ceiling and no unreadable amount.
      status: figures.exact ? 'ok' : 'partial',
      coverage: read.coverage,
      costUsd: figures.costUsd,
      credits: figures.credits,
      charges: figures.chargedActions,
      rows: figures.rows,
      deleted: figures.deleted,
      unreadableAmounts: figures.unreadableAmounts,
    },
  };
}

/**
 * MK-3 (SA-3): the window's recorded AI cost beside its charged one, by
 * Finance's builder and Finance's inputs: the charged units of the SAME
 * window and accounts, the Deleted accounts bucket left out of the charged
 * side (their usage rows are deleted with the account), and the charged
 * figure's own exactness (`ok` = exact). A failed charged read gives null, so
 * the difference is Unknown (R4-9). `read` is the usage-log result as the
 * route got it, `{ kind: 'failed' }` for a failed or late read.
 */
export function recordedInWindow(
  charged: ChargedAiCostWithUnits,
  read: RecordedReadInput
): ReturnType<typeof buildRecordedAiCost> {
  return buildRecordedAiCost({
    read,
    coverage: charged.charged.coverage,
    charged:
      charged.units !== null && charged.charged.status !== 'unknown'
        ? { ...charged.units, exact: charged.charged.status === 'ok' }
        : null,
  });
}

/** The recorded result's wire type is Finance's own (pinned equal to the credits declaration). */
export type RecordedInWindow = FinanceRecordedAiCost;
