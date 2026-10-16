'use client';

/**
 * Permission to email clients: who has given it, what they were asked, and what
 * still stands in the way of using it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE COUNT IS AT THE TOP
 *
 * "12 of your 340 contacts can receive marketing email" is the single most
 * useful line on this screen, and it is the one that stops the send gate being
 * experienced as a bug. Everyone who signed up before the checkbox existed is
 * in the other 328, permanently: consent cannot be collected after the fact,
 * because the email asking for it would itself be the marketing email nobody
 * agreed to.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Any way to mark contacts as consented in bulk. It would take one click to
 * undo everything this screen exists to do, and it is the first thing anyone
 * looking at the count above will want. Consent given on paper or in person is
 * recorded one person at a time, on their own card in the CRM, with the wording
 * typed in.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Info, Loader2 } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SavedAddressPicker, type KnownAddress } from '@/components/ui/SavedAddressPicker';
import { readAddressBook, type AddressBookRead } from '@/components/ui/addressBookRead';
import {
  readConsentSettings,
  type ConsentRead,
  type MarketingDrawerReads,
} from '@/components/business-os/settings/marketingDrawerReads';
import { formatAddressOneLine } from '@/lib/geo/address';
import type { CountryLocale } from '@/lib/geo/countries';
import { TabFooter } from '@/components/business-os/settings/TabFooter';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'MarketingConsentPanel' });

interface Settings {
  capture_enabled: boolean;
  statement_en: string | null;
  statement_he: string | null;
  statement_es: string | null;
  privacy_policy_mode: 'hosted' | 'url' | 'none';
  privacy_policy_url: string | null;
  privacy_policy_body: string | null;
  postal_address: string | null;
  label_as_advertisement: boolean;
}

interface Payload {
  settings: Settings | null;
  defaults: {
    statement_en: string;
    statement_he: string;
    statement_es: string;
    privacy_policy_body: string;
    /** The business's own address from its profile, or '' when it has none. */
    postal_address: string;
  };
  counts: { mailable: number; contacts: number };
  sending: { enabled: boolean; hasPostalAddress: boolean };
}

const EMPTY: Settings = {
  capture_enabled: true,
  statement_en: null,
  statement_he: null,
  statement_es: null,
  privacy_policy_mode: 'hosted',
  privacy_policy_url: null,
  privacy_policy_body: null,
  postal_address: null,
  label_as_advertisement: false,
};

/**
 * Fill every empty field with the default the server composed for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEEDED AS REAL TEXT, NOT AS A PLACEHOLDER.
 *
 * These used to be `placeholder` attributes. A placeholder is invisible to
 * anyone who does not click into the box, it cannot be part-edited, and it
 * vanishes the moment a single character is typed — so the owner faced two long
 * documents (the agreement wording and the privacy notice) as apparently blank
 * boxes they would have to compose from nothing. Almost nobody does; the notice
 * then went out as the generated English default with no sign to the owner that
 * it was ever theirs to change.
 *
 * WHAT THIS COSTS, ON PURPOSE. Saving the panel now persists the seeded body,
 * and a stored body stops tracking the generator — so a business that saves
 * once keeps this wording even if the platform's default improves later. That is
 * the deal being made: text the owner can see and edit, over text that silently
 * stays current and that they never knew existed.
 *
 * CLEARING A FIELD still means "use the platform default", which is what both
 * consumers already do with an empty value (`resolveStatement` treats blank as
 * unset; `PrivacyPolicyPage` falls back to the generator). So a cleared box comes
 * back seeded next time the panel opens, and that is the honest reading of it:
 * the default is what visitors would see either way.
 *
 * ONLY THE BUSINESS'S OWN LANGUAGE IS SEEDED. The other two stored statements
 * are passed through exactly as they came: left null they go on resolving to the
 * platform default per visitor, which is what a business that has never chosen
 * wording for a language it does not speak actually wants. Seeding all three
 * would freeze two translations the owner cannot read and has not approved.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function seeded(
  settings: Settings | null,
  defaults: Payload['defaults'],
  locale: 'en' | 'he' | 'es'
): Settings {
  const stored = { ...EMPTY, ...(settings ?? {}) };
  return {
    ...stored,
    [`statement_${locale}`]: stored[`statement_${locale}`] ?? defaults[`statement_${locale}`],
    privacy_policy_body: stored.privacy_policy_body ?? defaults.privacy_policy_body,
    // The only one that can legitimately have nothing to seed: a business that
    // has not told the platform its address. Left null so the example shows.
    postal_address: stored.postal_address ?? (defaults.postal_address || null),
  };
}

/** The nine saved fields. `reusedAddress` is display-only and never saved, so it is not here. */
const SETTINGS_KEYS: readonly (keyof Settings)[] = [
  'capture_enabled',
  'statement_en',
  'statement_he',
  'statement_es',
  'privacy_policy_mode',
  'privacy_policy_url',
  'privacy_policy_body',
  'postal_address',
  'label_as_advertisement',
];

/**
 * Whether two forms would save the same thing, field by field (not by
 * reference, so typing a letter and deleting it again is clean).
 *
 * `''` and `null` count as equal (SA C-4): every text handler writes
 * `e.target.value || null`, so a field the server returned as `''` comes back
 * as `null` after a type-and-delete, and would otherwise stay dirty for good.
 */
function sameSettings(a: Settings, b: Settings): boolean {
  return SETTINGS_KEYS.every((key) => (a[key] ?? '') === (b[key] ?? ''));
}

/** Enough of the payload to seed the form; anything less is a failed load. */
function isPayload(data: unknown): data is Payload {
  if (!data || typeof data !== 'object') return false;
  const defaults = (data as { defaults?: unknown }).defaults;
  return !!defaults && typeof defaults === 'object';
}

/**
 * What a consent read is worth: a payload to seed the form from, or the reason
 * it is not one. `status` is a refusal (a non-OK status, `success !== true`, a
 * payload without defaults); `err` is a throw (no response, a body that is not
 * JSON, a payload `seeded` cannot read). The panel logs them as it always has:
 * `warn({ status })` and `error({ err })` (D-12).
 */
type ConsentVerdict =
  | { usable: true; data: Payload; next: Settings }
  | { usable: false; status: number }
  | { usable: false; err: unknown };

function judgeConsent(read: ConsentRead, locale: 'en' | 'he' | 'es'): ConsentVerdict {
  if (!read.ok) return read.kind === 'threw' ? { usable: false, err: read.err } : { usable: false, status: read.status };
  const json = read.body as { success?: unknown; data?: unknown } | null;
  if (json?.success !== true || !isPayload(json.data)) return { usable: false, status: read.status };
  try {
    return { usable: true, data: json.data, next: seeded(json.data.settings, json.data.defaults, locale) };
  } catch (err) {
    // A payload `seeded` cannot read is a failed load, not a crash in render.
    return { usable: false, err };
  }
}

/** The address book beside the postal field: still coming, in, or not to be had. */
type BookState = 'pending' | 'failed' | { locale: string; addresses: KnownAddress[] };

const bookStateOf = (read: AddressBookRead): BookState =>
  read.ok ? { locale: read.locale, addresses: read.addresses } : 'failed';

/** Trimmed, inner whitespace collapsed, case-folded: the form two addresses are compared in. */
function normalisedAddressText(text: string | null | undefined): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Every language `formatAddressOneLine` writes in. A postal line filled from the
 * address book is written in whatever language the reader had at the time, and
 * only the country name differs between them, so recognising it needs all three.
 */
const ONE_LINE_LOCALES: readonly CountryLocale[] = ['en', 'he', 'es'];

interface MarketingConsentPanelProps {
  /** Told whenever the form starts or stops differing from what was last loaded or saved. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Told while a save (and the reload after it) is in flight, so the drawer can refuse to close. */
  onBusyChange?: (busy: boolean) => void;
  /**
   * Hands over reads the settings page started early (`useDrawerPrefetch`), or
   * `null`. Called once per mount. Used only when they were read in the panel's
   * language; anything unusable in them is read once more, fresh.
   */
  takePrefetched?: () => MarketingDrawerReads | null;
}

interface LoadOptions {
  /** Passed only by `save()`, for the reload after a successful save. */
  sentForm?: Settings;
  /** Passed only by the first load on mount: a consent read already started. */
  preloaded?: Promise<ConsentRead>;
}

export function MarketingConsentPanel({ onDirtyChange, onBusyChange, takePrefetched }: MarketingConsentPanelProps = {}) {
  const { t, isRTL, language } = useLanguage();

  /** The id of the saved address, if any, the postal field still represents. */
  const [reusedAddress, setReusedAddress] = useState<string | null>(null);

  /** `formatAddressOneLine` speaks three languages; anything else reads English. */
  const addressLocale: CountryLocale =
    language === 'he' || language === 'es' ? language : 'en';
  const [payload, setPayload] = useState<Payload | null>(null);
  const [form, setForm] = useState<Settings>(EMPTY);
  /** What the form is compared against: the last load, or the last successful save. */
  const [baseline, setBaseline] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /*
   * F-17. Set only when NOTHING has loaded yet (the first load, or Try again).
   * The form used to render anyway, seeded with `EMPTY`, under an enabled Save:
   * one press wrote null wording and a null postal address over the owner's
   * stored legal settings. While this is set there is no form and no Save.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Whether any load has succeeded. After one has, a failed reload is not a load failure. */
  const hasLoaded = useRef(false);
  /** One load at a time: Try again cannot double-fire. */
  const loadInFlight = useRef(false);
  /*
   * The address book, read AT THE SAME TIME as consent (C-3) rather than by the
   * picker once the form has rendered, which made the list a second wait. It
   * never touches `form` or `baseline`: only consent seeds the form (S-3).
   */
  const [book, setBook] = useState<BookState>('pending');
  /** The mount reads start once, StrictMode's re-run included (SA-CA-9). */
  const started = useRef(false);

  /*
   * `language` is read through a ref, not closed over as a dependency.
   *
   * It decides which language the seeded privacy notice comes back written in,
   * so it genuinely belongs in the request. But as a dependency it would refetch
   * mid-edit the moment someone switched the interface language and reseed over
   * whatever they had typed. The panel is mounted when its drawer opens,
   * so opening it again after a language switch is what picks up the new one.
   */
  const languageRef = useRef(language);
  languageRef.current = language;

  /*
   * Never logs a value from the payload or the form: the wording, the notice and
   * the postal address are legal or personal text. Status and `err` only.
   *
   * `sentForm` is passed only by `save()`, for the reload after a successful
   * save (SA S-3 finding 1, QA edge case 5). The fields stay editable while a
   * save is in flight, so anything typed since `sentForm` was sent is kept
   * rather than overwritten by the reload. The baseline still becomes what the
   * server now holds, so kept text leaves the form dirty and the drawer still
   * asks before dropping it.
   *
   * `preloaded` is passed only by the first load on mount (C-5). It is awaited
   * instead of a new request. Anything unusable in it (a refusal, a throw,
   * `success !== true`, a payload without defaults) is never shown: it is read
   * once more, fresh, and only that answer reaches the F-17 decision (SA-CA-2).
   * Try again and the reload after a save never pass it, so they always read
   * fresh.
   */
  const load = useCallback(async ({ sentForm, preloaded }: LoadOptions = {}) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    // A failure before anything has loaded hides the form (F-17). After a load
    // has succeeded (the reload after a save), it only warns and keeps the form.
    const failed = () => {
      if (!hasLoaded.current) setLoadFailed(true);
    };
    try {
      let verdict: ConsentVerdict | null = null;
      if (preloaded) {
        const early = judgeConsent(await preloaded, languageRef.current);
        if (early.usable) {
          verdict = early;
        } else {
          // Not acted on, so not a load failure: debug only, status or err only.
          logger.debug(
            'err' in early ? { err: early.err } : { status: early.status },
            'Prefetched consent settings unusable; reading again'
          );
        }
      }
      if (!verdict) verdict = judgeConsent(await readConsentSettings(languageRef.current), languageRef.current);

      if (!verdict.usable) {
        if ('err' in verdict) logger.error({ err: verdict.err }, 'Could not load consent settings');
        else logger.warn({ status: verdict.status }, 'Consent settings load refused');
        failed();
        return;
      }
      const { data, next } = verdict;
      setPayload(data);
      // Functional, so it compares against the latest typed text, not a stale closure.
      setForm((prev) => (sentForm && !sameSettings(prev, sentForm) ? prev : next));
      setBaseline(next);
      setLoadFailed(false);
      hasLoaded.current = true;
    } catch (err) {
      logger.error({ err }, 'Could not load consent settings');
      failed();
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, []);

  /*
   * On mount: the book and consent, both in flight before either is awaited
   * (C-3). Reads the page started early are taken once (C-5) and used only in
   * the panel's own language. A prefetched book that failed is read once more,
   * fresh; a book that fails again leaves no picker, which is what a failed
   * read always showed (Q-5).
   *
   * No cancellation on unmount: a late answer to an unmounted panel is a no-op,
   * and a StrictMode cleanup must not drop the one read this mount makes.
   */
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const lang = languageRef.current;
    const offered = takePrefetched?.() ?? null;
    const pre = offered && offered.locale === lang ? offered : null;

    const bookRead = pre
      ? pre.book.then((read) => (read.ok ? read : readAddressBook(lang)))
      : readAddressBook(lang);
    void bookRead.then((read) => setBook(bookStateOf(read)));

    void load({ preloaded: pre?.consent });
    // Mount only: `takePrefetched` is consumed once, never re-asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    if (loadInFlight.current) return;
    setLoadFailed(false);
    setLoading(true);
    void load();
  };

  const isDirty = !loadFailed && baseline !== null && !sameSettings(form, baseline);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(saving);
  }, [saving, onBusyChange]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setSaveFailed(false);
    // What is sent becomes the new baseline on success, before the reload: a
    // reload that then fails must leave the drawer clean, with "Saved" (SA C-2 b).
    const sent = form;
    try {
      const response = await fetch('/api/business-os/consent-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sent),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, 'Consent settings save refused');
        setSaveFailed(true);
        return;
      }
      const json = await response.json();
      if (json?.success !== true) {
        logger.warn({ status: response.status }, 'Consent settings save refused');
        setSaveFailed(true);
        return;
      }
      setBaseline(sent);
      setSaved(true);
      await load({ sentForm: sent });
    } catch (err) {
      // The form stays as typed, and dirty, so the drawer still guards it.
      logger.error({ err }, 'Could not save consent settings');
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Loader2 className="w-4 h-4 animate-spin text-[var(--v2-text-muted)]" />;
  }

  if (loadFailed) {
    // No form and no Save: there is nothing loaded to edit, and saving the
    // empty form would overwrite what the owner has stored (F-17).
    return (
      <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-3 text-sm">
        <p role="alert" className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          {t('consent.load_failed')}
        </p>
        <button
          type="button"
          onClick={retry}
          className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {t('common.try_again')}
        </button>
      </div>
    );
  }

  const counts = payload?.counts;
  const sending = payload?.sending;

  const field =
    'w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)]';

  /*
   * Which saved address the postal text already IS, for marking it in the list
   * (F-18). Used for marking only: a wrong answer can mark or unmark a radio,
   * and can never write the field.
   *
   * The entry's `label` counts: it is what a click would write for this
   * reader. So does the one-line form in each language `formatAddressOneLine`
   * speaks. English is how `business_profiles.address` is written, which is
   * where an unstored field is seeded from. Hebrew and Spanish are how a click
   * wrote it for a reader in that language, and the line stays the same address
   * when the reader later switches language (only the country name differs).
   * An empty field matches nothing. The field text is normalised once here, not
   * per option; the label is tried first and the language forms only on a miss.
   */
  const postalText = normalisedAddressText(form.postal_address);
  const sameAsPostal = (text: string | null | undefined): boolean =>
    normalisedAddressText(text) === postalText;
  const recognisesPostal = (option: KnownAddress): boolean =>
    postalText !== '' &&
    (sameAsPostal(option.label) ||
      ONE_LINE_LOCALES.some((locale) => sameAsPostal(formatAddressOneLine(option.address, locale))));

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-5 text-sm">
      {/* The number that makes the gate legible. Both figures are interpolated
          into one sentence rather than emphasised inline, so the clause order can
          differ per language without the markup fighting it. */}
      {counts && (
        <div className="rounded-lg border border-[var(--v2-border)] p-3">
          <p className="font-medium text-[var(--v2-text-primary)]">
            {t('consent.count', { mailable: counts.mailable, contacts: counts.contacts })}
          </p>
          {counts.contacts > counts.mailable && (
            <p className="mt-1 text-xs text-[var(--v2-text-muted)]">{t('consent.count_rest')}</p>
          )}
        </div>
      )}

      {/* Why nothing is going out yet, said plainly rather than left to be
          discovered when a campaign sends to nobody. */}
      {sending && !sending.enabled && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-xs text-amber-900">
            <p className="font-medium">{t('consent.sending_off')}</p>
            <p className="mt-1">{t('consent.sending_off_desc')}</p>
          </div>
        </div>
      )}

      {/*
        Toggle first, so it sits on the start side: right in Hebrew, left in
        English. The inner `dir="ltr"` is separate and non-negotiable — Switch
        moves its thumb by a fixed rightward `translate-x-[20px]`, so inside an
        RTL track the thumb would start at the right edge and that shift would
        carry it clean out. The row around it still mirrors.
      */}
      <div className="flex items-start gap-3">
        <div dir="ltr" className="mt-0.5 shrink-0">
          <Switch
            id="consent-capture-enabled"
            checked={form.capture_enabled}
            onCheckedChange={(checked) => setForm({ ...form, capture_enabled: checked })}
          />
        </div>
        <label htmlFor="consent-capture-enabled" className="min-w-0 cursor-pointer">
          <span className="block text-[var(--v2-text-primary)]">{t('consent.capture')}</span>
          <span className="mt-0.5 block text-xs text-[var(--v2-text-muted)]">
            {t('consent.capture_desc')}
          </span>
        </label>
      </div>

      <div>
        <label className="mb-1 block text-[var(--v2-text-primary)]">{t('consent.statement')}</label>
        <p className="mb-2 text-xs text-[var(--v2-text-muted)]">{t('consent.statement_desc')}</p>
        {/*
          ONE BOX, IN THE BUSINESS'S OWN LANGUAGE.

          The wording is stored per language and this used to render all three,
          which asked an owner to review and approve legal wording in two
          languages they may not read. Only theirs is editable here; a visitor
          arriving in another language still gets the platform's wording for that
          language, which is better than wording nobody checked.

          The placeholder still earns its place: it is what shows if the owner
          clears the box, and it says what visitors would then be asked instead.
        */}
        <textarea
          value={form[`statement_${language}`] ?? ''}
          onChange={(e) =>
            setForm({ ...form, [`statement_${language}`]: e.target.value || null })
          }
          rows={3}
          dir={isRTL ? 'rtl' : 'ltr'}
          placeholder={payload?.defaults[`statement_${language}`]}
          className={field}
        />
      </div>

      <div>
        <label className="mb-1 block text-[var(--v2-text-primary)]">{t('consent.privacy')}</label>
        {/* The design system's dropdown, not a bare `<select>`: a native one
            renders the OS widget, which ignores the dark theme entirely and sat
            in this panel as a white box among themed fields. */}
        <Select
          value={form.privacy_policy_mode}
          onValueChange={(value) =>
            setForm({ ...form, privacy_policy_mode: value as Settings['privacy_policy_mode'] })
          }
        >
          <SelectTrigger className="mb-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hosted">{t('consent.privacy_hosted')}</SelectItem>
            <SelectItem value="url">{t('consent.privacy_url')}</SelectItem>
            <SelectItem value="none">{t('consent.privacy_none')}</SelectItem>
          </SelectContent>
        </Select>

        {form.privacy_policy_mode === 'url' && (
          <input
            type="url"
            value={form.privacy_policy_url ?? ''}
            onChange={(e) => setForm({ ...form, privacy_policy_url: e.target.value || null })}
            placeholder="https://example.com/privacy"
            dir="ltr"
            className={field}
          />
        )}

        {form.privacy_policy_mode === 'hosted' && (
          <>
            <textarea
              value={form.privacy_policy_body ?? ''}
              onChange={(e) => setForm({ ...form, privacy_policy_body: e.target.value || null })}
              rows={10}
              placeholder={payload?.defaults.privacy_policy_body}
              className={`${field} font-mono text-xs`}
            />
            <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
              {t('consent.privacy_body_desc')}
            </p>
          </>
        )}
      </div>

      <div>
        <label className="mb-1 block text-[var(--v2-text-primary)]">{t('consent.postal')}</label>

        {/*
          An address already on file, offered as a one-click fill.

          The placeholder below has always SHOWN the business address greyed
          out, which looks like an answer and is not one — a business that
          never typed over it saved nothing, and the field is a legal
          requirement for marketing email. This turns the hint into a choice.

          Flattened to one line, because this column is free text rather than
          structured: `formatAddressOneLine` renders exactly what the public
          pages render.

          A TEXT FORM (F-18). `matchCurrent` tells the picker this field is
          text the panel seeded itself: it marks the entry the text already
          is, and never fills on its own. Only the owner's click changes the
          field. Without it the picker took the book's default and wrote it
          over the stored legal postal line on every open.
        */}
        <div className="mb-2">
          {book === 'pending' ? (
            /*
              C-4: the picker's place, held while the book is still coming, so
              the postal box does not jump when the list arrives. No text and
              hidden from assistive tech: it is a shape, not content. About one
              entry, the "different address" row and the title. Pulses only
              where motion is welcome.
            */
            <div
              data-testid="consent-address-book-placeholder"
              aria-hidden="true"
              className="h-[8.5rem] motion-safe:animate-pulse"
              style={{
                border: '1px solid var(--v2-border)',
                borderRadius: 'var(--v2-radius-card)',
                background: 'var(--v2-surface)',
              }}
            />
          ) : book !== 'failed' ? (
            <SavedAddressPicker
              use="marketing"
              selectedId={reusedAddress}
              onSelectedChange={(id) => setReusedAddress(id)}
              matchCurrent={recognisesPostal}
              otherLabel={t('settings.address.reuse_other')}
              onSelect={(address) =>
                setForm(prev => ({
                  ...prev,
                  postal_address: formatAddressOneLine(address, addressLocale) ?? prev.postal_address,
                }))
              }
              locale={language}
              isRTL={isRTL}
              t={t}
              initialBook={book}
            />
          ) : null}
        </div>
        {/* The business's own address from its profile, shown greyed. A detail it
            has already given the platform should not be a blank box here, and a
            business with no address on file still gets a worked example rather
            than nothing. */}
        <textarea
          value={form.postal_address ?? ''}
          onChange={(e) => {
            // Typed over, so it is no longer the saved one.
            setReusedAddress(null);
            setForm({ ...form, postal_address: e.target.value || null });
          }}
          rows={2}
          placeholder={payload?.defaults.postal_address || t('consent.postal_placeholder')}
          className={field}
        />
        <p className="mt-1 text-xs text-[var(--v2-text-muted)]">{t('consent.postal_desc')}</p>
      </div>

      <div className="flex items-start gap-3">
        <div dir="ltr" className="mt-0.5 shrink-0">
          <Switch
            id="consent-label-as-advertisement"
            checked={form.label_as_advertisement}
            onCheckedChange={(checked) => setForm({ ...form, label_as_advertisement: checked })}
          />
        </div>
        <label htmlFor="consent-label-as-advertisement" className="min-w-0 cursor-pointer">
          <span className="block text-[var(--v2-text-primary)]">{t('consent.label_ad')}</span>
          <span className="mt-0.5 block text-xs text-[var(--v2-text-muted)]">
            {t('consent.label_ad_desc')}
          </span>
        </label>
      </div>

      {/*
        The same filled primary button every other Business OS save uses.

        This was `<Button>`, whose default variant is `bg-primary
        text-primary-foreground` — and neither class exists: `tailwind.config.js`
        defines `v2.primary`, never a bare `primary`, and no stylesheet defines
        `--primary`. So the variant emitted no background and no colour at all,
        leaving "Save" as bare inherited text at the foot of a long panel. On the
        dark theme there was nothing to see it against.
      */}
      {/*
        In the settings drawer this portals into the drawer's fixed bar, so Save
        and its answer stay in view while the notice scrolls (S-3). A failed save
        says so (F-2: it used to show nothing) and keeps the form as typed.
        "Saved" shows only while the form still matches what was saved, so it
        never sits next to unsaved text. Save stays enabled on a clean form:
        pressing it on the seeded wording is how an owner adopts it.
      */}
      <TabFooter
        message={
          saveFailed ? (
            <p role="alert" className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              {t('consent.save_failed')}
            </p>
          ) : saved && !isDirty ? (
            <p role="status" className="flex items-center gap-2 text-xs text-emerald-500">
              <Check className="h-4 w-4 shrink-0" />
              {t('consent.saved')}
            </p>
          ) : null
        }
      >
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white disabled:opacity-50"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('common.save')}
        </button>
      </TabFooter>
    </div>
  );
}
