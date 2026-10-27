'use client';

/**
 * "Update card" and "Invoices", in Settings → Plan (plan payments P-7a.2;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §2.1,
 * §4.4, §4.5; SA C-1, C-6, TQ-6, TQ-8; BQ-7).
 *
 * IT RENDERS; IT DOES NOT DECIDE. `PlanManage` mounts it only where
 * `purchase.manage.cardAndInvoices` is set (`planCardAndInvoicesOffer`, the
 * predicate the portal and invoices routes refuse on), so a button appears
 * exactly where the route answers.
 *
 * Update card posts `{ intent: 'update_card', locale }` and sends the browser
 * to the portal URL the route returns, in the same tab; Stripe brings the
 * owner back to Settings → Plan. The URL is a bearer link: never logged,
 * never kept in state beyond the navigation.
 *
 * Invoices loads ONLY when the owner opens the list (TQ-6: not on every
 * drawer open), once per open; the last 12, newest first, each with Stripe's
 * hosted invoice page (invoice and receipt) in a new tab. "See all in Stripe"
 * (when there are more) opens the portal home. The list is never logged.
 *
 * Imports nothing from the entitlements module and no server file (type-only
 * imports).
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { PlanInvoiceRow } from '@/lib/business-os/billing/planInvoiceList';
import { createLogger } from '@/lib/logger';

import {
  PLAN_INVOICE_REASON_KEYS,
  PLAN_INVOICE_STATUS_KEYS,
  PLAN_INVOICES_PATH,
  PLAN_PORTAL_PATH,
  planBillingDocsRefusalKey,
} from './planManageCopy';
import { formatAccountDay, formatUsdMinor } from './planUpgradeCopy';

const logger = createLogger({ module: 'BusinessOsPlanCardAndInvoices' });

const SECONDARY_BUTTON = 'rounded border border-[var(--v2-border)] px-3 py-1.5 text-xs text-[var(--v2-text-primary)] disabled:opacity-60';
const LINK = 'text-xs font-medium text-[var(--v2-text-primary)] underline underline-offset-2';

type PortalIntent = 'update_card' | 'invoices';
const PORTAL_LANGUAGES: readonly string[] = ['en', 'he', 'es'];
type InvoiceState =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'ready'; invoices: PlanInvoiceRow[]; hasMore: boolean }
  | { kind: 'failed'; key: string };

/** A signed amount in USD (a credit reads "-$5.00"). */
function formatAmount(minor: number): string {
  return minor < 0 ? `-${formatUsdMinor(-minor)}` : formatUsdMinor(minor);
}

function isInvoiceRow(value: unknown): value is PlanInvoiceRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.reason === 'string' &&
    typeof row.amountMinor === 'number' &&
    typeof row.status === 'string' &&
    (row.hostedInvoiceUrl === null || typeof row.hostedInvoiceUrl === 'string')
  );
}

export interface PlanCardAndInvoicesProps {
  /** Test seam: where the browser goes. Default `window.location.assign`. */
  navigate?: (url: string) => void;
}

export function PlanCardAndInvoices({ navigate }: PlanCardAndInvoicesProps) {
  const { t, language, timezone } = useLanguage();
  const [opening, setOpening] = useState<PortalIntent | null>(null);
  const [portalRefusal, setPortalRefusal] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceState>({ kind: 'closed' });
  // One request at a time, even on a double click before React re-renders.
  const inFlight = useRef(false);

  // Back from Stripe through the browser's back/forward cache: the page is
  // restored as it was left ("Opening Stripe…"), so make it usable again.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      inFlight.current = false;
      setOpening(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const openPortal = async (intent: PortalIntent) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpening(intent);
    setPortalRefusal(null);
    try {
      const response = await fetch(PLAN_PORTAL_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The route accepts exactly these; anything else opens Stripe's `auto`.
        body: JSON.stringify({ intent, ...(PORTAL_LANGUAGES.includes(language) ? { locale: language } : {}) }),
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      const data = body?.data as Record<string, unknown> | undefined;
      const url = typeof data?.url === 'string' ? data.url : null;
      if (response.status === 200 && body?.success === true && url !== null && url.startsWith('https://')) {
        // Same tab; Stripe brings the owner back to Settings → Plan.
        (navigate ?? ((target: string) => window.location.assign(target)))(url);
        return; // Keep "Opening Stripe…" until the page leaves.
      }
      const code = typeof body?.code === 'string' ? body.code : null;
      setPortalRefusal(planBillingDocsRefusalKey({ httpStatus: response.status, code }));
    } catch (err) {
      // Never the URL: only that the request failed.
      logger.warn({ err, intent }, 'Plan billing portal request failed');
      setPortalRefusal('plan.manage.refusal.generic');
    }
    inFlight.current = false;
    setOpening(null);
  };

  const loadInvoices = async () => {
    setInvoices({ kind: 'loading' });
    try {
      const response = await fetch(PLAN_INVOICES_PATH, { method: 'GET', cache: 'no-store' });
      let body: Record<string, unknown> | null = null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      const data = body?.data as Record<string, unknown> | undefined;
      if (response.status === 200 && body?.success === true && data && Array.isArray(data.invoices)) {
        setInvoices({ kind: 'ready', invoices: data.invoices.filter(isInvoiceRow), hasMore: data.hasMore === true });
        return;
      }
      const code = typeof body?.code === 'string' ? body.code : null;
      const key = planBillingDocsRefusalKey({ httpStatus: response.status, code });
      // A provider or service hiccup reads as "could not load"; a real refusal says why.
      setInvoices({ kind: 'failed', key: key === 'plan.manage.refusal.stripe_error' || key === 'plan.manage.refusal.generic' ? 'plan.invoices.unavailable' : key });
    } catch (err) {
      logger.warn({ err }, 'Plan invoice list request failed');
      setInvoices({ kind: 'failed', key: 'plan.invoices.unavailable' });
    }
  };

  const toggleInvoices = () => {
    if (invoices.kind === 'closed') void loadInvoices();
    else setInvoices({ kind: 'closed' });
  };

  const busy = opening !== null;

  return (
    <div className="space-y-2" data-testid="plan-card-and-invoices">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => void openPortal('update_card')} data-testid="plan-update-card">
          {t('plan.manage.update_card')}
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={invoices.kind === 'loading'}
          aria-expanded={invoices.kind !== 'closed'}
          onClick={toggleInvoices}
          data-testid="plan-invoices-toggle"
        >
          {t(invoices.kind === 'closed' ? 'plan.invoices.show' : 'plan.invoices.hide')}
        </button>
      </div>

      {busy && (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]" data-testid="plan-portal-opening">
          <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
          <span>{t('plan.manage.opening_stripe')}</span>
        </p>
      )}
      {portalRefusal !== null && (
        <p role="alert" className="text-xs text-[var(--v2-text-secondary)]" data-testid="plan-portal-refused">
          {t(portalRefusal)}
        </p>
      )}

      {invoices.kind === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]" data-testid="plan-invoices-loading">
          <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
          <span>{t('plan.invoices.loading')}</span>
        </p>
      )}

      {invoices.kind === 'failed' && (
        <div className="space-y-1" data-testid="plan-invoices-failed">
          <p role="alert" className="text-xs text-[var(--v2-text-secondary)]">
            {t(invoices.key)}
          </p>
          <button type="button" className={LINK} onClick={() => void loadInvoices()} data-testid="plan-invoices-retry">
            {t('plan.invoices.retry')}
          </button>
        </div>
      )}

      {invoices.kind === 'ready' && (
        <section aria-label={t('plan.invoices.title')} className="space-y-2" data-testid="plan-invoices">
          {invoices.invoices.length === 0 ? (
            <p className="text-xs text-[var(--v2-text-secondary)]" data-testid="plan-invoices-empty">
              {t('plan.invoices.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {invoices.invoices.map((invoice) => {
                const day = formatAccountDay(invoice.createdAt, language, timezone) ?? '';
                const reason = t(PLAN_INVOICE_REASON_KEYS[invoice.reason] ?? 'plan.invoices.reason.other');
                const status = PLAN_INVOICE_STATUS_KEYS[invoice.status];
                return (
                  <li key={invoice.id} className="text-xs text-[var(--v2-text-primary)]" data-testid="plan-invoice-row">
                    <span className="block">
                      {day} · {reason}
                      {invoice.planLabel ? ` · ${invoice.planLabel}` : ''}
                    </span>
                    <span className="block text-[var(--v2-text-secondary)]">
                      {/* Amounts are digits in USD (SR-15); isolated so RTL does not reorder the sign. */}
                      <bdi>{formatAmount(invoice.amountMinor)}</bdi>
                      {status ? ` · ${t(status)}` : ''}
                    </span>
                    {invoice.hostedInvoiceUrl && (
                      <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="plan-invoice-link">
                        {/* FU-P7a2-1 (G-5, 2026-10-27): a Due invoice is paid on the same hosted page, so say so. */}
                        {t(invoice.status === 'open' ? 'plan.invoices.pay_now' : 'plan.invoices.view')}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {invoices.hasMore && (
            <button type="button" className={LINK} disabled={busy} onClick={() => void openPortal('invoices')} data-testid="plan-invoices-see-all">
              {t('plan.invoices.see_all')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
