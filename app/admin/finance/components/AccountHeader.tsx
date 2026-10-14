'use client';

/**
 * The picked business's header (Money M-1, finance health §11D.3, E-35). Shown
 * only with a business picked (M1-FR-10), above the KPI strip: the business
 * name (SA-Q32: the page's own name, else the short id), its plan group with
 * the Founding Partner chip (BD-15), Paying / Not paying / Unknown in words,
 * and the sentence that every section below is for this business only.
 *
 * No new figure and no arithmetic: everything is selected from the payload.
 * The paying chip is neutral (no green): the slice does not judge the state.
 */

import type { FinanceAccountsSection } from '@/lib/business-os/finance/financeTypes';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { formatShortId } from '@/app/admin/components/layout/adminTable';
import { pickedGroupOf, payingStateOf, type AccountName } from '../financeAccount';
import {
  ACCOUNT_HEADER_LABEL,
  ACCOUNT_PAYING_LABEL,
  ACCOUNT_PAYING_TEXT,
  ACCOUNT_PLAN_GROUP,
  ACCOUNT_SCOPE_NOTE,
  ACCOUNT_UNKNOWN,
  ACCOUNTS_FOUNDING_CHIP,
  NAME_PLATFORM,
} from '../financeCopy';
import { groupLabel } from './AccountsByPlanSection';

/** The name as shown: the platform label, the business name, or the short id. */
export function shownAccountName(accountId: string, name: AccountName): string {
  if (name.platform) return NAME_PLATFORM;
  return name.name ?? formatShortId(accountId);
}

/** The plan group in words, with the Founding Partner chip when its group holds one (BD-15). */
export function AccountPlanGroup({ accounts, testId }: { accounts: FinanceAccountsSection; testId: string }) {
  const group = pickedGroupOf(accounts);
  if (group === null) return <span data-testid={testId}>{ACCOUNT_UNKNOWN}</span>;
  return (
    <span data-testid={testId} className="inline-flex flex-wrap items-center gap-2">
      <span>{groupLabel(group)}</span>
      {group.foundingPartners > 0 && (
        <StatusChip tone="neutral" testId={`${testId}-founding`}>
          {ACCOUNTS_FOUNDING_CHIP}
        </StatusChip>
      )}
    </span>
  );
}

export function AccountHeader({
  accountId,
  name,
  accounts,
}: {
  accountId: string;
  name: AccountName;
  accounts: FinanceAccountsSection;
}) {
  const paying = payingStateOf(accounts);
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-2" data-testid="account-header">
      <p className="text-xs text-slate-400">{ACCOUNT_HEADER_LABEL}</p>
      <h2 className="text-lg font-semibold text-white" data-testid="account-header-name" title={accountId}>
        {shownAccountName(accountId, name)}
      </h2>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <dt className="text-slate-400">{ACCOUNT_PLAN_GROUP}</dt>
          <dd className="text-slate-200">
            <AccountPlanGroup accounts={accounts} testId="account-header-group" />
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-slate-400">{ACCOUNT_PAYING_LABEL}</dt>
          <dd data-paying={paying}>
            <StatusChip tone="neutral" testId="account-header-paying">
              {ACCOUNT_PAYING_TEXT[paying]}
            </StatusChip>
          </dd>
        </div>
      </dl>
      <p className="text-xs text-slate-400" data-testid="account-scope-note">
        {ACCOUNT_SCOPE_NOTE}
      </p>
    </div>
  );
}
