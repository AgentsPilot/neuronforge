'use client';

/**
 * Step 0: the clock and the currency, confirmed before anything is built on them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS COMES FIRST, BEFORE THE BUSINESS PROFILE AND THE SERVICES
 *
 * These two are not settings. They are the units every later answer is
 * expressed in:
 *
 *   the timezone   every hour a client is offered is READ in it. Set wrong, a
 *                  09:00 slot is offered at 09:00 in somebody else's day and
 *                  the booking is real, confirmed and at the wrong time.
 *   the currency   every price, invoice and payment is issued in it, and
 *                  `business_currency_lock` REFUSES to change it once money
 *                  exists in the old one — the API answers 409 CURRENCY_LOCKED.
 *                  So it is not merely awkward to fix later; after the first
 *                  invoice it cannot be fixed at all without starting again.
 *
 * Both are also guessed by default, which is the dangerous part. The timezone
 * column defaulted to 'UTC' for accounts nobody ever asked, and the currency
 * is seeded from the address. A guess that is never confirmed looks exactly
 * like an answer, and the first time anyone finds out is a client in the wrong
 * hour or a figure in the wrong money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO FIELDS, HERE, NOT A TRIP TO SETTINGS
 *
 * The obvious build is a card that says "check your settings" with a link. It
 * is also the one that loses people: the owner leaves the setup, lands on a
 * page of twenty other things, and either does not find the two or does not
 * come back. The pickers are in the card because confirming is the task.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMING IS A WRITE, DELIBERATELY
 *
 * Pressing the button POSTs both values even when neither was touched, because
 * agreeing with a guess is the answer we do not have. The timezone write
 * stamps `timezone_confirmed_at`, which the publish gate and My Day read as "a
 * human answered" — and which is why a truthy timezone alone has never been
 * enough to satisfy them.
 *
 * @module components/business-os/insight
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Loader2 } from 'lucide-react';

import { SearchableDropdown, type DropdownOption } from '@/components/ui/SearchableDropdown';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ClockAndCurrencyCard' });

/** The four this platform settles in. Same list the service editor offers. */
const CURRENCIES: Array<{ code: string; label: string; symbol: string }> = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'ILS', label: 'Israeli Shekel', symbol: '₪' },
];

interface Props {
  /** Fired once both are stored, so the host can move to the next step. */
  onConfirmed: () => void;
}

export function ClockAndCurrencyCard({ onConfirmed }: Props) {
  const { t, isRTL } = useLanguage();

  /** `t` returns the key when a translation is missing, so fall back by hand. */
  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Every zone the browser knows, UTC first.
   *
   * `supportedValuesOf` is absent on older engines, so a short list stands in
   * rather than an empty picker — the same fallback the settings page uses, and
   * for the same reason: an owner facing no options cannot confirm anything.
   */
  const zones: DropdownOption[] = useMemo(() => {
    const labelFor = (zone: string) => zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;
    const supported =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

    const list =
      supported.length > 0
        ? supported.filter(zone => zone !== 'UTC')
        : [
            'America/New_York',
            'America/Los_Angeles',
            'Europe/London',
            'Europe/Paris',
            'Asia/Jerusalem',
            'Asia/Tokyo',
          ];

    /* UTC first: a legitimate answer for a business that genuinely works to
       it, and `supportedValuesOf` does not always include it. */
    return [
      { value: 'UTC', label: 'UTC' },
      ...list.map(zone => ({
        value: zone,
        label: labelFor(zone),
        /* The full path as the hint rather than inside the label: the picker
           shows it on the right, and it keeps "Paris" readable while
           `Europe/Paris` stays searchable. */
        hint: zone,
        keywords: zone.replace(/[/_]/g, ' '),
      })),
    ];
  }, []);

  const currencyOptions: DropdownOption[] = useMemo(
    () =>
      CURRENCIES.map(option => ({
        value: option.code,
        label: option.label,
        hint: option.code,
        icon: option.symbol,
        keywords: `${option.code} ${option.symbol}`,
      })),
    []
  );

  /*
   * What is stored now, and the browser's own zone where nothing is.
   *
   * Prefilling from `Intl` is the difference between a question and a
   * confirmation: an owner who is in the zone we guessed presses one button.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let storedZone: string | null = null;
      let storedCurrency: string | null = null;

      try {
        const response = await fetch('/api/business-os/preferences');
        if (response.ok) {
          const body = await response.json();
          storedZone = body?.data?.locale?.timezone ?? null;
          storedCurrency = body?.data?.currency?.businessCurrency ?? null;
        }
      } catch (err) {
        logger.warn({ err }, 'Could not read the stored clock and currency');
      }

      if (cancelled) return;

      const browserZone =
        typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';

      setTimezone(storedZone || browserZone || 'UTC');
      if (storedCurrency) setCurrency(storedCurrency);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const confirm = async () => {
    setSaving(true);
    setError(null);

    try {
      /*
       * ───────────────────────────────────────────────────────────────────
       * TWO REQUESTS, BECAUSE THE ROUTE TAKES ONE ANSWER AT A TIME.
       *
       * `preferencesSchema` is a union of STRICT single-key objects —
       * `{language}` or `{currency}` or `{timezone}` — so a body carrying both
       * is refused by the schema before any write happens. The first build of
       * this card sent them together, and every press came back "that did not
       * save". The method is PATCH, not PUT, for the same reason it is worth
       * writing down: a partial update of one preference.
       *
       * CURRENCY FIRST. It is the one that can legitimately be refused —
       * `business_currency_lock` returns 409 once invoices exist — and the
       * timezone write is what stamps `timezone_confirmed_at`, the marker the
       * whole step is gated on. Stamping "answered" and then failing on the
       * currency would close the card over a question still open.
       *
       * BOTH ARE SENT even when neither was touched: agreeing with a guess is
       * precisely the answer the platform does not have.
       * ───────────────────────────────────────────────────────────────────
       */
      const save = async (body: Record<string, string>) => {
        const response = await fetch('/api/business-os/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const parsed = await response.json().catch(() => null);
        return { ok: response.ok && parsed?.success !== false, status: response.status, body: parsed };
      };

      const currencyResult = await save({ currency });

      if (!currencyResult.ok) {
        const locked =
          currencyResult.body?.error === 'CURRENCY_LOCKED' || currencyResult.status === 409;
        setError(
          locked
            ? tr(
                'setup.clock.locked',
                'Your currency cannot be changed now: invoices already exist in the old one. Pick the one you already bill in.'
              )
            : tr('setup.clock.failed', 'That did not save. Please try again.')
        );
        setSaving(false);
        return;
      }

      const timezoneResult = await save({ timezone });

      if (!timezoneResult.ok) {
        setError(tr('setup.clock.failed', 'That did not save. Please try again.'));
        setSaving(false);
        return;
      }

      onConfirmed();
    } catch (err) {
      logger.error({ err }, 'Could not confirm the clock and currency');
      setError(tr('setup.clock.failed', 'That did not save. Please try again.'));
      setSaving(false);
    }
  };

  const font = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const display = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';

  const field: React.CSSProperties = {
    width: '100%',
    background: 'var(--v2-bg)',
    border: '1px solid var(--v2-border)',
    color: 'var(--v2-text-primary)',
    borderRadius: 'var(--v2-radius-button)',
    padding: '10px 12px',
    fontSize: '13.5px',
    outline: 'none',
  };

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        fontFamily: font,
        border: '1px solid color-mix(in srgb, var(--v2-primary) 38%, var(--v2-border))',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--v2-primary) 9%, transparent), transparent 62%), var(--v2-surface)',
        borderRadius: '18px',
        padding: '18px',
        marginBottom: '24px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
      }}
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--v2-primary)',
        }}
      >
        {tr('setup.clock.eyebrow', 'First step')}
      </span>

      <h3
        style={{
          margin: '9px 0 0',
          fontSize: '19px',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--v2-text-primary)',
          fontFamily: display,
          lineHeight: 1.25,
        }}
      >
        {tr('setup.clock.title', 'Check your clock and your currency')}
      </h3>

      <p
        style={{
          margin: '5px 0 0',
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--v2-text-secondary)',
          textWrap: 'pretty',
        }}
      >
        {tr(
          'setup.clock.why',
          'Every hour a client is offered is read in this timezone, and every price, invoice and payment is issued in this currency. We filled them in from your address and your browser, so this is a check rather than a question.'
        )}
      </p>

      {/* The reason it cannot wait. Stated plainly rather than implied by its
          position: a currency becomes unchangeable the moment money exists. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          marginTop: '12px',
          padding: '11px 13px',
          borderRadius: 'var(--v2-radius-button)',
          background: 'var(--v2-status-warning-bg)',
          border: '1px solid var(--v2-status-warning-border)',
          color: 'var(--v2-status-warning-text)',
          fontSize: '12.5px',
          lineHeight: 1.5,
        }}
      >
        <AlertTriangle style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2 }} />
        <span style={{ minWidth: 0, textWrap: 'pretty' }}>
          {tr(
            'setup.clock.locks',
            'Your currency can no longer be changed once your first invoice exists, and a wrong timezone means confirmed bookings at the wrong hour. That is why this comes before everything else.'
          )}
        </span>
      </div>

        {/*
        ──────────────────────────────────────────────────────────────────
        ONE ROW, TWO PICKERS, BOTH THE PLATFORM'S OWN.

        They were a native `<select>` with a separate "type a city" box above
        it. Three problems, and the first is the one that shows: a bare
        `<select>` panel is drawn by the operating system, so on a dark theme
        it opens in the OS's colours whatever the page says. The second is
        that the search box made the two columns different heights, so the
        currency label floated above a control that started lower. The third
        is that a search input NEXT TO a picker is a second thing to
        understand: `SearchableDropdown` has the search inside it, which is
        what every other picker in the platform does.

        The city search is gone with it. Typing filters the list itself, and
        the full zone path rides along as `keywords`, so "jerusalem", "asia"
        and "IL"-style fragments all find the right row without a field of
        their own.
        ──────────────────────────────────────────────────────────────────
      */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 0' }}>
          <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: 'var(--v2-primary)' }} />
          <span style={{ fontSize: 13, color: 'var(--v2-text-muted)' }}>
            {tr('setup.clock.loading', 'Reading what you have…')}
          </span>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '12px',
            marginTop: '14px',
            alignItems: 'start',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '11.5px',
                fontWeight: 600,
                color: 'var(--v2-text-secondary)',
                marginBottom: 6,
                height: '16px',
              }}
            >
              <Clock style={{ width: 13, height: 13 }} />
              {tr('setup.clock.timezone', 'Your timezone')}
            </label>
            <SearchableDropdown
              value={timezone}
              onChange={setTimezone}
              options={zones}
              isRTL={isRTL}
              placeholder={tr('setup.clock.pick_zone', 'Choose your timezone')}
              emptyLabel={tr('setup.clock.no_zone', 'No timezones found')}
              /* A stored zone the browser does not list must still show its own
                 name rather than an empty box. */
              fallbackLabel={timezone}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                fontSize: '11.5px',
                fontWeight: 600,
                color: 'var(--v2-text-secondary)',
                marginBottom: 6,
                height: '16px',
              }}
            >
              {tr('setup.clock.currency', 'What you charge in')}
            </label>
            <SearchableDropdown
              value={currency}
              onChange={setCurrency}
              options={currencyOptions}
              isRTL={isRTL}
              placeholder={tr('setup.clock.pick_currency', 'Choose a currency')}
              emptyLabel={tr('setup.clock.no_currency', 'No currencies found')}
            />
          </div>
        </div>
      )}

      {error && (
        <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: '#B42318', lineHeight: 1.5 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: '16px' }}>
        <button
          type="button"
          onClick={confirm}
          disabled={loading || saving || !timezone}
          className="ap-primary-lift"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: 'none',
            background: 'var(--v2-primary)',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 600,
            padding: '10px 16px',
            borderRadius: '11px',
            cursor: loading || saving ? 'not-allowed' : 'pointer',
            opacity: loading || saving ? 0.6 : 1,
          }}
        >
          {saving ? (
            <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} />
          ) : (
            <Check style={{ width: 15, height: 15 }} />
          )}
          {tr('setup.clock.confirm', 'Yes, these are right')}
        </button>

        {/* No skip. Everything after this is priced and scheduled in these two,
            so parking them would mean building on an unanswered question. */}
        <span style={{ fontSize: '12px', color: 'var(--v2-text-muted)' }}>
          {tr('setup.clock.note', 'You can change your timezone later. Your currency, only until your first invoice.')}
        </span>
      </div>
    </div>
  );
}
