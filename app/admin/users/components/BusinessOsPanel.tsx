/**
 * The Business OS panel at the top of an expanded Businesses row
 * (admin reorganisation slice 2b).
 *
 * Two reads, both admin-gated on the server:
 *   - the EXISTING entitlements route, rendered by the SAME component the Plans
 *     & entitlements screen uses — so the plan, cohort and "which layer decided"
 *     are exactly what that API returns;
 *   - the account summary route: business name and vertical, 30-day Business OS
 *     AI spend, recent failed AI actions (metadata only).
 *
 * Money: AI cost is USD by definition of the model pricing table, labelled as
 * such, never converted and never mixed with the business's own currency.
 * No prompt, message body or owner-written text is shown: the summary route
 * sends none.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase } from 'lucide-react';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  ENTITLEMENT_ERROR_COPY,
  EntitlementSnapshot,
} from '@/app/admin/business-os-tiers/components/EntitlementSnapshot';
import type { AccountPayload } from '@/app/admin/business-os-tiers/types';
import type { AccountSummaryPayload } from '../types';

/** Every refusal the summary route can return, as a sentence. */
const SUMMARY_ERROR_COPY: Record<string, string> = {
  not_a_business_os_account: 'Not a Business OS account. This login has no Business OS business.',
  platform_account: 'This is the platform account. Its AI usage is not one business’s spend.',
  invalid_account_id: 'That does not look like an account id.',
  tenant_check_failed: 'Whether this is a Business OS account could not be determined. Try again.',
  'Internal server error': 'Something failed on the server. The correlation id is in the logs.',
};

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; code: string };

async function readJson<T>(url: string): Promise<Load<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok || !body?.success) {
      return { state: 'error', code: typeof body?.error === 'string' ? body.error : 'unknown' };
    }
    return { state: 'ok', data: body.data as T };
  } catch {
    return { state: 'error', code: 'unknown' };
  }
}

/** USD only, by design (the pricing table's currency). */
function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function auditLink(accountId: string, groupId?: string | null): string {
  const params = new URLSearchParams({ action: AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED, user_id: accountId });
  if (groupId) params.set('search', groupId);
  return `/admin/audit-trail?${params.toString()}`;
}

interface Props {
  accountId: string;
  /** The login's name, shown beside the business name. */
  userName: string | null;
}

export function BusinessOsPanel({ accountId, userName }: Props) {
  const [plan, setPlan] = useState<Load<AccountPayload>>({ state: 'loading' });
  const [summary, setSummary] = useState<Load<AccountSummaryPayload>>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const id = encodeURIComponent(accountId);
    void Promise.all([
      readJson<AccountPayload>(`/api/admin/business-os/entitlements/accounts/${id}`),
      readJson<AccountSummaryPayload>(`/api/admin/business-os/accounts/${id}/summary`),
    ]).then(([planResult, summaryResult]) => {
      if (cancelled) return;
      setPlan(planResult);
      setSummary(summaryResult);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const loading = plan.state === 'loading' || summary.state === 'loading';
  const notBos =
    (plan.state === 'error' && plan.code === 'not_a_business_os_account') ||
    (summary.state === 'error' && summary.code === 'not_a_business_os_account');

  const businessName =
    summary.state === 'ok' && summary.data.business.status === 'ok' ? summary.data.business.companyName : null;

  return (
    <section
      data-testid="bos-panel"
      className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 p-6 rounded-xl border border-emerald-500/20"
    >
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Briefcase className="h-5 w-5 text-emerald-400 self-center" aria-hidden="true" />
        <h3 data-testid="bos-panel-business" className="text-lg font-bold text-white">
          {notBos ? 'No Business OS business' : businessName || (loading ? 'Business OS' : 'Unnamed business')}
        </h3>
        <span data-testid="bos-panel-user" className="text-sm text-slate-400">
          {userName || 'No name'}
        </span>
      </header>

      {loading && <p className="text-sm text-slate-400">Loading Business OS details…</p>}

      {!loading && notBos && (
        <p data-testid="bos-panel-not-bos" className="text-sm text-slate-400">
          {SUMMARY_ERROR_COPY.not_a_business_os_account}
        </p>
      )}

      {!loading && !notBos && (
        <div className="space-y-6">
          {/* Business */}
          {summary.state === 'ok' && summary.data.business.status === 'ok' && (
            <p data-testid="bos-panel-vertical" className="text-sm text-slate-300">
              Vertical: <span className="text-white">{summary.data.business.vertical}</span>
              {summary.data.business.subVertical && (
                <span className="text-slate-400"> · {summary.data.business.subVertical}</span>
              )}
            </p>
          )}
          {summary.state === 'ok' && summary.data.business.status === 'none' && (
            <p className="text-sm text-slate-400">Business profile not created yet (setup in progress).</p>
          )}

          {/* Plan: the entitlements API, rendered by the Plans & entitlements component */}
          <div>
            <h4 className="text-sm font-semibold text-slate-300">Plan & entitlements</h4>
            {plan.state === 'ok' ? (
              <EntitlementSnapshot payload={plan.data} />
            ) : (
              plan.state === 'error' && (
                <p data-testid="bos-panel-plan-error" className="mt-2 text-sm text-rose-300">
                  {ENTITLEMENT_ERROR_COPY[plan.code] ?? 'The plan could not be read.'}
                </p>
              )
            )}
          </div>

          {summary.state === 'error' && (
            <p data-testid="bos-panel-summary-error" className="text-sm text-rose-300">
              {SUMMARY_ERROR_COPY[summary.code] ?? 'The Business OS summary could not be read.'}
            </p>
          )}

          {summary.state === 'ok' && (
            <>
              {/* AI spend, 30 days */}
              <div data-testid="bos-panel-spend">
                <h4 className="text-sm font-semibold text-slate-300">
                  Business OS AI spend (last 30 days, USD estimated)
                </h4>
                {summary.data.aiSpend30d.status === 'error' ? (
                  <p className="mt-2 text-sm text-rose-300">The AI usage ledger could not be read.</p>
                ) : (
                  <>
                    <p className="mt-2 text-2xl font-bold text-white">
                      {formatUsd(summary.data.aiSpend30d.total.estimatedCostUsd)}
                      <span className="ml-3 text-sm font-normal text-slate-400">
                        {summary.data.aiSpend30d.total.calls.toLocaleString('en-US')} calls ·{' '}
                        {summary.data.aiSpend30d.total.tokens.toLocaleString('en-US')} tokens
                      </span>
                    </p>
                    {summary.data.aiSpend30d.status === 'incomplete' && (
                      <p data-testid="bos-panel-spend-incomplete" className="mt-1 text-xs text-amber-300">
                        More than 5,000 calls in 30 days: this total is a lower bound.
                      </p>
                    )}
                    {summary.data.aiSpend30d.lines.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                        {summary.data.aiSpend30d.lines.map((line) => (
                          <li key={line.key} className="rounded bg-slate-800/60 px-2 py-1 text-slate-300">
                            {line.key}: {formatUsd(line.estimatedCostUsd)} ({line.calls})
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                <Link
                  href={`/admin/analytics?scope=bos&user=${encodeURIComponent(accountId)}`}
                  className="mt-2 inline-block text-xs text-emerald-300 underline hover:text-emerald-200"
                >
                  Open in AI cost & usage
                </Link>
              </div>

              {/* Recent AI failures */}
              <div data-testid="bos-panel-failures">
                <h4 className="text-sm font-semibold text-slate-300">Recent Business OS AI failures (last 30 days)</h4>
                {summary.data.recentAiFailures.status === 'error' ? (
                  <p className="mt-2 text-sm text-rose-300">The audit trail could not be read.</p>
                ) : summary.data.recentAiFailures.items.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">No failed AI actions.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {summary.data.recentAiFailures.items.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-3 text-slate-300">
                        <span className="text-slate-400">{new Date(item.createdAt).toLocaleString()}</span>
                        <span>{item.area ?? 'unknown area'}</span>
                        {item.actionType && <span className="text-slate-400">{item.actionType}</span>}
                        {item.errorCode && <span className="font-mono text-rose-300">{item.errorCode}</span>}
                        <Link href={auditLink(accountId, item.groupId)} className="text-xs text-blue-300 underline">
                          In audit trail
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  data-testid="bos-panel-failures-link"
                  href={auditLink(accountId)}
                  className="mt-2 inline-block text-xs text-blue-300 underline hover:text-blue-200"
                >
                  View all of this business’s AI failures in the audit trail
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
