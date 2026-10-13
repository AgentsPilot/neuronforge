'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { safeTimezone } from '@/lib/scheduling/businessTime';
import { clientLogger } from '@/lib/logger/client';
import { CREDIT_EXPLANATION } from '@/lib/i18n/creditExplanation';

/*
 * The dictionaries, one module each.
 *
 * They used to be written out inline here, and this file is a `'use client'`
 * component that 117 modules import — so every Business OS page compiled
 * twelve thousand lines of string data before it could render anything. The
 * dev server stalled for tens of seconds doing it, and requests already in
 * flight timed out behind the stall.
 *
 * Composed back into the same object with the same shape below, so every
 * reader of `translations` and every `t()` call is unchanged.
 */
import { en } from './translations/en';
import { es } from './translations/es';
import { he } from './translations/he';

const logger = clientLogger.child({ module: 'LanguageContext' });

type Language = 'en' | 'es' | 'he';
export type CurrencyCode = 'USD' | 'EUR' | 'ILS' | 'GBP';

interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  position: 'before' | 'after';
}

// All supported currencies
const CURRENCY_CONFIGS: Record<CurrencyCode, CurrencyConfig> = {
  USD: { code: 'USD', symbol: '$', position: 'before' },
  EUR: { code: 'EUR', symbol: '€', position: 'after' },
  ILS: { code: 'ILS', symbol: '₪', position: 'before' },
  GBP: { code: 'GBP', symbol: '£', position: 'before' }
};

// Default currency per language (used only if user hasn't set a preference)
const DEFAULT_CURRENCY_BY_LANGUAGE: Record<Language, CurrencyCode> = {
  en: 'USD',
  es: 'EUR',
  he: 'ILS'
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  /**
   * Returns the key itself when a string is missing, so an absent key renders
   * as `drawer.found.title` on the page rather than falling back — the
   * `t('x') || 'default'` idiom used around the codebase never reaches its
   * default. Add the key in all three languages.
   *
   * `vars` substitutes `{name}` placeholders; the implementation has always
   * supported it, but this type did not declare it.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
  isRTL: boolean;
  currency: CurrencyConfig;
  currencyCode: CurrencyCode;
  /**
   * What the BUSINESS trades in, when it has said. Undefined means unanswered —
   * do not default it, the readiness card needs the difference.
   *
   * For writing a currency, not for displaying one.
   */
  businessCurrency?: CurrencyCode;
  /**
   * Save the business's default currency.
   *
   * Resolves `{ ok: false, error }` when the save fails. The local value is put
   * back, so the screen never shows a setting that was not stored. `code` is
   * `'CURRENCY_LOCKED'` only when the database refused because money exists in
   * the current currency; any other failure (network, server) has no code.
   */
  setCurrency: (code: CurrencyCode) => Promise<{ ok: boolean; code?: string; error?: string }>;
  availableCurrencies: typeof CURRENCY_CONFIGS;
  formatCurrency: (amount: number | null, options?: { showFree?: boolean; currencyOverride?: CurrencyCode }) => string;

  /**
   * The business's clock — the one every displayed time must be read against.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY IT LIVES HERE
   *
   * It belongs beside `language` and `currency` for the same reason those do:
   * it is a fact about the BUSINESS that every screen needs and no screen
   * should fetch for itself. The alternative was what the codebase actually
   * had — each list, card and dialog calling `toLocaleTimeString()` with no
   * zone, which silently means THE BROWSER, so the same booking read one hour
   * in the drawer, another in the calendar and a third in the email.
   *
   * This provider was already fetching `user_preferences` on mount for the
   * language. Reading one more column off that same row costs nothing and
   * gives every consumer of `useLanguage()` the right clock for free.
   *
   * `UTC` until the row arrives, never the browser's zone: a placeholder that
   * happens to be right for the owner sitting in the office is a placeholder
   * that hides the bug until they travel.
   */
  timezone: string;
  /**
   * `toLocale*` options with the business clock already in them.
   *
   * The whole failure mode here is an omitted `timeZone`, which is invisible
   * at the call site and wrong only for readers elsewhere. Spreading this
   * makes the zone the default rather than the thing you must remember.
   */
  timeZoneOptions: (options?: Intl.DateTimeFormatOptions) => Intl.DateTimeFormatOptions;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

/*
 * Exported so the cancellation labels can be paired against the CLIENT-facing
 * set in `lib/email/templates/translations`. Those two must say the same thing
 * for every code except the five that are about the client themselves, and
 * nothing but a test can hold that — they live in different modules because one
 * is React and the other is used on the server.
 */
export const translations = { en, es, he };

/**
 * What the server has stored for this user, raw, validated by the caller.
 *
 * A value is `null` when unset. A HALF is `null` when that read failed, so the
 * caller can tell "nothing stored" from "unknown". The whole result is `null`
 * when nothing could be read.
 */
interface StoredPreferences {
  locale: { preferredLanguage: string | null; timezone: string | null } | null;
  currency: { businessCurrency: string | null } | null;
}

async function loadPreferencesFromServer(): Promise<StoredPreferences | null> {
  try {
    const res = await fetch('/api/business-os/preferences', { method: 'GET' });
    if (!res.ok) {
      logger.debug({ status: res.status }, 'Failed to load preferences from the server');
      return null;
    }
    const payload = (await res.json()) as { data?: StoredPreferences };
    return payload.data ?? null;
  } catch (err) {
    logger.debug({ err }, 'Failed to load preferences from the server');
    return null;
  }
}

/**
 * Save the language or the business currency through the server.
 *
 * The browser does not write these tables itself (CLAUDE.md rule 1). The route
 * validates the value and scopes the write to the session user. Never throws:
 * a network failure comes back as `{ ok: false }` like any other.
 */
async function savePreference(
  body: { language: Language } | { currency: CurrencyCode }
): Promise<{ ok: boolean; code?: string; error?: string }> {
  try {
    const res = await fetch('/api/business-os/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const payload = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    return { ok: false, code: payload?.code, error: payload?.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('USD');

  /**
   * The currency stored on the BUSINESS, as opposed to the one this browser is
   * displaying in.
   *
   * Undefined until loaded, and undefined for a business that has never chosen
   * — which is the state the readiness card exists to notice, so it must not be
   * collapsed into a default here.
   *
   * Deliberately NOT what `formatCurrency` reads. Display still follows
   * `currencyCode`; what this is for is the two modals that WRITE a currency
   * onto an invoice, where a per-device preference becoming permanent
   * client-visible data is the actual bug.
   */
  const [businessCurrency, setBusinessCurrency] = useState<CurrencyCode | undefined>(undefined);
  const [currencyInitialized, setCurrencyInitialized] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Deliberately not the browser's zone as the initial value. See `timezone`
  // on LanguageContextType.
  const [timezone, setTimezone] = useState<string>('UTC');

  // Load language and currency from localStorage and database on mount
  useEffect(() => {
    const loadPreferences = async () => {
      // First load from localStorage for immediate UI
      const savedLang = localStorage.getItem('business-os-language');
      if (savedLang && (savedLang === 'en' || savedLang === 'es' || savedLang === 'he')) {
        setLanguageState(savedLang);
      }

      const savedCurrency = localStorage.getItem('business-os-currency');
      if (savedCurrency && savedCurrency in CURRENCY_CONFIGS) {
        setCurrencyCode(savedCurrency as CurrencyCode);
      } else if (savedLang && savedLang in DEFAULT_CURRENCY_BY_LANGUAGE) {
        setCurrencyCode(DEFAULT_CURRENCY_BY_LANGUAGE[savedLang as Language]);
      }
      setCurrencyInitialized(true);

      // Then check if user is authenticated and load from database
      try {
        // Auth only, no table access: who is signed in decides whether the
        // pickers save, independently of whether the read below succeeds.
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserId(user.id);

          // Language AND clock off one row, plus the business's own default
          // currency, in one request through the server (CLAUDE.md rule 1).
          // Both are business-level facts that every screen needs; fetching
          // them separately is what let the two drift apart per surface.
          //
          // A half that could not be read is `null` and is skipped, keeping the
          // localStorage values for it. Deliberately no language backfill then:
          // a failed read is not "nothing stored", and writing this browser's
          // language over a real stored one would be wrong.
          const prefs = await loadPreferencesFromServer();
          const businessCurrencyValue = prefs?.currency?.businessCurrency;
          const locale = prefs?.locale;

          // The business's own default, for anything that WRITES a currency.
          if (businessCurrencyValue && businessCurrencyValue in CURRENCY_CONFIGS) {
            setBusinessCurrency(businessCurrencyValue as CurrencyCode);

            /*
             * The business's own currency also seeds the DISPLAY currency.
             *
             * It did not, and the two states sat side by side disagreeing: the
             * display one was derived from localStorage and then from the
             * LANGUAGE, so a business that had stated USD and switched the
             * interface to Hebrew read every figure with no stored currency of
             * its own as ₪ — 73 of the 78 `formatCurrency` call sites.
             *
             * Only when the owner has not pinned one on this device. An
             * explicit pick in Settings still wins, because it is an answer and
             * this is a default.
             */
            if (!localStorage.getItem('business-os-currency')) {
              setCurrencyCode(businessCurrencyValue as CurrencyCode);
            }
          }

          if (!locale) return;

          if (locale.timezone) {
            setTimezone(safeTimezone(locale.timezone));
          }

          if (locale.preferredLanguage && (locale.preferredLanguage === 'en' || locale.preferredLanguage === 'es' || locale.preferredLanguage === 'he')) {
            setLanguageState(locale.preferredLanguage);
            localStorage.setItem('business-os-language', locale.preferredLanguage);
          } else if (savedLang === 'en' || savedLang === 'es' || savedLang === 'he') {
            // No stored preference, but this browser knows what the user picked.
            // The route writes BOTH columns, the same pair syncLanguageToDatabase
            // writes: filling only one leaves the two disagreeing, and
            // server-side features have to pick a winner between them.
            const result = await savePreference({ language: savedLang });
            if (!result.ok) {
              logger.debug({ error: result.error }, 'Failed to backfill the language to the database');
            }
          }
        }
      } catch (err) {
        // Silently fail - localStorage will be used as fallback
        logger.debug({ err }, 'Failed to load language from database');
      }
    };

    loadPreferences();
  }, []);

  // Apply RTL to HTML element when language changes
  useEffect(() => {
    const isRTL = language === 'he';
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  // Sync language to database when it changes
  const syncLanguageToDatabase = useCallback(async (lang: Language) => {
    if (!userId) {
      logger.debug('syncLanguageToDatabase: no userId, skipping');
      return;
    }

    // user_preferences (for emails and insights) and business_profiles.language,
    // together, by the route.
    const result = await savePreference({ language: lang });
    if (!result.ok) {
      logger.error({ error: result.error }, 'Failed to sync language to database');
    }
  }, [userId]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('business-os-language', lang);

    /*
     * The language may pick the currency only when NOTHING better has said.
     *
     * Order: the owner's explicit pick on this device, then the BUSINESS's own
     * stated currency, and the language last. The business was missing from
     * that list, so switching the interface to Hebrew re-denominated a USD
     * business's whole dashboard to ₪ — "what language am I reading in" and
     * "what do I charge in" are different questions, and Israel charging US
     * clients in dollars is the case the platform is built for.
     *
     * Language remains a reasonable guess for a business that has stated
     * nothing: that is where `DEFAULT_CURRENCY_BY_LANGUAGE` still applies.
     */
    if (!localStorage.getItem('business-os-currency') && !businessCurrency) {
      setCurrencyCode(DEFAULT_CURRENCY_BY_LANGUAGE[lang]);
    }

    // Sync to database for email locale
    syncLanguageToDatabase(lang);
  }, [syncLanguageToDatabase, businessCurrency]);

  /**
   * Persist the business's DEFAULT currency.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This used to write `localStorage` and nothing else, while
   * `syncLanguageToDatabase` — forty lines above, for the sister control on the
   * same settings screen — wrote two tables. So the Currency dropdown looked
   * like a business setting and was a per-device display preference: pick
   * shekels on a laptop, open a phone, everything is dollars again, and two
   * people on one account see different symbols.
   *
   * It could not save before now, because `business_profiles.currency` did not
   * exist. It does now (20261004_business_default_currency.sql).
   *
   * A DEFAULT, NOT A CONSTRAINT. `scheduling_services.currency` remains the
   * authority for what a client is charged — a business operating from Israel
   * can price a US client in USD, and that must keep working. This value only
   * pre-fills the picker for a new service and labels figures with no row
   * behind them.
   *
   * The localStorage write stays. Display still reads from it, deliberately
   * untouched here: this slice makes the value STORABLE, and moving what reads
   * it is separate work against code that has already been carefully settled.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const setCurrency = useCallback(
    async (code: CurrencyCode): Promise<{ ok: boolean; code?: string; error?: string }> => {
      /*
       * Three separate things to restore, each from its OWN previous value.
       *
       * The business currency used to be restored from `currencyCode`, the
       * display currency. The two can differ (a device pin, or a business that
       * never chose), so a refused save could leave `businessCurrency` holding
       * the display value, and `businessCurrency` is what the invoice modals
       * WRITE. That is the per-device-value-becomes-client-data bug the CLAUDE.md
       * Currency rules exist to prevent.
       */
      const previousDisplay = currencyCode;
      const previousBusiness = businessCurrency;
      const previousPinned = localStorage.getItem('business-os-currency');

      // Optimistic, because the picker has always been instant.
      setCurrencyCode(code);
      setBusinessCurrency(code);
      localStorage.setItem('business-os-currency', code);

      if (!userId) return { ok: true };

      // `code` is the owner's pick from the picker, never `currencyCode`.
      const result = await savePreference({ currency: code });

      if (!result.ok) {
        /*
         * PUT IT BACK.
         *
         * The database refuses a currency change once money exists in the old
         * one (`business_currency_lock`, 20261008), because changing it
         * relabels history rather than converting it. The route reports that
         * as `CURRENCY_LOCKED`. Leaving the optimistic value on screen would
         * show a setting that was not saved — the same "looks saved, isn't"
         * failure this control had for its whole life, arrived at from the
         * other direction.
         */
        setCurrencyCode(previousDisplay);
        setBusinessCurrency(previousBusiness);
        if (previousPinned === null) {
          localStorage.removeItem('business-os-currency');
        } else {
          localStorage.setItem('business-os-currency', previousPinned);
        }

        logger.error({ code: result.code, error: result.error }, 'Failed to save the business currency');
        return { ok: false, code: result.code, error: result.error };
      }

      return { ok: true };
    },
    [userId, currencyCode, businessCurrency]
  );

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let text = translations[language][key as keyof typeof translations['en']] || key;
    if (vars) {
      Object.entries(vars).forEach(([varKey, value]) => {
        text = text.replace(new RegExp(`\\{${varKey}\\}`, 'g'), String(value));
      });
    }
    return text;
  };

  const isRTL = language === 'he';

  // Get currency config based on user's currency setting
  const currency = CURRENCY_CONFIGS[currencyCode];

  // Format currency with proper symbol and position
  const formatCurrency = (amount: number | null, options?: { showFree?: boolean; currencyOverride?: CurrencyCode }): string => {
    // Use override currency if provided (for service-level currency), otherwise use user's currency
    const activeCurrency = options?.currencyOverride
      ? (CURRENCY_CONFIGS[options.currencyOverride] || currency)
      : currency;

    if (amount === null || amount === 0) {
      if (options?.showFree !== false) {
        return t('scheduling.service.free');
      }
      return activeCurrency.position === 'before'
        ? `${activeCurrency.symbol}0`
        : `0${activeCurrency.symbol}`;
    }

    const formattedAmount = amount.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return activeCurrency.position === 'before'
      ? `${activeCurrency.symbol}${formattedAmount}`
      : `${formattedAmount}${activeCurrency.symbol}`;
  };

  /*
   * `timeZone` last, so it cannot be overridden by a caller's options object.
   *
   * That is the point: a call site that passes its own `timeZone` is either
   * re-introducing the bug or doing something deliberate enough to format
   * directly with `Intl`.
   */
  const timeZoneOptions = useCallback(
    (options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions => ({
      ...options,
      timeZone: timezone,
    }),
    [timezone]
  );

  return (
    <LanguageContext.Provider value={{
      language,
      setLanguage,
      t,
      isRTL,
      currency,
      currencyCode,
      businessCurrency,
      setCurrency,
      availableCurrencies: CURRENCY_CONFIGS,
      formatCurrency,
      timezone,
      timeZoneOptions
    }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

/**
 * Non-throwing variant, for components shared across surfaces that are not all
 * wrapped in a `LanguageProvider`.
 *
 * `LanguageProvider` covers `app/business-os/**` and `app/onboarding-build/**`,
 * but NOT `app/v2/**` — `app/v2/layout.tsx` provides only `V2ThemeProvider`. So
 * a component rendered on both `/business-os/settings` and `/v2/settings`
 * cannot call `useLanguage()`: it would throw at render on the v2 surface.
 *
 * Callers get `undefined` outside a provider and are expected to fall back to
 * their own English strings. Prefer `useLanguage()` anywhere the provider is
 * guaranteed — an accidental silent fallback to English is a worse bug than a
 * loud missing-provider error.
 */
export function useOptionalLanguage(): LanguageContextType | undefined {
  return useContext(LanguageContext);
}

/**
 * The business's clock, for a component that may render outside the provider.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND HOOK
 *
 * `useLanguage` THROWS without a provider, which is right for a component whose
 * every string comes from it. The clock is needed by cards and lists that are
 * also mounted from public pages and standalone dialogs, where no provider is
 * mounted — reaching for `useLanguage` there would turn a formatting detail
 * into a blank screen.
 *
 * `UTC` when there is no provider, matching the provider's own initial value,
 * so the fallback is the same wrong-but-consistent answer everywhere rather
 * than the browser's zone, which is wrong differently for every viewer.
 */
export function useBusinessTimezone(): {
  timezone: string;
  timeZoneOptions: (options?: Intl.DateTimeFormatOptions) => Intl.DateTimeFormatOptions;
} {
  const context = useContext(LanguageContext);
  const timezone = context?.timezone ?? 'UTC';

  return {
    timezone,
    timeZoneOptions: useCallback(
      (options: Intl.DateTimeFormatOptions = {}) => ({ ...options, timeZone: timezone }),
      [timezone]
    ),
  };
}
