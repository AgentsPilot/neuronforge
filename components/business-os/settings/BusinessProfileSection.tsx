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

import React, { useState, useEffect, useMemo } from 'react';
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
  Store,
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
import {
  getVerticalLabel,
  isKnownVertical,
  SELECTABLE_VERTICALS,
} from '@/lib/business-os/verticalLabels';
import { CONFIG_ACCENT, configAccentButton } from '@/components/business-os/configAccent';
import { TabFooter } from '@/components/business-os/settings/TabFooter';
import { RequiredMark, RequiredStrip } from '@/components/business-os/settings/RequiredMark';
import { missingProfileFields } from '@/lib/business-os/setup/profileReadiness';
import { industryForVertical } from '@/lib/business-os/setup/industryForVertical';
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

/**
 * The business-type picker's value for "none of these is what we are".
 *
 * Not a vertical and never stored as one: it selects the free-text field, whose
 * answer goes to `organizations.settings.business_type` while the pipeline key
 * stays on the generic preset. Prefixed so it cannot collide with a real key —
 * `other` would have, and `other` is one of the two sentinels this whole change
 * exists to stop treating as an answer.
 */
const OWN_WORDS = '__own_words__';

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
  /*
   * The organisation's four answers. NOT its name.
   *
   * `organizations.name` is a TENANCY LABEL, not the business name, and this
   * form used to write the business name into it as well. One fact in two
   * columns is what produced the bug above: the field offered whichever was
   * non-empty, which on a chat-built account is the label — and the label is
   * seeded with the ACCOUNT EMAIL by `get_or_create_user_organization`, so an
   * owner who had not saved yet was shown their own email as their business
   * name.
   *
   * `business_profiles.company_name` is the single answer, and it is the one
   * every reader that matters already used: the invoice, the booking page, the
   * outbound mail, `missingProfileFields`. Nothing on the server reads the
   * label at all — every other query against that row asks for `settings` or
   * `id` — so it is left as signup wrote it.
   */
  const [orgSettings, setOrgSettings] = useState({
    industry: '',
    company_size: '',
    primary_goal: '',
    technical_level: '',
    work_hours_per_day: 8,
    /**
     * What the owner calls their business, when our preset list has no word for
     * it. Stored in `organizations.settings`, not on the profile: the profile's
     * `vertical` is a pipeline key and this is prose. See the field's note in
     * `profileReadiness`.
     */
    business_type: '',
  });

  // Organization ID for updates
  const [orgId, setOrgId] = useState<string | null>(null);
  const [businessLoaded, setBusinessLoaded] = useState(false);

  /**
   * Which business type the picker is showing.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT JUST `businessProfile.vertical`.
   *
   * The picker has to tell three states apart and that column can only hold
   * two of them: a preset trade, our fallback, and "none of these, here is
   * what we are". The last of those lives in `organizations.settings
   * .business_type` — prose, which is not a pipeline key — so the control reads
   * from both and this says which of them is in front of the owner.
   *
   * Empty means nothing has been chosen, which is the state that made the
   * dashboard ask: before this control existed, a business the preset list
   * could not describe was stuck on `default` for ever, shown as "Service
   * Provider" in this very section, and reported missing one screen away.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [businessTypeChoice, setBusinessTypeChoice] = useState<string>('');

  /**
   * Does this value carry any digits beyond its calling code?
   *
   * `parsePhoneNumber` throws on some inputs rather than returning undefined —
   * every other call in this file wraps it for that reason — and a save must
   * never fail over a question this cheap. The fallback strips a leading `+`
   * and the longest calling code it could be, then asks whether anything is
   * left.
   */
  const hasNationalDigits = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;

    try {
      const parsed = parsePhoneNumber(trimmed);
      if (parsed?.nationalNumber) return true;
    } catch {
      /* Falls through to the digit test below. */
    }

    /* Calling codes are one to three digits, so anything longer than four
       characters after the `+` has national digits in it. */
    return trimmed.replace(/\D/g, '').length > 3;
  };

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
      /*
       * ───────────────────────────────────────────────────────────────────────
       * AN EMPTY FIELD GETS THE CALLING CODE, and this line is the bug fix.
       *
       * It used to return unchanged when there was no number yet, which looks
       * harmless and is not: `PhoneInput` runs in `international` mode, where
       * the box holds a full `+…` number and `country` is only the DEFAULT for
       * parsing. Picking a country therefore moved the flag and wrote nothing,
       * leaving the box empty — so the first digits typed were read as the
       * start of an international number.
       *
       * Reported exactly that way: pick the United States, type 20…, and the
       * field shows `+20` — Egypt — because "20" is a calling code and there
       * was no `+1` in front of it for the digits to attach to.
       *
       * Seeding `+1` makes the next keystroke a NATIONAL digit, which is what
       * the owner is typing. `saveBusiness` drops a value that never grew past
       * its prefix, so a country picked and then abandoned stores nothing.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (!b.phone.trim()) return { ...b, phone: `+${getCallingCode(country)}` };

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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE FIELD OPENS READY TO TYPE INTO.
   *
   * `PhoneInput` is in `international` mode, so an empty box has nothing for
   * digits to attach to and the first ones typed are read as a calling code —
   * type 20 and the field becomes `+20`, Egypt. `changePhoneCountry` seeds the
   * code when a country is PICKED, which left one case: the owner who never
   * touches the picker because the flag beside the box is already right.
   *
   * Reported as "the phone number has no +1 so I need to reselect the country".
   *
   * Once, when the load finishes, and only into an empty field: a stored number
   * is never touched, and the seed is not an answer — `hasNationalDigits` keeps
   * a bare prefix out of the save and out of the required-field count.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (!businessLoaded) return;
    setBusinessProfile(b =>
      b.phone.trim() ? b : { ...b, phone: `+${getCallingCode(phoneCountry)}` }
    );
    /* `phoneCountry` is deliberately not a dependency: changing it is the
       picker's job, and re-running here would fight `changePhoneCountry`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessLoaded]);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const [businessRes, orgRes, brandingRes] = await Promise.all([
          supabase.from('business_profiles').select('vertical, sub_vertical, company_name, description, website_url, clients_per_week, revenue_tier, phone, email, address, address_parts, extracted_data, website_analysis').eq('user_id', user.id).maybeSingle(),
          /* `name` deliberately not selected — see the `orgSettings` comment. */
          supabase.from('organizations').select('id, settings').eq('owner_user_id', user.id).maybeSingle(),
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
          /*
           * ───────────────────────────────────────────────────────────────────
           * THE ACCOUNT'S OWN EMAIL AS THE PREFILL, never a blank box.
           *
           * This is the address a CLIENT writes to, so it is genuinely a
           * different fact from the one they sign in with — and for most of the
           * businesses this product onboards they are the same address. Nothing
           * in onboarding asks for it, so the field opened empty on a step that
           * now REQUIRES it, which is a question with an obvious answer sitting
           * one table away.
           *
           * A PREFILL, not a write: it appears in the box, the owner sees it,
           * and saving the form is what stores it. An owner who publishes from
           * a different address clears it and types theirs, the same as any
           * other suggested value on this screen.
           * ───────────────────────────────────────────────────────────────────
           */
          email: businessRes.data.email || user?.email || '',
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
      } else if (user?.email) {
        /*
         * NO PROFILE ROW YET, and the account's email is still the best answer.
         *
         * `maybeSingle` returns null for an account whose profile has not been
         * created — which is every account between signing up and finishing
         * the build. The branch above never runs for them, so without this the
         * prefill would reach exactly the owners who have typed the least.
         */
        setBusinessProfile(b => ({ ...b, email: user.email as string }));
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
          /*
           * Derived from the trade when nothing is stored — see
           * `industryForVertical`. A barber should not have to translate "I cut
           * hair" into a market category to satisfy a required field, and the
           * answer is already in `vertical`.
           *
           * Only when EMPTY: an owner's own pick is never overwritten, and a
           * vertical we could not read derives nothing.
           */
          industry:
            (settings.industry as string)
            || industryForVertical(businessRes.data?.vertical)
            || '',
          company_size: (settings.company_size as string) || '',
          primary_goal: (settings.primary_goal as string) || '',
          technical_level: (settings.technical_level as string) || '',
          work_hours_per_day: (settings.work_hours_per_day as number) || 8,
          business_type: (settings.business_type as string) || '',
        });
      }

      /*
       * The picker's state: the two columns read together — the preset key when
       * it is a real answer, the owner's own words when they gave some, and
       * otherwise nothing, which is what "not set" means.
       *
       * OUTSIDE the organisation block deliberately. Every account built by the
       * onboarding chat has no `organizations` row — the comment on the save
       * path records that, and it is why the four answers beside this one are
       * written through the API — so initialising in there would leave the
       * picker reading "not set" for a business whose trade we know perfectly
       * well, on exactly the accounts this screen matters most for.
       */
      const ownWords = (
        ((orgRes.data?.settings || {}) as Record<string, unknown>).business_type as string | undefined
      )?.trim();

      setBusinessTypeChoice(
        isKnownVertical(businessRes.data?.vertical)
          ? (businessRes.data!.vertical as string)
          : ownWords
            ? OWN_WORDS
            : ''
      );
    } catch (error) {
        logger.error({ err: error }, 'Failed to load the business profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  /**
   * The business types on offer, named in the reader's language.
   *
   * Sorted by the LABEL rather than by the key, because the keys are English
   * and two of the three interfaces are not: alphabetised by key, a Hebrew
   * picker would run in an order with no relation to the words on screen.
   * "Something else" is pinned last — it is the way out of the list, not a
   * member of it.
   */
  const verticalOptions = useMemo(
    () => [
      ...SELECTABLE_VERTICALS
        .map(value => ({ value, label: getVerticalLabel(value, language) }))
        .sort((a, b) => a.label.localeCompare(b.label, language)),
      { value: OWN_WORDS, label: t('settings.business.vertical_own_words') },
    ],
    [language, t]
  );

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE TRADES THIS PRODUCT ACTUALLY ONBOARDS.
   *
   * This list read `b2b_saas`, `ecommerce`, `manufacturing`, `finance`,
   * `nonprofit` — a B2B software company's categories, on a screen whose
   * `vertical` picker two fields above offers hairdresser, contractor, dentist
   * and dog groomer. A barber choosing an industry had one honest answer
   * available and it was "Other", and the two fields disagreed about what kind
   * of business this is while sitting in the same section.
   *
   * Ten categories that cover all twenty-nine verticals, named the way an owner
   * would describe themselves rather than the way a market analyst would.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const industryOptions = [
    { value: 'professional_services', label: t('settings.industry.professional_services') },
    { value: 'health', label: t('settings.industry.health') },
    { value: 'beauty', label: t('settings.industry.beauty') },
    { value: 'fitness', label: t('settings.industry.fitness') },
    { value: 'education', label: t('settings.industry.education') },
    { value: 'home_trades', label: t('settings.industry.home_trades') },
    { value: 'events', label: t('settings.industry.events') },
    { value: 'pet_services', label: t('settings.industry.pet_services') },
    { value: 'retail', label: t('settings.industry.retail') },
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
          /*
           * A BARE CALLING CODE IS NOT A PHONE NUMBER.
           *
           * Choosing a country seeds `+1` so the next keystroke is a national
           * digit (see `changePhoneCountry`). An owner who picks a country and
           * then types nothing must not have `+1` stored and counted as an
           * answer — `missingProfileFields` only asks whether the column holds
           * something, so a prefix would satisfy a required field with no way
           * for a client to call.
           */
          phone: hasNationalDigits(businessProfile.phone) ? businessProfile.phone.trim() : '',
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
            /* No `name`: the business name is `company_name`, written by the
               upsert above. This row carries the four answers and nothing the
               owner thinks of as their business name. */
            // Null, not undefined: an answer the owner cleared has to be
            // cleared on the row, and an undefined field is dropped by JSON
            // before it ever reaches the server.
            industry: orgSettings.industry || null,
            company_size: orgSettings.company_size || null,
            primary_goal: orgSettings.primary_goal || null,
            technical_level: orgSettings.technical_level || null,
            work_hours_per_day: orgSettings.work_hours_per_day,
            /* Only meaningful when the picker is on "something else"; cleared
               otherwise, so a preset chosen afterwards does not leave stale
               prose standing beside it as a second answer. */
            business_type:
              businessTypeChoice === OWN_WORDS
                ? orgSettings.business_type.trim() || null
                : null,
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

  /*
   * WHAT IS STILL MANDATORY, asked of the rule rather than written out here.
   *
   * `missingProfileFields` is the function the readiness card, the publish gate
   * and `journeyReadiness` all read, so the asterisks below and the dashboard
   * cannot disagree about what this business owes. Run against the values
   * CURRENTLY IN THE FORM, not the ones last saved, so a mark clears as the
   * owner types rather than after a round trip.
   *
   * `business_type` is resolved exactly as `saveBusiness` resolves it — the
   * typed words count only while "something else" is the chosen preset — so the
   * mark describes what the save will actually store.
   */
  const missingRequired = useMemo(
    () =>
      missingProfileFields(
        {
          company_name: businessProfile.company_name,
          vertical: businessProfile.vertical,
          /* Public contact details, gates since nothing in onboarding asks for
             them. See `ProfileField`.
             `hasNationalDigits`, not the raw value: the field is seeded with a
             calling code so it can be typed into, and `+1` on its own is not a
             number a client can call. */
          phone: hasNationalDigits(businessProfile.phone) ? businessProfile.phone : '',
          email: businessProfile.email,
        },
        {
          industry: orgSettings.industry,
          company_size: orgSettings.company_size,
          primary_goal: orgSettings.primary_goal,
          technical_level: orgSettings.technical_level,
          business_type:
            businessTypeChoice === OWN_WORDS ? orgSettings.business_type.trim() || null : null,
        }
      ),
    [
      businessProfile.company_name,
      businessProfile.vertical,
      businessProfile.phone,
      businessProfile.email,
      orgSettings.industry,
      orgSettings.company_size,
      orgSettings.primary_goal,
      orgSettings.technical_level,
      orgSettings.business_type,
      businessTypeChoice,
    ]
  );

  /* What the rule asks for: the six that describe the business, plus the two
     that say how to reach it. */
  const REQUIRED_TOTAL = 8;

  /** The name THIS form puts on a field, shared with the dashboard's list. */
  const fieldLabel = (field: string): string => t(`setup.field.${field}`) || field;

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

      {/*
        What is mandatory, in the same words the dashboard uses.
        ───────────────────────────────────────────────────────────────────────
        The six marked fields are spread over two sections below, so the list
        goes at the top: an owner arriving from "Still needs: Business name ·
        Industry" sees the same two names here and an asterisk on each box.
        Everything unmarked is genuinely optional, which is the other half of
        what this says.
      */}
      <RequiredStrip
        missing={missingRequired}
        total={REQUIRED_TOTAL}
        labelFor={fieldLabel}
        stillNeedsLabel={t('readiness.stillNeeds')}
        doneLabel={t('settings.required.allSet')}
        note={t('settings.required.note')}
      />

      <FormSection title={t('settings.business.section_identity')}>
        {/* Company Name */}
        <div>
          <label className={FIELD_LABEL}>
            {t('settings.business.org_name')}
            <RequiredMark reason={t('settings.required.company_name')} />
          </label>
          <div className="relative">
            <Building2 className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
            {/*
              ───────────────────────────────────────────────────────────────
              ONE FACT, ONE COLUMN.

              This read `company_name || orgSettings.name`, and the two are not
              the same thing. `organizations.name` is a TENANCY LABEL: the row
              is created the first time anything needs an `org_id`, long before
              anybody is asked what the business is called, and because the
              column is NOT NULL it is seeded with the account's EMAIL ADDRESS
              — see `get_or_create_user_organization`.

              So the fallback showed two wrong things at different times. On a
              new account it offered the owner their own email as their company
              name. On an account whose profile had been cleared it showed a
              name that `missingProfileFields` — which reads `company_name`
              alone, as do the invoice, the booking page and every email —
              correctly reported as missing. The field said one thing and the
              readiness row beside it said the opposite, and both were right
              about different columns.

              `company_name` is the owner's answer. An empty one shows the
              placeholder, which asks the question rather than pretending it
              has been answered.

              Nothing is lost by dropping the fallback: the save below writes
              BOTH columns, so any name entered through this form is already in
              `company_name`. The only path that wrote the org row alone was
              the browser-direct one this route replaced, and the comment on
              `business-profile/route.ts` records that it silently stored
              nothing at all.
              ───────────────────────────────────────────────────────────────
            */}
            <input
              type="text"
              value={businessProfile.company_name}
              onChange={(e) => {
                setBusinessProfile(b => ({ ...b, company_name: e.target.value }));
                /* Still written to both: the org row keeps a human label
                   instead of an email once there is a real name to give it. */
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

        {/* Business Logo — the single source for invoices, emails, booking
            pages, smart links and the website. Spans both columns: the
            uploader, its hint and its checkbox need the room.

            AFTER the name and the website, not before them. It led the
            section and was the first thing an owner met on this screen —
            an upload box, optional, in front of the two required fields
            the form exists to collect. The mandatory answers come first
            now, and the picture follows them. */}
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
            <RequiredMark reason={t('settings.required.phone')} />
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
            <RequiredMark reason={t('settings.required.email')} />
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
        {/*
          ── BUSINESS TYPE ─────────────────────────────────────────────────────
          The field the dashboard asks for, and until now the only one on that
          readiness row with nowhere to answer it. `vertical` was written by the
          onboarding extraction and displayed read-only; a business the preset
          list could not place sat on `default` for ever, was printed here as
          "Service Provider", and was reported missing one screen away.

          Two controls because there are two different answers. The picker sets
          `vertical`, which is a pipeline key. "Something else" takes the
          owner's own words instead and leaves the pipeline generic, because
          inventing a key out of typed prose is how somebody ends up with stages
          they never chose.
        */}
        <div className="relative">
          <label className={FIELD_LABEL}>
            {t('settings.business.vertical')}
            <RequiredMark reason={t('settings.required.business_type')} />
          </label>
          <button
            onClick={() => setOpenDropdown(openDropdown === 'vertical' ? null : 'vertical')}
            className={`${FIELD_BASE} px-3 flex items-center justify-between hover:bg-[var(--v2-surface)]`}
            style={FIELD_RADIUS}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Store className="w-4 h-4 shrink-0 text-[var(--v2-text-muted)]" />
              <span className={`truncate ${businessTypeChoice ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}`}>
                {businessTypeChoice === OWN_WORDS
                  ? t('settings.business.vertical_own_words')
                  : businessTypeChoice
                    ? getVerticalLabel(businessTypeChoice, language)
                    : t('settings.business.vertical_placeholder')}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'vertical' ? 'rotate-180' : ''}`} />
          </button>
          {openDropdown === 'vertical' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg max-h-48 overflow-y-auto scrollbar-thin" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                {verticalOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setBusinessTypeChoice(opt.value);
                      /*
                       * A trade chosen from the list IS the pipeline key. The
                       * own-words option deliberately moves the column to the
                       * fallback instead: leaving a previously chosen trade
                       * standing there would satisfy the readiness gate with a
                       * value the owner has just told us is wrong.
                       */
                      setBusinessProfile(b => ({
                        ...b,
                        vertical: opt.value === OWN_WORDS ? 'default' : opt.value,
                      }));
                      setOpenDropdown(null);
                    }}
                    className={`w-full px-3 py-2.5 text-sm text-[var(--v2-text-primary)] flex items-center justify-between hover:bg-[var(--v2-bg)] ${businessTypeChoice === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {businessTypeChoice === opt.value && <Check className="w-4 h-4 shrink-0" style={{ color: CONFIG_ACCENT }} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {businessTypeChoice === OWN_WORDS && (
          <div>
            <label className={FIELD_LABEL}>{t('settings.business.vertical_describe')}</label>
            <input
              type="text"
              value={orgSettings.business_type}
              onChange={(e) => setOrgSettings(o => ({ ...o, business_type: e.target.value }))}
              placeholder={t('settings.business.vertical_describe_placeholder')}
              maxLength={100}
              className={`${FIELD_BASE} px-3`}
              style={FIELD_RADIUS}
            />
            <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 leading-snug">
              {t('settings.business.vertical_describe_hint')}
            </p>
          </div>
        )}

        {/* Industry Dropdown */}
        <div className="relative">
          <label className={FIELD_LABEL}>
            {t('settings.business.industry')}
            <RequiredMark reason={t('settings.required.industry')} />
          </label>
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
                    className={`w-full px-3 py-2.5 text-sm text-[var(--v2-text-primary)] flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.industry === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
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
          <label className={FIELD_LABEL}>
            {t('settings.business.company_size')}
            <RequiredMark reason={t('settings.required.company_size')} />
          </label>
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
                    className={`w-full px-3 py-2.5 text-sm text-[var(--v2-text-primary)] flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.company_size === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
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
          <label className={FIELD_LABEL}>
            {t('settings.business.primary_goal')}
            <RequiredMark reason={t('settings.required.primary_goal')} />
          </label>
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
                    className={`w-full px-3 py-2.5 text-sm text-[var(--v2-text-primary)] flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.primary_goal === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
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
          <label className={FIELD_LABEL}>
            {t('settings.business.technical_level')}
            <RequiredMark reason={t('settings.required.technical_level')} />
          </label>
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
                    className={`w-full px-3 py-2.5 text-sm text-[var(--v2-text-primary)] flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.technical_level === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
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
      {(businessProfile.website_url || businessProfile.clients_per_week > 0 || businessProfile.revenue_tier || isKnownVertical(businessProfile.vertical)) && (
        <div className="pt-4 border-t border-[var(--v2-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--v2-text-muted)] mb-2">
            {t('settings.business.profile_subtitle')}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/*
              A SENTINEL IS NOT SHOWN HERE AT ALL.

              This printed `getVerticalLabel('default')` — "Service Provider" —
              for a business whose trade had never been read, so the owner saw a
              business type in settings while the dashboard reported that same
              field missing. The label function now returns nothing for a
              sentinel; the tile is gated on the same question so it does not
              render an empty row instead. What is set is set in the picker
              above, which is where it can also be changed.
            */}
            {isKnownVertical(businessProfile.vertical) && (
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
