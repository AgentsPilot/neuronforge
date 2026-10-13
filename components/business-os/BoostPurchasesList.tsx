'use client';

/**
 * Purchases: the owner's bought boosts, at the bottom of the Top up panel
 * (credits boost slice 5b.2; requirement FR-26, FR-28, FR-29, BQ-B1; SA Q-3,
 * Q-4).
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────────
 * Nothing at all until the owner has at least one purchase (SA Q-3). Then one
 * row per purchase, newest first, from `GET …/boost/purchases`:
 *   - when: the BUSINESS's clock (`timeZoneOptions`, from the business's saved
 *     timezone), never a guess from the browser;
 *   - the package name (the active catalogue; a retired package shows its id,
 *     SA Q-4);
 *   - the credits, the price with "excl. tax" (`formatMinorAmount`, USD only);
 *   - a status chip, a "Bought" tag (bought versus granted, BQ-B1), and a
 *     Receipt link only when the server sent an https link (opened in a new
 *     tab with `noopener noreferrer`).
 * Every figure is the API's; none is typed here (the credit-figure guard lists
 * this file). A failed read is a line with Try again, never an empty list.
 *
 * ── WHEN IT READS ────────────────────────────────────────────────────────────
 * When the panel opens, on Try again, and when the credits change while the
 * panel is open (the return notice raises that signal once a purchase is
 * credited). Never on a timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { formatMinorAmount } from '@/lib/business-os/currency';
import { onCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';
import type { BoostLabels } from '@/lib/business-os/boost/boostPackagesTypes';
import { BOOST_PURCHASE_OWNER_STATUSES, type BoostPurchaseView } from '@/lib/business-os/boost/boostPurchasesTypes';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BoostPurchasesList' });

const PURCHASES_URL = '/api/business-os/credits/boost/purchases';

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const BORDER = 'var(--v2-border)';
const PRIMARY = 'var(--v2-primary)';
const ALERT = '#F97316';

const isString = (value: unknown): value is string => typeof value === 'string';
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isLabels = (value: unknown): value is BoostLabels =>
  !!value && typeof value === 'object' && isString((value as BoostLabels).en) && isString((value as BoostLabels).he) && isString((value as BoostLabels).es);

function isPurchase(value: unknown): value is BoostPurchaseView {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BoostPurchaseView>;
  return (
    isString(v.id) &&
    isString(v.createdAt) &&
    !Number.isNaN(Date.parse(v.createdAt)) &&
    (v.paidAt === null || isString(v.paidAt)) &&
    isString(v.packageId) &&
    (v.name === null || isLabels(v.name)) &&
    isWhole(v.creditsTotal) &&
    isWhole(v.priceMinor) &&
    v.currency !== undefined &&
    isString(v.currency) &&
    v.currency.toUpperCase() === 'USD' &&
    (BOOST_PURCHASE_OWNER_STATUSES as readonly string[]).includes(v.status as string) &&
    (v.receiptUrl === null || isString(v.receiptUrl)) &&
    v.kind === 'bought'
  );
}

/** Only an https link is ever rendered (defence in depth: the server already filters). */
function safeReceipt(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const CHIP_COLOR: Record<BoostPurchaseView['status'], string> = {
  credited: PRIMARY,
  processing: MUTED,
  awaiting_payment: MUTED,
  failed: ALERT,
  expired: MUTED,
  refunded: MUTED,
  partially_refunded: MUTED,
  under_review: ALERT,
  reversed: ALERT,
};

export function BoostPurchasesList({ open }: { open: boolean }) {
  const { t, language, timeZoneOptions } = useLanguage();
  const [purchases, setPurchases] = useState<BoostPurchaseView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch(PURCHASES_URL, { cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      if (inFlightRef.current !== controller) return;
      const list = body?.data?.purchases;
      if (response.ok && body?.success && Array.isArray(list) && list.every(isPurchase)) {
        setPurchases(list);
        setFailed(false);
      } else {
        setFailed(true);
        logger.warn({ status: response.status }, 'Boost purchases read failed');
      }
    } catch (err) {
      if (inFlightRef.current !== controller) return;
      setFailed(true);
      logger.warn({ err }, 'Boost purchases read threw');
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    // A purchase credited while the panel is open shows here at once.
    const off = onCreditUsageChanged(() => void load());
    return () => {
      off();
      const inFlight = inFlightRef.current;
      inFlightRef.current = null;
      inFlight?.abort();
    };
  }, [open, load]);

  if (failed) {
    return (
      <section data-testid="boost-purchases-error" style={{ marginTop: 20 }}>
        <p style={{ fontSize: 12.5, color: ALERT }}>{t('usage.boost.purchases.error')}</p>
        <button
          type="button"
          data-testid="boost-purchases-retry"
          disabled={loading}
          onClick={() => void load()}
          style={{ marginTop: 6, fontSize: 12.5, color: PRIMARY, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          {t('usage.boost.retry')}
        </button>
      </section>
    );
  }
  // SA Q-3: nothing at all until there is at least one purchase.
  if (!purchases || purchases.length === 0) return null;

  const credits = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  const day = new Intl.DateTimeFormat(language, timeZoneOptions({ day: 'numeric', month: 'short', year: 'numeric' }));
  const clock = new Intl.DateTimeFormat(language, timeZoneOptions({ hour: '2-digit', minute: '2-digit' }));
  const nameOf = (purchase: BoostPurchaseView) =>
    purchase.name ? purchase.name[language as keyof BoostLabels] || purchase.name.en : purchase.packageId;

  return (
    <section data-testid="boost-purchases" aria-labelledby="boost-purchases-title" style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${BORDER}` }}>
      <h3 id="boost-purchases-title" style={{ fontSize: 14, fontWeight: 600, color: INK, margin: '0 0 8px' }}>
        {t('usage.boost.purchases.title')}
      </h3>
      <ul data-testid="boost-purchases-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {purchases.map((purchase) => {
          const at = new Date(purchase.createdAt);
          const receipt = safeReceipt(purchase.receiptUrl);
          return (
            <li
              key={purchase.id}
              data-testid="boost-purchase"
              data-status={purchase.status}
              style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>
                  <span data-testid="boost-purchase-name">{nameOf(purchase)}</span>
                  <span
                    data-testid="boost-purchase-bought"
                    style={{ marginInlineStart: 6, fontSize: 10.5, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '1px 6px' }}
                  >
                    {t('usage.boost.purchases.bought')}
                  </span>
                </span>
                <span
                  data-testid="boost-purchase-status"
                  style={{ fontSize: 11, fontWeight: 600, color: CHIP_COLOR[purchase.status], whiteSpace: 'nowrap' }}
                >
                  {t(`usage.boost.purchases.status.${purchase.status}`)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '0 10px', fontVariantNumeric: 'tabular-nums' }}>
                <span data-testid="boost-purchase-when">{`${day.format(at)}, ${clock.format(at)}`}</span>
                <span data-testid="boost-purchase-credits">{t('usage.boost.credits', { credits: credits.format(purchase.creditsTotal) })}</span>
                <span data-testid="boost-purchase-price">
                  {t('usage.boost.purchases.price', { price: formatMinorAmount(purchase.priceMinor, purchase.currency, language) })}
                </span>
                {receipt && (
                  <a data-testid="boost-purchase-receipt" href={receipt} target="_blank" rel="noopener noreferrer" style={{ color: PRIMARY }}>
                    {t('usage.boost.purchases.receipt')}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
