/**
 * The admin AI Activity drill-down — one Business OS AI action, opened from a
 * row of the Activity list (Gap B slice B2a: FR-B2, FR-B12, SA-RC-11,
 * SA-RC-12, AC-B2, AC-B5, AC-B19 drill-down half). Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B2_WORKPLAN.md § D.
 *
 * WHAT IT SHOWS. The opened charge; every charge of the same grouping id ON THE
 * SAME ACCOUNT, each with its corrections listed and netted and its audit entry
 * state; the audit entry's fields (the B1b projection, OQ-12); and whether the
 * grouping id holds more than one charged action (the shared-group marker,
 * drawer only, OQ-10). The group's individual calls and the group-level cost
 * check are slice B2b; this file reads no call table.
 *
 * THE REQUEST CARRIES ONLY AN ACTION ID (SA-RC-11). The account and the
 * grouping id are read from the charge row the id names, never from the
 * request, so a request cannot widen any read. Every second read is keyed on
 * those row values: the group read is account-scoped by signature, every row
 * it returns is re-checked here (kind, account, group), and a row that fails
 * is dropped and counted, never shown. Corrections are looked up by the
 * group's own action ids and attributed only when `resolveEffectiveFields`
 * accepts them (same account). Audit entries are read across accounts (a
 * grouping id can be shared, F-28) and matched on action id AND account by
 * the list's own join (SA-B1-7); another account's entry is counted, never
 * sent.
 *
 * NOT FOUND (OQ-9). NULL — the route answers one identical 404 — for an
 * unknown id, an adjustment's id, a charge of a deleted account (no account to
 * scope a second read; the list never offers it as a row) and a charge of a
 * platform account (impossible by construction, F-20, refused rather than
 * assumed).
 *
 * REUSE, NOT COPY. Netting, the audit read, the archive cutoff and the join
 * are the list builder's own exported functions (OQ-7), so the two screens
 * cannot disagree about one action's entry or its corrections. The per-charge
 * projection below mirrors the list's row projection field by field; a parity
 * test feeds one charge through both builders (SA-B2-7).
 *
 * READ-ONLY. No write, no LLM call, no audit entry (FR-B7, NFR-3).
 *
 * Server-only: called only from the admin drill-down route, after
 * `requireAdmin` and a strict Zod parse.
 *
 * @module lib/business-os/credits/aiActivityDrillDown
 */

import type {
  BusinessOsCreditLedgerReadRepository,
  CreditLedgerRow,
} from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { COST_SCALE, CREDIT_SCALE, toUnits, type AccountName, type CreditReportLogger } from './creditReport';
import { resolveEffectiveFields } from './effectiveFields';
import {
  joinAuditEntries,
  netAdjustments,
  readArchiveCutoff,
  readAuditEntries,
  settle,
  type AiActivityDeps,
  type PageCharge,
} from './aiActivity';
import type { AiActivityOutcome, AiActivityReadStatus, AiActivityTrigger } from './aiActivityTypes';
import type {
  AiActivityDrillDownAdjustment,
  AiActivityDrillDownCharge,
  AiActivityDrillDownPayload,
} from './aiActivityDrillDownTypes';

export const AI_ACTIVITY_DRILL_DOWN_LIMITS = {
  /** Charges of one group on one account. An onboarding conversation is the largest group (OQ-6). */
  GROUP_CHARGES_PAGE_SIZE: 500,
  GROUP_CHARGES_CEILING: 500,
  /** The adjustment lookup's per-request limit. */
  ADJUSTMENT_IDS_PER_REQUEST: 200,
} as const;

export interface AiActivityDrillDownDeps {
  /** The three ledger reads. Production wiring: `aiActivityDrillDownDeps.ts`. */
  ledger: Pick<
    BusinessOsCreditLedgerReadRepository,
    'findChargesByActionIds' | 'listChargesOfGroupForAccount' | 'listAdjustmentsForActionIds'
  >;
  /** Admin-pinned reads, injected by the route (the B1 pattern); required, no default. */
  findNames: AiActivityDeps['findNames'];
  listAuditEntries: AiActivityDeps['listAuditEntries'];
  /** The audit archive cutoff reads. Production wiring: `aiActivityDeps.ts` (reused). */
  archive: AiActivityDeps['archive'];
  now?: () => Date;
}

/** The opened charge could not be read: there is nothing honest to show. The route answers 500. */
export class AiActivityDrillDownReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiActivityDrillDownReadError';
  }
}

/** A live charge row, narrowed without a cast (SA-B2-9): action id and account set, trigger and outcome known. */
type DrillCharge = PageCharge & { triggered_by: AiActivityTrigger; outcome: AiActivityOutcome };

const isTrigger = (value: string | null): value is AiActivityTrigger =>
  value === 'owner' || value === 'scheduled' || value === 'external';
const isOutcome = (value: string | null): value is AiActivityOutcome => value === 'succeeded' || value === 'failed';

/**
 * CHECK `charge_shape`, `triggered_by_known` and `outcome_known` hold every
 * charge row to this shape; anything else is an invariant break, never a row.
 */
function isLiveCharge(row: CreditLedgerRow): row is DrillCharge {
  return (
    row.kind === 'charge' &&
    typeof row.action_id === 'string' &&
    row.action_id.length > 0 &&
    typeof row.user_id === 'string' &&
    row.user_id.length > 0 &&
    isTrigger(row.triggered_by) &&
    isOutcome(row.outcome)
  );
}

/** Newest `created_at` first, then the higher id: the repository's own order, kept after the opened charge is added. */
function newestFirst(a: CreditLedgerRow, b: CreditLedgerRow): number {
  const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (Number.isFinite(byTime) && byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

type AdjustmentsRead = { status: 'ok'; rows: CreditLedgerRow[] } | { status: 'failed' };

/**
 * The corrections of the group's charges, by their own action ids, unwindowed
 * (a correction written in a later period still nets, FR-B12). A failed read
 * or one cut at its ceiling is "unread": no charge then shows a net figure
 * that may be missing a correction (the list's B1 D-4 rule).
 */
async function readAdjustments(
  actionIds: readonly string[],
  deps: AiActivityDrillDownDeps,
  log: CreditReportLogger
): Promise<AdjustmentsRead> {
  const rows: CreditLedgerRow[] = [];
  for (let i = 0; i < actionIds.length; i += AI_ACTIVITY_DRILL_DOWN_LIMITS.ADJUSTMENT_IDS_PER_REQUEST) {
    const chunk = actionIds.slice(i, i + AI_ACTIVITY_DRILL_DOWN_LIMITS.ADJUSTMENT_IDS_PER_REQUEST);
    const result = await settle(() => deps.ledger.listAdjustmentsForActionIds(chunk));
    if (result.error || !result.data || result.data.reachedCeiling) {
      log.error(
        { err: result.error, reachedCeiling: result.data?.reachedCeiling ?? null, read: 'drill-down adjustments' },
        'AI activity drill-down read failed; charges are shown without net figures'
      );
      return { status: 'failed' };
    }
    rows.push(...result.data.rows);
  }
  return { status: 'ok', rows };
}

/**
 * NULL when there is no such charge, or one this view does not open (the
 * route answers 404 with one body for every case). Throws
 * `AiActivityDrillDownReadError` when the charge itself cannot be read.
 */
export async function buildAiActivityDrillDown(
  requestedActionId: string,
  log: CreditReportLogger,
  deps: AiActivityDrillDownDeps
): Promise<AiActivityDrillDownPayload | null> {
  const now = (deps.now ?? (() => new Date()))();
  // SA-B2-8: `action_id` reads back lower-case. The route lower-cases already;
  // this keeps the builder correct for any caller.
  const actionId = requestedActionId.toLowerCase();

  // ---- 1. The opened charge, by its unique id: the ONLY request-supplied key ----
  const found = await settle(() => deps.ledger.findChargesByActionIds([actionId]));
  if (found.error || !found.data) {
    log.error({ err: found.error, read: 'drill-down charge' }, 'AI activity drill-down read failed');
    throw new AiActivityDrillDownReadError('The AI action could not be read');
  }
  const row = found.data.find((r) => r.kind === 'charge' && r.action_id === actionId);
  // Unknown id, or an adjustment's id (the read asks for charge rows only).
  if (!row) return null;
  // A deleted account: there is no account to scope a second read by.
  if (row.user_id === null) return null;
  // A platform account's rows are the platform's, not a business's (F-20).
  if (isPlatformAccount(row.user_id)) return null;
  if (!isLiveCharge(row)) {
    log.warn({ actionId, read: 'drill-down charge' }, 'AI activity drill-down refused a row that is not a live charge');
    return null;
  }
  const opened = row;

  // ---- 2. The keys, from the ROW only (SA-RC-11) ----
  const accountId = opened.user_id;
  const groupId = (opened.group_id ?? '').toLowerCase();

  // Names and the archive cutoff need nothing from the group: started now, each
  // in its own promise, so a synchronous throw fails only its own part.
  const namesPromise = settle<AccountName[]>(() => deps.findNames([accountId]));
  const archivePromise = readArchiveCutoff(deps);

  // ---- 3. The group, on this account only ----
  let groupStatus: AiActivityReadStatus = 'ok';
  let atLeast = false;
  const groupRows: DrillCharge[] = [];
  if (groupId === '') {
    // CHECK charge_shape gives every charge a grouping id; without one there is no group to read.
    groupStatus = 'failed';
    log.warn({ actionId, read: 'drill-down group' }, 'AI activity drill-down found a charge with no grouping id');
  } else {
    const group = await settle(() =>
      deps.ledger.listChargesOfGroupForAccount(accountId, groupId, {
        pageSize: AI_ACTIVITY_DRILL_DOWN_LIMITS.GROUP_CHARGES_PAGE_SIZE,
        ceiling: AI_ACTIVITY_DRILL_DOWN_LIMITS.GROUP_CHARGES_CEILING,
      })
    );
    if (group.error || !group.data) {
      groupStatus = 'failed';
      log.error({ err: group.error, actionId, read: 'drill-down group' }, 'AI activity drill-down group read failed; the opened charge is shown alone');
    } else {
      atLeast = group.data.reachedCeiling;
      let dropped = 0;
      for (const r of group.data.rows) {
        // Defence in depth: the read is scoped to this account and group, so
        // this drops nothing by construction. A row that fails is never shown.
        if (isLiveCharge(r) && r.user_id === accountId && (r.group_id ?? '').toLowerCase() === groupId) {
          groupRows.push(r);
        } else {
          dropped += 1;
        }
      }
      if (dropped > 0) {
        log.warn({ actionId, dropped, read: 'drill-down group' }, 'AI activity drill-down dropped group rows outside the charge account or group');
      }
    }
  }
  // A read cut at its ceiling (or a failed one) may not hold the opened charge.
  if (!groupRows.some((r) => r.action_id === actionId)) groupRows.push(opened);
  groupRows.sort(newestFirst);

  const chargesByActionId = new Map<string, CreditLedgerRow>(groupRows.map((r) => [r.action_id, r]));

  // ---- 4 and 5. Corrections and the audit entries, in parallel ----
  const [adjustmentsRead, auditRead, archiveRead, namesResult] = await Promise.all([
    readAdjustments([...chargesByActionId.keys()], deps, log),
    readAuditEntries(groupRows, deps),
    archivePromise,
    namesPromise,
  ]);

  let unreadable = 0;
  const units = (value: number | string | null | undefined, scale: number): number => {
    const u = toUnits(value, scale);
    if (Number.isNaN(u)) {
      unreadable += 1;
      return 0;
    }
    return u;
  };

  const adjustmentsStatus: AiActivityReadStatus = adjustmentsRead.status;
  let netted: ReturnType<typeof netAdjustments> = { byActionId: new Map(), unresolved: 0 };
  const listed = new Map<string, AiActivityDrillDownAdjustment[]>();
  if (adjustmentsRead.status === 'ok') {
    netted = netAdjustments(adjustmentsRead.rows, chargesByActionId, units);
    // The same attribution rule netting uses: a correction refused there is
    // only counted (`unresolvedAdjustments`), never listed. Amounts here are
    // not re-counted as unreadable: netting already counted them.
    const listedUnits = (value: number | string, scale: number): number => {
      const u = toUnits(value, scale);
      return Number.isNaN(u) ? 0 : u;
    };
    for (const adjustment of adjustmentsRead.rows) {
      const target = adjustment.adjusts_action_id;
      if (adjustment.kind !== 'adjustment' || target === null) continue;
      if (!resolveEffectiveFields(adjustment, chargesByActionId).resolved) continue;
      const items = listed.get(target) ?? [];
      items.push({
        createdAt: adjustment.created_at,
        reasonCode: adjustment.reason_code,
        costUsd: listedUnits(adjustment.cost_usd, COST_SCALE) / COST_SCALE,
        credits: listedUnits(adjustment.credits, CREDIT_SCALE) / CREDIT_SCALE,
      });
      listed.set(target, items);
    }
    for (const items of listed.values()) items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  let namesStatus: AiActivityReadStatus = 'ok';
  let companyName: string | null = null;
  if (namesResult.error || !namesResult.data) {
    namesStatus = 'failed';
    // Display data only: the drawer opens without the name.
    log.warn({ err: namesResult.error, read: 'business names' }, 'AI activity drill-down business-name lookup failed');
  } else {
    companyName = namesResult.data.find((n) => n.user_id === accountId)?.company_name ?? null;
  }

  const join = joinAuditEntries(groupRows, auditRead, archiveRead, now, log);

  // ---- 6. The charges: the list row's projection, field by field (SA-B2-7) ----
  const netKnown = adjustmentsStatus === 'ok';
  const charges: AiActivityDrillDownCharge[] = groupRows.map((r) => {
    const grossCost = units(r.cost_usd, COST_SCALE);
    const grossCredits = units(r.credits, CREDIT_SCALE);
    const adjustments = netted.byActionId.get(r.action_id);
    return {
      actionId: r.action_id,
      createdAt: r.created_at,
      // The charge's own fields, resolved in the one place allowed to (N-10).
      area: resolveEffectiveFields(r, chargesByActionId).effectiveArea,
      actionType: r.action_type ?? '',
      trigger: r.triggered_by,
      outcome: r.outcome,
      costUsd: {
        gross: grossCost / COST_SCALE,
        net: netKnown ? (grossCost + (adjustments?.cost ?? 0)) / COST_SCALE : null,
      },
      credits: {
        gross: grossCredits / CREDIT_SCALE,
        net: netKnown ? (grossCredits + (adjustments?.credits ?? 0)) / CREDIT_SCALE : null,
      },
      isFallbackPriced: r.is_fallback_priced === true,
      corrected: (adjustments?.count ?? 0) > 0,
      adjustmentCount: adjustments?.count ?? 0,
      reasonCodes: adjustments ? [...adjustments.reasons].sort() : [],
      adjustments: listed.get(r.action_id) ?? [],
      entry: join.entries.get(r.action_id) ?? { state: 'unknown', reason: 'audit_read_failed' },
      opened: r.action_id === actionId,
    };
  });

  return {
    generatedAt: now.toISOString(),
    account: { accountId, companyName },
    names: namesStatus,
    actionId,
    group: {
      groupId,
      status: groupStatus,
      // Every charge of the group on this account. Only the AI service writes
      // charges today; if another ever shares a grouping id, this counts it too.
      chargedActions: charges.length,
      shared: charges.length > 1,
      atLeast,
      charges,
    },
    adjustments: adjustmentsStatus,
    unresolvedAdjustments: netted.unresolved,
    unreadableAmounts: unreadable,
    audit: join.summary,
  };
}
