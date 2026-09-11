'use client';

/**
 * The business's own details — name, what it does, how clients reach it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT ON THE SETTINGS PAGE ANY MORE
 *
 * `/business-os/settings` is the ACCOUNT screen: the person's profile, their
 * password, their data. This is the BUSINESS — its name, its trade, the phone
 * and address its clients are shown — and it belongs with the rest of the
 * business configuration, beside services, availability and payments, rather
 * than under a heading about the user.
 *
 * The split had a visible cost: the dashboard's readiness chips opened a
 * settings PAGE for two items and a configuration DIALOG for the rest, so the
 * same list of unfinished work led to two different kinds of screen.
 *
 * Self-contained, like `InvoiceSettingsSection` beside it: it loads what it
 * needs and saves it, so a host only has to mount it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import {
  Loader2,
  ExternalLink,
  Clock,
  Building2,
  ChevronDown,
  Check,
  Briefcase,
  CheckCircle,
  AlertCircle,
  Users,
  Target,
  Sparkles,
  Mail,
  MapPin,
} from 'lucide-react';
import PhoneInput, { getCountryCallingCode, parsePhoneNumber } from 'react-phone-number-input';
import type { Country } from 'react-phone-number-input';
import phoneCountryLabels from 'react-phone-number-input/locale/en';
import 'react-phone-number-input/style.css';
import { SearchableCountrySelect } from '@/components/crm/SearchableCountrySelect';
import { MediaUploader } from '@/components/website/MediaUploader';
import { toE164 } from '@/lib/branding/phone';
import { safeExternalUrl } from '@/lib/branding/externalUrl';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { getVerticalLabel } from '@/lib/business-os/verticalLabels';
import { CONFIG_ACCENT, configAccentButton } from '@/components/business-os/configAccent';
import { TabFooter } from '@/components/business-os/settings/TabFooter';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BusinessProfileSection' });

/**
 * Which country to assume when a stored number has no `+`.
 *
 * Numbers saved before this field existed are bare local strings. The
 * business's own working language is the least-wrong guess, and the selector
 * lets the owner correct it.
 */
const COUNTRY_BY_LANGUAGE: Record<string, Country> = { he: 'IL', es: 'ES', en: 'US' };

/** The calling code for a country, or the US as a last resort. */
function getCallingCode(country: Country): string {
  try {
    return getCountryCallingCode(country);
  } catch {
    return '1';
  }
}

/**
 * What the business said it does, wherever onboarding actually left it.
 *
 * The answer to "מה העסק שלך עושה" is meant to land in
 * `business_profiles.description`, but the build step only writes that column
 * when it receives the value in that exact field. For accounts whose answer
 * arrived inside the configuration blob it is in `extracted_data` instead —
 * and the onboarding conversation names it `businessDescription`, the build
 * schema names it `description`, and the website analyser names it
 * `business_description`. Some rows nest the whole thing under `metadata`.
 *
 * So the column is checked first and the blob is then searched by every name
 * the value is known to travel under. A business that has answered the question
 * sees its answer; nothing here writes, so opening settings cannot rewrite it.
 */
function readBusinessDescription(profile: {
  description?: string | null;
  extracted_data?: unknown;
  website_analysis?: unknown;
}): string {
  if (profile.description?.trim()) return profile.description.trim();

  const KEYS = ['description', 'businessDescription', 'business_description'] as const;

  const pick = (source: unknown): string | null => {
    if (!source || typeof source !== 'object') return null;
    const record = source as Record<string, unknown>;

    for (const key of KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }

    // One level of nesting, which is where `metadata`-wrapped rows keep it.
    for (const nested of ['metadata', 'configuration', 'profile']) {
      const found = pick(record[nested]);
      if (found) return found;
    }

    return null;
  };

  return pick(profile.extracted_data) || pick(profile.website_analysis) || '';
}


/**
 * Form styling shared by every control below.
 *
 * These fields were written for the ~380px right-hand column of the settings
 * page. In the configuration dialog — `max-w-7xl`, so 1280px — the same
 * `w-full` inputs stretched the full width of the screen, which reads as a
 * broken layout rather than a roomy one. The form is capped and laid out in two
 * columns instead, and only the fields that genuinely need the width (the
 * description, the address) span both.
 */
const FIELD_LABEL = 'block text-xs font-medium text-[var(--v2-text-primary)] mb-1.5';

/** Focus ring in the dialog's accent, so a focused field matches its tab. */
const FIELD_BASE =
  'w-full py-2.5 text-sm border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] transition-colors focus:outline-none focus:ring-2 focus:ring-[#D14E97]/40 focus:border-[#D14E97]';

const FIELD_RADIUS = { borderRadius: 'var(--v2-radius-button)' } as const;

/** A labelled group of fields. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </section>
  );
}

/**
 * A stored number as E.164, plus the country it belongs to.
 *
 * Numbers predating the country selector are bare local strings (`054-1234567`)
 * and `parsePhoneNumber` cannot place them without a hint, so the caller's
 * best guess is passed in as the fallback country. Returns the input unchanged
 * when it cannot be parsed at all — refusing to show a number the owner
 * definitely has is worse than showing an unnormalised one.
 */
function normalizePhone(
  stored: string,
  fallbackCountry: Country
): { phone: string; country: Country } {
  if (!stored.trim()) return { phone: '', country: fallbackCountry };

  try {
    // Without a hint first, so an already-international number keeps its own
    // country rather than being reinterpreted under the fallback.
    const parsed = parsePhoneNumber(stored) || parsePhoneNumber(stored, fallbackCountry);
    if (parsed?.number) {
      return { phone: parsed.number, country: parsed.country || fallbackCountry };
    }
  } catch {
    // Falls through to the character-level conversion below.
  }

  return {
    phone: toE164(stored, getCallingCode(fallbackCountry)) || stored,
    country: fallbackCountry,
  };
}

interface BusinessProfileSectionProps {
  /** Fired after a successful save, so a host can refresh what it shows. */
  onSaved?: () => void;
}

export function BusinessProfileSection({ onSaved }: BusinessProfileSectionProps) {
  const { user } = useAuth();
  const { t, isRTL, language } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [businessProfile, setBusinessProfile] = useState({
    vertical: '',
    sub_vertical: '',
    company_name: '',
    /**
     * What the business said it does, in its own words, during onboarding.
     *
     * It was captured and then never shown anywhere it could be read or
     * corrected — while the website generator writes a whole homepage from it.
     * Someone whose site says the wrong thing had no way to find out why.
     */
    description: '',
    website_url: '',
    /**
     * How a client reaches this business: the number they call, the address
     * they email, and where they come.
     *
     * These are the only fields on this screen a CUSTOMER of the business ever
     * sees — they appear on the public booking, intake, contact and invoice
     * pages. They live on `business_profiles` rather than in the website
     * editor, so a business with no website can still publish them.
     */
    phone: '',
    email: '',
    address: '',
    clients_per_week: 0,
    revenue_tier: '',
  });
  const [branding, setBranding] = useState<{ logo_url: string; show_logo_on_smart_links: boolean }>({
    logo_url: '',
    show_logo_on_smart_links: true,
  });
  const [savingBranding, setSavingBranding] = useState(false);
  const [orgSettings, setOrgSettings] = useState({
    name: '',
    industry: '',
    company_size: '',
    primary_goal: '',
    technical_level: '',
    work_hours_per_day: 8,
  });

  // Organization ID for updates
  const [orgId, setOrgId] = useState<string | null>(null);
  const [businessLoaded, setBusinessLoaded] = useState(false);

  /** The country the public phone field composes against. */
  const [phoneCountry, setPhoneCountry] = useState<Country>(
    COUNTRY_BY_LANGUAGE[language] || 'US'
  );

  /**
   * Re-compose the number onto the newly chosen country's calling code.
   *
   * Picking a country used to move the flag and the rendered prefix while
   * leaving the value alone, so the save wrote the old prefix back.
   */
  const changePhoneCountry = (country: Country) => {
    setPhoneCountry(country);
    setBusinessProfile(b => {
      if (!b.phone.trim()) return b;

      let national = '';
      try {
        national = parsePhoneNumber(b.phone)?.nationalNumber?.toString() || '';
      } catch {
        national = '';
      }
      // An unparseable value keeps its digits, minus any trunk prefix, which is
      // never part of the international form.
      if (!national) national = b.phone.replace(/\D/g, '').replace(/^0+/, '');
      if (!national) return b;

      return { ...b, phone: `+${getCallingCode(country)}${national}` };
    });
  };

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const [businessRes, orgRes, brandingRes] = await Promise.all([
          supabase.from('business_profiles').select('vertical, sub_vertical, company_name, description, website_url, clients_per_week, revenue_tier, phone, email, address, extracted_data, website_analysis').eq('user_id', user.id).maybeSingle(),
          supabase.from('organizations').select('id, name, settings').eq('owner_user_id', user.id).maybeSingle(),
          // Logo columns arrive with the business-logo migration. Asked for
          // separately because PostgREST rejects an entire select when one named
          // column is absent — folded into the query above, an un-migrated
          // database returned nothing and this whole form loaded blank, which is
          // how saving it could wipe the company name.
          supabase.from('business_profiles').select('logo_url, show_logo_on_smart_links').eq('user_id', user.id).maybeSingle(),
        ]);

        if (cancelled) return;

      setBusinessLoaded(!businessRes.error);

      if (businessRes.data) {
        setBusinessProfile({
          vertical: businessRes.data.vertical || '',
          sub_vertical: businessRes.data.sub_vertical || '',
          company_name: businessRes.data.company_name || '',
          description: readBusinessDescription(businessRes.data),
          website_url: businessRes.data.website_url || '',
          phone: businessRes.data.phone || '',
          email: businessRes.data.email || '',
          address: businessRes.data.address || '',
          clients_per_week: businessRes.data.clients_per_week || 0,
          revenue_tier: businessRes.data.revenue_tier || '',
        });

        /*
         * Show the flag that matches the number already saved.
         *
         * Without this the selector always opened on the language default, so
         * an owner with a saved `+44` number saw an Israeli flag beside it and
         * would reasonably assume the number was wrong.
         */
        const savedPhone = businessRes.data.phone || '';
        const normalized = normalizePhone(savedPhone, COUNTRY_BY_LANGUAGE[language] || 'US');
        setPhoneCountry(normalized.country);
        /*
         * Write the normalised number back into state, rather than only
         * displaying it.
         *
         * This is the bug that made the prefix look saved and not be: the field
         * rendered `toE164(phone, …)` while state kept the raw `054-1234567`,
         * so an owner who never touched the field — or who only changed the
         * country — saw `+972…` and saved the number without it. What is on
         * screen and what will be written are now the same string.
         */
        if (normalized.phone !== savedPhone) {
          setBusinessProfile(b => ({ ...b, phone: normalized.phone }));
        }
      }

      if (brandingRes.data) {
        setBranding({
          logo_url: brandingRes.data.logo_url || '',
          show_logo_on_smart_links: brandingRes.data.show_logo_on_smart_links ?? true,
        });
      }

      if (orgRes.data) {
        setOrgId(orgRes.data.id);
        const settings = (orgRes.data.settings || {}) as Record<string, unknown>;
        setOrgSettings({
          name: orgRes.data.name || '',
          industry: (settings.industry as string) || '',
          company_size: (settings.company_size as string) || '',
          primary_goal: (settings.primary_goal as string) || '',
          technical_level: (settings.technical_level as string) || '',
          work_hours_per_day: (settings.work_hours_per_day as number) || 8,
        });
      }
    } catch (error) {
        logger.error({ err: error }, 'Failed to load the business profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const industryOptions = [
    { value: 'b2b_saas', label: t('settings.industry.b2b_saas') },
    { value: 'ecommerce', label: t('settings.industry.ecommerce') },
    { value: 'agency', label: t('settings.industry.agency') },
    { value: 'healthcare', label: t('settings.industry.healthcare') },
    { value: 'manufacturing', label: t('settings.industry.manufacturing') },
    { value: 'finance', label: t('settings.industry.finance') },
    { value: 'education', label: t('settings.industry.education') },
    { value: 'nonprofit', label: t('settings.industry.nonprofit') },
    { value: 'other', label: t('settings.industry.other') },
  ];

  const companySizeOptions = [
    { value: 'solo', label: t('settings.size.solo') },
    { value: 'small', label: t('settings.size.small') },
    { value: 'medium', label: t('settings.size.medium') },
    { value: 'large', label: t('settings.size.large') },
    { value: 'enterprise', label: t('settings.size.enterprise') },
  ];

  const primaryGoalOptions = [
    { value: 'reduce_costs', label: t('settings.goal.reduce_costs') },
    { value: 'grow_revenue', label: t('settings.goal.grow_revenue') },
    { value: 'improve_efficiency', label: t('settings.goal.improve_efficiency') },
    { value: 'scale_operations', label: t('settings.goal.scale_operations') },
    { value: 'better_cx', label: t('settings.goal.better_cx') },
  ];

  const technicalLevelOptions = [
    { value: 'non_technical', label: t('settings.tech.non_technical') },
    { value: 'some_technical', label: t('settings.tech.some_technical') },
    { value: 'technical', label: t('settings.tech.technical') },
  ];


  /**
   * Logo and smart-link visibility save on change rather than on the Save
   * button: the uploader has already committed the file by the time it calls
   * back, so leaving the row unsaved would show a logo that isn't stored.
   * Optimistic, with a rollback to `previous` on failure.
   */
  const saveBranding = async (patch: { logo_url?: string | null; show_logo_on_smart_links?: boolean }) => {
    const previous = branding;
    setBranding(b => ({
      logo_url: patch.logo_url !== undefined ? (patch.logo_url || '') : b.logo_url,
      show_logo_on_smart_links: patch.show_logo_on_smart_links ?? b.show_logo_on_smart_links,
    }));
    setSavingBranding(true);

    try {
      const res = await fetch('/api/business-os/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Branding save failed: ${res.status}`);
    } catch (error) {
      logger.error({ err: error }, 'Failed to save branding');
      setBranding(previous);
    } finally {
      setSavingBranding(false);
    }
  };

  const saveBusiness = async () => {
    if (!user) return;
    // Refuse to write what was never read. Without this, a failed load left the
    // form blank and the first save replaced the company name with ''.
    if (!businessLoaded) {
      setErrorMessage(t('settings.business.error'));
      return;
    }

    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      // Update business_profiles
      await supabase.from('business_profiles').upsert({
        user_id: user.id,
        company_name: businessProfile.company_name,
        description: businessProfile.description,
        vertical: businessProfile.vertical,
        /*
         * The business's own website, if it has one.
         *
         * Nothing could set this before: onboarding stopped asking for the
         * address when the old extraction path was replaced — it now learns
         * only WHETHER a site exists, not where — and this screen showed it as
         * a read-only link. A column three surfaces read from could never be
         * filled.
         *
         * Stored as null when blank rather than '', because every reader tests
         * for a value; an empty string would render an empty link.
         */
        website_url: safeExternalUrl(businessProfile.website_url),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      /*
       * The public contact details go through the API, not the upsert above.
       *
       * They are read by the public pages with the service role on behalf of
       * unauthenticated clients, so they are written through the repository
       * layer where the validation and the audit entry live — a phone number
       * that reaches the database unvalidated is one the WhatsApp link cannot
       * use. (The rest of this save still writes directly; that predates this
       * and is flagged rather than widened.)
       */
      const contactResponse = await fetch('/api/business-os/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: businessProfile.phone.trim(),
          email: businessProfile.email.trim(),
          address: businessProfile.address.trim(),
        }),
      });

      if (!contactResponse.ok) {
        const detail = await contactResponse.json().catch(() => null);
        throw new Error(detail?.error || 'Could not save the contact details');
      }

      // Update organization if exists
      if (orgId) {
        await supabase.from('organizations').update({
          name: orgSettings.name,
          settings: {
            industry: orgSettings.industry || undefined,
            company_size: orgSettings.company_size || undefined,
            primary_goal: orgSettings.primary_goal || undefined,
            technical_level: orgSettings.technical_level || undefined,
            work_hours_per_day: orgSettings.work_hours_per_day,
          },
          updated_at: new Date().toISOString(),
        }).eq('id', orgId).eq('owner_user_id', user.id);
      }

      // The accordion this used to close no longer exists — the section is a
      // dialog tab now, and collapsing it would hide the confirmation.
      onSaved?.();
      setSuccessMessage(t('settings.business.saved'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      logger.error({ err: error }, 'Failed to save the business profile');
      setErrorMessage(t('settings.business.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: CONFIG_ACCENT }} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7">
      {/* AI Hint */}
      <div className="p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20" style={FIELD_RADIUS}>
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-[var(--v2-text-secondary)]">
            {t('settings.business.ai_hint')}
          </p>
        </div>
      </div>

      <FormSection title={t('settings.business.section_identity')}>
        {/* Business Logo — the single source for invoices, emails, booking
            pages, smart links and the website. Spans both columns: the
            uploader, its hint and its checkbox need the room. */}
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL}>{t('settings.business.logo')}</label>
          <div className="flex items-start gap-3 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={FIELD_RADIUS}>
            <div className="shrink-0">
              <MediaUploader
                value={branding.logo_url}
                onChange={(url) => saveBranding({ logo_url: url })}
                onRemove={() => saveBranding({ logo_url: null })}
                folder={`${user?.id || 'shared'}/logos`}
                placeholder=""
                previewClassName="w-16 h-16 rounded-lg"
                showUrlInput={false}
                disabled={savingBranding}
              />
            </div>
            {/* min-w-0 lets the hint wrap inside the row instead of forcing
                it wider; the checkbox keeps its own line and never splits
                from its label. */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--v2-text-secondary)] leading-snug">
                {t('settings.business.logo_hint')}
              </p>
              <label className="mt-2 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={branding.show_logo_on_smart_links}
                  onChange={(e) => saveBranding({ show_logo_on_smart_links: e.target.checked })}
                  disabled={savingBranding}
                  className="w-3.5 h-3.5 mt-0.5 shrink-0 accent-[#D14E97]"
                />
                <span className="text-xs text-[var(--v2-text-secondary)] leading-snug">
                  {t('settings.business.logo_on_smart_links')}
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Company Name */}
        <div>
          <label className={FIELD_LABEL}>{t('settings.business.org_name')}</label>
          <div className="relative">
            <Building2 className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
            <input
              type="text"
              value={businessProfile.company_name || orgSettings.name}
              onChange={(e) => {
                setBusinessProfile(b => ({ ...b, company_name: e.target.value }));
                setOrgSettings(o => ({ ...o, name: e.target.value }));
              }}
              placeholder={t('settings.business.org_name_placeholder')}
              className={`${FIELD_BASE} ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
              style={FIELD_RADIUS}
            />
          </div>
        </div>

        {/*
          The business's own website, for a business that has one.

          Sits with the identity fields rather than with the public contact
          details below: those are what a CLIENT uses to reach the business,
          while this is a fact about the business that happens to be
          published. It reaches the public contact page, the email branding,
          and — only when there is no bookable page anywhere on this platform
          — a booking email's "book again" link.
        */}
        <div>
          <label className={FIELD_LABEL}>{t('settings.business.website')}</label>
          <input
            type="url"
            inputMode="url"
            value={businessProfile.website_url}
            onChange={(e) => setBusinessProfile(b => ({ ...b, website_url: e.target.value }))}
            placeholder="https://example.com"
            // Latin script, left to right, even in Hebrew: a URL is not
            // prose, and mirroring it puts the scheme on the wrong end.
            dir="ltr"
            className={`${FIELD_BASE} px-3`}
            style={FIELD_RADIUS}
          />
          <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 leading-snug">
            {t('settings.business.website_hint')}
          </p>
        </div>

        {/* What the business does, as it described itself.
            Shown here because this is the text the website generator writes a
            homepage from, and the invoices and emails inherit its tone — so it
            has to be readable and correctable somewhere. Full width: it is
            prose, and a half-width box invites a one-line answer. */}
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL}>{t('settings.business.description')}</label>
          <textarea
            value={businessProfile.description}
            onChange={(e) => setBusinessProfile(b => ({ ...b, description: e.target.value }))}
            rows={3}
            placeholder={t('settings.business.description_placeholder')}
            className={`${FIELD_BASE} px-3 resize-none ${isRTL ? 'text-right' : ''}`}
            style={FIELD_RADIUS}
          />
          <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 leading-snug">
            {t('settings.business.description_hint')}
          </p>
        </div>
      </FormSection>

      {/*
        What a client uses to reach this business.

        The only fields on this screen a CUSTOMER ever sees: they appear on the
        booking-management page, the intake confirmation, the smart-link pages
        and the invoice. Grouped and labelled as public so it is clear these
        are published, not internal record-keeping.
      */}
      <FormSection title={t('settings.business.public_contact')}>
        {/* Phone: country selector + number.
            The country code is not decoration — a number stored without one
            cannot become a WhatsApp link, and a plain text field is how
            businesses end up saving `054-1234567` and wondering why the
            WhatsApp row never appears. `PhoneInput` keeps the value in E.164. */}
        <div>
          <label htmlFor="business-phone" className={FIELD_LABEL}>
            {t('settings.business.phone')}
          </label>
          {/* A phone number is Latin digits and reads left-to-right even on a
              Hebrew form. */}
          <div className="flex gap-2" dir="ltr">
            <SearchableCountrySelect
              value={phoneCountry}
              onChange={changePhoneCountry}
              labels={phoneCountryLabels}
            />
            <PhoneInput
              id="business-phone"
              international
              countryCallingCodeEditable={false}
              country={phoneCountry}
              /* The stored value, not a derived one — see `normalizePhone`. */
              value={businessProfile.phone || undefined}
              onChange={(value) =>
                setBusinessProfile(b => ({ ...b, phone: value || '' }))
              }
              className="phone-input-settings flex-1 min-w-0"
            />
          </div>
        </div>

        <div>
          <label htmlFor="business-email" className={FIELD_LABEL}>
            {t('settings.business.public_email')}
          </label>
          <div className="relative">
            <Mail className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
            <input
              id="business-email"
              type="email"
              dir="ltr"
              value={businessProfile.email}
              onChange={(e) => setBusinessProfile(b => ({ ...b, email: e.target.value }))}
              placeholder="hello@yourbusiness.co.il"
              className={`${FIELD_BASE} ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
              style={FIELD_RADIUS}
            />
          </div>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="business-address" className={FIELD_LABEL}>
            {t('settings.business.public_address')}
          </label>
          <div className="relative">
            <MapPin className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
            <input
              id="business-address"
              type="text"
              /*
               * Follows what is typed, rather than the interface.
               *
               * An address is the one field here that can legitimately be in
               * either script — a Hebrew business writes "רחוב דיזנגוף 50, תל
               * אביב" but may equally write an English address for foreign
               * clients. Pinning it to the interface direction mis-renders
               * whichever case does not match; `auto` picks the direction from
               * the first strong character, so both read correctly and the
               * field flips as the owner types.
               */
              dir="auto"
              value={businessProfile.address}
              onChange={(e) => setBusinessProfile(b => ({ ...b, address: e.target.value }))}
              placeholder={t('settings.business.public_address_placeholder')}
              className={`${FIELD_BASE} ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
              style={FIELD_RADIUS}
            />
          </div>
          <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 leading-snug">
            {t('settings.business.public_contact_hint')}
          </p>
        </div>
      </FormSection>

      <FormSection title={t('settings.business.section_profile')}>
        {/* Industry Dropdown */}
        <div className="relative">
          <label className={FIELD_LABEL}>{t('settings.business.industry')}</label>
          <button
            onClick={() => setOpenDropdown(openDropdown === 'industry' ? null : 'industry')}
            className={`${FIELD_BASE} px-3 flex items-center justify-between hover:bg-[var(--v2-surface)]`}
            style={FIELD_RADIUS}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Briefcase className="w-4 h-4 shrink-0 text-[var(--v2-text-muted)]" />
              <span className={`truncate ${orgSettings.industry ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}`}>
                {industryOptions.find(i => i.value === orgSettings.industry)?.label || t('settings.business.industry_placeholder')}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'industry' ? 'rotate-180' : ''}`} />
          </button>
          {openDropdown === 'industry' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                {industryOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setOrgSettings(o => ({ ...o, industry: opt.value })); setOpenDropdown(null); }}
                    className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.industry === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {orgSettings.industry === opt.value && <Check className="w-4 h-4 shrink-0" style={{ color: CONFIG_ACCENT }} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Company Size Dropdown */}
        <div className="relative">
          <label className={FIELD_LABEL}>{t('settings.business.company_size')}</label>
          <button
            onClick={() => setOpenDropdown(openDropdown === 'company_size' ? null : 'company_size')}
            className={`${FIELD_BASE} px-3 flex items-center justify-between hover:bg-[var(--v2-surface)]`}
            style={FIELD_RADIUS}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Users className="w-4 h-4 shrink-0 text-[var(--v2-text-muted)]" />
              <span className={`truncate ${orgSettings.company_size ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}`}>
                {companySizeOptions.find(s => s.value === orgSettings.company_size)?.label || t('settings.business.company_size_placeholder')}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'company_size' ? 'rotate-180' : ''}`} />
          </button>
          {openDropdown === 'company_size' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                {companySizeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setOrgSettings(o => ({ ...o, company_size: opt.value })); setOpenDropdown(null); }}
                    className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.company_size === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {orgSettings.company_size === opt.value && <Check className="w-4 h-4 shrink-0" style={{ color: CONFIG_ACCENT }} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Primary Goal Dropdown */}
        <div className="relative">
          <label className={FIELD_LABEL}>{t('settings.business.primary_goal')}</label>
          <button
            onClick={() => setOpenDropdown(openDropdown === 'primary_goal' ? null : 'primary_goal')}
            className={`${FIELD_BASE} px-3 flex items-center justify-between hover:bg-[var(--v2-surface)]`}
            style={FIELD_RADIUS}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Target className="w-4 h-4 shrink-0 text-[var(--v2-text-muted)]" />
              <span className={`truncate ${orgSettings.primary_goal ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}`}>
                {primaryGoalOptions.find(g => g.value === orgSettings.primary_goal)?.label || t('settings.business.primary_goal_placeholder')}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'primary_goal' ? 'rotate-180' : ''}`} />
          </button>
          {openDropdown === 'primary_goal' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                {primaryGoalOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setOrgSettings(o => ({ ...o, primary_goal: opt.value })); setOpenDropdown(null); }}
                    className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.primary_goal === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {orgSettings.primary_goal === opt.value && <Check className="w-4 h-4 shrink-0" style={{ color: CONFIG_ACCENT }} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Technical Level Dropdown */}
        <div className="relative">
          <label className={FIELD_LABEL}>{t('settings.business.technical_level')}</label>
          <button
            onClick={() => setOpenDropdown(openDropdown === 'technical_level' ? null : 'technical_level')}
            className={`${FIELD_BASE} px-3 flex items-center justify-between hover:bg-[var(--v2-surface)]`}
            style={FIELD_RADIUS}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Users className="w-4 h-4 shrink-0 text-[var(--v2-text-muted)]" />
              <span className={`truncate ${orgSettings.technical_level ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}`}>
                {technicalLevelOptions.find(l => l.value === orgSettings.technical_level)?.label || t('settings.business.technical_level_placeholder')}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'technical_level' ? 'rotate-180' : ''}`} />
          </button>
          {openDropdown === 'technical_level' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                {technicalLevelOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setOrgSettings(o => ({ ...o, technical_level: opt.value })); setOpenDropdown(null); }}
                    className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.technical_level === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {orgSettings.technical_level === opt.value && <Check className="w-4 h-4 shrink-0" style={{ color: CONFIG_ACCENT }} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Work Hours Per Day — a two-digit number, so it does not get a
            column of its own to stretch into. */}
        <div>
          <label className={FIELD_LABEL}>{t('settings.business.work_hours')}</label>
          <div className="relative max-w-[10rem]">
            <Clock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
            <input
              type="number"
              min="1"
              max="24"
              value={orgSettings.work_hours_per_day}
              onChange={(e) => setOrgSettings(o => ({
                ...o,
                work_hours_per_day: Math.min(24, Math.max(1, parseInt(e.target.value) || 8)),
              }))}
              className={`${FIELD_BASE} ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
              style={FIELD_RADIUS}
            />
          </div>
          <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 leading-snug">
            {t('settings.business.work_hours_hint')}
          </p>
        </div>
      </FormSection>

      {/* Read-only Business Profile from Onboarding */}
      {(businessProfile.website_url || businessProfile.clients_per_week > 0 || businessProfile.revenue_tier || businessProfile.vertical) && (
        <div className="pt-4 border-t border-[var(--v2-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--v2-text-muted)] mb-2">
            {t('settings.business.profile_subtitle')}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {businessProfile.vertical && (
              <div className="p-2 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={FIELD_RADIUS}>
                <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.vertical')}</p>
                <p className="text-xs font-medium text-[var(--v2-text-primary)]">
                  {/* Was the raw column value with underscores swapped for
                      spaces, so a Hebrew account read "tutor". */}
                  {getVerticalLabel(businessProfile.vertical, language)}
                </p>
              </div>
            )}
            {businessProfile.website_url && (
              <div className="p-2 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={FIELD_RADIUS}>
                <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.website')}</p>
                <a
                  href={businessProfile.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium hover:underline flex items-center gap-1 truncate"
                  style={{ color: CONFIG_ACCENT }}
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate">{businessProfile.website_url.replace(/^https?:\/\//, '')}</span>
                </a>
              </div>
            )}
            {businessProfile.clients_per_week > 0 && (
              <div className="p-2 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={FIELD_RADIUS}>
                <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.clients_per_week')}</p>
                <p className="text-xs font-medium text-[var(--v2-text-primary)]">
                  {businessProfile.clients_per_week}
                </p>
              </div>
            )}
            {businessProfile.revenue_tier && (
              <div className="p-2 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={FIELD_RADIUS}>
                <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.revenue_tier')}</p>
                <p className="text-xs font-medium text-[var(--v2-text-primary)] capitalize">
                  {businessProfile.revenue_tier.replace(/_/g, ' ')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save and its answer, in the frozen bar: this form is taller than the
          dialog, and a confirmation at the end of the document renders where
          the reader is not. */}
      <TabFooter
        message={
          (successMessage && (
            <p className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--v2-success-text)' }}>
              <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-success-icon)' }} />
              {successMessage}
            </p>
          )) ||
          (errorMessage && (
            <p className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--v2-error-text)' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-error-icon)' }} />
              {errorMessage}
            </p>
          )) ||
          null
        }
      >
        <button
          onClick={saveBusiness}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium border transition-all disabled:opacity-50"
          style={configAccentButton}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {t('settings.business.save')}
        </button>
      </TabFooter>

    {/*
      `react-phone-number-input` ships its own class names and its stylesheet
      is imported at the top of this file; without these overrides the field
      renders as a bare browser input beside the design-system controls around
      it.

      The library's own country dropdown is hidden — `SearchableCountrySelect`
      is the picker this product uses, and two country selectors on one field
      is worse than either alone.
    */}
    <style jsx global>{`
      .phone-input-settings {
        display: flex;
      }

      .phone-input-settings .PhoneInputCountry {
        display: none;
      }

      .phone-input-settings .PhoneInputInput {
        flex: 1;
        background: var(--v2-bg);
        border: 1px solid var(--v2-border);
        border-radius: var(--v2-radius-button);
        padding: 0.625rem 0.75rem;
        color: var(--v2-text-primary);
        font-size: 0.875rem;
        outline: none;
        transition: all 0.2s ease;
      }

      .phone-input-settings .PhoneInputInput:focus {
        border-color: var(--v2-primary);
      }

      .phone-input-settings .PhoneInputInput::placeholder {
        color: var(--v2-text-muted);
      }
    `}</style>
    </div>
  );
}
