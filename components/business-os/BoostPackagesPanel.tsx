'use client';

/**
 * Top up credits: the boost packages an owner can buy, in a side panel opened
 * from the Credits card (credits boost slice 5a; requirement FR-1, FR-24,
 * FR-28, FR-29, FR-42; user decision B, 2026-10-07; SA C-1 to C-5).
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────────
 * One card per active package, in the catalogue's order: name, badge, the price
 * with "excl. tax", the credits, the bonus (only when there is one) and the
 * description. Every figure is the API's, formatted in the reader's language;
 * none is typed here (the credit-figure guard lists this file).
 *
 * ── NOTHING CAN BE BOUGHT YET ───────────────────────────────────────────────
 * Every Buy button is disabled and reads "Coming soon", whatever the payload's
 * `purchaseAvailable` says (SA C-3): 5a has no purchase flow, so this file
 * starts no payment and calls no purchase route. Slice 5b adds both. The server
 * stays the authority either way: the purchase route refuses while its switch
 * is off.
 *
 * ── WHEN IT READS ────────────────────────────────────────────────────────────
 * When it opens, and on "Try again". Never on a timer. A failed read or a
 * malformed answer is an error with "Try again", never an empty list.
 *
 * ── WHICH SIDE ───────────────────────────────────────────────────────────────
 * `side={isRTL ? 'left' : 'right'}` with `dir` on the content, as the credit
 * history panel and the product's other drawers do.
 *
 * ── FOCUS ON CLOSE (QA5a-D1, WCAG 2.4.3) ────────────────────────────────────
 * The panel is opened by a plain button on the card, not a `SheetTrigger`
 * (it is mounted lazily, on first open), so Radix has no trigger to return
 * focus to and would drop it on `<body>`. The card passes `returnFocusRef`;
 * on close, focus goes back to that button.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { formatMinorAmount } from '@/lib/business-os/currency';
import type { BoostLabels, BoostPackagesPayload, BoostPackageView } from '@/lib/business-os/boost/boostPackagesTypes';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BoostPackagesPanel' });

const PACKAGES_URL = '/api/business-os/credits/boost/packages';

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const BORDER = 'var(--v2-border)';
const PRIMARY = 'var(--v2-primary)';
const ALERT = '#F97316';

/**
 * Buying is not built in 5a, so Buy is disabled even if the server ever says
 * otherwise (SA C-3). Slice 5b replaces this with the payload's value.
 */
const PURCHASE_BUILT = false;

const isString = (value: unknown): value is string => typeof value === 'string';
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isLabels = (value: unknown): value is BoostLabels =>
  !!value &&
  typeof value === 'object' &&
  isString((value as BoostLabels).en) &&
  isString((value as BoostLabels).he) &&
  isString((value as BoostLabels).es);

function isPackage(value: unknown): value is BoostPackageView {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BoostPackageView>;
  return (
    isString(v.id) &&
    isWhole(v.priceMinor) &&
    v.priceMinor > 0 &&
    // USD only, never converted (FR-28): anything else is an error, not a price.
    v.currency === 'USD' &&
    v.taxExclusive === true &&
    isWhole(v.baseCredits) &&
    isWhole(v.bonusCredits) &&
    isWhole(v.totalCredits) &&
    typeof v.bonusPercent === 'number' &&
    Number.isFinite(v.bonusPercent) &&
    v.bonusPercent >= 0 &&
    !!v.labels &&
    isLabels(v.labels.name) &&
    isLabels(v.labels.description) &&
    (v.labels.badge === null || isLabels(v.labels.badge))
  );
}

/** The payload, checked before it is shown: a malformed answer is an error, never an empty list. */
function isPayload(value: unknown): value is BoostPackagesPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BoostPackagesPayload>;
  return (
    Array.isArray(v.packages) && v.packages.length > 0 && v.packages.every(isPackage) && typeof v.purchaseAvailable === 'boolean'
  );
}

export interface BoostPackagesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the panel closes: the button that opened it (QA5a-D1). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function BoostPackagesPanel({ open, onOpenChange, returnFocusRef }: BoostPackagesPanelProps) {
  const { t, language, isRTL } = useLanguage();

  const [payload, setPayload] = useState<BoostPackagesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlightRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(PACKAGES_URL, { signal: controller.signal });
      const body = await response.json();
      if (inFlightRef.current !== controller) return;
      if (response.ok && body?.success && isPayload(body.data)) {
        setPayload(body.data);
      } else {
        setPayload(null);
        setFailed(true);
        logger.warn({ status: response.status }, 'Boost packages read failed');
      }
    } catch (err) {
      if (inFlightRef.current !== controller) return;
      setPayload(null);
      setFailed(true);
      logger.warn({ err }, 'Boost packages read threw');
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
    return () => {
      const inFlight = inFlightRef.current;
      inFlightRef.current = null;
      inFlight?.abort();
    };
  }, [open, load]);

  const label = (labels: BoostLabels) => labels[language as keyof BoostLabels] || labels.en;
  const credits = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 2 });
  const canBuy = PURCHASE_BUILT && payload?.purchaseAvailable === true;
  const packages = payload ? [...payload.packages].sort((a, b) => a.order - b.order) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isRTL ? 'left' : 'right'}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="boost-packages-panel"
        data-side={isRTL ? 'left' : 'right'}
        aria-describedby={undefined}
        onCloseAutoFocus={(event: Event) => {
          const target = returnFocusRef?.current;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
        className="w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col"
      >
        <div style={{ padding: '24px 24px 16px', borderBottom: `1px solid ${BORDER}` }}>
          <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] text-start">
            {t('usage.boost.title')}
          </SheetTitle>
          <p data-testid="boost-packages-intro" style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>
            {t('usage.boost.intro')}
          </p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {failed && (
            <div data-testid="boost-packages-error" style={{ marginTop: 4 }}>
              <p style={{ fontSize: 13, color: ALERT }}>{t('usage.boost.error')}</p>
              <button
                type="button"
                data-testid="boost-packages-retry"
                disabled={loading}
                onClick={() => void load()}
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: PRIMARY,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: loading ? 'default' : 'pointer',
                }}
              >
                {t('usage.boost.retry')}
              </button>
            </div>
          )}

          {!failed && !payload && (
            <div data-testid="boost-packages-loading" role="status" aria-busy="true" aria-label={t('usage.boost.loading')}>
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  style={{ height: 132, borderRadius: 14, background: 'var(--v2-surface)', border: `1px solid ${BORDER}`, marginBottom: 12, opacity: 0.6 }}
                />
              ))}
            </div>
          )}

          {!failed && payload && (
            <>
              <ul data-testid="boost-packages-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {packages.map((pkg) => (
                  <li
                    key={pkg.id}
                    data-testid="boost-package"
                    data-package-id={pkg.id}
                    style={{
                      padding: 16,
                      borderRadius: 14,
                      border: `1px solid ${BORDER}`,
                      background: 'var(--v2-surface)',
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span data-testid="boost-package-name" style={{ fontSize: 14, fontWeight: 600, color: INK }}>
                        {label(pkg.labels.name)}
                      </span>
                      {pkg.labels.badge && (
                        <span
                          data-testid="boost-package-badge"
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: PRIMARY,
                            background: 'color-mix(in srgb, var(--v2-primary) 12%, transparent)',
                            borderRadius: 999,
                            padding: '2px 8px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label(pkg.labels.badge)}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
                      <span
                        data-testid="boost-package-price"
                        style={{ fontSize: 20, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatMinorAmount(pkg.priceMinor, pkg.currency, language)}
                      </span>
                      <span data-testid="boost-package-tax" style={{ fontSize: 12, color: MUTED }}>
                        {t('usage.boost.excl_tax')}
                      </span>
                    </div>

                    <p data-testid="boost-package-credits" style={{ fontSize: 13, color: INK, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                      {t('usage.boost.credits', { credits: credits.format(pkg.totalCredits) })}
                    </p>
                    {pkg.bonusPercent > 0 && pkg.bonusCredits > 0 && (
                      <p data-testid="boost-package-bonus" style={{ fontSize: 12, color: PRIMARY, marginTop: 2 }}>
                        {t('usage.boost.bonus', {
                          percent: percent.format(pkg.bonusPercent / 100),
                          credits: credits.format(pkg.bonusCredits),
                        })}
                      </p>
                    )}
                    <p data-testid="boost-package-description" style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                      {label(pkg.labels.description)}
                    </p>

                    <button
                      type="button"
                      data-testid="boost-package-buy"
                      disabled={!canBuy}
                      aria-disabled={!canBuy}
                      title={canBuy ? undefined : t('usage.boost.coming_soon_hint')}
                      style={{
                        marginTop: 12,
                        width: '100%',
                        height: 34,
                        borderRadius: 10,
                        border: `1px solid ${BORDER}`,
                        background: 'var(--v2-bg)',
                        color: MUTED,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: canBuy ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {t('usage.boost.coming_soon')}
                    </button>
                  </li>
                ))}
              </ul>
              <p data-testid="boost-packages-footer" style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
                {t('usage.boost.footer')}
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
