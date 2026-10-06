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
import { Loader2, Info } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SavedAddressPicker, type AddressSource } from '@/components/ui/SavedAddressPicker';
import { formatAddressOneLine } from '@/lib/geo/address';
import type { CountryLocale } from '@/lib/geo/countries';
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

export function MarketingConsentPanel() {
  const { t, isRTL, language } = useLanguage();

  /** Which saved address, if any, the postal field still represents. */
  const [reusedAddress, setReusedAddress] = useState<AddressSource | null>(null);

  /** `formatAddressOneLine` speaks three languages; anything else reads English. */
  const addressLocale: CountryLocale =
    language === 'he' || language === 'es' ? language : 'en';
  const [payload, setPayload] = useState<Payload | null>(null);
  const [form, setForm] = useState<Settings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  /*
   * `language` is read through a ref, not closed over as a dependency.
   *
   * It decides which language the seeded privacy notice comes back written in,
   * so it genuinely belongs in the request. But as a dependency it would refetch
   * mid-edit the moment someone switched the interface language and reseed over
   * whatever they had typed. The panel is mounted when its section is expanded,
   * so opening it again after a language switch is what picks up the new one.
   */
  const languageRef = useRef(language);
  languageRef.current = language;

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/business-os/consent-settings?locale=${encodeURIComponent(languageRef.current)}`
      );
      const json = await response.json();
      if (json.success) {
        setPayload(json.data);
        setForm(seeded(json.data.settings, json.data.defaults, languageRef.current));
      }
    } catch (err) {
      logger.error({ err }, 'Could not load consent settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch('/api/business-os/consent-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await response.json();
      if (json.success) {
        setSaved(true);
        await load();
      }
    } catch (err) {
      logger.error({ err }, 'Could not save consent settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Loader2 className="w-4 h-4 animate-spin text-[var(--v2-text-muted)]" />;
  }

  const counts = payload?.counts;
  const sending = payload?.sending;

  const field =
    'w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)]';

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
        */}
        <div className="mb-2">
          <SavedAddressPicker
            selected={reusedAddress}
            onSelectedChange={setReusedAddress}
            onSelect={(address) =>
              setForm(prev => ({
                ...prev,
                postal_address: formatAddressOneLine(address, addressLocale) ?? prev.postal_address,
              }))
            }
            locale={language}
            isRTL={isRTL}
            t={t}
          />
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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white disabled:opacity-50"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('common.save')}
        </button>
        {saved && <span className="text-xs text-emerald-500">{t('consent.saved')}</span>}
      </div>
    </div>
  );
}
