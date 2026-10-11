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
 * sum: one account's unreadable lots make K-4 unknown. Boost lots are skipped
 * here (slice 4).
 *
 * @module lib/business-os/finance/creditsSection
 */

import type { AdminCreditPosition } from '@/lib/business-os/credits/adminCreditPercent';
import { extraCreditsAt, type CreditLotDrawForBalance } from '@/lib/business-os/credits/creditLots';
import type {
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
}

/** A row before names are added (the builder looks them up for the rows shown only). */
export type CreditsSectionRow = Omit<FinanceCreditRow, 'name' | 'nameStatus'>;

export interface CreditsSectionResult {
  figures: (Omit<FinanceCreditsFigures, 'rows'> & { rows: CreditsSectionRow[] }) | null;
  gifted: FinanceGiftedFigures | null;
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

function giftedFigures(lots: readonly FinanceLot[], input: CreditsSectionInput): GiftedByAccount {
  const grants = lots.filter((lot) => lot.source === 'admin_grant');

  const byAccount = new Map<string, FinanceLot[]>();
  const deleted: FinanceLot[] = [];
  for (const lot of grants) {
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
    const extra = extraCreditsAt(accountLots, input.now);
    const micro = extra === null ? null : toMicro(extra.extraCredits);
    outstanding.set(accountId, micro);
    if (extra?.hasInconsistentLot) inconsistentAccounts += 1;
    // Never a partial sum.
    totalMicro = totalMicro === null || micro === null ? null : totalMicro + micro;
  }

  const deletedExtra = deleted.length === 0 ? null : extraCreditsAt(deleted, input.now);
  const deletedMicro = deleted.length === 0 ? 0 : deletedExtra === null ? null : toMicro(deletedExtra.extraCredits);

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

export function buildCreditsSection(input: CreditsSectionInput): CreditsSectionResult {
  const giftedResult = input.lots === null ? null : giftedFigures(input.lots, input);

  if (input.accountIds === null || input.positions === null) {
    return { figures: null, gifted: giftedResult?.gifted ?? null };
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

    const position = input.positions.get(accountId) ?? { kind: 'unknown' as const };
    if (position.kind === 'no_allowance') {
      noAllowanceAccounts += 1;
      rows.push({ ...unknownRow(accountId, group, tierLabel, 'no_allowance'), giftedOutstanding });
      continue;
    }
    const micro = position.kind === 'position' ? microFigures(position.allowance, position.used) : null;
    if (position.kind !== 'position' || micro === null) {
      unknownAccounts += 1;
      rows.push({ ...unknownRow(accountId, group, tierLabel, 'unknown'), giftedOutstanding });
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
    });
  }

  rows.sort(compareRows);
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
  };
}
