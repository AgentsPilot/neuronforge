/**
 * The picked business's name and paying state (Money M-1, finance health
 * §11D.3: M1-FR-3, SA-Q32, E-35). Pure: no React, no fetch, no `'use client'`.
 * Imports types only.
 *
 * The NAME is decided by the page alone, from what it already holds (SA-Q32):
 *   (a) the name the admin picked, held in the view's state (never in the URL);
 *   (b) a payload row for EXACTLY this id, in a fixed order: Section 4's credit
 *       row, Section 3's top accounts, the takings rows, then the overdue
 *       invoice and instalment rows. Only a `found` name counts; `platform`
 *       says it is the platform account;
 *   (c) nothing: the chip then shows the short id.
 * No read is made for a name, and the name never reaches the URL, a request or
 * a log line.
 *
 * The PAYING state (E-35) comes from Section 1's one-business form: the group
 * that holds this account. Paying is a tier group; Not paying is trial,
 * Founding Partner, comped or unknown/held; Unknown is a section that could not
 * load, the `tier_set` fold (the paying read failed), or no group with a count.
 */

import type { FinanceAccountsSection, FinanceGroupCount, FinancePayload } from '@/lib/business-os/finance/financeTypes';

export interface PickedName {
  accountId: string;
  name: string | null;
}

export interface AccountName {
  /** The business name, or null (show the short id). */
  name: string | null;
  /** The platform account (SA-WR-5): labelled, never shown as a business. */
  platform: boolean;
}

interface NamedRow {
  accountId: string | null;
  name: string | null;
  nameStatus: string;
}

const NONE: AccountName = { name: null, platform: false };

/** A usable name: non-blank text. */
const usable = (name: string | null | undefined): name is string => typeof name === 'string' && name.trim() !== '';

/** The payload's rows that can name an account, in the M1-FR-3 order (b). */
function namedRows(data: FinancePayload): NamedRow[] {
  const rows: NamedRow[] = [];
  rows.push(...(data.credits.figures?.rows ?? []));
  rows.push(...(data.aiCost.figures?.topAccounts ?? []));
  rows.push(...(data.takings.figures?.rows ?? []));
  rows.push(...(data.paymentProblems.overdueInvoices.figures?.rows ?? []));
  rows.push(...(data.paymentProblems.overdueInstalments.figures?.rows ?? []));
  return rows;
}

/** M1-FR-3: the picked name, else a payload row for exactly this id, else none. */
export function accountNameFor(accountId: string, picked: PickedName | null, data: FinancePayload | null): AccountName {
  if (picked !== null && picked.accountId === accountId && usable(picked.name)) {
    return { name: picked.name, platform: false };
  }
  if (data === null || data.accountId !== accountId) return NONE;
  for (const row of namedRows(data)) {
    if (row.accountId !== accountId) continue;
    if (row.nameStatus === 'platform') return { name: null, platform: true };
    if (row.nameStatus === 'found' && usable(row.name)) return { name: row.name, platform: false };
  }
  return NONE;
}

export type PayingState = 'paying' | 'not_paying' | 'unknown';

/** The one group holding the picked account (count above 0), or null when none can be said. */
export function pickedGroupOf(accounts: FinanceAccountsSection): FinanceGroupCount | null {
  if (accounts.status === 'unknown' || accounts.figures === null) return null;
  return accounts.figures.groups.find((group) => group.count > 0) ?? null;
}

/** E-35: Paying, Not paying or Unknown, from the group alone. */
export function payingStateOf(accounts: FinanceAccountsSection): PayingState {
  const group = pickedGroupOf(accounts);
  if (group === null) return 'unknown';
  if (group.key.startsWith('tier:')) return 'paying';
  switch (group.key) {
    case 'trial':
    case 'founding_partner':
    case 'comped':
    case 'unknown_held':
      return 'not_paying';
    default:
      // `tier_set`: the paying read failed, so paying and comped cannot be told apart.
      return 'unknown';
  }
}
