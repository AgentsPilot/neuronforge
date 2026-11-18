'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';

import { CONFIG_ACCENT } from '@/components/business-os/configAccent';
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StripeEmbeddedOnboarding' });

/**
 * One `--v2-*` token's computed value, or the given fallback.
 *
 * Stripe's appearance API takes literal colours, not `var()` references, so the
 * values have to be resolved before the component mounts. A token that does not
 * resolve returns the fallback rather than an empty string: Stripe rejects an
 * empty colour and would refuse the whole appearance object, taking the form
 * down with it.
 */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

/* ───────────────────────────────────────────────────────────────────────────
 * CONTRAST, COMPUTED RATHER THAN HOPED FOR
 *
 * Two of these colours are read ON another of them: the label on a primary
 * button sits on the accent, and a link sits on the surface. The platform
 * accent is admin-customisable, so neither pairing can be written down as a
 * literal — white on this deployment's orange (#fb923c) measures 2.26:1, which
 * is below the floor for any text at all.
 * ─────────────────────────────────────────────────────────────────────────── */

/** #rgb or #rrggbb to [r,g,b], or null for anything else (rgb(), oklch(), …). */
function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number | null {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return null;
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

/** Near-black or near-white, whichever is legible on the given background. */
function inkOn(background: string, lightInk: string, darkInk: string): string {
  const parsed = parseHex(background);
  if (!parsed) return darkInk;
  return luminance(parsed) > 0.45 ? darkInk : lightInk;
}

function mix(hex: string, towards: [number, number, number], amount: number): string {
  const parsed = parseHex(hex);
  if (!parsed) return hex;
  const out = parsed.map((channel, i) => Math.round(channel + (towards[i] - channel) * amount));
  return `#${out.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A foreground that is actually readable on `background`.
 *
 * Nudged toward white or black until it clears 4.5:1, or returned unchanged
 * when it cannot be parsed. Used for link text, where the accent itself is
 * often too close to the surface in one of the two themes.
 */
function legible(foreground: string, background: string, min = 4.5): string {
  const start = contrast(foreground, background);
  if (start === null || start >= min) return foreground;

  const bg = parseHex(background);
  const towards: [number, number, number] = bg && luminance(bg) > 0.45 ? [0, 0, 0] : [255, 255, 255];

  let candidate = foreground;
  for (let step = 1; step <= 10; step += 1) {
    candidate = mix(foreground, towards, step / 10);
    const ratio = contrast(candidate, background);
    if (ratio !== null && ratio >= min) return candidate;
  }
  return candidate;
}

/**
 * The embedded form's appearance, in this product's colours and type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY COLOUR VARIABLE STRIPE OFFERS, NOT JUST THE OBVIOUS SIX
 *
 * Reported from a real onboarding: "some of the embedded Stripe screens are
 * missing full dark mode support". The cause is that an unset appearance
 * variable does not inherit from the ones that ARE set — it falls back to
 * Stripe's own light default. So setting `colorBackground` and `colorText`
 * themed the main card and left every secondary surface white: section
 * backgrounds (`offsetBackgroundColor`), input fields (`formBackgroundColor`),
 * secondary buttons, and all four badge styles.
 *
 * The full list is taken from `@stripe/connect-js`'s own
 * `exportedTypes/shared.d.ts`, so a variable cannot be forgotten by being
 * unknown to us.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function themeAppearance() {
  const surface = token('--v2-surface', '#ffffff');
  const ground = token('--v2-bg', '#F5F5F7');
  const text = token('--v2-text-primary', '#1a1a1a');
  const secondaryText = token('--v2-text-secondary', '#6B7280');
  const muted = token('--v2-text-muted', '#9CA3AF');
  const border = token('--v2-border', '#E5E7EB');
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE DIALOG'S ACCENT, NOT `--v2-primary`.
   *
   * `--v2-primary` is the BUSINESS's own brand colour at runtime: the theme
   * provider writes `customTokens.colors.primary` over it, so on an account
   * whose website is orange, Stripe's "Add information" button came back
   * orange — inside a configuration dialog painted `CONFIG_ACCENT`. Stripe's
   * own form ended up the one element on screen wearing a third colour.
   *
   * Every host that mounts this component renders inside that dialog
   * (`ConfigurationDialog`, and `StripeConnectWizard` which the dialog owns),
   * so the dialog's accent is the right one and `configAccent` is where it
   * lives — the same constant the Continue button and the requirement rows
   * use.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const accent = CONFIG_ACCENT;
  const danger = token('--v2-error-icon', '#df1b41');
  /* Stripe's appearance API takes literal values, never `var()`, so the radii
     are resolved here like every colour above. */
  const cardRadius = token('--v2-radius-card', '16px');
  const buttonRadius = token('--v2-radius-button', '12px');

  return {
    /* ── the base four ──────────────────────────────────────────────────── */
    colorPrimary: accent,
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE FORM SITS ON THE PANEL, IT IS NOT A CARD ON IT.
     *
     * `colorBackground` was `--v2-surface` while the panel this mounts into is
     * `--v2-bg`, so Stripe's component drew its own lighter card inside ours:
     * a card in a card, two borders and two grounds for one thing.
     *
     * Taking the panel's own ground makes the form look like part of the
     * dialog rather than an embed pasted into it. There is no "transparent"
     * here — Stripe's appearance API takes literal colours only — so matching
     * the host is how a background is removed.
     *
     * The two surfaces below are swapped to keep the contrast that was doing
     * real work: nested sections and input fields now sit slightly RAISED on
     * that ground instead of recessed into it. Left as they were, both would
     * equal the card and the form would be one flat sheet with no fields
     * visible.
     * ───────────────────────────────────────────────────────────────────────
     */
    colorBackground: ground,
    colorText: text,
    colorDanger: danger,
    colorSecondaryText: secondaryText,
    colorBorder: border,

    /* ── the surfaces that were staying white ───────────────────────────── */
    /*
     * `offsetBackgroundColor` IS THE COLUMN, not just the nested sections.
     *
     * Setting it to `surface` to "raise" the sections painted the whole form
     * area one shade lighter than the panel — the card that was supposed to
     * disappear, back again and now wider. Stripe uses this variable for the
     * component's own body, so it has to match the host too.
     *
     * Only the INPUTS keep the lighter surface. That is the one place the
     * contrast is doing work: a field has to look like somewhere you type.
     */
    offsetBackgroundColor: ground,
    formBackgroundColor: surface,
    formBorderRadius: buttonRadius,
    formAccentColor: accent,
    formHighlightColorBorder: accent,
    formPlaceholderTextColor: muted,

    /* ── buttons. The primary label is computed, never assumed white ────── */
    buttonPrimaryColorBackground: accent,
    buttonPrimaryColorBorder: accent,
    buttonPrimaryColorText: inkOn(accent, '#FFFFFF', '#1F2937'),
    buttonSecondaryColorBackground: surface,
    buttonSecondaryColorBorder: border,
    buttonSecondaryColorText: text,
    buttonDangerColorBackground: danger,
    buttonDangerColorBorder: danger,
    buttonDangerColorText: inkOn(danger, '#FFFFFF', '#1F2937'),
    buttonBorderRadius: buttonRadius,
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE BUTTON'S OWN INSETS, MATCHED TO THE PLATFORM'S.
     *
     * Stripe's default button is tighter than anything this product draws,
     * so "Add information" sat in the middle of our dialog visibly smaller
     * than the Continue button two screens earlier.
     *
     * `spacingUnit` is the wrong lever for this — it multiplies through
     * every inset in the component at once, so padding the button that way
     * inflates the card, the fields and the gaps with it. These two
     * variables move the button and nothing else.
     *
     * The numbers are our own `px-5 py-2.5` (20px / 10px) with `text-sm`
     * `font-medium`, the treatment every primary button in Business OS
     * wears, so Stripe's button is the same object as ours rather than a
     * near-miss.
     * ─────────────────────────────────────────────────────────────────────
     */
    buttonPaddingX: '20px',
    buttonPaddingY: '10px',
    buttonLabelFontSize: '14px',
    buttonLabelFontWeight: '600',

    /* ── links, nudged until they are readable on this theme's surface ──── */
    actionPrimaryColorText: legible(accent, surface),
    actionSecondaryColorText: secondaryText,

    /* ── badges, all four, or the unset ones render light-on-light ───────── */
    badgeNeutralColorBackground: ground,
    badgeNeutralColorBorder: border,
    badgeNeutralColorText: secondaryText,
    badgeSuccessColorBackground: token('--v2-status-success-bg', '#F0FDF4'),
    badgeSuccessColorBorder: token('--v2-status-success-border', '#BBF7D0'),
    badgeSuccessColorText: token('--v2-status-success-text', '#15803D'),
    badgeWarningColorBackground: token('--v2-status-warning-bg', '#FFFBEB'),
    badgeWarningColorBorder: token('--v2-status-warning-border', '#FDE68A'),
    badgeWarningColorText: token('--v2-status-warning-text', '#92400E'),
    badgeDangerColorBackground: token('--v2-status-error-bg', '#FEF2F2'),
    badgeDangerColorBorder: token('--v2-status-error-border', '#FECACA'),
    badgeDangerColorText: token('--v2-status-error-text', '#991B1B'),
    badgeBorderRadius: '999px',

    /* Heebo, the face the rest of the product sets, so the two halves of the
       screen are not visibly different documents. */
    fontFamily: '"Heebo", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSizeBase: '14px',
    spacingUnit: '4px',
    /* The card Stripe draws inside our panel. At 8px it was visibly squarer
       than everything around it; the platform's own card radius makes it one
       surface with the dialog instead of a frame inside a frame. */
    borderRadius: cardRadius,
  };
}

interface StripeEmbeddedOnboardingProps {
  onComplete: () => void;
  onExit?: () => void;
}

type OnboardingStatus = 'loading' | 'ready' | 'error' | 'complete';

/**
 * Stripe Connect Embedded Onboarding Component
 *
 * Uses Stripe's Connect embedded components to show the onboarding form
 * directly within our dialog, providing a seamless experience.
 */
export function StripeEmbeddedOnboarding({ onComplete, onExit }: StripeEmbeddedOnboardingProps) {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<OnboardingStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  /* Watches <html> for a theme change, so the embedded form follows it. */
  const themeWatcherRef = useRef<MutationObserver | null>(null);

  // Store callbacks in refs to avoid re-running effect
  const onCompleteRef = useRef(onComplete);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onExitRef.current = onExit;
  }, [onComplete, onExit]);

  // Initialize Stripe Connect
  useEffect(() => {
    // Only initialize once per language
    if (initializedRef.current) return;

    // Don't initialize until we have a definite language (not just default)
    if (!language) return;

    initializedRef.current = true;

    const initializeStripeConnect = async () => {
      const container = containerRef.current;
      if (!container) {
        logger.error('Container ref not available');
        setError('Container not available');
        setStatus('error');
        return;
      }

      try {
        const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!publishableKey) {
          throw new Error('Stripe publishable key not configured');
        }

        logger.info('Initializing Stripe Connect embedded onboarding');

        // Fetch client secret from our API
        const fetchClientSecret = async (): Promise<string> => {
          const response = await fetch('/api/payments/stripe-connect/account-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          const result = await response.json();

          if (!result.success || !result.clientSecret) {
            throw new Error(result.error || 'Failed to create account session');
          }

          return result.clientSecret;
        };

        // Map our language to Stripe locale codes
        // Stripe supports: ar, bg, cs, da, de, el, en, es, et, fi, fil, fr, hr, hu, id, it, ja, ko, lt, lv, ms, mt, nb, nl, pl, pt, ro, ru, sk, sl, sv, th, tr, vi, zh, zh-HK, zh-TW
        // Also supports region variants like es-419 (Latin American Spanish), en-GB, etc.
        const stripeLocale = language === 'he' ? 'he' : language === 'es' ? 'es' : 'en';

        logger.info({ language, stripeLocale }, 'Initializing Stripe Connect with locale');

        // Initialize Stripe Connect
        const stripeConnectInstance = loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret,
          appearance: {
            overlays: 'dialog',
            /*
             * ── THE FORM TAKES THIS PRODUCT'S COLOURS ───────────────────────
             *
             * These were literals: Stripe purple on #ffffff with near-black
             * text. In dark mode that is a white card sitting inside a dark
             * dialog — it reads as another company's page embedded in ours, at
             * the one moment an owner is being asked for their ID number and
             * bank account. Trust is the whole job of this screen.
             *
             * Read from the live `--v2-*` tokens so it follows the theme AND
             * any platform custom tokens an admin has set, with the literals
             * kept only as the fallback for a context where the variable does
             * not resolve.
             */
            variables: themeAppearance(),
          },
          locale: stripeLocale,
        });

        /*
         * ── AND RE-THEME IF THE THEME CHANGES UNDER IT ──────────────────────
         *
         * The variables above are resolved once, at mount, because Stripe's
         * appearance API takes literal colours. So an owner who switches to
         * dark while this form is open keeps the light one: the rest of the
         * page flips and the Stripe panel does not, which is the most visible
         * version of the problem.
         *
         * `V2ThemeProvider` stamps the mode as a class on <html>, so watching
         * that one attribute is enough. `update` re-sends the whole appearance
         * without remounting the form or losing what has been typed into it.
         */
        const themeWatcher = new MutationObserver(() => {
          try {
            stripeConnectInstance.update({
              appearance: { overlays: 'dialog', variables: themeAppearance() },
            });
          } catch (themeError) {
            /* A failed re-theme is cosmetic. It must never take down a form
               the owner is halfway through. */
            logger.warn({ err: themeError }, 'Could not re-theme the embedded onboarding');
          }
        });
        themeWatcher.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme'],
        });
        themeWatcherRef.current = themeWatcher;

        // Create the account onboarding component (returns a custom HTML element)
        const onboardingComponent = stripeConnectInstance.create('account-onboarding');

        /*
         * ── ASK FOR WHAT IS NEEDED NOW, NOT FOR EVERYTHING EVENTUALLY ───────
         *
         * The default is `eventually_due`: every field Stripe will ever want,
         * in one sitting, before the owner can take a single payment. That is
         * the difference between a first visit of about four questions and one
         * of sixteen, for someone who has no way of telling which of them
         * matter today.
         *
         * `currently_due` is the shorter list that unlocks charging. The rest
         * is collected later, when a payout threshold or a deadline actually
         * makes it due, through this same component — which is why
         * `futureRequirements: 'omit'` is safe rather than a way of losing
         * them: nothing is skipped, only deferred to the visit that needs it.
         *
         * This belongs on the component and NOT on the account session: it is
         * not an `accountSessions.create` parameter, and sending it there is
         * rejected outright, taking the form down with it.
         *
         * Guarded the way `setOnExit` below is: these are optional methods on
         * the component instance, and an older connect.js simply will not have
         * them. Missing means the old behaviour, never a crash.
         */
        if (typeof onboardingComponent.setCollectionOptions === 'function') {
          onboardingComponent.setCollectionOptions({
            fields: 'currently_due',
            futureRequirements: 'omit',
          });
        }

        // Listen for exit - the event listener is set via setOnExit if available
        if (typeof onboardingComponent.setOnExit === 'function') {
          onboardingComponent.setOnExit(() => {
            logger.info('User exited onboarding');
            onExitRef.current?.();
          });
        }

        // Mount the component using DOM appendChild (not .mount())
        container.innerHTML = '';
        container.appendChild(onboardingComponent);

        setStatus('ready');
        logger.info('Stripe embedded onboarding mounted successfully');

        // Poll for completion status
        const checkCompletion = async () => {
          try {
            const response = await fetch('/api/payments/stripe-connect/refresh-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
            const result = await response.json();

            // Consider onboarding complete if:
            // 1. Full completion (charges AND payouts enabled), OR
            // 2. Details submitted AND charges enabled (payouts may take longer)
            const isComplete = result.success && (
              result.data?.onboarding_completed ||
              (result.data?.details_submitted && result.data?.charges_enabled)
            );

            if (isComplete) {
              logger.info({ data: result.data }, 'Stripe onboarding detected as complete');
              setStatus('complete');
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
              }
              setTimeout(() => onCompleteRef.current(), 1500);
            }
          } catch (err) {
            // Ignore errors in polling
          }
        };

        // Check completion every 5 seconds
        pollIntervalRef.current = setInterval(checkCompletion, 5000);

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load onboarding';
        logger.error({ err }, 'Failed to initialize Stripe embedded onboarding');
        setError(errorMessage);
        setStatus('error');
      }
    };

    initializeStripeConnect();

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      /* The observer outlives the form otherwise, and keeps calling `update`
         on an instance whose container is gone. */
      themeWatcherRef.current?.disconnect();
      themeWatcherRef.current = null;
    };
  }, [language]); // Only re-run if language changes

  // Retry handler
  const handleRetry = useCallback(() => {
    initializedRef.current = false;
    setStatus('loading');
    setError(null);
    // Force re-mount by updating a key or re-running effect
    // Since we can't easily re-trigger useEffect, we'll reload the component
    window.location.reload();
  }, []);

  // Error state
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {t('payments.stripe.embedded.error_title') || 'Failed to Load'}
          </h3>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1 max-w-sm">
            {error || t('payments.stripe.embedded.error_desc') || 'Unable to load the payment setup form.'}
          </p>
        </div>
        <Button
          onClick={handleRetry}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          {t('common.try_again') || 'Try Again'}
        </Button>
      </div>
    );
  }

  // Complete state
  if (status === 'complete') {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {t('payments.stripe.embedded.complete_title') || 'Setup Complete!'}
          </h3>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
            {t('payments.stripe.embedded.complete_desc') || 'Your payment account is ready.'}
          </p>
        </div>
      </div>
    );
  }

  // Loading or Ready state
  return (
    <div className="stripe-embedded-onboarding">
      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-[#635BFF]" />
          <p className="text-[var(--v2-text-muted)]">
            {t('payments.stripe.embedded.loading') || 'Loading payment setup...'}
          </p>
        </div>
      )}

      {/*
        ───────────────────────────────────────────────────────────────────────
        THE WINDOW STRIPE IS ABOUT TO OPEN, SAID BEFORE IT OPENS.

        The first thing the form asks for is the account holder's own Stripe
        login — email, phone, a code — and Stripe serves that step from
        `connect.stripe.com` in a SEPARATE TOP-LEVEL WINDOW. It is not a choice
        of ours and there is no setting for it: a credential screen rendered
        inside a page the platform controls is a page the platform could read
        or fake, so Stripe never embeds it. Everything after it — business
        details, bank account, documents — does render in the card below.

        What was ours to fix is the surprise. A second browser window appearing
        unannounced is the moment an owner thinks something has gone wrong,
        closes it, or never notices it behind the main window — and a blocked
        popup looks identical to a dead button. One sentence turns all three
        into something expected.

        Placed ABOVE the form rather than below it: it has to be read before
        the press, and the form is tall enough that anything underneath is off
        screen at the moment it matters.
        ───────────────────────────────────────────────────────────────────────
      */}
      {status !== 'loading' && (
        <div
          className="flex items-start gap-2.5 px-3.5 py-3 mb-4 text-[12.5px] leading-relaxed"
          style={{
            borderRadius: 'var(--v2-radius-button)',
            background: 'var(--v2-bg)',
            border: '1px solid var(--v2-border)',
            color: 'var(--v2-text-secondary)',
          }}
        >
          <ExternalLink
            className="h-3.5 w-3.5 flex-shrink-0 mt-[3px]"
            style={{ color: CONFIG_ACCENT }}
          />
          <span className="min-w-0 [text-wrap:pretty]">
            {t('payments.stripe.embedded.popup_notice') ||
              'Stripe opens its own window to check your phone and email. If nothing appears, allow pop-ups for this site. Come back here once it closes.'}
          </span>
        </div>
      )}

      {/* The Stripe component will be mounted here - always rendered but hidden during loading */}
      {/* The appearance radius above rounds what Stripe draws; this rounds the
          hole it is drawn into, so an element that paints its own square edge
          to the container's bounds is still clipped to our corner. */}
      <div
        ref={containerRef}
        className="min-h-[400px] w-full"
        style={{
          display: status === 'loading' ? 'none' : 'block',
          /* The corner is kept for the rare component that still paints its
             own edge; there is no card of Stripe's to clip any more. */
          borderRadius: 'var(--v2-radius-card)',
          overflow: 'hidden',
          /*
           * ─────────────────────────────────────────────────────────────────
           * THE INSET STRIPE'S FORM DOES NOT DRAW FOR ITSELF.
           *
           * The embedded component fills whatever box it is given, edge to
           * edge: headings, labels and input fields all ran flush to the sides
           * of our panel, so the form looked pasted onto the dialog rather
           * than set inside it. Every other panel in this dialog is inset from
           * its own border.
           *
           * Padding HERE rather than `spacingUnit` in the appearance: that
           * variable multiplies through every gap inside the component at
           * once — the space between fields, inside badges, around buttons —
           * so using it to buy an outer margin changes the form's whole
           * density as a side effect. This moves only the edge.
           * ─────────────────────────────────────────────────────────────────
           */
          padding: '8px 28px 28px',
          /* The panel's full width, as it was. The measure was tried and the
             form reads better wide now that its background matches the panel:
             what looked like sprawl was largely the lighter card around it. */
        }}
      />

      <style jsx global>{`
        /* Custom styles for Stripe Connect embedded components */
        .stripe-embedded-onboarding {
          /* Ensure the embedded component respects our theme */
        }

        /* Override Stripe's default styles to match our design */
        stripe-connect-account-onboarding {
          display: block;
          width: 100%;
        }
      `}</style>
    </div>
  );
}
