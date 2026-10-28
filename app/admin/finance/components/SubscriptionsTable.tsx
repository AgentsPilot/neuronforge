'use client';

/**
 * The Subscriptions table (plan payments P-8a.1, AM-2). One row per account,
 * already filtered, sorted and capped by the server. This component only
 * formats: it adds no figures together and sorts nothing.
 *
 * Money MK-8: with `onQuickLook`, a narrow last column (LF-8) holds each
 * row's opener for the Finance business drawer. Without it the table renders
 * exactly as before (the plan drawer reuses the table without openers).
 */

import Link from 'next/link';

import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { ROW_OPEN_TEST_ID, rowOpenTarget } from '@/app/admin/components/layout/rowOpenClick';
import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_ID,
  ADMIN_TD_NUM,
  ADMIN_TD_OPEN,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_TH_OPEN,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { businessesHref } from '@/app/admin/finance/financeLinks';
import type { SubscriptionRow } from '@/lib/admin/billing/subscriptionsTypes';

import { DISAGREES_LABEL, NO_ACCOUNT, NO_NAME, NONE, STATUS_LABEL, STATUS_TONE, disagreesTitle } from '../plansCopy';
import { BUSINESS_DRAWER } from '../financeCopy';
import { openableRowClass } from './BusinessDrawer';

const LINK_CLASS = 'text-blue-300 underline hover:text-blue-200';

function dateOrNone(value: string | null): string {
  return value === null ? NONE : formatUtc(value);
}

function Business({ row }: { row: SubscriptionRow }) {
  if (row.accountId === null) return <span className="text-slate-400">{NO_ACCOUNT}</span>;
  return (
    <div>
      <Link data-testid="subscription-business-link" href={businessesHref(row.accountId)} className={LINK_CLASS}>
        {row.businessName ?? NO_NAME}
      </Link>
      <div className={ADMIN_TD_ID} title={row.accountId}>
        {formatShortId(row.accountId)}
      </div>
    </div>
  );
}

function Renewal({ row }: { row: SubscriptionRow }) {
  if (row.endedAt !== null) return <span>Ended {formatUtc(row.endedAt)}</span>;
  if (row.currentPeriodEnd === null) return <span>{NONE}</span>;
  const date = formatUtc(row.currentPeriodEnd);
  return (
    <div>
      <span>{row.cancelAtPeriodEnd ? `Ends on ${date}` : `Renews on ${date}`}</span>
      {row.pendingPlan && (
        <div className="text-xs text-slate-400">Moves to {row.pendingPlan.name} at renewal</div>
      )}
    </div>
  );
}

export function SubscriptionsTable({
  rows,
  onQuickLook,
  openAccountId = null,
}: {
  rows: readonly SubscriptionRow[];
  /** Money MK-8: open the business drawer for a row (an account, never a detached row). */
  onQuickLook?: (row: SubscriptionRow & { accountId: string }, opener: HTMLButtonElement) => void;
  /** Money MK-10: the account the drawer shows now, for the open-row highlight. */
  openAccountId?: string | null;
}) {
  return (
    <div className={ADMIN_TABLE_WRAP}>
      <table data-testid="subscriptions-table" className={ADMIN_TABLE}>
        <caption className="sr-only">Business OS plan subscriptions</caption>
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>Business</th>
            <th scope="col" className={ADMIN_TH}>Status</th>
            <th scope="col" className={ADMIN_TH}>Plan bought</th>
            <th scope="col" className={ADMIN_TH}>Plan row</th>
            <th scope="col" className={ADMIN_TH}>Paid through</th>
            <th scope="col" className={ADMIN_TH}>Renewal</th>
            <th scope="col" className={ADMIN_TH}>Last payment</th>
            <th scope="col" className={ADMIN_TH_NUM}>Failed attempts</th>
            {onQuickLook && (
              <th scope="col" className={ADMIN_TH_OPEN}>
                <span className="sr-only">Details</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {rows.map((row, index) => (
            <tr
              key={row.accountId ?? `detached-${index}`}
              data-testid="subscription-row"
              // Money MK-10 (D-17): a row click opens through the row's Open button; a detached row has none.
              {...(onQuickLook && row.accountId !== null
                ? {
                    className: openableRowClass(openAccountId === row.accountId),
                    onClick: (event: React.MouseEvent<HTMLTableRowElement>) => {
                      const button = rowOpenTarget(event);
                      if (button) onQuickLook({ ...row, accountId: row.accountId as string }, button);
                    },
                  }
                : {})}
            >
              <td className={ADMIN_TD}>
                <Business row={row} />
              </td>
              <td className={ADMIN_TD}>
                <div className="flex flex-wrap gap-1">
                  <StatusChip tone={STATUS_TONE[row.status]} testId="subscription-status">
                    {STATUS_LABEL[row.status]}
                  </StatusChip>
                  {row.statuses
                    .filter((status) => status !== row.status)
                    .map((status) => (
                      <StatusChip key={status} tone="neutral">
                        {STATUS_LABEL[status]}
                      </StatusChip>
                    ))}
                  {/* P-8b.3a (AM-2, SA P3-SA-4): our two stored records disagree; the title names how.
                      `?.`: a payload from a server older than P-8b.3a (a page open across a deploy) has no
                      field, and shows no chip rather than failing the whole table. */}
                  {row.disagreements?.length > 0 && (
                    <span title={disagreesTitle(row.disagreements)} data-testid="subscription-disagrees">
                      <StatusChip tone="warn">{DISAGREES_LABEL}</StatusChip>
                    </span>
                  )}
                </div>
                {row.stripeStatus !== null && <div className="mt-1 text-xs text-slate-400">Stripe: {row.stripeStatus}</div>}
              </td>
              <td className={ADMIN_TD}>
                {row.planBought?.name ?? NONE}
                {row.discounted && <div className="text-xs text-slate-400">Founder discount</div>}
              </td>
              <td className={ADMIN_TD}>{row.planOnRecord?.name ?? NONE}</td>
              <td className={ADMIN_TD}>{dateOrNone(row.paidThrough)}</td>
              <td className={ADMIN_TD}>
                <Renewal row={row} />
              </td>
              <td className={ADMIN_TD}>
                {dateOrNone(row.lastPaidAt)}
                {row.lastPaymentFailedAt !== null && (
                  <div className="text-xs text-slate-400">Last failed {formatUtc(row.lastPaymentFailedAt)}</div>
                )}
              </td>
              <td className={ADMIN_TD_NUM}>{row.failedAttempts}</td>
              {onQuickLook && (
                <td className={ADMIN_TD_OPEN}>
                  {row.accountId !== null && (
                    <OpenRowButton
                      label={BUSINESS_DRAWER.openDetails(row.businessName ?? NO_NAME)}
                      onOpen={(button) => onQuickLook({ ...row, accountId: row.accountId as string }, button)}
                      testId={ROW_OPEN_TEST_ID}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
