/**
 * Section 4 of the admin finance page, credits (finance & business health
 * slice 1b, S1-FR-21 to S1-FR-24, §8.4, SA-W9, SA-W12, SA-W15, SA-W17).
 * Workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md.
 *
 * PURE: no I/O, no repository, no clock of its own, nothing from the
 * entitlements module. It takes the credit positions (from the admin credit
 * pass), the narrow lots (mapped in the wiring, SA-W14) and the plan groups as
 * parameters (SA-WR-4).
 *
 * UNITS: every figure is in CREDITS, the platform's own unit, never money.
 * Arithmetic is in integer micro-credits (the ledger's 6 dp), the method of
 * `creditBands.ts` and of the lot balance core, so a comparison is exact:
 *   - over allowance:   used > allowance;
 *   - far over (K-2):   used × 100 >= allowance × line (150 → 150% is far
 *                       over, 149.9% is not);
 *   - % used:           floor(used × 1000 / allowance) tenths, never rounded
 *                       up into the K-2 band (SA-W17).
 *
 * GIFTED CREDITS: the one definition, `extraCreditsAt`, over each account's
 * admin-grant lots at `now`. Lots of deleted accounts (no account) are never
 * in K-4 or the column; they are their own figure (SA-W9), and the window's
 * grant figures still include them (the grant did happen). Never a partial
 * sum: one account's unreadable lots make K-4 unknown.
 *
 * BOUGHT CREDITS (slice 4b.2, S4-FR-18 to S4-FR-20): the same definition over
 * the boost-purchase lots, BESIDE the gifted figures and never added to them:
 * K-4 and every gifted figure still count admin-grant lots only. Bought
 * credits are paid for; gifts are given away. BQ-13 is open, so a refunded
 * boost keeps its credits (nothing here, or anywhere in finance, writes a lot).
 *
 * @module lib/business-os/finance/creditsSection
 */

import type { AdminCreditPosition } from '@/lib/business-os/credits/adminCreditPercent';
import { extraCreditsAt, type CreditLotDrawForBalance } from '@/lib/business-os/credits/creditLots';
import type {
  FinanceBoughtFigures,
  FinanceCreditRow,
  FinanceCreditsFigures,
  FinanceGiftedFigures,
  FinanceGroupKey,
} from './financeTypes';

/**
 * One lot as Section 4 needs it (SA-W14), built field by field in the wiring.
 * No admin-written text can travel in it: no reason, key or source reference.
 */
export interface FinanceLot {
  id: string;
  accountId: string | null;
  source: 'admin_grant' | 'boost_purchase';
  creditsGranted: number;
  expiresAt: string | null;
  createdAt: string;
  /** Counted (distinct granting admins), never returned. */
  actorAdminId: string | null;
  draws: ReadonlyArray<{ kind: CreditLotDrawForBalance['kind']; credits: number; createdAt: string }>;
}

export interface CreditsSectionInput {
  /** The accounts of the table: the walked plan rows, or the picked one. Null when the walk failed or was capped. */
  accountIds: readonly string[] | null;
  groupOf: (accountId: string) => FinanceGroupKey | undefined;
  tierLabelOf: (key: FinanceGroupKey) => string | null;
  /** Null when the pass was not run, failed or timed out. */
  positions: ReadonlyMap<string, AdminCreditPosition> | null;
  /** Null when the lots read failed or reached its ceiling. */
  lots: readonly FinanceLot[] | null;
  window: { start: Date; end: Date };
  now: Date;
  /** The validated far-over-allowance line (SA-W10); null when the configured one is invalid. */
  farOverAllowancePercent: number | null;
  /** Rows shown at most (SA-W15). Counts always cover every account. */
  displayCap: number;
  /** Slice 4b.2 (FR-4B-13): a refund was recorded in the window, so the "not taken back" sentence shows. */
  refundNotTakenBack?: boolean;
}

/** A row before names are added (the builder looks them up for the rows shown only). */
export type CreditsSectionRow = Omit<FinanceCreditRow, 'name' | 'nameStatus'>;

export interface CreditsSectionResult {
  figures: (Omit<FinanceCreditsFigures, 'rows'> & { rows: CreditsSectionRow[] }) | null;
  gifted: FinanceGiftedFigures | null;
  /** Slice 4b.2: bought credits; null when the lots read failed or reached its ceiling. */
  bought: FinanceBoughtFigures | null;
  /**
   * NON-WIRE (slice 6a, SA-W78): EVERY account's row, before the display cap,
   * from the same computation as `figures.rows`, so Section 4 and the
   * Accounts tab cannot differ. Null exactly when `figures` is null.
   */
  rowByAccount: ReadonlyMap<string, CreditsSectionRow> | null;
}

const MICRO = 1e6;

function toMicro(value: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const micro = Math.round(value * MICRO);
  return Number.isSafeInteger(micro) ? micro : null;
}

/** The position's figures in micro-credits, or null when they cannot be compared exactly (the `creditPercentLeft` refusal). */
function microFigures(allowance: number, used: number): { allowanceMicro: number; usedMicro: number } | null {
  if (!Number.isFinite(allowance) || allowance <= 0 || !Number.isFinite(used)) return null;
  const allowanceMicro = toMicro(allowance);
  const usedMicro = toMicro(Math.max(0, used));
  if (allowanceMicro === null || usedMicro === null || allowanceMicro <= 0) return null;
  // The products below must stay exact integers.
  if (!Number.isSafeInteger(allowanceMicro * 1000) || !Number.isSafeInteger(usedMicro * 1000)) return null;
  return { allowanceMicro, usedMicro };
}

function unknownRow(accountId: string, group: FinanceGroupKey | null, tierLabel: string | null, kind: 'no_allowance' | 'unknown'): CreditsSectionRow {
  return {
    accountId,
    group,
    tierLabel,
    kind,
    allowance: null,
    used: null,
    usedTenths: null,
    trial: false,
    overAllowance: null,
    farOverAllowance: null,
    giftedOutstanding: null,
    boughtOutstanding: null,
  };
}

const KIND_ORDER: Record<CreditsSectionRow['kind'], number> = { position: 0, no_allowance: 1, unknown: 2 };

/** Highest % used first; then no allowance; then unknown; ties by account id (stable for a reader). */
function compareRows(a: CreditsSectionRow, b: CreditsSectionRow): number {
  if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  const byUsed = (b.usedTenths ?? 0) - (a.usedTenths ?? 0);
  if (byUsed !== 0) return byUsed;
  return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
}

interface GiftedByAccount {
  /** Micro-credits outstanding per account; null for an account whose lots are unreadable. */
  outstanding: Map<string, number | null>;
  gifted: FinanceGiftedFigures;
}

function within(iso: string, startMs: number, endMs: number): boolean | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return ms >= startMs && ms < endMs;
}

/** The window's grant figures over admin-grant lots, deleted accounts included. Null when a date or figure is unreadable. */
function windowGrants(grants: readonly FinanceLot[], window: { start: Date; end: Date }): FinanceGiftedFigures['window'] {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  let grantedMicro = 0;
  let takenBackMicro = 0;
  let count = 0;
  const admins = new Set<string>();
  for (const lot of grants) {
    const inWindow = within(lot.createdAt, startMs, endMs);
    const granted = toMicro(lot.creditsGranted);
    if (inWindow === null || granted === null) return null;
    if (inWindow) {
      grantedMicro += granted;
      count += 1;
      if (lot.actorAdminId !== null) admins.add(lot.actorAdminId);
    }
    for (const draw of lot.draws) {
      const drawInWindow = within(draw.createdAt, startMs, endMs);
      const credits = toMicro(draw.credits);
      if (drawInWindow === null || credits === null) return null;
      if (drawInWindow && draw.kind === 'reversal') takenBackMicro += credits;
    }
  }
  return { granted: grantedMicro / MICRO, takenBack: takenBackMicro / MICRO, grants: count, grantingAdmins: admins.size };
}

/** Outstanding credits per account over ONE source's lots (the one definition, `extraCreditsAt`). */
function outstandingOf(sourceLots: readonly FinanceLot[], now: Date): {
  outstanding: Map<string, number | null>;
  totalMicro: number | null;
  deletedMicro: number | null;
  inconsistentAccounts: number;
} {
  const byAccount = new Map<string, FinanceLot[]>();
  const deleted: FinanceLot[] = [];
  for (const lot of sourceLots) {
    if (lot.accountId === null) {
      deleted.push(lot);
      continue;
    }
    const list = byAccount.get(lot.accountId) ?? [];
    list.push(lot);
    byAccount.set(lot.accountId, list);
  }

  const outstanding = new Map<string, number | null>();
  let totalMicro: number | null = 0;
  let inconsistentAccounts = 0;
  for (const [accountId, accountLots] of byAccount) {
    const extra = extraCreditsAt(accountLots, now);
    const micro = extra === null ? null : toMicro(extra.extraCredits);
    outstanding.set(accountId, micro);
    if (extra?.hasInconsistentLot) inconsistentAccounts += 1;
    // Never a partial sum.
    totalMicro = totalMicro === null || micro === null ? null : totalMicro + micro;
  }

  const deletedExtra = deleted.length === 0 ? null : extraCreditsAt(deleted, now);
  const deletedMicro = deleted.length === 0 ? 0 : deletedExtra === null ? null : toMicro(deletedExtra.extraCredits);
  return { outstanding, totalMicro, deletedMicro, inconsistentAccounts };
}

function giftedFigures(lots: readonly FinanceLot[], input: CreditsSectionInput): GiftedByAccount {
  const grants = lots.filter((lot) => lot.source === 'admin_grant');
  const { outstanding, totalMicro, deletedMicro, inconsistentAccounts } = outstandingOf(grants, input.now);

  let accountsNotListed: number | null = null;
  if (input.accountIds !== null) {
    const listed = new Set(input.accountIds);
    accountsNotListed = [...outstanding.entries()].filter(([id, micro]) => !listed.has(id) && micro !== 0).length;
  }

  return {
    outstanding,
    gifted: {
      outstanding: totalMicro === null ? null : totalMicro / MICRO,
      accountsNotListed,
      deletedAccountsOutstanding: deletedMicro === null ? null : deletedMicro / MICRO,
      inconsistentAccounts,
      window: windowGrants(grants, input.window),
    },
  };
}

/** Slice 4b.2 (S4-FR-18): bought credits over the boost-purchase lots, never combined with gifted. */
function boughtFigures(lots: readonly FinanceLot[], input: CreditsSectionInput): { outstanding: Map<string, number | null>; bought: FinanceBoughtFigures } {
  const boosts = lots.filter((lot) => lot.source === 'boost_purchase');
  const { outstanding, totalMicro, deletedMicro } = outstandingOf(boosts, input.now);
  const startMs = input.window.start.getTime();
  const endMs = input.window.end.getTime();
  let windowMicro: number | null = 0;
  let windowLots = 0;
  for (const lot of boosts) {
    const inWindow = within(lot.createdAt, startMs, endMs);
    const credits = toMicro(lot.creditsGranted);
    if (inWindow === null || credits === null) {
      windowMicro = null;
      break;
    }
    if (inWindow) {
      windowMicro += credits;
      windowLots += 1;
    }
  }
  return {
    outstanding,
    bought: {
      outstanding: totalMicro === null ? null : totalMicro / MICRO,
      deletedAccountsOutstanding: deletedMicro === null ? null : deletedMicro / MICRO,
      window: windowMicro === null ? null : { credits: windowMicro / MICRO, lots: windowLots },
      refundNotTakenBack: input.refundNotTakenBack ?? false,
    },
  };
}

export function buildCreditsSection(input: CreditsSectionInput): CreditsSectionResult {
  const giftedResult = input.lots === null ? null : giftedFigures(input.lots, input);
  const boughtResult = input.lots === null ? null : boughtFigures(input.lots, input);

  if (input.accountIds === null || input.positions === null) {
    return { figures: null, gifted: giftedResult?.gifted ?? null, bought: boughtResult?.bought ?? null, rowByAccount: null };
  }

  const line = input.farOverAllowancePercent;
  const rows: CreditsSectionRow[] = [];
  let overAllowance = 0;
  let farOverAllowance = 0;
  let unknownAccounts = 0;
  let noAllowanceAccounts = 0;

  for (const accountId of input.accountIds) {
    const group = input.groupOf(accountId) ?? null;
    const tierLabel = group === null ? null : input.tierLabelOf(group);
    const gifted = giftedResult === null ? null : giftedResult.outstanding.has(accountId) ? giftedResult.outstanding.get(accountId) ?? null : 0;
    const giftedOutstanding = gifted === null ? null : gifted / MICRO;
    // S4-FR-20: 0 with no boost lot; null under the same lot-failure rules as gifted.
    const bought = boughtResult === null ? null : boughtResult.outstanding.has(accountId) ? boughtResult.outstanding.get(accountId) ?? null : 0;
    const boughtOutstanding = bought === null ? null : bought / MICRO;

    const position = input.positions.get(accountId) ?? { kind: 'unknown' as const };
    if (position.kind === 'no_allowance') {
      noAllowanceAccounts += 1;
      rows.push({ ...unknownRow(accountId, group, tierLabel, 'no_allowance'), giftedOutstanding, boughtOutstanding });
      continue;
    }
    const micro = position.kind === 'position' ? microFigures(position.allowance, position.used) : null;
    if (position.kind !== 'position' || micro === null) {
      unknownAccounts += 1;
      rows.push({ ...unknownRow(accountId, group, tierLabel, 'unknown'), giftedOutstanding, boughtOutstanding });
      continue;
    }

    const { allowanceMicro, usedMicro } = micro;
    const over = usedMicro > allowanceMicro;
    const far = line === null ? null : usedMicro * 100 >= allowanceMicro * line;
    if (over) overAllowance += 1;
    if (far) farOverAllowance += 1;
    rows.push({
      accountId,
      group,
      tierLabel,
      kind: 'position',
      allowance: allowanceMicro / MICRO,
      used: usedMicro / MICRO,
      usedTenths: Math.floor((usedMicro * 1000) / allowanceMicro),
      trial: position.trial,
      overAllowance: over,
      farOverAllowance: far,
      giftedOutstanding,
      boughtOutstanding,
    });
  }

  rows.sort(compareRows);
  const rowByAccount = new Map(rows.map((row) => [row.accountId, row]));
  return {
    figures: {
      accounts: input.accountIds.length,
      overAllowance,
      farOverAllowance: line === null ? null : farOverAllowance,
      unknownAccounts,
      noAllowanceAccounts,
      rows: rows.slice(0, input.displayCap),
    },
    gifted: giftedResult?.gifted ?? null,
    bought: boughtResult?.bought ?? null,
    rowByAccount,
  };
}
