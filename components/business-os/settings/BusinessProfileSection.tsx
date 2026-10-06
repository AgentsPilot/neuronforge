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
import { CountrySelect } from '@/components/ui/CountrySelect';
import { AdminAreaField } from '@/components/ui/AdminAreaField';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { SavedAddressPicker } from '@/components/ui/SavedAddressPicker';
import { legacyCountryToCode } from '@/lib/geo/countries';
import {
  formatAddressOneLine,
  hasAddressContent,
  type StructuredAddress,
} from '@/lib/geo/address';
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
import { Switch } from '@/components/ui/switch';
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

  /** Which saved address, if any, these fields still represent. */
  /**
   * Which entry in the address book this form is on.
   *
   * An id now, not a source — the book has identity, so "the billing one" is no
   * longer a thing a form can be pointed at. `null` means the owner is adding a
   * new address, which is the one state that shows the fields.
   */
  const [reusedAddress, setReusedAddress] = useState<string | null>(null);
  /** Bumped after a save so the picker refetches and shows a new entry. */
  const [addressBookVersion, setAddressBookVersion] = useState(0);
  /**
   * The saved entry open in the fields for correcting.
   *
   * Separate from the selection: the entry stays MARKED while it is edited, so
   * the list keeps saying which address the form is on. `null` means nothing is
   * being corrected, and the fields then show only for "add a new address".
   */
  const [editingAddress, setEditingAddress] = useState<string | null>(null);


  /** One part of the display address, leaving the rest alone. */
  const updateAddressPart = (field: keyof StructuredAddress, value: string) => {
    // Edited by hand, so it is no longer the saved one.
    setReusedAddress(null);
    setBusinessProfile(b => ({
      ...b,
      address_parts: { ...b.address_parts, [field]: value },
    }));
  };


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
    /*
     * The display address in parts.
     *
     * `address` is kept beside it as the rendered line, because the public
     * pages, the website address block and the privacy policy all read that
     * column as a string. It is composed from these on save, so the two cannot
     * drift apart.
     */
    address_parts: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: '',
    } as StructuredAddress,
    clients_per_week: 0,
    revenue_tier: '',
  });

  /*
   * An address with something in it has to say which country.
   *
   * Not an address that is simply empty — a business that has not filled this in
   * yet must still be able to save the rest of its profile. It is only once
   * there is an address at all that a missing country becomes the gap this
   * change exists to close.
   *
   * Legacy free text does not satisfy it: picking from the list is what turns
   * "Israel" into something the refund disclaimer and tax rules can read.
   */
  const addressCountryMissing =
    hasAddressContent(businessProfile.address_parts) &&
    !legacyCountryToCode(businessProfile.address_parts.country);

  /*
   * The country as a CODE, for the two controls that reason about it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `address_parts.country` can still hold free text — "Israel", "United
   * States" — written before the picker existed. `CountrySelect` copes: an
   * unmatched value falls back to being displayed as typed, so the field looks
   * right either way.
   *
   * `AdminAreaField` does not, and that asymmetry was the bug. It asks
   * `addressRulesFor`, which returns UNKNOWN for anything that is not exactly
   * two characters — so a legacy name produced `adminLabel: null` and the state
   * control rendered as nothing at all. The country picker beside it looked
   * perfectly healthy, which made the missing one read as a styling fault
   * rather than a value this component never translated.
   *
   * `legacyCountryToCode` is the same translation the gap check above already
   * trusts; it was simply never applied to what the fields were handed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const addressCountryCode = legacyCountryToCode(businessProfile.address_parts.country) ?? '';
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
          supabase.from('business_profiles').select('vertical, sub_vertical, company_name, description, website_url, clients_per_week, revenue_tier, phone, email, address, address_parts, extracted_data, website_analysis').eq('user_id', user.id).maybeSingle(),
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
          /*
           * An address that predates the structured form keeps every character,
           * in `line1`.
           *
           * Splitting "2nd floor, above the bakery" into street/city/postcode is
           * a guess, and this line is printed on public pages — so it is moved
           * across whole instead. The rendered result is identical to what
           * clients see today, and the owner can break it up when they next
           * edit. Blanking it would look like their settings had been lost.
           */
          address_parts: hasAddressContent(businessRes.data.address_parts)
            ? { ...businessRes.data.address_parts }
            : { line1: businessRes.data.address || '', country: '' },
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
      /*
       * One request, and the organisation travels with it.
       *
       * The four answers below used to be written straight from the browser,
       * guarded by `if (orgId)` — and an account built by the onboarding chat
       * has no organisation row, because nothing in that path creates one. So
       * the write was skipped, silently, while this function went on to show
       * "Saved". The server now creates the row if it has to, and a failure
       * comes back as a failure.
       */
      const contactResponse = await fetch('/api/business-os/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: businessProfile.phone.trim(),
          email: businessProfile.email.trim(),
          /*
           * BOTH are sent: the parts are the truth, the line is what every
           * public reader already consumes. Composed here rather than in the
           * API so the owner sees exactly the string that will be stored.
           */
          address: formatAddressOneLine(businessProfile.address_parts) ?? '',
          address_parts: businessProfile.address_parts,
          /*
           * WHICH ENTRY these parts belong to, so the server edits the right
           * one.
           *
           * Without it the save falls back to the entry this FORM points at —
           * so opening the billing address with the pencil, correcting it and
           * saving would have rewritten the PROFILE's entry with the billing
           * one's content, and left the billing entry untouched. The exact
           * opposite of what was asked for, silently.
           *
           * `editingAddress` first: it is the entry the owner opened. The
           * selection is the fallback, and `null` means a genuinely new
           * address, which the server then adds to the book.
           */
          address_id: editingAddress ?? reusedAddress,
          organization: {
            name: orgSettings.name,
            // Null, not undefined: an answer the owner cleared has to be
            // cleared on the row, and an undefined field is dropped by JSON
            // before it ever reaches the server.
            industry: orgSettings.industry || null,
            company_size: orgSettings.company_size || null,
            primary_goal: orgSettings.primary_goal || null,
            technical_level: orgSettings.technical_level || null,
            work_hours_per_day: orgSettings.work_hours_per_day,
          },
        }),
      });

      if (!contactResponse.ok) {
        const detail = await contactResponse.json().catch(() => null);
        throw new Error(detail?.error || 'Could not save the contact details');
      }

      // The accordion this used to close no longer exists — the section is a
      // dialog tab now, and collapsing it would hide the confirmation.
      onSaved?.();
      setSuccessMessage(t('settings.business.saved'));
      /* The address may have become a new entry in the book — a fork, or the
         first one this business has saved. Refetch so the picker shows it
         without a page reload. */
      setAddressBookVersion(v => v + 1);
      // The correction is saved; the fields close and the list stands again.
      setEditingAddress(null);

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
                it wider; the toggle keeps its own line and never splits
                from its label. */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--v2-text-secondary)] leading-snug">
                {t('settings.business.logo_hint')}
              </p>
              <div className="mt-2 flex items-start gap-2">
                {/*
                  `dir="ltr"` is non-negotiable: Switch moves its thumb by a fixed
                  rightward `translate-x-[20px]`, so inside an RTL track the thumb
                  starts at the right edge and that shift carries it clean out.
                  The row around it still mirrors.

                  The section's own accent as an inline style, not a class: the
                  shared Switch hardcodes `--v2-primary` in its class list and
                  this project's `cn` is a plain join with no tailwind-merge, so a
                  competing class would leave both on the element and let CSS
                  source order decide. This is the accent the checkbox used.
                */}
                <div dir="ltr" className="mt-0.5 shrink-0">
                  <Switch
                    id="logo-on-smart-links"
                    checked={branding.show_logo_on_smart_links}
                    onCheckedChange={(checked) =>
                      saveBranding({ show_logo_on_smart_links: checked })
                    }
                    disabled={savingBranding}
                    style={
                      branding.show_logo_on_smart_links
                        ? { backgroundColor: CONFIG_ACCENT }
                        : undefined
                    }
                  />
                </div>
                <label
                  htmlFor="logo-on-smart-links"
                  className="text-xs text-[var(--v2-text-secondary)] leading-snug cursor-pointer"
                >
                  {t('settings.business.logo_on_smart_links')}
                </label>
              </div>
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
          {/*
            The business's address book. Renders nothing while it is empty,
            which is the right screen for a business adding its first address:
            the fields below are all it needs.
          */}
          <SavedAddressPicker
            use="profile"
            current={businessProfile.address_parts}
            selectedId={reusedAddress}
            onSelectedChange={(id) => {
              setReusedAddress(id);
              // Choosing a different entry abandons whatever was being
              // corrected, or its fields would stay open under a new selection.
              setEditingAddress(null);
            }}
            onSelect={(address) =>
              setBusinessProfile(b => ({ ...b, address_parts: { ...b.address_parts, ...address } }))
            }
            locale={language}
            isRTL={isRTL}
            t={t}
            refreshKey={addressBookVersion}
            /*
              Editing opens the entry in the fields below, with the selection
              cleared so they are visible. Saving then goes through the same
              path as any other save — which is what keeps the one rule in one
              place rather than giving edit a second opinion.
            */
            onEdit={(option) => {
              setBusinessProfile(b => ({ ...b, address_parts: { ...b.address_parts, ...option.address } }));
              /*
                The entry STAYS SELECTED while it is being corrected.
                Clearing the selection here moved the mark to "add a new
                address", which told the owner they were creating a second
                address when they had asked to fix an existing one — and it is
                not even what happens: saving a correction to an entry only this
                form uses edits it in place. `editingAddress` is what opens the
                fields; the selection says which entry they belong to.
              */
              setEditingAddress(option.id);
            }}
          />

          {/*
            Hidden while a saved address is chosen.

            The fields are the record either way — picking copies into them and
            saving stores them — but showing a form under a chosen answer asks
            the owner to read two statements about one address and work out which
            is true. Choosing "enter a different address" opens them.
          */}
          {(reusedAddress === null || editingAddress !== null) && (
            /*
              ONE CARD, because it is one address.
              ────────────────────────────────────────────────────────────────
              These six controls were loose siblings, each spaced from the last
              with its own `mt-2`. Sitting in a form whose other rows are single
              fields — company name, email, phone — they read as six more
              unrelated settings that happened to land together, and the
              autocomplete at the top looked like a seventh rather than the
              shortcut that fills the other five.

              A surface and a border say what the spacing could not: everything
              inside is one answer. The margins move to `space-y-2` on the
              container so the rhythm comes from one place instead of being
              re-declared on each child.
            */
            <div
              className="mt-2 space-y-2 border border-[var(--v2-border)] bg-[var(--v2-surface)] p-3"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
            {/* Type once, fill the lot. Renders nothing without an API key, and
                the fields below remain the real record either way. */}
            <AddressAutocomplete
              onSelect={(address) => {
                // An address of your own ends the claim that a saved one is here.
                setReusedAddress(null);
                setBusinessProfile(b => ({ ...b, address_parts: { ...b.address_parts, ...address } }));
              }}
              country={businessProfile.address_parts.country}
              language={language}
              isRTL={isRTL}
              placeholder={t('settings.address.lookup') || 'Start typing your address…'}
              hint={t('settings.address.lookup_hint') || undefined}
              className={`${FIELD_BASE}`}
              style={FIELD_RADIUS}
            />

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
                value={businessProfile.address_parts.line1 || ''}
                onChange={(e) => updateAddressPart('line1', e.target.value)}
                placeholder={t('settings.business.public_address_placeholder')}
                className={`${FIELD_BASE} ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
                style={FIELD_RADIUS}
              />
            </div>
            {/*
              The rest of the address.
              ──────────────────────────────────────────────────────────────────
              City, state and postcode stay free text: no package here supplies
              subdivisions, and a hand-written list of states would be exactly the
              invented data this change exists to remove.

              The country is the one that is picked, because it is the one the
              platform reasons about — the refund disclaimer, tax, currency — and
              the only one with a real list behind it.
            */}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                dir="auto"
                value={businessProfile.address_parts.line2 || ''}
                onChange={(e) => updateAddressPart('line2', e.target.value)}
                placeholder={t('settings.business.address_line2') || 'Suite, unit, floor (optional)'}
                className={`${FIELD_BASE} px-3`}
                style={FIELD_RADIUS}
              />
              <input
                type="text"
                dir="auto"
                value={businessProfile.address_parts.city || ''}
                onChange={(e) => updateAddressPart('city', e.target.value)}
                placeholder={t('settings.business.address_city') || 'City'}
                className={`${FIELD_BASE} px-3`}
                style={FIELD_RADIUS}
              />
              {/* Only for countries whose addresses carry one — nothing is
                  rendered for Israel, the UK or most of Europe. */}
              <AdminAreaField
                country={addressCountryCode}
                value={businessProfile.address_parts.state || ''}
                onChange={(value) => updateAddressPart('state', value)}
                label={(key) => t(`settings.address.admin.${key}`) || key}
                searchPlaceholder={t('settings.address.admin_search') || 'Type to search…'}
                emptyLabel={t('settings.address.admin_none') || 'No matches'}
                isRTL={isRTL}
                className={`${FIELD_BASE} px-3`}
                style={FIELD_RADIUS}
              />
              <input
                type="text"
                dir="auto"
                value={businessProfile.address_parts.postal_code || ''}
                onChange={(e) => updateAddressPart('postal_code', e.target.value)}
                placeholder={t('settings.business.address_postal_code') || 'Postal code'}
                className={`${FIELD_BASE} px-3`}
                style={FIELD_RADIUS}
              />
              <div className="col-span-2">
                <CountrySelect
                  value={businessProfile.address_parts.country || ''}
                  onChange={(code) => updateAddressPart('country', code)}
                  locale={language === 'he' ? 'he' : language === 'es' ? 'es' : 'en'}
                  isRTL={isRTL}
                  placeholder={t('settings.business.address_country') || 'Country'}
                  emptyLabel={t('settings.business.address_country_none') || 'No countries found'}
                />
              </div>
            </div>

            {/* Inside the card, under the country it is about — a warning
                floating outside the group would point at nothing. */}
            {addressCountryMissing && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                {t('settings.business.address_country_required') ||
                  'Choose the country for this address.'}
              </p>
            )}
            </div>
          )}

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
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto scrollbar-thin" style={{ borderRadius: 'var(--v2-radius-card)' }}>
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
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto scrollbar-thin" style={{ borderRadius: 'var(--v2-radius-card)' }}>
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
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto scrollbar-thin" style={{ borderRadius: 'var(--v2-radius-card)' }}>
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
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto scrollbar-thin" style={{ borderRadius: 'var(--v2-radius-card)' }}>
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
          disabled={saving || addressCountryMissing}
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
