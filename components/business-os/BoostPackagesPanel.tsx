'use client';

/**
 * Top up credits: the boost packages an owner can buy, in a side panel opened
 * from the Credits card (credits boost slices 5a and 5b.1; requirement FR-1,
 * FR-6 to FR-12, FR-24, FR-28, FR-29, FR-42; user decision B, 2026-10-07).
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────────
 * One card per active package, in the catalogue's order: name, badge, the price
 * with "excl. tax", the credits, the bonus (only when there is one) and the
 * description. Every figure is the API's, formatted in the reader's language;
 * none is typed here (the credit-figure guard lists this file).
 *
 * ── BUYING (5b.1) ────────────────────────────────────────────────────────────
 * Buy is enabled only when the server says `purchaseAvailable: true` (the
 * checkout switch and allow-list for this account, and matching Stripe keys,
 * decided by the packages route; SA C-2). Otherwise every Buy is disabled and
 * reads "Coming soon". The server stays the authority: the checkout route
 * re-checks the switch and the list, and answers 404 while the switch is off.
 *
 * A click sends `{ packageId }` and nothing else (FR-8), ONCE: a ref guard is
 * held from the click until the payment form mounts or the request fails, and
 * re-armed on Back (SA C-4). On success, Stripe's embedded checkout opens in
 * this sheet. On completion Stripe sends the whole page to the return URL,
 * where the dashboard's return notice reads what happened; nothing here
 * credits anything (FR-13). Every refusal has its own friendly line; a raw
 * code is never shown. Closing the sheet or Back leaves the reservation to
 * expire with its Stripe session (SA Q-6).
 *
 * ── WHEN IT READS ────────────────────────────────────────────────────────────
 * When it opens, on "Try again", and after a 404 from the checkout route (the
 * switch may have changed). Never on a timer.
 *
 * ── WHICH SIDE, FOCUS ────────────────────────────────────────────────────────
 * `side={isRTL ? 'left' : 'right'}` with `dir` on the content. Focus returns to
 * the button that opened the panel (`returnFocusRef`, QA5a-D1). The intro line
 * is the sheet's description (5a SA N-2).
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { formatMinorAmount } from '@/lib/business-os/currency';
import type { BoostLabels, BoostPackagesPayload, BoostPackageView } from '@/lib/business-os/boost/boostPackagesTypes';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BoostPackagesPanel' });

const PACKAGES_URL = '/api/business-os/credits/boost/packages';
/** The one place this file names the checkout route (pinned by a source guard). */
const CHECKOUT_URL = '/api/business-os/credits/boost/checkout';

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const BORDER = 'var(--v2-border)';
const PRIMARY = 'var(--v2-primary)';
const ALERT = '#F97316';

/** Stripe.js, loaded once per page and only when a payment form is about to open (SA Q-7: local). */
let stripePromise: Promise<Stripe | null> | null = null;
function browserStripe(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  // Defence in depth (SA C-2): the server already hides Buy without a usable key.
  if (!key || !/^pk_(test|live)_/.test(key)) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}

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

/** A refusal as the owner reads it: a dictionary key and its placeholders. */
interface CheckoutProblem {
  key: string;
  vars?: Record<string, string>;
}

/** Slice 3's refusal codes → the owner's line (workplan §3.2). Never the raw code. */
function problemFor(status: number, body: unknown, language: string): CheckoutProblem {
  const answer = (body ?? {}) as { error?: unknown; capMinor?: unknown; windowDays?: unknown };
  const code = typeof answer.error === 'string' ? answer.error : null;
  if (status === 401) return { key: 'usage.boost.error.signed_out' };
  if (code === 'cap_reached') {
    // SA C-5: the cap (an override included) and its window come from the server.
    if (isWhole(answer.capMinor) && isWhole(answer.windowDays) && answer.windowDays > 0) {
      return {
        key: 'usage.boost.error.cap',
        vars: {
          amount: formatMinorAmount(answer.capMinor, 'USD', language),
          days: new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(answer.windowDays),
        },
      };
    }
    return { key: 'usage.boost.error.cap_plain' };
  }
  if (code === 'awaiting_payment') return { key: 'usage.boost.error.awaiting_payment' };
  if (code === 'not_eligible') return { key: 'usage.boost.error.not_eligible' };
  if (status === 404) return { key: 'usage.boost.error.unavailable' };
  return { key: 'usage.boost.error.generic' };
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

  // Buying (5b.1).
  const [startingId, setStartingId] = useState<string | null>(null);
  const [problem, setProblem] = useState<CheckoutProblem | null>(null);
  const [checkout, setCheckout] = useState<{ pkg: BoostPackageView; clientSecret: string } | null>(null);
  /** SA C-4: held from the click until the form mounts or the request fails; re-armed on Back. */
  const checkoutGuardRef = useRef(false);

  const load = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(PACKAGES_URL, { cache: 'no-store', signal: controller.signal });
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
    // Every opening starts from the package list.
    setCheckout(null);
    setProblem(null);
    checkoutGuardRef.current = false;
    void load();
    return () => {
      const inFlight = inFlightRef.current;
      inFlightRef.current = null;
      inFlight?.abort();
    };
  }, [open, load]);

  const canBuy = payload?.purchaseAvailable === true;

  async function startCheckout(pkg: BoostPackageView): Promise<void> {
    // The server's answer, not a client choice, decides whether a checkout may start.
    if (payload?.purchaseAvailable !== true) return;
    if (checkoutGuardRef.current) return;
    checkoutGuardRef.current = true;
    setStartingId(pkg.id);
    setProblem(null);
    try {
      const response = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const data = (body as { success?: unknown; data?: { clientSecret?: unknown } } | null) ?? null;
      if (response.ok && data?.success === true && typeof data.data?.clientSecret === 'string' && data.data.clientSecret !== '') {
        // The guard stays held while the form is open (SA C-4).
        setCheckout({ pkg, clientSecret: data.data.clientSecret });
        return;
      }
      checkoutGuardRef.current = false;
      const code = (body as { error?: unknown } | null)?.error;
      logger.warn({ status: response.status, code: typeof code === 'string' ? code : null }, 'Boost checkout refused');
      setProblem(problemFor(response.status, body, language));
      // The switch may have changed since the panel loaded: show what is true now.
      if (response.status === 404) void load();
    } catch (err) {
      checkoutGuardRef.current = false;
      logger.warn({ err }, 'Boost checkout request threw');
      setProblem({ key: 'usage.boost.error.generic' });
    } finally {
      setStartingId(null);
    }
  }

  function backToPackages(): void {
    setCheckout(null);
    checkoutGuardRef.current = false;
  }

  const label = (labels: BoostLabels) => labels[language as keyof BoostLabels] || labels.en;
  const credits = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 2 });
  const packages = payload ? [...payload.packages].sort((a, b) => a.order - b.order) : [];
  const stripe = checkout ? browserStripe() : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isRTL ? 'left' : 'right'}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="boost-packages-panel"
        data-side={isRTL ? 'left' : 'right'}
        onCloseAutoFocus={(event: Event) => {
          const target = returnFocusRef?.current;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
        className={`w-full ${checkout ? 'sm:max-w-2xl' : 'sm:max-w-xl'} p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col`}
      >
        <div style={{ padding: '24px 24px 16px', borderBottom: `1px solid ${BORDER}` }}>
          <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] text-start">
            {t('usage.boost.title')}
          </SheetTitle>
          <SheetDescription data-testid="boost-packages-intro" style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>
            {t('usage.boost.intro')}
          </SheetDescription>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {problem && (
            <p data-testid="boost-checkout-error" role="alert" style={{ fontSize: 13, color: ALERT, marginBottom: 12 }}>
              {t(problem.key, problem.vars)}
            </p>
          )}

          {checkout && (
            <div data-testid="boost-checkout-view">
              <button
                type="button"
                data-testid="boost-checkout-back"
                onClick={backToPackages}
                style={{ fontSize: 13, color: PRIMARY, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {isRTL ? '→' : '←'} {t('usage.boost.back')}
              </button>
              <p data-testid="boost-checkout-summary" style={{ fontSize: 13, color: INK, margin: '10px 0 14px' }}>
                {t('usage.boost.checkout_summary', {
                  name: label(checkout.pkg.labels.name),
                  credits: credits.format(checkout.pkg.totalCredits),
                  price: formatMinorAmount(checkout.pkg.priceMinor, checkout.pkg.currency, language),
                })}
              </p>
              {stripe === null ? (
                <p data-testid="boost-checkout-no-key" role="alert" style={{ fontSize: 13, color: ALERT }}>
                  {t('usage.boost.error.payments_unavailable')}
                </p>
              ) : (
                <div data-testid="boost-checkout-form">
                  <EmbeddedCheckoutProvider stripe={stripe} options={{ clientSecret: checkout.clientSecret }}>
                    <EmbeddedCheckout />
                  </EmbeddedCheckoutProvider>
                </div>
              )}
            </div>
          )}

          {!checkout && failed && (
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

          {!checkout && !failed && !payload && (
            <div data-testid="boost-packages-loading" role="status" aria-busy="true" aria-label={t('usage.boost.loading')}>
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  style={{ height: 132, borderRadius: 14, background: 'var(--v2-surface)', border: `1px solid ${BORDER}`, marginBottom: 12, opacity: 0.6 }}
                />
              ))}
            </div>
          )}

          {!checkout && !failed && payload && (
            <>
              <ul data-testid="boost-packages-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {packages.map((pkg) => {
                  const starting = startingId === pkg.id;
                  const disabled = !canBuy || startingId !== null;
                  return (
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
                        disabled={disabled}
                        aria-disabled={disabled}
                        aria-busy={starting}
                        onClick={() => void startCheckout(pkg)}
                        style={{
                          marginTop: 12,
                          width: '100%',
                          height: 34,
                          borderRadius: 10,
                          border: canBuy ? 'none' : `1px solid ${BORDER}`,
                          background: canBuy ? PRIMARY : 'var(--v2-bg)',
                          color: canBuy ? '#fff' : MUTED,
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: canBuy && startingId !== null && !starting ? 0.6 : 1,
                        }}
                      >
                        {!canBuy ? t('usage.boost.coming_soon') : starting ? t('usage.boost.buying') : t('usage.boost.buy')}
                      </button>
                    </li>
                  );
                })}
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
