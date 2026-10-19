'use client';

/**
 * Finance → Plans & subscriptions, the Subscriptions part (Money MK-4; KPI
 * restructure review §3.2, SA-2, SA-4, C-4). What `/admin/subscriptions`
 * showed (plan payments P-8a.1), now inside Finance; that path redirects here.
 *
 * ONE READ, ONLY WHEN OPEN: this component mounts only on the Plans &
 * subscriptions tab, and its one read goes to the existing subscriptions route
 * (`requireAdmin` first, the current Stripe mode, PF-15). The Overview never
 * calls it, so the page still makes exactly one request on load (AC-173).
 *
 * THE MODE IS NAMED HERE (C-4): the chip and the test-key note come from
 * `plansCopy.ts`. Both files are on the finance source guard's explicit
 * mode-wording allow-list (SA-4, SA-CR-MK4 CR-1); every other Finance file
 * still names no mode.
 *
 * The status filter is the Finance URL's `status` key (the page's one filter
 * hook), so an old `/admin/subscriptions?status=…` link keeps its filter.
 * Money is formatted per currency; nothing here adds two figures.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { clientLogger } from '@/lib/logger/client';
import { formatMinorAmount } from '@/lib/business-os/currency';
import { AdminEmpty, AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_FIELD_CONTROL, ADMIN_FIELD_LABEL } from '@/app/admin/components/layout/AdminFilterBar';
import { ADMIN_COUNT_LINE } from '@/app/admin/components/layout/adminTable';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import type { SubscriptionStatus, SubscriptionsMrrLine, SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import { SubscriptionsTable } from './SubscriptionsTable';
import {
  EMPTY_ALL,
  EMPTY_ALL_HINT,
  EMPTY_FILTERED,
  MODE_BADGE,
  MRR_LABEL,
  MRR_NONE,
  MRR_PAST_DUE_COUNTED,
  MRR_PAST_DUE_NOT_COUNTED,
  MRR_UNKNOWN_CURRENCY,
  PAID_ACCOUNTS_LABEL,
  STATUS_FILTER_ORDER,
  STATUS_LABEL,
  SUBSCRIPTIONS_WHAT,
  TEST_KEY_NOTE,
  countLine,
  mrrDiscountNote,
  mrrUnpricedNote,
} from '../plansCopy';
import { PLANS_STATUS_ALL, PLANS_STATUS_LABEL, PLANS_SUBSCRIPTIONS_SUBTITLE, PLANS_SUBSCRIPTIONS_TITLE } from '../financeCopy';

/** Facts only: HTTP status, the filter and counts. Never a business name or an id. */
const logger = clientLogger.child({ module: 'AdminFinancePlansSubscriptions' });

export const SUBSCRIPTIONS_ROUTE = '/api/admin/business-os/billing/subscriptions';

function money(hundredths: number, currency: string | null): string {
  // An unreadable currency code is never assumed to be USD.
  if (currency === null) return `${MRR_UNKNOWN_CURRENCY} ${formatCount(hundredths)} (hundredths)`;
  return formatMinorAmount(hundredths, currency, 'en-US');
}

function mrrParts(line: SubscriptionsMrrLine): string {
  const parts = [`${formatCount(line.subscriptions)} subscription${line.subscriptions === 1 ? '' : 's'}`];
  if (line.cancellingHundredths > 0) parts.push(`of which cancelling ${money(line.cancellingHundredths, line.currency)}`);
  if (line.pastDueHundredths > 0) parts.push(`of which ${MRR_PAST_DUE_COUNTED} ${money(line.pastDueHundredths, line.currency)}`);
  if (line.overflow) parts.push('not exact');
  return parts.join(' · ');
}

export function PlansSubscriptions({
  status,
  onStatus,
}: {
  status: SubscriptionStatus | null;
  onStatus: (next: SubscriptionStatus | null) => void;
}) {
  const [data, setData] = useState<SubscriptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const readSeq = useRef(0);
  const selectId = useId();

  const load = useCallback(async () => {
    readSeq.current += 1;
    const seq = readSeq.current;
    setLoading(true);
    setError(null);
    const query = status === null ? '' : `?status=${encodeURIComponent(status)}`;
    try {
      const response = await fetch(`${SUBSCRIPTIONS_ROUTE}${query}`, { cache: 'no-store' });
      const result = await readAdminResponse<SubscriptionsPayload>(response, { what: SUBSCRIPTIONS_WHAT, sessionEndedCopy: true });
      if (seq !== readSeq.current) return;
      if (result.ok) {
        setData(result.data);
      } else {
        logger.warn({ status: result.status, filter: status ?? 'all' }, 'Subscriptions read failed');
        setData(null);
        setError(result.message);
      }
    } catch (err) {
      if (seq !== readSeq.current) return;
      logger.warn({ err, filter: status ?? 'all' }, 'Subscriptions read did not reach the server');
      setData(null);
      setError(ADMIN_NETWORK_ERROR);
    } finally {
      if (seq === readSeq.current) setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals ?? null;
  const paidAccounts = totals ? totals.paidByPlan.reduce((count, plan) => count + plan.accounts, 0) : 0;
  const headingId = 'plans-subscriptions-heading';

  return (
    <section
      aria-labelledby={headingId}
      data-testid="plans-subscriptions"
      aria-busy={loading}
      className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-3"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="text-base font-semibold text-white">
              {PLANS_SUBSCRIPTIONS_TITLE}
            </h2>
            {data && (
              <StatusChip tone="neutral" testId="plans-subscriptions-mode">
                {MODE_BADGE[data.mode]}
              </StatusChip>
            )}
          </div>
          <p className="text-xs text-slate-400">{PLANS_SUBSCRIPTIONS_SUBTITLE(data ? formatUtc(data.generatedAt) : null)}</p>
        </div>
        <div>
          <label htmlFor={selectId} className={ADMIN_FIELD_LABEL}>
            {PLANS_STATUS_LABEL}
          </label>
          <select
            id={selectId}
            data-testid="plans-subscriptions-status"
            value={status ?? 'all'}
            onChange={(event) => {
              const next = event.target.value;
              onStatus(next === 'all' ? null : (next as SubscriptionStatus));
            }}
            className={ADMIN_FIELD_CONTROL}
          >
            <option value="all">{PLANS_STATUS_ALL}</option>
            {STATUS_FILTER_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </header>

      {data?.mode === 'test' && <AdminNotice testId="plans-subscriptions-test-key-note">{TEST_KEY_NOTE}</AdminNotice>}

      {totals && (
        <dl className="grid gap-3 sm:grid-cols-2" data-testid="plans-subscriptions-totals">
          <div>
            <dt className="text-xs text-slate-400">{MRR_LABEL}</dt>
            {totals.mrr.length === 0 ? (
              <dd className="text-sm text-white" data-testid="plans-subscriptions-mrr">{MRR_NONE}</dd>
            ) : (
              totals.mrr.map((line) => (
                <dd key={line.currency ?? 'unknown'} className="text-sm text-white" data-testid="plans-subscriptions-mrr">
                  <span className="font-semibold tabular-nums">{money(line.totalHundredths, line.currency)}</span>{' '}
                  <span className="text-xs text-slate-400">{mrrParts(line)}</span>
                </dd>
              ))
            )}
            {!totals.mrrPastDueCounted && <dd className="text-xs text-slate-400">{MRR_PAST_DUE_NOT_COUNTED}</dd>}
            {totals.mrrUnpriced > 0 && <dd className="text-xs text-slate-400">{mrrUnpricedNote(totals.mrrUnpriced)}</dd>}
            {totals.mrrDiscountUnknown > 0 && <dd className="text-xs text-slate-400">{mrrDiscountNote(totals.mrrDiscountUnknown)}</dd>}
          </div>
          <div>
            <dt className="text-xs text-slate-400">{PAID_ACCOUNTS_LABEL}</dt>
            <dd className="text-sm text-white" data-testid="plans-subscriptions-paid">
              <span className="font-semibold tabular-nums">{formatCount(paidAccounts)}</span>{' '}
              <span className="text-xs text-slate-400">
                {totals.paidByPlan.map((plan) => `${plan.name} ${formatCount(plan.accounts)}`).join(' · ')}
              </span>
            </dd>
          </div>
        </dl>
      )}

      <div data-testid="plans-subscriptions-content" className="space-y-3">
        {loading && data === null && <AdminLoading what={SUBSCRIPTIONS_WHAT} />}
        {error !== null && <AdminError message={error} testId="plans-subscriptions-error" onRetry={() => void load()} />}
        {data !== null && data.rows.length === 0 && (
          <AdminEmpty
            testId="plans-subscriptions-empty"
            message={status === null ? EMPTY_ALL : EMPTY_FILTERED}
            hint={status === null ? EMPTY_ALL_HINT : undefined}
            onClear={status === null ? undefined : () => onStatus(null)}
          />
        )}
        {data !== null && data.rows.length > 0 && (
          <>
            <p data-testid="plans-subscriptions-count" className={ADMIN_COUNT_LINE}>
              {countLine(data.rows.length, data.matching)}
            </p>
            <SubscriptionsTable rows={data.rows} />
          </>
        )}
      </div>
    </section>
  );
}
