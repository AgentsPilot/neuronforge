/**
 * Section 3's sums (finance & business health slice 1a, S1-FR-16, S1-FR-17).
 * Pure: ledger rows in, figures out.
 *
 * EXACT: every amount is summed as an integer in the ledger's own scale (cost
 * 10 dp, credits 6 dp, the `creditReport.ts` method) and converted to a number
 * ONCE, at the edge. An unreadable amount counts as 0 and is COUNTED
 * (`unreadableAmounts`), never silent.
 *
 * NET: charges AND adjustments are summed. An adjustment is grouped under its
 * charge's trigger through `resolveEffectiveFields` (never the raw `service`
 * column, N-10); one whose charge cannot be found, or sits on another account,
 * is "unattributed" and counted in `unresolvedAdjustments`.
 *
 * DELETED ACCOUNTS (`user_id` NULL) are in the total AND in their own bucket,
 * never in the top 10. A platform account's rows are in the total too; the top
 * 10 marks them so the page labels them "Platform account" (SA-WR-5).
 *
 * @module lib/business-os/finance/aiCost
 */

import type { CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { COST_SCALE, CREDIT_SCALE, toUnits } from '@/lib/business-os/credits/creditReport';
import { resolveEffectiveFields, type EffectiveFieldsInput } from '@/lib/business-os/credits/effectiveFields';
import type { FinanceAiCostFigures, FinanceAmount, FinanceGroupKey, FinanceTriggerKey } from './financeTypes';

export const TOP_ACCOUNTS = 10;

const TRIGGERS: readonly FinanceTriggerKey[] = ['owner', 'scheduled', 'external', 'unattributed'];

interface UnitBucket {
  cost: number;
  credits: number;
  rows: number;
}

const emptyBucket = (): UnitBucket => ({ cost: 0, credits: 0, rows: 0 });
const toAmount = (b: UnitBucket): FinanceAmount => ({ costUsd: b.cost / COST_SCALE, credits: b.credits / CREDIT_SCALE, rows: b.rows });

/** A top-10 line before names are looked up. */
export interface TopAccountUnits {
  accountId: string;
  costUsd: number;
  credits: number;
  isPlatform: boolean;
}

export interface SummariseAiCostInput {
  rows: readonly CreditLedgerRow[];
  reachedCeiling: boolean;
  /** Charges outside the read set that some adjustment in it corrects. */
  originals: readonly CreditLedgerRow[];
  /**
   * The account's CURRENT plan group (BD-8), or null when the plan walk failed
   * (the breakdown is then `unknown`; the total still renders).
   */
  groupOf: ((accountId: string) => FinanceGroupKey | undefined) | null;
  /** False when the plan walk hit its ceiling: the breakdown is then `partial` (SA-2). */
  groupsComplete: boolean;
  tierLabelOf: (key: FinanceGroupKey) => string | null;
  isPlatform: (accountId: string) => boolean;
}

export interface AiCostSummary {
  /** `topAccounts` here carries no names: the builder adds them. */
  figures: Omit<FinanceAiCostFigures, 'topAccounts'>;
  top: TopAccountUnits[];
}

function triggerOf(effectiveTrigger: string | null, resolved: boolean): FinanceTriggerKey {
  if (!resolved) return 'unattributed';
  return effectiveTrigger === 'owner' || effectiveTrigger === 'scheduled' || effectiveTrigger === 'external'
    ? effectiveTrigger
    : 'unattributed';
}

export function summariseAiCost(input: SummariseAiCostInput): AiCostSummary {
  const { rows, reachedCeiling, originals, groupOf, groupsComplete, tierLabelOf, isPlatform } = input;

  const chargesByActionId = new Map<string, EffectiveFieldsInput>();
  for (const row of [...originals, ...rows]) {
    if (row.kind === 'charge' && row.action_id) chargesByActionId.set(row.action_id, row);
  }

  const total = emptyBucket();
  const deleted = emptyBucket();
  const byTrigger = new Map<FinanceTriggerKey, UnitBucket>(TRIGGERS.map((t) => [t, emptyBucket()]));
  const byGroup = new Map<FinanceGroupKey, UnitBucket>();
  const byAccount = new Map<string, UnitBucket>();
  let chargedActions = 0;
  let unreadableAmounts = 0;
  let unresolvedAdjustments = 0;

  for (const row of rows) {
    let cost = toUnits(row.cost_usd, COST_SCALE);
    let credits = toUnits(row.credits, CREDIT_SCALE);
    if (Number.isNaN(cost)) {
      unreadableAmounts += 1;
      cost = 0;
    }
    if (Number.isNaN(credits)) {
      unreadableAmounts += 1;
      credits = 0;
    }
    const add = (b: UnitBucket) => {
      b.cost += cost;
      b.credits += credits;
      b.rows += 1;
    };

    add(total);
    if (row.kind === 'charge') chargedActions += 1;

    const effective = resolveEffectiveFields(row, chargesByActionId);
    if (row.kind === 'adjustment' && !effective.resolved) unresolvedAdjustments += 1;
    add(byTrigger.get(triggerOf(effective.effectiveTrigger, effective.resolved)) as UnitBucket);

    if (row.user_id === null) {
      add(deleted);
      continue;
    }

    const account = byAccount.get(row.user_id) ?? emptyBucket();
    add(account);
    byAccount.set(row.user_id, account);

    if (groupOf) {
      // An account on the ledger with no plan row is held, never dropped.
      const key = groupOf(row.user_id) ?? 'unknown_held';
      const bucket = byGroup.get(key) ?? emptyBucket();
      add(bucket);
      byGroup.set(key, bucket);
    }
  }

  const top = [...byAccount.entries()]
    .sort(([idA, a], [idB, b]) => (b.cost !== a.cost ? b.cost - a.cost : idA.localeCompare(idB)))
    .slice(0, TOP_ACCOUNTS)
    .map(([accountId, b]) => ({
      accountId,
      costUsd: b.cost / COST_SCALE,
      credits: b.credits / CREDIT_SCALE,
      isPlatform: isPlatform(accountId),
    }));

  return {
    figures: {
      // An unreadable amount counted as 0 makes the total a guess, not exact (SA-1).
      exact: !reachedCeiling && unreadableAmounts === 0,
      costUsd: total.cost / COST_SCALE,
      credits: total.credits / CREDIT_SCALE,
      chargedActions,
      rows: total.rows,
      byTrigger: TRIGGERS.map((trigger) => ({ trigger, ...toAmount(byTrigger.get(trigger) as UnitBucket) })),
      byGroup: groupOf
        ? {
            status: groupsComplete ? 'ok' : 'partial',
            lines: [...byGroup.entries()]
              .sort(([, a], [, b]) => b.cost - a.cost)
              .map(([key, b]) => ({ key, tierLabel: tierLabelOf(key), ...toAmount(b) })),
          }
        : { status: 'unknown', lines: [] },
      deleted: toAmount(deleted),
      unreadableAmounts,
      unresolvedAdjustments,
    },
    top,
  };
}

/** The adjustments whose charge is not in the read set: their originals must be looked up by id. */
export function missingOriginalIds(rows: readonly CreditLedgerRow[]): string[] {
  const present = new Set<string>();
  for (const row of rows) if (row.kind === 'charge' && row.action_id) present.add(row.action_id);
  const missing = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'adjustment' && row.adjusts_action_id && !present.has(row.adjusts_action_id)) {
      missing.add(row.adjusts_action_id);
    }
  }
  return [...missing];
}

/**
 * K-1's figure: the net AI cost of these rows in USD, summed exactly. An
 * unreadable amount counts as 0 and is counted, as in `summariseAiCost`.
 */
export function sumCostUsd(rows: readonly CreditLedgerRow[]): { costUsd: number; unreadableAmounts: number } {
  let units = 0;
  let unreadableAmounts = 0;
  for (const row of rows) {
    const cost = toUnits(row.cost_usd, COST_SCALE);
    if (Number.isNaN(cost)) unreadableAmounts += 1;
    else units += cost;
  }
  return { costUsd: units / COST_SCALE, unreadableAmounts };
}
