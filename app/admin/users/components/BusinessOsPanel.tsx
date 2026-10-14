/**
 * The Business OS part of the Businesses drawer (admin reorganisation slice
 * 2b; layout from Admin Layout follow-ups LF-4a.2).
 *
 * Order (BD-4): a header line, the summary strip, then three sections:
 * Credits & billing (the Credits and Credit top-ups blocks, unedited, each
 * with its own read), Plan & entitlements (collapsed), AI usage (Business OS
 * spend and failures, then "All products" from the drawer, folded). The rest of
 * the drawer (Account & security, Activity, Danger area) is `BusinessDetail`'s.
 *
 * The panel stays the one owner of its two reads and of the take-back wiring
 * between the two money blocks (SA ruling LF-4a.2 SQ-B: not lifted). It always
 * renders one root and the three sections; only their contents switch, and the
 * money blocks have one fixed slot with no key, so they mount once per opening
 * (SA C7).
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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  ENTITLEMENT_ERROR_COPY,
  EntitlementSnapshot,
} from '@/app/admin/business-os-tiers/components/EntitlementSnapshot';
import type { AccountPayload } from '@/app/admin/business-os-tiers/types';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import type { AccountSummaryPayload, AdminUserRow } from '../types';
import { CreditsBlock, type TakeBackRequest } from './CreditsBlock';
import { BoostBlock } from './BoostBlock';
import {
  BusinessSummaryStrip,
  STRIP_COPY,
  type StripCreditsSlot,
  type StripSlot,
} from './BusinessSummaryStrip';
import { ShowMoreList } from './drawerFolds';
import { DrawerBox, PART_BOX, PartPurpose } from './DrawerBox';

/**
 * Every refusal the summary route can return, as a sentence. Kept complete by a
 * test that reads the route's source and fails on a code with no copy here
 * (SA N-6, modelled on accountLookup.contract).
 */
export const SUMMARY_ERROR_COPY: Record<string, string> = {
  not_a_business_os_account: 'Not a Business OS account. This login has no Business OS business.',
  platform_account: 'This is the platform account. Its AI usage is not one business’s spend.',
  invalid_account_id: 'That does not look like an account id.',
  tenant_check_failed: 'Whether this is a Business OS account could not be determined. Try again.',
  'Internal server error': 'Something failed on the server. The correlation id is in the logs.',
};

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; code: string };

/**
 * One GET. The request is byte-identical to before LF-4a.2; only the body is
 * read through `readJsonBody` (§5.10, SA-C12), which maps an unreadable body to
 * `null` and so to the same `'unknown'` code the old parser error gave. The
 * truthiness test on `success` is kept on purpose (SA review point 4).
 */
async function readJson<T>(url: string): Promise<Load<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await readJsonBody(response);
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

/**
 * The tier and cohort the entitlements read already returned, nothing more.
 * Never empty (SA C6): with neither it says "No plan recorded", as the strip
 * does. The section heading already says "Plan & entitlements" (SQ-H).
 */
function planSummary(payload: AccountPayload): string {
  const parts: string[] = [];
  if (payload.plan?.tier) parts.push(payload.plan.tier);
  if (payload.plan?.cohort) parts.push(`cohort ${payload.plan.cohort}`);
  return parts.length > 0 ? parts.join(' · ') : STRIP_COPY.noPlan;
}

/** The link style the drawer uses for every in-text link (BD-11: no decorative green). */
const LINK_CLASS = 'text-xs text-blue-300 underline hover:text-blue-200';

interface Props {
  /** The open row: its id, the login's name, and the strip's row facts (BD-1). */
  user: AdminUserRow;
  /**
   * "All products, token records", built by the drawer from the page's stats
   * read; shown in AI usage in every state of this panel (BD-7, SA C3 (d)).
   * Presentational: it holds no read.
   */
  allProducts: ReactNode;
  /**
   * BD-14 (LF-4b): the drawer's list re-read, called by the Credits block once
   * after a successful Give or Take back.
   */
  onCreditsChanged: () => void;
}

export function BusinessOsPanel({ user, allProducts, onCreditsChanged }: Props) {
  const accountId = user.id;
  const userName = user.full_name;
  const [plan, setPlan] = useState<Load<AccountPayload>>({ state: 'loading' });
  const [summary, setSummary] = useState<Load<AccountSummaryPayload>>({ state: 'loading' });
  // Credits boost 6b (SA C-5): Take back from a top-up opens the Credits block's dialog.
  const [takeBackableLots, setTakeBackableLots] = useState<string[]>([]);
  const [loadedLots, setLoadedLots] = useState<string[]>([]);
  // The top-up's button travels with the request, so focus can return to it (SA-C8, SA C5).
  const [takeBackRequest, setTakeBackRequest] = useState<TakeBackRequest | null>(null);
  const onTakeBackableLots = useCallback((lotIds: string[], loadedLotIds: string[]) => {
    setTakeBackableLots(lotIds);
    setLoadedLots(loadedLotIds);
  }, []);
  const takeBack = useMemo(
    () => ({
      lotIds: new Set(takeBackableLots),
      loadedLotIds: new Set(loadedLots),
      onTakeBack: (lotId: string, opener: HTMLElement) =>
        setTakeBackRequest((previous) => ({ lotId, seq: (previous?.seq ?? 0) + 1, opener })),
    }),
    [takeBackableLots, loadedLots]
  );

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

  // The header never guesses (SA N-4): a name only when the summary produced
  // one; "Unnamed business" only for a business whose profile has no name; a
  // neutral title while loading, when the profile does not exist yet, or when
  // the summary failed.
  let headerTitle = 'Business OS';
  if (notBos) headerTitle = 'No Business OS business';
  else if (summary.state === 'ok' && summary.data.business.status === 'ok') {
    headerTitle = summary.data.business.companyName || 'Unnamed business';
  }
  // What the credit forms' confirm step names (slice 11c): the business when
  // the summary named one, otherwise the account id, never "Business OS".
  const businessLabel =
    summary.state === 'ok' && summary.data.business.status === 'ok' && summary.data.business.companyName
      ? summary.data.business.companyName
      : accountId;

  // The strip's slots (BD-1, BD-12, BD-13, SQ-G): placeholders until both reads
  // settle; then "Not a Business OS account" when the reads say so (the reads
  // decide, not the row); a failed read says so, never a zero (BD-3).
  let planSlot: StripSlot = { kind: 'unreadable' };
  let aiSlot: StripSlot = { kind: 'unreadable' };
  let creditsSlot: StripCreditsSlot = { kind: 'cell' };
  if (loading) {
    planSlot = { kind: 'reading' };
    aiSlot = { kind: 'reading' };
    creditsSlot = { kind: 'reading' };
  } else if (notBos) {
    planSlot = { kind: 'not_bos' };
    aiSlot = { kind: 'not_bos' };
    creditsSlot = { kind: 'not_bos' };
  } else {
    if (plan.state === 'ok') planSlot = { kind: 'value', text: planSummary(plan.data) };
    if (summary.state === 'ok' && summary.data.aiSpend30d.status !== 'error') {
      const spend = summary.data.aiSpend30d;
      aiSlot = {
        kind: 'value',
        text: formatUsd(spend.total.estimatedCostUsd),
        sub: spend.status === 'incomplete' ? 'estimated, a lower bound' : 'estimated',
      };
    }
  }

  // One root in every state, and the three sections always render (SA C7):
  // only their contents switch, so nothing above the money blocks changes type.
  return (
    <div data-testid="bos-panel" className="space-y-6">
      <div data-testid="bos-panel-header" className="space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-slate-400">
          <span data-testid="bos-panel-business" className="font-semibold text-slate-200">
            {headerTitle}
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="bos-panel-user">{userName || 'No name'}</span>
          {!notBos && summary.state === 'ok' && summary.data.business.status === 'ok' && (
            <>
              <span aria-hidden="true">·</span>
              <span data-testid="bos-panel-vertical" className="text-slate-300">
                Vertical: <span className="text-white">{summary.data.business.vertical}</span>
                {summary.data.business.subVertical && (
                  <span className="text-slate-400"> · {summary.data.business.subVertical}</span>
                )}
              </span>
            </>
          )}
        </p>
        {!notBos && summary.state === 'ok' && summary.data.business.status === 'none' && (
          <p className="text-sm text-slate-400">Business profile not created yet (setup in progress).</p>
        )}
      </div>

      <BusinessSummaryStrip
        plan={planSlot}
        credits={creditsSlot}
        aiSpend={aiSlot}
        business={user.business}
        creditsLeft={user.creditsLeft}
        lastSignInAt={user.last_sign_in_at ?? null}
      />

      {/* 1. Credits & billing: the two money blocks (their action bars, folds
          and focus return are LF-4b's, inside them). Today's gate: mounted only after both
          reads settle, and only for a Business OS account (BD-13). */}
      {/* LF-4d (BD-16): each section in its box with its purpose line; the
          box renders in every state, so the money blocks keep their nodes. */}
      <DrawerBox section="credits" title="Credits & billing" testId="drawer-section-credits">
        {loading && <p className="text-sm text-slate-400">Loading Business OS details…</p>}

        {!loading && notBos && (
          <p data-testid="bos-panel-not-bos" className="text-sm text-slate-400">
            {SUMMARY_ERROR_COPY.not_a_business_os_account}
          </p>
        )}

        {!loading && !notBos && (
          <div className="space-y-3">
            {/* Credits (credit deduction slice 11c): its own read */}
            <CreditsBlock
              accountId={accountId}
              businessLabel={businessLabel}
              takeBackRequest={takeBackRequest}
              onTakeBackableLots={onTakeBackableLots}
              onCreditsChanged={onCreditsChanged}
            />

            {/* Credit top-ups (credits boost slice 6a): its own read, after Credits.
                6b (SA C-5): its Take back opens the Credits block's dialog on the purchase's lot. */}
            <BoostBlock accountId={accountId} businessLabel={businessLabel} takeBack={takeBack} />
          </div>
        )}
      </DrawerBox>

      {/* 2. Plan: the entitlements API, rendered by the Plans & entitlements
          component, collapsed by default here only (user UI fixes,
          2026-10-04). The Plans page renders it open, unchanged. A read
          failure is never hidden behind the fold. */}
      <DrawerBox section="plan" title="Plan & entitlements" testId="drawer-section-plan">
        {loading && <p className="text-sm text-slate-400">Loading the plan…</p>}

        {!loading && notBos && (
          <p data-testid="bos-plan-not-bos" className="text-sm text-slate-400">
            {SUMMARY_ERROR_COPY.not_a_business_os_account}
          </p>
        )}

        {!loading && !notBos && plan.state === 'ok' && (
          <details data-testid="bos-panel-plan" className="group">
            <summary
              data-testid="bos-panel-plan-summary"
              className="cursor-pointer select-none text-sm font-semibold text-slate-300 hover:text-white"
            >
              {planSummary(plan.data)}
              <span className="font-normal text-blue-300">
                {' · '}
                <span className="group-open:hidden">Show all capabilities</span>
                <span className="hidden group-open:inline">Hide capabilities</span>
              </span>
            </summary>
            <EntitlementSnapshot payload={plan.data} />
          </details>
        )}

        {!loading && !notBos && plan.state === 'error' && (
          <p data-testid="bos-panel-plan-error" className="text-sm text-rose-300">
            {ENTITLEMENT_ERROR_COPY[plan.code] ?? 'The plan could not be read.'}
          </p>
        )}
      </DrawerBox>

      {/* 3. AI usage (BD-7, Q-4 (a)): Business OS first and open; "All
          products" from the drawer last, folded, in every state (SA C3 (d)). */}
      <DrawerBox section="ai" title="AI usage" testId="drawer-section-ai">
        {loading && <p className="text-sm text-slate-400">Loading Business OS AI usage…</p>}

        {!loading && !notBos && summary.state === 'error' && (
          <p data-testid="bos-panel-summary-error" className="text-sm text-rose-300">
            {SUMMARY_ERROR_COPY[summary.code] ?? 'The Business OS summary could not be read.'}
          </p>
        )}

        {!loading && !notBos && summary.state === 'ok' && (
          <>
            {/* Not headings: each DrawerSection has exactly one (L-1d M-4; SA C2). */}
            <div data-testid="bos-panel-spend" className={`${PART_BOX} space-y-2`}>
              <p className="text-sm font-semibold text-slate-300">Business OS, last 30 days (USD estimated)</p>
              <PartPurpose part="ai-bos" />
              {summary.data.aiSpend30d.status === 'error' ? (
                <p className="text-sm text-rose-300">The AI usage ledger could not be read.</p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-white">
                    {formatUsd(summary.data.aiSpend30d.total.estimatedCostUsd)}
                    <span className="ml-3 text-sm font-normal text-slate-400">
                      {summary.data.aiSpend30d.total.calls.toLocaleString('en-US')} calls ·{' '}
                      {summary.data.aiSpend30d.total.tokens.toLocaleString('en-US')} tokens
                    </span>
                  </p>
                  {summary.data.aiSpend30d.status === 'incomplete' && (
                    <p data-testid="bos-panel-spend-incomplete" className="text-xs text-amber-300">
                      More than {summary.data.aiSpend30d.readCeiling.toLocaleString('en-US')} calls in 30 days:
                      this total is a lower bound.
                    </p>
                  )}
                  {summary.data.aiSpend30d.lines.length > 0 && (
                    <ul className="flex flex-wrap gap-2 text-xs">
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
                className={`inline-block ${LINK_CLASS}`}
              >
                Open in AI cost & usage
              </Link>
            </div>

            <div data-testid="bos-panel-failures" className={`${PART_BOX} space-y-2`}>
              <p className="text-sm font-semibold text-slate-300">Recent Business OS AI failures (last 30 days)</p>
              <PartPurpose part="ai-failures" />
              {summary.data.recentAiFailures.status === 'error' ? (
                <p className="text-sm text-rose-300">The audit trail could not be read.</p>
              ) : summary.data.recentAiFailures.items.length === 0 ? (
                <p className="text-sm text-slate-400">No failed AI actions.</p>
              ) : (
                // BD-8: the newest three, the rest hidden (never unmounted) behind "Show N more".
                <ShowMoreList
                  testId="bos-panel-failures-more"
                  listClassName="space-y-1 text-sm"
                  items={summary.data.recentAiFailures.items.map((item) => (
                    <li
                      key={item.id}
                      data-testid="bos-panel-failure"
                      className="flex flex-wrap items-center gap-x-3 text-slate-300"
                    >
                      {/* §5.11: UTC, never the browser's local time (P-8). */}
                      <span data-testid="bos-panel-failure-time" className="text-slate-400">
                        {formatUtc(item.createdAt)}
                      </span>
                      <span>{item.area ?? 'unknown area'}</span>
                      {item.actionType && <span className="text-slate-400">{item.actionType}</span>}
                      {item.errorCode && <span className="font-mono text-rose-300">{item.errorCode}</span>}
                      <Link href={auditLink(accountId, item.groupId)} className="text-xs text-blue-300 underline">
                        In audit trail
                      </Link>
                    </li>
                  ))}
                />
              )}
              <Link
                data-testid="bos-panel-failures-link"
                href={auditLink(accountId)}
                className={`inline-block ${LINK_CLASS}`}
              >
                View all of this business’s AI failures in the audit trail
              </Link>
            </div>
          </>
        )}

        {allProducts}
      </DrawerBox>
    </div>
  );
}
