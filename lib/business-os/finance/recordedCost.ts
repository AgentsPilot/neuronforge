/**
 * Section 3's recorded AI cost and "Recorded above charged" (finance & business
 * health Money M-4, OV-5, §11F.5). Pure: rows of `{ cost_usd }`, a read-kind
 * flag and Section 3's integer units in; one payload object out.
 *
 * WHAT IT IS. The recorded AI cost is the sum of the usage log's Business OS
 * calls in the window (every call, charged or not). "Recorded above charged"
 * is that sum MINUS Section 3's charged AI cost for the same window and the
 * same accounts, with the Deleted accounts bucket left out of the charged side
 * (their usage rows are deleted with the account, R4-4). It is a difference
 * of two measures, never a per-call match (that is the Leak check's job), and
 * it is NEVER added to the charged figure (BD-18, R4-11): no export here takes
 * or returns their sum.
 *
 * EXACT (R4-8). Every cost is summed as an integer at the ledger's own scale
 * (`COST_SCALE`, through `toUnits`), the difference is taken in integers, and
 * each figure is converted once, in `usdOf`. An unreadable cost counts as 0
 * and is counted; a USD 0 cost is a real 0. A sum past the safe-integer range
 * is Unknown, never a rounded figure.
 *
 * EXACTNESS PER READ (E-53, SA F-1), decided here and nowhere else:
 *   - all accounts: exact only when the read `completed` (the Health tile's
 *     C-1 rule; de-duplication can stop a read below its ceiling without
 *     completing it, so the ceiling flag alone is not enough);
 *   - one account: exact when it did not reach its ceiling.
 *
 * ORDER (SA-W101): a failed read first, then a window before the cut-over
 * ("Not available"), then any inexact side ("Unknown"), then the difference.
 *
 * Imports only the scale and the unit rule, and the wire types. No repository,
 * no data layer, no clock, no entitlements module, and it names no usage-log
 * reader: the route binds those reads and the builder hands their rows here.
 *
 * @module lib/business-os/finance/recordedCost
 */

import { COST_SCALE, toUnits } from '@/lib/business-os/credits/creditReport';
import type { FinanceCoverage, FinanceRecordedAiCost, FinanceSectionStatus } from './financeTypes';

/** One usage-log row, structurally: only its cost is read. */
export interface RecordedRowInput {
  cost_usd: number | string | null;
}

/** E-53: exactness is decided per read kind, here, in one place. */
export type RecordedReadInput =
  | { kind: 'all_accounts'; rows: readonly RecordedRowInput[]; completed: boolean }
  | { kind: 'account'; rows: readonly RecordedRowInput[]; reachedCeiling: boolean }
  | { kind: 'failed' };

export interface RecordedCostInput {
  read: RecordedReadInput;
  coverage: FinanceCoverage;
  /**
   * Section 3's integer units (`COST_SCALE`) for the same window and accounts,
   * and its own exactness; null when the ledger read failed.
   */
  charged: { totalUnits: number; deletedUnits: number; exact: boolean } | null;
}

/** The one conversion to USD in this file (R4-8). */
function usdOf(units: number): number {
  return units / COST_SCALE;
}

const UNKNOWN_RESULT: FinanceRecordedAiCost = {
  status: 'unknown',
  recordedUsd: null,
  recordedExact: false,
  aboveCharged: { state: 'unknown', usd: null },
  chargedAboveUsd: null,
};

/**
 * For the route's one log line (M4-FR-9): what the read returned, as counts and
 * flags only, never an amount. Null where the read failed or the flag does not
 * belong to that read kind. Taken here so the read flags are read in one file.
 */
interface RecordedReadCounts {
  rows: number | null;
  completed: boolean | null;
  reachedCeiling: boolean | null;
  unreadable: number;
}

export function buildRecordedAiCost(input: RecordedCostInput): { recorded: FinanceRecordedAiCost; counts: RecordedReadCounts } {
  const { read, coverage, charged } = input;

  // Rule 2 (R4-9): a failed or timed-out read makes both figures Unknown.
  if (read.kind === 'failed') {
    return { recorded: UNKNOWN_RESULT, counts: { rows: null, completed: null, reachedCeiling: null, unreadable: 0 } };
  }

  // Rule 1 (R4-8): the sum, in integer units; an unreadable cost adds 0 and is counted.
  let recordedUnits = 0;
  let unreadable = 0;
  for (const row of read.rows) {
    const units = toUnits(row.cost_usd, COST_SCALE);
    if (Number.isNaN(units)) unreadable += 1;
    else recordedUnits += units;
  }

  // Rule 3 (E-53): each read's own completeness flag, read once, by its kind.
  const completed = read.kind === 'all_accounts' ? read.completed : null;
  const reachedCeiling = read.kind === 'account' ? read.reachedCeiling : null;
  const counts: RecordedReadCounts = { rows: read.rows.length, completed, reachedCeiling, unreadable };
  if (!Number.isSafeInteger(recordedUnits)) return { recorded: UNKNOWN_RESULT, counts };

  const readComplete = completed !== null ? completed : reachedCeiling === false;
  const recordedExact = readComplete && unreadable === 0;
  const recordedUsd = usdOf(recordedUnits);

  let aboveCharged: FinanceRecordedAiCost['aboveCharged'];
  let chargedAboveUsd: number | null = null;
  if (coverage !== 'after_cutover') {
    // Rule 4 (R4-5): before the cut-over nothing was charged; the recorded figure still shows.
    aboveCharged = { state: 'not_available', usd: null };
  } else if (!recordedExact || charged === null || !charged.exact) {
    // Rule 5 (R4-9): either side not exact.
    aboveCharged = { state: 'unknown', usd: null };
  } else {
    // Rule 6 (R4-2, R4-4, R4-6): in integers; the deleted bucket is left out of the charged side.
    const chargedUnits = charged.totalUnits - charged.deletedUnits;
    const differenceUnits = recordedUnits - chargedUnits;
    if (!Number.isSafeInteger(differenceUnits)) {
      aboveCharged = { state: 'unknown', usd: null };
    } else if (differenceUnits > 0) {
      aboveCharged = { state: 'figure', usd: usdOf(differenceUnits) };
    } else {
      // A negative "above" is never produced: "None", with how far charged is above recorded.
      aboveCharged = { state: 'none', usd: null };
      if (differenceUnits < 0) chargedAboveUsd = usdOf(-differenceUnits);
    }
  }

  // Rule 7: the status.
  const status: FinanceSectionStatus = !recordedExact || aboveCharged.state === 'unknown' ? 'partial' : 'ok';
  return { recorded: { status, recordedUsd, recordedExact, aboveCharged, chargedAboveUsd }, counts };
}
