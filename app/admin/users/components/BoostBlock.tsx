'use client';

/**
 * The "Credit top-ups" block of the Businesses panel (credits boost slice 6a;
 * requirement FR-22, FR-38, R-12; SA N-3, C-4, Q-7; workplan §3.2).
 *
 * Reads `GET /api/admin/business-os/credits/accounts/<id>/boost` on its own, so
 * the Credits block (11c) above it and its tests are untouched, and shows:
 *   - every top-up in both Stripe modes, newest first, each row with its own
 *     mode badge (Q-7), the package, credits, what was paid (tax and refunds
 *     included), a plain-words status (raw status on hover) and, for a flagged
 *     one, the reason in words (2b SA N-3);
 *   - Stripe references: the payment and the dispute link to the Stripe
 *     dashboard in the ROW's own mode, only for a well-formed id (SA C-4);
 *     anything else is plain text;
 *   - the spending limit: the default from configuration, or the active admin
 *     override with its reason, admin and date, and the last 20 changes.
 *
 * Read only in 6a: no limit change, no reconcile button and no Take back (6b).
 * A block the server could not read says so; it never shows zeros. Free text
 * (reasons) is rendered as text only.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Receipt } from 'lucide-react';

import {
  adminBoostFlagReasonWords,
  adminBoostStatusTone,
  adminBoostStatusWords,
  stripeDashboardUrl,
  type AdminBoostStatusTone,
  type StripeDashboardKind,
} from '@/lib/business-os/boost/boostAdminView';
import type { AdminBoostCapBlock, AdminBoostPurchaseRow, AdminBoostView } from '@/lib/business-os/boost/boostAdminViewTypes';
import { formatMinorAmount } from '@/lib/business-os/currency';

import { formatCredits, formatUtc, shortId } from '../creditCopy';

export const BOOST_BLOCK_COPY = {
  heading: 'Credit top-ups',
  loading: 'Loading credit top-ups…',
  error: 'Credit top-ups could not be read.',
  purchasesError: 'The top-ups could not be read.',
  capError: 'The spending limit could not be read.',
  noPurchases: 'No top-ups yet.',
  truncatedTest: 'Showing the latest 50 test top-ups.',
  truncatedLive: 'Showing the latest 50 live top-ups.',
  truncatedBoth: 'Showing the latest 50 test and the latest 50 live top-ups.',
  testKeyNote: 'This server uses a Stripe test key: test-mode top-ups are not real money.',
  limitHeading: 'Spending limit',
  historyHeading: 'Limit changes (latest 20)',
  noHistory: 'No admin has changed this limit.',
  needsReview: 'Needs review',
} as const;

/** Error codes the route can answer, in words. */
const ERROR_WORDS: Readonly<Record<string, string>> = {
  platform_account: 'This is the platform account, not a business.',
  not_a_business_os_account: 'This account is not a Business OS business.',
  tenant_check_failed: 'Whether this is a business could not be checked.',
  invalid_account_id: 'The account id is not valid.',
};

// ── The shape the block draws, checked in full before anything is drawn (QA6a-L1) ──

type Unknown = Record<string, unknown>;

const isObject = (value: unknown): value is Unknown => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown) => value === null || isString(value);
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isNullableNumber = (value: unknown) => value === null || isNumber(value);

function isPurchaseRow(value: unknown): value is AdminBoostPurchaseRow {
  if (!isObject(value) || !isObject(value.stripe)) return false;
  const stripe = value.stripe;
  return (
    isString(value.id) &&
    typeof value.livemode === 'boolean' &&
    isString(value.status) &&
    isString(value.packageId) &&
    isNumber(value.packageVersion) &&
    isNumber(value.priceMinor) &&
    isString(value.currency) &&
    isNumber(value.creditsTotal) &&
    isNullableNumber(value.amountTotalMinor) &&
    isNullableNumber(value.amountTaxMinor) &&
    isNumber(value.amountRefundedMinor) &&
    isNullableString(value.flagReason) &&
    isNullableString(stripe.paymentIntentId) &&
    isNullableString(stripe.disputeId) &&
    isNullableString(stripe.checkoutSessionId) &&
    isString(value.createdAt) &&
    isNullableString(value.paidAt)
  );
}

function isCapChange(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value.id) &&
    isNumber(value.amountMinor) &&
    isString(value.currency) &&
    isString(value.reason) &&
    isString(value.actorAdminId) &&
    isString(value.createdAt) &&
    isNullableString(value.endedAt) &&
    isNullableString(value.endedByAdminId) &&
    isNullableString(value.endedReason)
  );
}

function isCapBlock(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.status === 'error') return true;
  if (value.status !== 'ok') return false;
  const fallback = value.default;
  const active = value.active;
  return (
    isObject(fallback) &&
    isNumber(fallback.amountMinor) &&
    isString(fallback.currency) &&
    isNumber(fallback.windowDays) &&
    (active === null ||
      (isObject(active) && isNumber(active.amountMinor) && isString(active.currency) && isString(active.reason) && isString(active.actorAdminId) && isString(active.createdAt))) &&
    Array.isArray(value.history) &&
    value.history.every(isCapChange)
  );
}

function isPurchasesBlock(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.status === 'error') return true;
  return (
    value.status === 'ok' &&
    Array.isArray(value.rows) &&
    value.rows.every(isPurchaseRow) &&
    isObject(value.truncated) &&
    typeof value.truncated.test === 'boolean' &&
    typeof value.truncated.live === 'boolean'
  );
}

export function isAdminBoostView(value: unknown): value is AdminBoostView {
  return (
    isObject(value) &&
    typeof value.isOwnAccount === 'boolean' &&
    (value.serverMode === null || value.serverMode === 'test' || value.serverMode === 'live') &&
    isPurchasesBlock(value.purchases) &&
    isCapBlock(value.cap)
  );
}

/** Minor units in their own currency, through the shared rule (SA CR-1); never throws. */
function money(minor: number, currency: string): string {
  if (!Number.isFinite(minor)) return 'unreadable';
  try {
    return formatMinorAmount(minor, currency, 'en');
  } catch {
    return 'unreadable';
  }
}

/** QA6a-L2: the note names the mode that was cut. */
function truncatedNote(truncated: { test: boolean; live: boolean }): string | null {
  if (truncated.test && truncated.live) return BOOST_BLOCK_COPY.truncatedBoth;
  if (truncated.test) return BOOST_BLOCK_COPY.truncatedTest;
  if (truncated.live) return BOOST_BLOCK_COPY.truncatedLive;
  return null;
}

type Load = { state: 'loading' } | { state: 'ok'; data: AdminBoostView } | { state: 'error'; code: string };

/** GET and read JSON; never throws. */
async function readView(url: string): Promise<Load> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    if (!response.ok || record?.success !== true || !record.data) {
      return { state: 'error', code: typeof record?.error === 'string' ? record.error : 'unknown' };
    }
    // A body of another shape is a failure, never a half-drawn block or a throw (QA6a-L1).
    if (!isAdminBoostView(record.data)) return { state: 'error', code: 'unknown' };
    return { state: 'ok', data: record.data };
  } catch {
    return { state: 'error', code: 'unknown' };
  }
}

const TONE_CLASSES: Readonly<Record<AdminBoostStatusTone, string>> = {
  paid: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  reversed: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  review: 'border-rose-500/50 bg-rose-500/10 text-rose-200',
  waiting: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  closed: 'border-slate-600 bg-slate-800 text-slate-300',
};

function StripeRef({ kind, id, livemode, label }: { kind: StripeDashboardKind; id: string | null; livemode: boolean; label: string }) {
  if (id === null) return null;
  const url = stripeDashboardUrl(kind, id, livemode);
  if (!url) {
    return (
      <span data-testid={`boost-stripe-${kind}-text`} title={id} className="text-xs text-slate-400">
        {label} {shortId(id)}
      </span>
    );
  }
  return (
    <a
      data-testid={`boost-stripe-${kind}-link`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={id}
      className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

function PurchaseRow({ row }: { row: AdminBoostPurchaseRow }) {
  const tone = adminBoostStatusTone(row.status);
  const reason = row.status === 'flagged_mismatch' ? adminBoostFlagReasonWords(row.flagReason) : null;
  const paid = row.amountTotalMinor ?? row.priceMinor;
  return (
    <li data-testid="boost-purchase" data-status={row.status} className="rounded border border-slate-700 p-2 text-sm text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="boost-mode-badge"
          className={`rounded px-1.5 text-[10px] font-semibold uppercase ${row.livemode ? 'bg-emerald-600 text-white' : 'bg-slate-600 text-slate-100'}`}
        >
          {row.livemode ? 'Live' : 'Test'}
        </span>
        <span title={row.paidAt ? `Paid ${formatUtc(row.paidAt)}` : undefined}>{formatUtc(row.createdAt)}</span>
        <span className="text-slate-400">
          {row.packageId} v{row.packageVersion}
        </span>
        <span className="font-semibold text-white">{formatCredits(row.creditsTotal)} credits</span>
        <span data-testid="boost-purchase-paid">
          {money(paid, row.currency)}
          {row.amountTaxMinor !== null && row.amountTaxMinor > 0 && (
            <span className="text-slate-400"> (incl. tax {money(row.amountTaxMinor, row.currency)})</span>
          )}
        </span>
        <span data-testid="boost-status" title={row.status} className={`rounded border px-1.5 text-xs ${TONE_CLASSES[tone]}`}>
          {adminBoostStatusWords(row.status)}
        </span>
        {row.amountRefundedMinor > 0 && (
          <span data-testid="boost-refunded" className="text-xs text-amber-200">
            Refunded {money(row.amountRefundedMinor, row.currency)}
          </span>
        )}
      </div>
      {reason !== null && (
        <p data-testid="boost-flag-reason" title={row.flagReason ?? undefined} className="mt-1 text-xs text-rose-200">
          {BOOST_BLOCK_COPY.needsReview}: {reason}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <StripeRef kind="payment" id={row.stripe.paymentIntentId} livemode={row.livemode} label="Payment" />
        <StripeRef kind="dispute" id={row.stripe.disputeId} livemode={row.livemode} label="Dispute" />
        {row.stripe.checkoutSessionId && (
          <span data-testid="boost-session-id" title={row.stripe.checkoutSessionId} className="text-xs text-slate-500">
            Session {row.stripe.checkoutSessionId.slice(0, 14)}…
          </span>
        )}
      </div>
    </li>
  );
}

function perWindow(amountMinor: number, currency: string, windowDays: number): string {
  return `${money(amountMinor, currency)} per ${windowDays} days`;
}

function CapSection({ cap }: { cap: AdminBoostCapBlock }) {
  if (cap.status === 'error') {
    return (
      <p data-testid="boost-cap-error" className="text-sm text-rose-300">
        {BOOST_BLOCK_COPY.capError}
      </p>
    );
  }
  const windowDays = cap.default.windowDays;
  return (
    <div data-testid="boost-cap" className="space-y-1 text-sm text-slate-300">
      <p className="text-slate-400">{BOOST_BLOCK_COPY.limitHeading}</p>
      {cap.active ? (
        <p data-testid="boost-cap-override">
          <span className="font-semibold text-white">Set by an admin: {perWindow(cap.active.amountMinor, cap.active.currency, windowDays)}</span>
          <span className="text-slate-400">
            {' '}
            (default {perWindow(cap.default.amountMinor, cap.default.currency, windowDays)}) · by{' '}
            <span title={cap.active.actorAdminId}>{shortId(cap.active.actorAdminId)}</span> on {formatUtc(cap.active.createdAt)} ·{' '}
          </span>
          <span data-testid="boost-cap-reason">“{cap.active.reason}”</span>
        </p>
      ) : (
        <p data-testid="boost-cap-default">
          <span className="font-semibold text-white">Default: {perWindow(cap.default.amountMinor, cap.default.currency, windowDays)}</span>
        </p>
      )}
      <details data-testid="boost-cap-history">
        <summary className="cursor-pointer select-none text-xs text-slate-400 hover:text-white">{BOOST_BLOCK_COPY.historyHeading}</summary>
        {cap.history.length === 0 ? (
          <p data-testid="boost-cap-no-history" className="mt-1 text-xs text-slate-400">
            {BOOST_BLOCK_COPY.noHistory}
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {cap.history.map((change) => (
              <li key={change.id} data-testid="boost-cap-change">
                {formatUtc(change.createdAt)}: set to {money(change.amountMinor, change.currency)} by{' '}
                <span title={change.actorAdminId}>{shortId(change.actorAdminId)}</span> · “{change.reason}”
                {change.endedAt ? (
                  <span className="text-slate-400">
                    {' '}
                    · ended {formatUtc(change.endedAt)}
                    {change.endedByAdminId && (
                      <>
                        {' '}
                        by <span title={change.endedByAdminId}>{shortId(change.endedByAdminId)}</span>
                      </>
                    )}
                    {change.endedReason === 'replaced' ? ' (replaced by a newer limit)' : change.endedReason ? ` · “${change.endedReason}”` : ''}
                  </span>
                ) : (
                  <span className="text-emerald-300"> · active</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

export function BoostBlock({ accountId }: { accountId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const url = `/api/admin/business-os/credits/accounts/${encodeURIComponent(accountId)}/boost`;

  const reload = useCallback(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    void readView(url).then((next) => {
      if (!cancelled) setLoad(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => reload(), [reload]);

  return (
    <div data-testid="boost-block">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
        <Receipt className="h-4 w-4 text-sky-300" aria-hidden="true" />
        {BOOST_BLOCK_COPY.heading}
      </h4>

      {load.state === 'loading' && <p className="mt-2 text-sm text-slate-400">{BOOST_BLOCK_COPY.loading}</p>}

      {load.state === 'error' && (
        <p data-testid="boost-error" className="mt-2 text-sm text-rose-300">
          {ERROR_WORDS[load.code] ?? BOOST_BLOCK_COPY.error}
        </p>
      )}

      {load.state === 'ok' && (
        <div className="mt-2 space-y-3">
          {load.data.serverMode === 'test' && (
            <p data-testid="boost-test-key-note" className="text-xs text-slate-400">
              {BOOST_BLOCK_COPY.testKeyNote}
            </p>
          )}

          {load.data.purchases.status === 'error' ? (
            <p data-testid="boost-purchases-error" className="text-sm text-rose-300">
              {BOOST_BLOCK_COPY.purchasesError}
            </p>
          ) : load.data.purchases.rows.length === 0 ? (
            <p data-testid="boost-no-purchases" className="text-sm text-slate-400">
              {BOOST_BLOCK_COPY.noPurchases}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {load.data.purchases.rows.map((row) => (
                  <PurchaseRow key={row.id} row={row} />
                ))}
              </ul>
              {truncatedNote(load.data.purchases.truncated) && (
                <p data-testid="boost-truncated" className="text-xs text-slate-500">
                  {truncatedNote(load.data.purchases.truncated)}
                </p>
              )}
            </>
          )}

          <CapSection cap={load.data.cap} />
        </div>
      )}
    </div>
  );
}
