'use client';

/**
 * `/admin/subscriptions`: Subscriptions (plan payments P-8a.1, AM-2 and AM-3;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md §5.4).
 *
 * In the Money sidebar section (BD-23: totals, MRR and the subscriptions list
 * in the Money area). The route is TOP LEVEL, not under `/admin/finance`
 * (deviation D-2): every file under `app/admin/finance` is held to the Finance
 * page's rule that no Stripe mode is ever named (BD-14), and this page must
 * name it (PF-15: the list and MRR are the current mode only).
 *
 * Header → filter bar (Status in the URL, Refresh) → KPI strip (AM-3, every
 * figure from the one read) → content area (always mounted: loading, error,
 * empty, or the count line and the table). Read-only: there is no action.
 *
 * A CLIENT component with no data of its own: the read goes to an admin route
 * whose first statement is `requireAdmin`, and the page sits under
 * `app/admin/layout.tsx`, whose `requireAdminPage` runs before it renders.
 * Money is formatted per currency only; nothing here adds two figures.
 */

import { Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { clientLogger } from '@/lib/logger/client';
import { formatMinorAmount } from '@/lib/business-os/currency';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminFilterBar, ADMIN_FIELD_CONTROL, ADMIN_FIELD_LABEL } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminEmpty, AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { ADMIN_COUNT_LINE } from '@/app/admin/components/layout/adminTable';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import type { SubscriptionStatus, SubscriptionsMrrLine, SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';

import { SubscriptionsTable } from './components/SubscriptionsTable';
import {
  EMPTY_ALL,
  EMPTY_ALL_HINT,
  EMPTY_FILTERED,
  MODE_BADGE,
  MRR_LABEL,
  MRR_NONE,
  MRR_NONE_SUB,
  MRR_PAST_DUE_COUNTED,
  MRR_PAST_DUE_NOT_COUNTED,
  MRR_UNKNOWN_CURRENCY,
  PAID_ACCOUNTS_LABEL,
  STATUS_FILTER_ORDER,
  STATUS_LABEL,
  SUBSCRIPTIONS_FILTER_SPEC,
  SUBSCRIPTIONS_PURPOSE,
  SUBSCRIPTIONS_TITLE,
  SUBSCRIPTIONS_WHAT,
  TEST_KEY_NOTE,
  countLine,
  mrrDiscountNote,
  mrrUnpricedNote,
  toSubscriptionsFilter,
} from './subscriptionsCopy';

/** Facts only: HTTP status, the filter and counts. Never a business name or an id. */
const logger = clientLogger.child({ module: 'AdminSubscriptionsPage' });

const ROUTE = '/api/admin/business-os/billing/subscriptions';

/** The KPI tiles that filter the list (K-6 same-page filter tiles). */
const FILTER_TILES: readonly SubscriptionStatus[] = ['grace', 'paused', 'failed', 'cancelling', 'no_stripe'];

function money(hundredths: number, currency: string | null): string {
  // An unreadable currency code is never assumed to be USD.
  if (currency === null) return `${MRR_UNKNOWN_CURRENCY} ${formatCount(hundredths)} (hundredths)`;
  return formatMinorAmount(hundredths, currency, 'en-US');
}

function mrrSub(line: SubscriptionsMrrLine): string {
  const parts = [`${formatCount(line.subscriptions)} subscription${line.subscriptions === 1 ? '' : 's'}`];
  if (line.cancellingHundredths > 0) parts.push(`of which cancelling ${money(line.cancellingHundredths, line.currency)}`);
  if (line.pastDueHundredths > 0) parts.push(`of which ${MRR_PAST_DUE_COUNTED} ${money(line.pastDueHundredths, line.currency)}`);
  if (line.overflow) parts.push('not exact');
  return parts.join(' · ');
}

function SubscriptionsPageContent() {
  const pathname = usePathname() ?? '/admin/subscriptions';
  const { filters, setFilters, clear, isDefault, hrefFor } = useAdminFilters(SUBSCRIPTIONS_FILTER_SPEC);
  const filter = toSubscriptionsFilter(filters.status);

  const [data, setData] = useState<SubscriptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const readSeq = useRef(0);
  const statusId = useId();

  const load = useCallback(async () => {
    readSeq.current += 1;
    const seq = readSeq.current;
    setLoading(true);
    setError(null);
    const query = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`;
    try {
      const response = await fetch(`${ROUTE}${query}`, { cache: 'no-store' });
      const result = await readAdminResponse<SubscriptionsPayload>(response, {
        what: SUBSCRIPTIONS_WHAT,
        sessionEndedCopy: true,
      });
      if (seq !== readSeq.current) return;
      if (result.ok) {
        setData(result.data);
      } else {
        logger.warn({ status: result.status, filter }, 'Subscriptions read failed');
        setData(null);
        setError(result.message);
      }
    } catch (err) {
      if (seq !== readSeq.current) return;
      logger.warn({ err, filter }, 'Subscriptions read did not reach the server');
      setData(null);
      setError(ADMIN_NETWORK_ERROR);
    } finally {
      if (seq === readSeq.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals ?? null;
  const paidAccounts = totals ? totals.paidByPlan.reduce((count, plan) => count + plan.accounts, 0) : 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={SUBSCRIPTIONS_TITLE}
        purpose={SUBSCRIPTIONS_PURPOSE}
        asOf={data ? `As of ${formatUtc(data.generatedAt)}` : null}
        badge={data ? { label: MODE_BADGE[data.mode], testId: 'subscriptions-mode' } : { label: 'Read-only' }}
      />

      {data?.mode === 'test' && <AdminNotice testId="subscriptions-test-key-note">{TEST_KEY_NOTE}</AdminNotice>}

      <AdminFilterBar
        what={SUBSCRIPTIONS_WHAT}
        busy={loading}
        onRefresh={() => void load()}
        onClear={clear}
        canClear={!isDefault}
      >
        <div>
          <label htmlFor={statusId} className={ADMIN_FIELD_LABEL}>
            Status
          </label>
          <select
            id={statusId}
            data-testid="subscriptions-status-filter"
            value={filter}
            onChange={(event) => setFilters({ status: toSubscriptionsFilter(event.target.value) })}
            className={ADMIN_FIELD_CONTROL}
          >
            <option value="all">All</option>
            {STATUS_FILTER_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
      </AdminFilterBar>

      {(totals !== null || (loading && data === null)) && (
        <KpiStrip loading={loading && data === null} placeholderCount={5}>
          {totals && (
            <>
              {totals.mrr.length === 0 ? (
                <KpiTile
                  testId="kpi-mrr"
                  label={MRR_LABEL}
                  value={MRR_NONE}
                  sub={MRR_NONE_SUB}
                  detail={[
                    totals.mrrUnpriced > 0 ? mrrUnpricedNote(totals.mrrUnpriced) : null,
                    totals.mrrDiscountUnknown > 0 ? mrrDiscountNote(totals.mrrDiscountUnknown) : null,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' ') || null}
                />
              ) : (
                totals.mrr.map((line) => (
                  <KpiTile
                    key={line.currency ?? 'unknown'}
                    testId="kpi-mrr"
                    label={`${MRR_LABEL} (${line.currency ?? MRR_UNKNOWN_CURRENCY})`}
                    value={money(line.totalHundredths, line.currency)}
                    sub={mrrSub(line)}
                    detail={[
                      totals.mrrPastDueCounted ? null : MRR_PAST_DUE_NOT_COUNTED,
                      totals.mrrUnpriced > 0 ? mrrUnpricedNote(totals.mrrUnpriced) : null,
                      totals.mrrDiscountUnknown > 0 ? mrrDiscountNote(totals.mrrDiscountUnknown) : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' ') || null}
                  />
                ))
              )}
              <KpiTile
                testId="kpi-paid-accounts"
                label={PAID_ACCOUNTS_LABEL}
                value={formatCount(paidAccounts)}
                sub={totals.paidByPlan.map((plan) => `${plan.name} ${formatCount(plan.accounts)}`).join(' · ') || null}
              />
              {FILTER_TILES.map((status) => (
                <KpiTile
                  key={status}
                  testId={`kpi-${status}`}
                  label={STATUS_LABEL[status]}
                  value={formatCount(totals.byStatus[status])}
                  filter={{
                    href: `${pathname}${hrefFor({ status })}`,
                    apply: () => setFilters({ status }),
                    current: filter === status,
                  }}
                />
              ))}
            </>
          )}
        </KpiStrip>
      )}

      <div data-testid="subscriptions-content" className="space-y-3">
        {loading && data === null && <AdminLoading what={SUBSCRIPTIONS_WHAT} />}
        {error !== null && <AdminError message={error} testId="subscriptions-error" onRetry={() => void load()} />}
        {data !== null && data.rows.length === 0 && (
          <AdminEmpty
            testId="subscriptions-empty"
            message={filter === 'all' ? EMPTY_ALL : EMPTY_FILTERED}
            hint={filter === 'all' ? EMPTY_ALL_HINT : undefined}
            onClear={filter === 'all' ? undefined : clear}
          />
        )}
        {data !== null && data.rows.length > 0 && (
          <>
            <p data-testid="subscriptions-count" className={ADMIN_COUNT_LINE}>
              {countLine(data.rows.length, data.matching)}
            </p>
            <SubscriptionsTable rows={data.rows} />
          </>
        )}
      </div>
    </div>
  );
}

// useSearchParams (the filter hook) needs a Suspense boundary in Next 14.
export default function SubscriptionsPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionsPageContent />
    </Suspense>
  );
}
