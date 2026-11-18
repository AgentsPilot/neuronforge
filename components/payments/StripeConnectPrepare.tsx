'use client';

/**
 * The two screens before Stripe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE EXIST AT ALL
 *
 * Pressing "Connect Stripe" used to create an American Express account on the
 * spot and drop the owner into Stripe's form with nothing filled in. Two
 * separate problems hid inside that one press:
 *
 *   1. `accounts.country` is fixed forever at creation. Getting it wrong means
 *      a new account, not a correction — and it was hardcoded to `'US'`, so an
 *      Israeli business was asked for a Social Security Number and could never
 *      be paid in shekels.
 *   2. Everything Stripe asks for about the BUSINESS — name, website, phone,
 *      address, industry, description — was already in `business_profiles`.
 *
 * So: one screen for the answer that cannot be undone, one screen to confirm
 * what we already know, and then Stripe's own frame for the identity and bank
 * details that are genuinely theirs to collect.
 *
 * ── IT CREATES NOTHING UNTIL THE LAST PRESS ─────────────────────────────────
 * No Stripe account exists while these screens are open. An owner who closes
 * the dialog here leaves nothing behind, which is the opposite of the old
 * behaviour, where backing out of the form left a half-made American account
 * that nothing in the UI explained.
 *
 * @module components/payments/StripeConnectPrepare
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CreditCard, Loader2 } from 'lucide-react';

import { SearchableDropdown, type DropdownOption } from '@/components/ui/SearchableDropdown';
import { CONFIG_ACCENT, configAccentButton } from '@/components/business-os/configAccent';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';
import { settlementCurrencyFor } from '@/lib/payments/countryCurrency';
import { SUPPORTED_COUNTRIES, countryNameIn, findCountry } from '@/lib/payments/stripeCountries';

const logger = createLogger({ module: 'StripeConnectPrepare' });

/** The facts the prefill endpoint hands back, ready to display. */
interface KnownFact {
  key: string;
  value: string;
}

type BusinessType = 'individual' | 'company';

interface PrefillData {
  suggestedCountry: string | null;
  countrySource: 'address' | 'invoice_address' | 'language' | null;
  currency: string | null;
  known: KnownFact[];
  knownCount: number;
  suggestedBusinessType: BusinessType | null;
  bankPrefillable: boolean;
  /** What must be completed before an account can be opened. */
  blockers: string[];
  /** Worth filling in, but never a refusal. */
  nudges: string[];
  canConnect: boolean;
}

interface StripeConnectPrepareProps {
  /** The account now exists; show Stripe's embedded form. */
  onCreated: () => void;
  /** Backed out before anything was created. */
  onCancel: () => void;
  /** Take them to the business details, where the blockers are fixed. */
  onFixProfile?: () => void;
}

type Phase = 'country' | 'confirm';

export function StripeConnectPrepare({ onCreated, onCancel, onFixProfile }: StripeConnectPrepareProps) {
  const { t, isRTL, language } = useLanguage();

  const [phase, setPhase] = useState<Phase>('country');
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState('');
  /*
   * Sole trader or company. Empty until answered, like the country, and for the
   * same reason: it was hardcoded to 'individual', and a company owner then
   * retyped the address and tax id we already held, because Stripe reads a
   * different object for each.
   */
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── what we already know ───────────────────────────────────────────────── */
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch('/api/payments/stripe-connect/prefill', {
          signal: controller.signal,
        });
        const body = await response.json();

        if (body?.success && body.data) {
          const data = body.data as PrefillData;
          setPrefill(data);
          /*
           * Preselected, never auto-submitted. A suggestion the owner has not
           * looked at is the same mistake as a default, just slower.
           */
          if (data.suggestedCountry) setCountry(data.suggestedCountry);
          if (data.suggestedBusinessType) setBusinessType(data.suggestedBusinessType);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        /* The screen still works with nothing prefilled: the owner picks a
           country and Stripe asks for the rest, exactly as it did before. */
        logger.warn({ err }, 'Could not read business details for prefill');
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const currency = settlementCurrencyFor(country);
  const chosen = findCountry(country);

  /*
   * Blocked only when we have actually READ the profile and it falls short. A
   * prefill request that failed is not evidence of an incomplete profile, so
   * the owner is allowed to continue: the server holds the same gate and will
   * refuse with the reasons if it really is incomplete.
   */
  const blocked = Boolean(prefill && !prefill.canConnect);

  /* ── the only call that creates anything ────────────────────────────────── */
  const createAccount = useCallback(async () => {
    if (!country || !businessType || creating) return;

    setCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/payments/stripe-connect/create-minimal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, business_type: businessType }),
      });
      const result = await response.json();

      if (result?.success) {
        logger.info(
          { country, businessType, prefillApplied: result.prefillApplied, bankApplied: result.bankApplied },
          'Stripe account created'
        );
        onCreated();
        return;
      }

      /*
       * The server holds the same gate (409 with the blockers named). If it
       * refused on that basis, show the gate rather than an error message:
       * the owner needs the list and the way to fix it, not a sentence saying
       * something was wrong.
       */
      if (response.status === 409 && Array.isArray(result?.blockers) && result.blockers.length > 0) {
        setPrefill(current =>
          current
            ? { ...current, blockers: result.blockers, canConnect: false }
            : {
                suggestedCountry: null,
                countrySource: null,
                currency: null,
                known: [],
                knownCount: 0,
                suggestedBusinessType: null,
                bankPrefillable: false,
                blockers: result.blockers,
                nudges: [],
                canConnect: false,
              }
        );
        return;
      }

      setError(result?.error || t('config.stripe.create_failed') || 'Could not create the account. Please try again.');
    } catch (err) {
      logger.error({ err, country }, 'Failed to create Stripe account');
      setError(t('config.stripe.create_failed') || 'Could not create the account. Please try again.');
    } finally {
      setCreating(false);
    }
  }, [country, businessType, creating, onCreated, t]);

  /*
   * Re-read the facts once both answers are in, so the confirm screen lists
   * EXACTLY what is about to be sent. Which block Stripe reads depends on the
   * business type, and whether the bank details can be used depends on the
   * country, so the same profile produces different answers.
   */
  const openConfirm = useCallback(async () => {
    setPhase('confirm');
    try {
      const query = new URLSearchParams({ country, business_type: businessType });
      const response = await fetch(`/api/payments/stripe-connect/prefill?${query.toString()}`);
      const body = await response.json();
      if (body?.success && body.data) setPrefill(body.data as PrefillData);
    } catch (err) {
      /* Keep the list from the first read: it is the same profile, and the
         only difference is which fields will actually be used. */
      logger.warn({ err }, 'Could not refresh the prefill for the chosen answers');
    }
  }, [country, businessType]);

  const Forward = isRTL ? ArrowLeft : ArrowRight;

  /**
   * The countries Stripe will actually open an account in, as dropdown options.
   *
   * Named in the owner's language, flagged, and searchable by ISO code as well
   * as by name — somebody who types "IL" should not have to know whether we
   * call it Israel or ישראל.
   */
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE PLATFORM ALREADY PRICES IN, so the two can be compared HERE.
   *
   * The country decides the Stripe account's settlement currency and cannot be
   * changed afterwards. `business_profiles.currency` decides what every service,
   * proposal and invoice is denominated in, and `business_currency_lock`
   * refuses to change THAT once an invoice exists. Two one-way doors, asked on
   * two different screens, and nothing compared them.
   *
   * This screen is the last moment both are still free, so it is where the
   * comparison belongs. Read from the same endpoint step 0 writes.
   */
  const [platformCurrency, setPlatformCurrency] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/business-os/preferences');
        if (!response.ok) return;
        const body = await response.json();
        const stored = body?.data?.currency?.businessCurrency;
        if (!cancelled && typeof stored === 'string' && stored) setPlatformCurrency(stored);
      } catch {
        /* Silent: this only adds a warning. Failing to read it must never stop
           somebody opening a Stripe account. */
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /** Priced in one currency, paid out in another. */
  const currencyClash = Boolean(
    platformCurrency && currency && platformCurrency.toUpperCase() !== currency.toUpperCase()
  );

  const [aligning, setAligning] = useState(false);
  const [alignError, setAlignError] = useState<string | null>(null);

  /**
   * Price in the payout currency instead — the fix, offered where the problem
   * is named.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A warning with no action is a warning an owner reads, agrees with, and then
   * cannot act on without leaving the flow, finding the right settings screen
   * and coming back. Both values are still free at this moment, so the fix is
   * one press: move the PLATFORM currency to match the country they just chose.
   *
   * Only this direction. Changing the country instead is already possible — the
   * picker is directly above — so the button offers the half they cannot reach
   * from here.
   *
   * `business_currency_lock` may refuse, and that answer is the useful one: it
   * means invoices already exist in the old currency, so the country is now the
   * only thing that can move. Reported in those words rather than as a failure.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const alignCurrency = async () => {
    if (!currency) return;
    setAligning(true);
    setAlignError(null);

    try {
      /* PATCH, and one key: `preferencesSchema` is a union of STRICT
         single-key objects, so anything else is refused before a write. */
      const response = await fetch('/api/business-os/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || body?.success === false) {
        const locked = body?.error === 'CURRENCY_LOCKED' || response.status === 409;
        setAlignError(
          locked
            ? t('config.stripe.prepare.currency_locked') ||
              'Your prices cannot be moved now: invoices already exist in the old currency. Choose a country that pays out in it instead.'
            : t('config.stripe.prepare.currency_failed') || 'That did not save. Please try again.'
        );
        setAligning(false);
        return;
      }

      setPlatformCurrency(currency);
      setAligning(false);
    } catch (error) {
      logger.error({ err: error }, 'Could not align the business currency');
      setAlignError(t('config.stripe.prepare.currency_failed') || 'That did not save. Please try again.');
      setAligning(false);
    }
  };

  const countryChoices: DropdownOption[] = useMemo(
    () =>
      SUPPORTED_COUNTRIES.map(option => ({
        value: option.code,
        label: countryNameIn(option, language),
        hint: option.code,
        icon: option.flag,
        keywords: option.code,
      })),
    [language]
  );
  const Backward = isRTL ? ArrowRight : ArrowLeft;

  return (
    <div
      /* Roomier than the 24px it had: this is a full screen inside the dialog
         rather than a panel in a stack of them, and it carries the one
         irreversible decision in the whole of setup. Crowded edges make a
         consequential screen read as a form to get through. */
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-7 sm:p-8"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* which of the two screens, and how many are left */}
      <div className="flex items-center justify-between mb-7 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {/*
            ─────────────────────────────────────────────────────────────────
            THE DIALOG'S ACCENT, NOT THE PLATFORM PRIMARY.

            `--v2-primary` is the BUSINESS's own brand colour at runtime — the
            theme provider writes `customTokens.colors.primary` over it — so a
            filled primary button here wears whatever colour that account chose
            for its website. On a business with an orange brand this screen
            came up orange inside a dialog painted pink, which reads as a
            different product bolted into the middle of setup.

            `configAccent` exists for exactly this and says so: availability,
            services and payments all use it, so a filled button in one tab
            looks foreign.
            ─────────────────────────────────────────────────────────────────
          */}
          <CreditCard className="h-5 w-5 flex-shrink-0" style={{ color: CONFIG_ACCENT }} />
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] truncate">
            {t('config.stripe.prepare.title') || 'Set up payments'}
          </h3>
        </div>
        <span className="text-xs font-medium text-[var(--v2-text-muted)] flex-shrink-0">
          {phase === 'country'
            ? t('config.stripe.prepare.step_one') || 'Step 1 of 2'
            : t('config.stripe.prepare.step_two') || 'Step 2 of 2'}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--v2-text-muted)]" />
          <span className="text-sm text-[var(--v2-text-muted)]">
            {t('config.stripe.prepare.loading') || 'Reading your business details...'}
          </span>
        </div>
      ) : blocked ? (
        /*
         * ══════════════ THE GATE ══════════════
         *
         * Not a warning beside a button that still works. Stripe fixes the
         * country at creation from an address we do not have, and bills under a
         * business name we cannot give it, so there is nothing useful on the
         * other side of this screen until these are filled in.
         *
         * It names each missing thing rather than saying "profile incomplete",
         * and offers the one button that leads somewhere.
         */
        <div className="space-y-6">
          <div>
            <h4 className="text-base font-semibold text-[var(--v2-text-primary)]">
              {t('config.stripe.gate.heading') || 'Finish your business details first'}
            </h4>
            <p className="text-sm text-[var(--v2-text-muted)] mt-1 max-w-[90ch] [text-wrap:pretty]">
              {t('config.stripe.gate.why') ||
                'Stripe needs these to open your account, and some of them cannot be changed afterwards. Fill them in once and we send them for you.'}
            </p>
          </div>

          <ul className="space-y-2">
            {prefill!.blockers.map(blocker => (
              <li key={blocker} className="flex items-start gap-2.5 text-sm">
                <AlertTriangle
                  className="h-4 w-4 flex-shrink-0 mt-0.5"
                  style={{ color: 'var(--v2-warning)' }}
                />
                <span>
                  <span className="font-medium text-[var(--v2-text-primary)]">
                    {t(`config.stripe.gate.missing.${blocker}`) || blocker}
                  </span>
                  <span className="block text-xs text-[var(--v2-text-muted)]">
                    {t(`config.stripe.gate.needed.${blocker}`) || ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3 flex-wrap">
            {onFixProfile && (
              <button
                onClick={onFixProfile}
                className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium border transition-all hover:brightness-110 active:scale-[0.98] ${isRTL ? 'flex-row-reverse' : ''}`}
                style={configAccentButton}
              >
                {t('config.stripe.gate.fix') || 'Open business details'}
                <Forward className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onCancel}
              className="text-sm text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
          </div>
        </div>
      ) : phase === 'country' ? (
        /* ══════════════ 1. the answer that cannot be changed ══════════════ */
        /*
         * ═══════════════════════════════════════════════════════════════════
         * TWO QUESTIONS, EACH A BLOCK, EACH CARRYING ITS OWN SMALL PRINT.
         *
         * This was one flat stack at a single rhythm: heading, field, warning,
         * payout line, suggestion, second question, buttons — seven things
         * evenly spaced, so nothing said which sentence belonged to which
         * control. "Suggested from your business address" is help for the
         * COUNTRY FIELD and sat two items below it, on the far side of a loud
         * amber box, where it read as a note about the screen.
         *
         * The shape now matches the content:
         *
         *   question  heading + why, then the control
         *   help      directly under its own control, small and quiet
         *   effect    what the answer locks in, grouped in one box
         *   ──────    a rule, because the next question is unrelated
         *   actions   below a second rule, so they belong to the screen
         *             rather than to the question they happen to follow
         * ═══════════════════════════════════════════════════════════════════
         */
        <div className="space-y-7">
          <section>
            <h4 className="text-base font-semibold text-[var(--v2-text-primary)]">
              {t('config.stripe.prepare.country_heading') || 'Where is your business based?'}
            </h4>
            <p className="text-sm text-[var(--v2-text-muted)] mt-1 max-w-[90ch] [text-wrap:pretty]">
              {t('config.stripe.prepare.country_why') ||
                'Stripe fixes this when the account is created and it cannot be changed afterwards, so we ask before anything is sent.'}
            </p>

            {/*
              ───────────────────────────────────────────────────────────────
              THE PLATFORM'S PICKER, NOT A NATIVE SELECT.

              A bare `<select>` is drawn by the operating system: on a dark
              theme its panel comes up in the OS's own colours whatever the
              page says, the options cannot carry a flag beside a name, and
              there is no search — so choosing from forty-odd Stripe countries
              meant scrolling a list painted in a different product's palette.

              `SearchableDropdown` is what every other country and region field
              in the platform already uses (`CountrySelect`, `AdminAreaField`).

              The options are `SUPPORTED_COUNTRIES`, NOT the shared
              `CountrySelect` — Stripe accepts a subset, and offering a country
              it will refuse is a dead end at account creation. `keywords`
              keeps the code searchable: somebody who types "IL" or "GB" gets
              their country without knowing how we spell its name.
              ───────────────────────────────────────────────────────────────
            */}
            <label className="block mt-4">
              <span className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1.5">
                {t('config.stripe.prepare.country_label') || 'Country of your business'}
              </span>
              <SearchableDropdown
                value={country}
                onChange={setCountry}
                options={countryChoices}
                isRTL={isRTL}
                placeholder={t('config.stripe.prepare.country_placeholder') || 'Choose a country'}
                emptyLabel={t('settings.business.address_country_none') || 'No countries found'}
              />

              {/* Help for THIS field, under it, where field help goes. */}
              {prefill?.suggestedCountry && prefill.suggestedCountry === country && (
                <span className="block text-xs text-[var(--v2-text-muted)] mt-1.5">
                  {prefill.countrySource === 'language'
                    ? t('config.stripe.prepare.from_language') || 'Suggested from your language setting. Change it if that is wrong.'
                    : t('config.stripe.prepare.from_address') || 'Suggested from your business address. Change it if that is wrong.'}
                </span>
              )}
            </label>

            {/*
              WHAT THIS ANSWER LOCKS IN, in one box rather than scattered.

              The irreversibility and the payout currency are the same fact
              said twice — the country decides both and neither can be changed
              afterwards — so they are one block under the field they belong
              to. Apart, the currency read as a neutral aside halfway down the
              screen and the warning read as an error about nothing.
            */}
            <div
              className="flex items-start gap-3 px-4 py-3.5 border text-sm leading-relaxed mt-4"
              style={{
                borderRadius: 'var(--v2-radius-card)',
                backgroundColor: 'var(--v2-status-warning-bg)',
                borderColor: 'var(--v2-status-warning-border)',
                color: 'var(--v2-status-warning-text)',
              }}
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-[3px]" />
              {/* The box is as wide as the card, so neither sentence has any
                  reason to break early. `text-wrap: pretty` keeps a lone word
                  off a line of its own if one ever does wrap. */}
              <span className="min-w-0 [text-wrap:pretty]">
                {t('config.stripe.prepare.immutable_warning') ||
                  'This one cannot be undone. If the country is wrong, the only fix is a new Stripe account.'}
                {currency && (
                  <span className="block mt-1 opacity-90 [text-wrap:pretty]">
                    {(t('config.stripe.prepare.payout_currency') || 'You will be paid out in {currency}.').replace(
                      '{currency}',
                      currency
                    )}
                  </span>
                )}
              </span>
            </div>

          {/*
            ─────────────────────────────────────────────────────────────────
            PRICED IN ONE CURRENCY, PAID OUT IN ANOTHER.

            A separate, louder block because it is a different kind of fact
            from the one above: that one says what this answer fixes, this one
            says the answer disagrees with a decision already made.

            What happens if it is ignored: every charge is PRESENTED in the
            platform's currency — `create-checkout` and the payment link both
            send the service's or the invoice's — on an account that settles in
            another. Stripe converts each payment and takes a conversion fee
            nobody chose, the Money tab and the bank stop agreeing, and some
            country/currency pairs are refused outright at the moment a client
            presses pay.

            Why HERE and nowhere else: both halves are one-way. The account's
            country is fixed at creation, and `business_currency_lock` refuses
            to change the platform's currency once an invoice exists. This
            screen is the last moment either is still free.

            It does not block. A business that genuinely prices in dollars and
            banks in shekels exists, and refusing them would be us overruling a
            decision that is theirs. It states the cost and leaves the choice.
            ─────────────────────────────────────────────────────────────────
          */}
          {currencyClash && (
            <div
              className="flex items-start gap-3 px-4 py-3.5 border text-sm leading-relaxed mt-3"
              style={{
                borderRadius: 'var(--v2-radius-card)',
                backgroundColor: 'var(--v2-status-error-bg, rgba(180, 35, 24, 0.08))',
                borderColor: 'var(--v2-status-error-border, rgba(180, 35, 24, 0.35))',
                color: 'var(--v2-status-error-text, #B42318)',
              }}
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-[3px]" />
              <span className="min-w-0 [text-wrap:pretty]">
                {(
                  t('config.stripe.prepare.currency_clash') ||
                  'You price everything in {platform}, and an account in this country is paid out in {payout}. Clients would still be charged in {platform}, but Stripe converts every payment before it reaches you and takes a conversion fee. Neither of these can be changed afterwards.'
                )
                  .replaceAll('{platform}', platformCurrency ?? '')
                  .replaceAll('{payout}', currency ?? '')}

                <span className="flex items-center gap-3 flex-wrap mt-2.5">
                  <button
                    type="button"
                    onClick={alignCurrency}
                    disabled={aligning}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-[12.5px] font-semibold border transition-all disabled:opacity-50"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      color: 'inherit',
                      borderColor: 'currentColor',
                      background: 'transparent',
                    }}
                  >
                    {aligning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {(t('config.stripe.prepare.use_payout_currency') || 'Price in {payout} instead').replace(
                      '{payout}',
                      currency ?? ''
                    )}
                  </button>

                  {/* The other half of the fix is the picker directly above, so
                      it is named rather than duplicated as a second button. */}
                  <span className="text-[12px] opacity-80">
                    {t('config.stripe.prepare.or_change_country') || 'or choose a different country above'}
                  </span>
                </span>

                {alignError && (
                  <span className="block mt-2 text-[12px] font-medium">{alignError}</span>
                )}
              </span>
            </div>
          )}

          </section>

          {/* An unrelated question starts here, and the rule says so. */}
          <div aria-hidden className="border-t border-[var(--v2-border)]" />

          {/*
            * SOLE TRADER OR COMPANY.
            *
            * Asked, not inferred, because Stripe reads a different object for
            * each: a sole trader gives a date of birth, a company gives a
            * registered address and a tax id. This was hardcoded to individual,
            * so a company owner retyped the address and the EIN we already had.
            */}
          <fieldset className="border-0 p-0 m-0">
            <legend className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1.5">
              {t('config.stripe.prepare.type_label') || 'How is your business registered?'}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['individual', 'company'] as const).map(option => {
                const active = businessType === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setBusinessType(option)}
                    aria-pressed={active}
                    className="text-start p-3 border transition-all"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      borderColor: active ? CONFIG_ACCENT : 'var(--v2-border)',
                      backgroundColor: active
                        ? `${CONFIG_ACCENT}14`
                        : 'var(--v2-bg)',
                    }}
                  >
                    <span className="block text-sm font-medium text-[var(--v2-text-primary)]">
                      {option === 'individual'
                        ? t('config.stripe.prepare.type_individual') || 'Sole trader'
                        : t('config.stripe.prepare.type_company') || 'Company'}
                    </span>
                    <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">
                      {option === 'individual'
                        ? t('config.stripe.prepare.type_individual_hint') || 'Self-employed, trading under your own name'
                        : t('config.stripe.prepare.type_company_hint') || 'Registered, with a company or tax number'}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/*
            THE THREE BELONG TOGETHER: press, back out, and the note saying
            that backing out costs nothing. They keep one tight gap; the air
            that was missing is above the row, and the stack's own rhythm plus
            the rule now provide it.
          */}
          {/*
            NO RULE HERE, and the one that was is gone.

            It was meant to say "the actions belong to the screen, not to the
            question above them" — but a hairline directly under two cards
            reads as part of those cards: an underline on the choice, or the
            top edge of something that never arrives. The question is already
            closed by the rule ABOVE it, and the row only needs air, which the
            stack's own rhythm gives it.
          */}
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: '44px' }}>
            <button
              onClick={openConfirm}
              disabled={!country || !businessType}
              className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium border transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 ${isRTL ? 'flex-row-reverse' : ''}`}
              style={configAccentButton}
            >
              {t('common.continue') || 'Continue'}
              <Forward className="h-4 w-4" />
            </button>
            <button
              onClick={onCancel}
              className="px-1 py-2.5 text-sm text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            {/*
              THE REASSURANCE, ON THE BUTTON ROW AND LEGIBLE ON IT.

              It is the answer to the fear the warning above just created —
              "nothing has gone to Stripe yet, you can still back out" — and it
              was muted 12px text trailing the controls, the treatment given to
              things nobody needs to read. It stays on this row, beside Cancel
              where the backing-out happens, but in the secondary text colour
              with a tick in front, so it scans as reassurance rather than as
              fine print.
            */}
            <span
              className="flex items-center gap-1.5 text-[12.5px] text-[var(--v2-text-secondary)]"
            >
              <Check className="h-3.5 w-3.5 flex-shrink-0" style={{ color: CONFIG_ACCENT }} />
              {t('config.stripe.prepare.nothing_sent') || 'Nothing has been sent to Stripe yet'}
            </span>
          </div>
        </div>
      ) : (
        /* ══════════════ 2. what Stripe will not have to ask ══════════════ */
        <div className="space-y-6">
          <div>
            <h4 className="text-base font-semibold text-[var(--v2-text-primary)]">
              {t('config.stripe.prepare.confirm_heading') || 'Check what we already know'}
            </h4>
            <p className="text-sm text-[var(--v2-text-muted)] mt-1 max-w-[90ch] [text-wrap:pretty]">
              {t('config.stripe.prepare.confirm_why') ||
                'You entered these when you set up your business. We send them to Stripe so you are not asked again.'}
            </p>
          </div>

          {prefill && prefill.known.length > 0 ? (
            <div
              className="border border-[var(--v2-border)] overflow-hidden"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              {/* the country first: it is the one thing the owner just decided */}
              <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-[var(--v2-border)] bg-[var(--v2-bg)]">
                <span className="text-xs text-[var(--v2-text-secondary)] w-28 flex-shrink-0">
                  {t('config.stripe.prepare.country_label') || 'Country of your business'}
                </span>
                <span className="text-sm font-medium text-[var(--v2-text-primary)] min-w-0 break-words">
                  {chosen ? `${chosen.flag} ${countryNameIn(chosen, language)}` : country}
                  {currency ? ` · ${currency}` : ''}
                </span>
              </div>

              <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-[var(--v2-border)] bg-[var(--v2-bg)]">
                <span className="text-xs text-[var(--v2-text-secondary)] w-28 flex-shrink-0">
                  {t('config.stripe.prepare.type_label') || 'How is your business registered?'}
                </span>
                <span className="text-sm font-medium text-[var(--v2-text-primary)] min-w-0 break-words">
                  {businessType === 'company'
                    ? t('config.stripe.prepare.type_company') || 'Company'
                    : t('config.stripe.prepare.type_individual') || 'Sole trader'}
                </span>
              </div>

              {prefill.known.map(fact => (
                <div
                  key={fact.key}
                  className="flex items-center gap-3 px-3.5 py-2.5 border-b border-[var(--v2-border)] last:border-b-0"
                >
                  <span className="text-xs text-[var(--v2-text-secondary)] w-28 flex-shrink-0">
                    {t(`config.stripe.known.${fact.key}`) || fact.key}
                  </span>
                  <span className="text-sm font-medium text-[var(--v2-text-primary)] min-w-0 break-words">
                    {fact.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* Nothing to confirm is a fine outcome, not an error: Stripe simply
               asks for everything, which is what it did before any of this. */
            <p className="text-sm text-[var(--v2-text-muted)]">
              {t('config.stripe.prepare.nothing_known') ||
                'We have nothing on file to send yet, so Stripe will ask for your business details directly.'}
            </p>
          )}

          <div
            className="flex gap-2.5 p-3.5 border text-sm"
            style={{
              borderRadius: 'var(--v2-radius-card)',
              backgroundColor: 'var(--v2-bg)',
              borderColor: 'var(--v2-border)',
              color: 'var(--v2-text-secondary)',
            }}
          >
            <Check className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              {prefill?.bankPrefillable
                ? t('config.stripe.prepare.next_is_stripe_no_bank') ||
                  'Next, Stripe asks for your ID. Your bank details go with the rest, so they will not be asked for again.'
                : t('config.stripe.prepare.next_is_stripe') ||
                  'Next, Stripe asks for your ID and bank account. That part is their secure form, running inside this page.'}
            </span>
          </div>

          {error && (
            <p className="text-sm font-medium" style={{ color: 'var(--v2-error-icon)' }}>
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={createAccount}
              disabled={creating}
              className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium border transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 ${isRTL ? 'flex-row-reverse' : ''}`}
              style={configAccentButton}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {creating
                ? t('config.stripe.prepare.creating') || 'Setting up...'
                : t('config.stripe.prepare.looks_right') || 'Looks right, continue'}
            </button>
            <button
              onClick={() => setPhase('country')}
              disabled={creating}
              className={`inline-flex items-center gap-1.5 text-sm text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors disabled:opacity-50 ${isRTL ? 'flex-row-reverse' : ''}`}
            >
              <Backward className="h-3.5 w-3.5" />
              {t('common.back') || 'Back'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
