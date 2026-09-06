'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import {
  ArrowLeft,
  Loader2,
  Globe,
  DollarSign,
  Clock,
  Building2,
  Lock,
  Download,
  Trash2,
  ChevronRight,
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  Pencil,
  X,
  User,
  Briefcase,
  CheckCircle,
  AlertCircle,
  Users,
  Target,
  Sparkles,
  ExternalLink,
  Settings,
  Mail,
  MapPin,
} from 'lucide-react';
import PhoneInput, { getCountryCallingCode, parsePhoneNumber } from 'react-phone-number-input';
import type { Country } from 'react-phone-number-input';
import phoneCountryLabels from 'react-phone-number-input/locale/en';
import 'react-phone-number-input/style.css';
import { SearchableCountrySelect } from '@/components/crm/SearchableCountrySelect';
import { toE164 } from '@/lib/branding/phone';
import { useLanguage } from '@/lib/business-os/LanguageContext';

/**
 * Which country to assume when a stored number has no `+`.
 *
 * Numbers saved before this field existed are bare local strings, and showing
 * one in an E.164 field means guessing. The business's own working language is
 * the least-wrong guess — an Israeli clinic writing Hebrew is not storing a US
 * number — and the owner can correct it with the selector, which is why the
 * selector is there.
 */
const COUNTRY_BY_LANGUAGE: Record<string, Country> = { he: 'IL', es: 'ES', en: 'US' };

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

/** The calling code for a country, or the US as a last resort. */
function getCallingCode(country: Country): string {
  try {
    return getCountryCallingCode(country);
  } catch {
    return '1';
  }
}
import AvatarUpload from '@/components/ui/AvatarUpload';
import { MediaUploader } from '@/components/website/MediaUploader';
import { InvoiceSettingsSection } from '@/components/business-os/settings/InvoiceSettingsSection';
import { getVerticalLabel } from '@/lib/business-os/verticalLabels';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

function BusinessOSSettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { t, isRTL, language, setLanguage, currencyCode, setCurrency, availableCurrencies } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Profile data
  const [profile, setProfile] = useState({
    full_name: '',
    avatar_url: '',
    job_title: '',
    timezone: '',
  });

  /**
   * Persist branding immediately rather than with the rest of the form.
   *
   * Uploading a logo or flipping its visibility is already a deliberate act; if
   * it waited for a Save the user could reasonably believe it had taken effect
   * and leave without it. State is rolled back when the write fails, so the UI
   * never claims a logo the database does not have.
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
    } catch {
      setBranding(previous);
    } finally {
      setSavingBranding(false);
    }
  };

  // Business data (from business_profiles - read only from onboarding)
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

  // The business's logo and where it is allowed to appear. Read from and
  // written to business_profiles; every surface that shows a logo reads it
  // from there — see lib/branding/businessLogo.ts.
  const [branding, setBranding] = useState<{ logo_url: string; show_logo_on_smart_links: boolean }>({
    logo_url: '',
    show_logo_on_smart_links: true,
  });
  const [savingBranding, setSavingBranding] = useState(false);

  // Organization settings (editable)
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

  // Edit states
  const [editingProfile, setEditingProfile] = useState(false);
  /** False until the business profile row has been read — see saveBusiness. */
  const [businessLoaded, setBusinessLoaded] = useState(false);

  /** The country the public phone field composes against. */
  const [phoneCountry, setPhoneCountry] = useState<Country>(
    COUNTRY_BY_LANGUAGE[language] || 'US'
  );

  // Expandable sections
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Password form
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    new: '',
    confirm: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Delete account dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user?.id]);

  /**
   * Open a section directly from a link — `?section=business` or
   * `?section=invoice`, which is how the readiness chips on the dashboard get
   * here. Landing on settings with everything collapsed leaves the reader to
   * hunt for the thing they just clicked.
   *
   * Waits for `loading` to clear. While it is true this page renders a spinner
   * instead of the sections, so an earlier version scrolled to an element that
   * did not exist yet and silently did nothing — which looked fine for the
   * business section near the top and looked broken for the invoice section
   * below the fold.
   *
   * Only the sections that exist are honoured; anything else is ignored rather
   * than opening a panel that isn't there.
   */
  useEffect(() => {
    if (loading) return;

    const requested = searchParams.get('section');
    if (requested !== 'business' && requested !== 'invoice') return;

    setExpandedSection(requested);

    // After paint, so the section has rendered its expanded height and the
    // scroll lands on the open panel rather than where it used to be.
    const timer = setTimeout(() => {
      const target = document.getElementById(`settings-section-${requested}`);
      if (!target) return;

      // Offset by the sticky header, which would otherwise cover the section
      // heading the reader was sent here to find.
      const header = document.querySelector('.sticky');
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 12;

      window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
    }, 100);

    return () => clearTimeout(timer);
  }, [searchParams, loading]);

  const loadData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [profileRes, prefsRes, businessRes, orgRes, brandingRes] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url, job_title').eq('id', user.id).single(),
        supabase.from('user_preferences').select('timezone').eq('user_id', user.id).maybeSingle(),
        supabase.from('business_profiles').select('vertical, sub_vertical, company_name, description, website_url, clients_per_week, revenue_tier, phone, email, address, extracted_data, website_analysis').eq('user_id', user.id).maybeSingle(),
        supabase.from('organizations').select('id, name, settings').eq('owner_user_id', user.id).maybeSingle(),
        // Logo columns arrive with the business-logo migration. Asked for
        // separately because PostgREST rejects an entire select when one named
        // column is absent — folded into the query above, an un-migrated
        // database returned nothing and this whole form loaded blank, which is
        // how saving it could wipe the company name.
        supabase.from('business_profiles').select('logo_url, show_logo_on_smart_links').eq('user_id', user.id).maybeSingle(),
      ]);

      if (profileRes.data) {
        setProfile({
          full_name: profileRes.data.full_name || '',
          avatar_url: profileRes.data.avatar_url || '',
          job_title: profileRes.data.job_title || '',
          timezone: prefsRes.data?.timezone || '',
        });
      }

      // Whether the profile row was actually read. saveBusiness upserts
      // company_name from this state, so saving after a failed load would
      // overwrite a real name with an empty string.
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
        const parsedPhone = savedPhone ? parsePhoneNumber(savedPhone) : undefined;
        if (parsedPhone?.country) setPhoneCountry(parsedPhone.country);
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
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;

    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      await supabase.from('profiles').upsert({
        id: user.id,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        job_title: profile.job_title,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      if (profile.timezone) {
        await supabase.from('user_preferences').upsert({
          user_id: user.id,
          timezone: profile.timezone,
          // Carried even though this save is about the timezone. Without it the
          // upsert CREATES the row, and `preferred_language` lands on its `en`
          // default — which server-side features read as a deliberate choice
          // and used to generate English insights for a Hebrew business.
          preferred_language: language,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      }

      setEditingProfile(false);
      setSuccessMessage(t('settings.profile.saved'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error saving profile:', error);
      setErrorMessage(t('settings.profile.error'));
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!passwordForm.current || !passwordForm.new) {
      setErrorMessage(t('settings.security.password_required'));
      return;
    }
    if (passwordForm.new !== passwordForm.confirm) {
      setErrorMessage(t('settings.security.password_mismatch'));
      return;
    }
    if (passwordForm.new.length < 8) {
      setErrorMessage(t('settings.security.password_short'));
      return;
    }

    try {
      setChangingPassword(true);
      setErrorMessage('');

      const { error } = await supabase.auth.updateUser({ password: passwordForm.new });
      if (error) throw error;

      setSuccessMessage(t('settings.security.password_updated'));
      setPasswordForm({ current: '', new: '', confirm: '' });
      setExpandedSection(null);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error changing password:', error);
      setErrorMessage(t('settings.security.password_error'));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleExportData = async () => {
    if (!user) return;

    try {
      setExporting(true);

      const [profileRes, prefsRes, connectionsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id),
        supabase.from('user_preferences').select('*').eq('user_id', user.id),
        supabase.from('plugin_connections').select('*').eq('user_id', user.id),
      ]);

      const userData = {
        user: { id: user.id, email: user.email },
        profile: profileRes.data?.[0] || null,
        preferences: prefsRes.data?.[0] || null,
        connections: connectionsRes.data || [],
      };

      const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `my-data-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setSuccessMessage(t('settings.security.export_success'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error exporting:', error);
      setErrorMessage(t('settings.security.export_error'));
    } finally {
      setExporting(false);
    }
  };

  // Get the confirmation word based on language
  const getDeleteConfirmWord = () => {
    if (language === 'es') return 'ELIMINAR';
    if (language === 'he') return 'מחק';
    return 'DELETE';
  };

  const handleDeleteAccount = async () => {
    const confirmWord = getDeleteConfirmWord();
    if (deleteConfirmation !== confirmWord) {
      setErrorMessage(t('settings.security.delete_wrong_confirmation'));
      return;
    }

    try {
      setDeleting(true);
      setErrorMessage('');

      const response = await fetch('/api/user/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE_MY_ACCOUNT' }),
      });

      if (response.ok) {
        setSuccessMessage(t('settings.security.delete_success'));
        setTimeout(async () => {
          await supabase.auth.signOut();
          window.location.href = '/';
        }, 2000);
      } else {
        setErrorMessage(t('settings.security.delete_error'));
      }
    } catch (error) {
      setErrorMessage(t('settings.security.delete_error'));
    } finally {
      setDeleting(false);
    }
  };

  // Language options
  const languageOptions = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'he', label: 'עברית', flag: '🇮🇱' },
  ];

  // Currency options
  const currencyOptions = Object.entries(availableCurrencies).map(([code, config]) => ({
    code,
    label: `${code} (${config.symbol})`,
  }));

  // Timezone options (simplified)
  const timezoneOptions = [
    { value: 'America/New_York', label: 'New York' },
    { value: 'America/Los_Angeles', label: 'Los Angeles' },
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Paris' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Asia/Jerusalem', label: 'Jerusalem' },
    { value: 'UTC', label: 'UTC' },
  ];

  const currentLanguage = languageOptions.find(l => l.code === language) || languageOptions[0];
  const currentCurrency = currencyOptions.find(c => c.code === currencyCode) || currencyOptions[0];
  const currentTimezone = timezoneOptions.find(tz => tz.value === profile.timezone);

  // Business dropdown options
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

  // Save business settings
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

      setExpandedSection(null);
      setSuccessMessage(t('settings.business.saved'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error saving business:', error);
      setErrorMessage(t('settings.business.error'));
    } finally {
      setSaving(false);
    }
  };

  // Job title translations
  const jobTitleLabels: Record<string, string> = {
    software_engineer: t('settings.profile.job_titles.software_engineer'),
    product_manager: t('settings.profile.job_titles.product_manager'),
    designer: t('settings.profile.job_titles.designer'),
    founder: t('settings.profile.job_titles.founder'),
    manager: t('settings.profile.job_titles.manager'),
    ceo: t('settings.profile.job_titles.ceo'),
    freelancer: t('settings.profile.job_titles.freelancer'),
    other: t('settings.profile.job_titles.other'),
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--v2-primary)', borderTopColor: 'transparent' }}></div>
            <p className="text-[var(--v2-text-secondary)] font-medium">{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>

      {/* Main Content with max-width like CRM page */}
      <div className={`${PAGE_CONTAINER} py-6 sm:py-8 space-y-8`}>
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-[var(--v2-primary)]/20 to-[var(--v2-secondary)]/20 flex-shrink-0">
              <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--v2-primary)]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold text-[var(--v2-text-primary)] truncate">{t('settings.title')}</h1>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-1 hidden sm:block truncate">{t('settings.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Back to Dashboard */}
            <button
              onClick={() => router.push('/business-os')}
              className="p-1.5 sm:p-2 text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)] transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('settings.back_to_dashboard')}
            >
              <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4 rtl:rotate-180" />
            </button>
          </div>
        </div>

        {/* Messages */}
        {successMessage && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-2" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            <CheckCircle className="w-4 h-4 text-green-600" />
            <p className="text-sm text-green-700 dark:text-green-400">{successMessage}</p>
          </div>
        )}
        {errorMessage && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            <AlertCircle className="w-4 h-4 text-red-600" />
            <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
            <button onClick={() => setErrorMessage('')} className="ms-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Two Column Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Profile & Preferences */}
          <div className="space-y-6">
            {/* Profile Card */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-5" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {!editingProfile ? (
            <div className="flex items-center gap-4">
              <AvatarUpload
                currentAvatarUrl={profile.avatar_url}
                userName={profile.full_name}
                userEmail={user?.email}
                size="lg"
                onAvatarChange={(url) => setProfile(p => ({ ...p, avatar_url: url || '' }))}
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-[var(--v2-text-primary)] truncate">
                  {profile.full_name || user?.email}
                </h2>
                <p className="text-sm text-[var(--v2-text-secondary)] truncate">
                  {user?.email}
                </p>
                {profile.job_title && (
                  <p className="text-sm text-[var(--v2-text-muted)] mt-0.5">
                    {jobTitleLabels[profile.job_title] || profile.job_title}
                  </p>
                )}
              </div>
              <button
                onClick={() => setEditingProfile(true)}
                className="p-2 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <AvatarUpload
                  currentAvatarUrl={profile.avatar_url}
                  userName={profile.full_name}
                  userEmail={user?.email}
                  size="lg"
                  onAvatarChange={(url) => setProfile(p => ({ ...p, avatar_url: url || '' }))}
                />
                <div className="flex-1">
                  <input
                    type="text"
                    value={profile.full_name}
                    onChange={(e) => setProfile(p => ({ ...p, full_name: e.target.value }))}
                    placeholder={t('settings.profile.full_name_placeholder')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditingProfile(false)}
                  className="px-4 py-2 text-sm text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-[var(--v2-primary)] text-white font-medium disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.save')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Preferences */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] divide-y divide-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {/* Language */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'language' ? null : 'language')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.profile.language')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--v2-text-secondary)]">{currentLanguage.flag} {currentLanguage.label}</span>
                <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'language' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openDropdown === 'language' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 mx-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  {languageOptions.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => { setLanguage(lang.code as 'en' | 'es' | 'he'); setOpenDropdown(null); }}
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${language === lang.code ? 'bg-[var(--v2-bg)]' : ''}`}
                    >
                      <span>{lang.flag} {lang.label}</span>
                      {language === lang.code && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Currency */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'currency' ? null : 'currency')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.profile.currency')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--v2-text-secondary)]">{currentCurrency.label}</span>
                <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'currency' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openDropdown === 'currency' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 mx-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  {currencyOptions.map((curr) => (
                    <button
                      key={curr.code}
                      onClick={() => { setCurrency(curr.code as 'USD' | 'EUR' | 'ILS' | 'GBP'); setOpenDropdown(null); }}
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${currencyCode === curr.code ? 'bg-[var(--v2-bg)]' : ''}`}
                    >
                      <span>{curr.label}</span>
                      {currencyCode === curr.code && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Timezone */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'timezone' ? null : 'timezone')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.profile.timezone')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--v2-text-secondary)]">{currentTimezone?.label || t('settings.profile.timezone_placeholder')}</span>
                <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'timezone' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openDropdown === 'timezone' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 mx-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  {timezoneOptions.map((tz) => (
                    <button
                      key={tz.value}
                      onClick={() => { setProfile(p => ({ ...p, timezone: tz.value })); setOpenDropdown(null); saveProfile(); }}
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${profile.timezone === tz.value ? 'bg-[var(--v2-bg)]' : ''}`}
                    >
                      <span>{tz.label}</span>
                      {profile.timezone === tz.value && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
          </div>

          {/* Right Column - Business & Account */}
          <div className="space-y-6">
            {/* Business Info */}
        <div id="settings-section-business" className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <button
            onClick={() => setExpandedSection(expandedSection === 'business' ? null : 'business')}
            className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-[var(--v2-text-muted)]" />
              <div className="text-start">
                <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('settings.business.title')}
                </p>
                {(businessProfile.company_name || orgSettings.name) && (
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    {businessProfile.company_name || orgSettings.name}
                    {orgSettings.industry && ` · ${industryOptions.find(i => i.value === orgSettings.industry)?.label || orgSettings.industry}`}
                  </p>
                )}
              </div>
            </div>
            <ChevronRight className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${expandedSection === 'business' ? 'rotate-90' : ''}`} />
          </button>
          {expandedSection === 'business' && (
            <div className="px-4 pb-4 space-y-4 border-t border-[var(--v2-border)] pt-4">
              {/* AI Hint */}
              <div className="p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    {t('settings.business.ai_hint')}
                  </p>
                </div>
              </div>

              {/* Business Logo — the single source for invoices, emails,
                  booking pages, smart links and the website. */}
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.logo')}
                </label>
                <div className="flex items-start gap-3 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
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
                        className="w-3.5 h-3.5 mt-0.5 shrink-0 accent-[var(--v2-primary)]"
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
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.org_name')}
                </label>
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
                    className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>
              </div>

              {/* What the business does, as it described itself.
                  Shown here because this is the text the website generator
                  writes a homepage from, and the invoices and emails inherit
                  its tone — so it has to be readable and correctable
                  somewhere. */}
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.description')}
                </label>
                <textarea
                  value={businessProfile.description}
                  onChange={(e) => setBusinessProfile(b => ({ ...b, description: e.target.value }))}
                  rows={4}
                  placeholder={t('settings.business.description_placeholder')}
                  className={`w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] resize-none ${isRTL ? 'text-right' : ''}`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 leading-snug">
                  {t('settings.business.description_hint')}
                </p>
              </div>

              {/*
                What a client uses to reach this business.

                The only fields on this screen a CUSTOMER ever sees: they appear
                on the booking-management page, the intake confirmation, the
                smart-link pages and the invoice. Grouped and labelled as public
                so it is clear these are published, not internal record-keeping.
              */}
              <div className="pt-2">
                <p className="text-xs font-semibold text-[var(--v2-text-secondary)] mb-2">
                  {t('settings.business.public_contact')}
                </p>

                <div className="space-y-3">
                  {/* Phone: country selector + number.
                      The country code is not decoration — a number stored
                      without one cannot become a WhatsApp link, and a plain
                      text field is how businesses end up saving `054-1234567`
                      and wondering why the WhatsApp row never appears.
                      `PhoneInput` keeps the value in E.164. */}
                  <div>
                    <label
                      htmlFor="business-phone"
                      className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1"
                    >
                      {t('settings.business.phone')}
                    </label>
                    {/* A phone number is Latin digits and reads left-to-right
                        even on a Hebrew form. */}
                    <div className="flex gap-2" dir="ltr">
                      <SearchableCountrySelect
                        value={phoneCountry}
                        onChange={setPhoneCountry}
                        labels={phoneCountryLabels}
                      />
                      <PhoneInput
                        id="business-phone"
                        international
                        countryCallingCodeEditable={false}
                        country={phoneCountry}
                        value={toE164(businessProfile.phone, getCallingCode(phoneCountry))}
                        onChange={(value) =>
                          setBusinessProfile(b => ({ ...b, phone: value || '' }))
                        }
                        className="phone-input-settings flex-1"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="business-email"
                      className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1"
                    >
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
                        className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="business-address"
                      className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1"
                    >
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
                         * An address is the one field here that can legitimately
                         * be in either script — a Hebrew business writes
                         * "רחוב דיזנגוף 50, תל אביב" but may equally write an
                         * English address for foreign clients. Pinning it to the
                         * interface direction mis-renders whichever case does
                         * not match; `auto` picks the direction from the first
                         * strong character, so both read correctly and the field
                         * flips as the owner types.
                         */
                        dir="auto"
                        value={businessProfile.address}
                        onChange={(e) => setBusinessProfile(b => ({ ...b, address: e.target.value }))}
                        placeholder={t('settings.business.public_address_placeholder')}
                        className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-[var(--v2-text-muted)] mt-2 leading-snug">
                  {t('settings.business.public_contact_hint')}
                </p>
              </div>

              {/* Industry Dropdown */}
              <div className="relative">
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.industry')}
                </label>
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'industry' ? null : 'industry')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] flex items-center justify-between hover:bg-[var(--v2-surface)] transition-colors"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-[var(--v2-text-muted)]" />
                    <span className={orgSettings.industry ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                      {industryOptions.find(i => i.value === orgSettings.industry)?.label || t('settings.business.industry_placeholder')}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'industry' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'industry' && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                    <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                      {industryOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setOrgSettings(o => ({ ...o, industry: opt.value })); setOpenDropdown(null); }}
                          className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.industry === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                        >
                          <span>{opt.label}</span>
                          {orgSettings.industry === opt.value && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Company Size Dropdown */}
              <div className="relative">
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.company_size')}
                </label>
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'company_size' ? null : 'company_size')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] flex items-center justify-between hover:bg-[var(--v2-surface)] transition-colors"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[var(--v2-text-muted)]" />
                    <span className={orgSettings.company_size ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                      {companySizeOptions.find(s => s.value === orgSettings.company_size)?.label || t('settings.business.company_size_placeholder')}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'company_size' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'company_size' && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                    <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                      {companySizeOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setOrgSettings(o => ({ ...o, company_size: opt.value })); setOpenDropdown(null); }}
                          className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.company_size === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                        >
                          <span>{opt.label}</span>
                          {orgSettings.company_size === opt.value && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Primary Goal Dropdown */}
              <div className="relative">
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.primary_goal')}
                </label>
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'primary_goal' ? null : 'primary_goal')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] flex items-center justify-between hover:bg-[var(--v2-surface)] transition-colors"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-[var(--v2-text-muted)]" />
                    <span className={orgSettings.primary_goal ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                      {primaryGoalOptions.find(g => g.value === orgSettings.primary_goal)?.label || t('settings.business.primary_goal_placeholder')}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'primary_goal' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'primary_goal' && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                    <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                      {primaryGoalOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setOrgSettings(o => ({ ...o, primary_goal: opt.value })); setOpenDropdown(null); }}
                          className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.primary_goal === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                        >
                          <span>{opt.label}</span>
                          {orgSettings.primary_goal === opt.value && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Technical Level Dropdown */}
              <div className="relative">
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.technical_level')}
                </label>
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'technical_level' ? null : 'technical_level')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] flex items-center justify-between hover:bg-[var(--v2-surface)] transition-colors"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[var(--v2-text-muted)]" />
                    <span className={orgSettings.technical_level ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                      {technicalLevelOptions.find(l => l.value === orgSettings.technical_level)?.label || t('settings.business.technical_level_placeholder')}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'technical_level' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'technical_level' && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                    <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                      {technicalLevelOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setOrgSettings(o => ({ ...o, technical_level: opt.value })); setOpenDropdown(null); }}
                          className={`w-full px-3 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${orgSettings.technical_level === opt.value ? 'bg-[var(--v2-bg)]' : ''}`}
                        >
                          <span>{opt.label}</span>
                          {orgSettings.technical_level === opt.value && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Work Hours Per Day */}
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.business.work_hours')}
                </label>
                <div className="relative">
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
                    className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>
                <p className="text-xs text-[var(--v2-text-muted)] mt-1">{t('settings.business.work_hours_hint')}</p>
              </div>

              {/* Read-only Business Profile from Onboarding */}
              {(businessProfile.website_url || businessProfile.clients_per_week > 0 || businessProfile.revenue_tier || businessProfile.vertical) && (
                <div className="pt-3 border-t border-[var(--v2-border)]">
                  <p className="text-xs font-medium text-[var(--v2-text-muted)] mb-2">
                    {t('settings.business.profile_subtitle')}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {businessProfile.vertical && (
                      <div className="p-2 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                        <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.vertical')}</p>
                        <p className="text-xs font-medium text-[var(--v2-text-primary)]">
                          {/* Was the raw column value with underscores swapped
                              for spaces, so a Hebrew account read "tutor". */}
                          {getVerticalLabel(businessProfile.vertical, language)}
                        </p>
                      </div>
                    )}
                    {businessProfile.website_url && (
                      <div className="p-2 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                        <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.website')}</p>
                        <a
                          href={businessProfile.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-[var(--v2-primary)] hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {businessProfile.website_url.replace(/^https?:\/\//, '').slice(0, 20)}
                        </a>
                      </div>
                    )}
                    {businessProfile.clients_per_week > 0 && (
                      <div className="p-2 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                        <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.clients_per_week')}</p>
                        <p className="text-xs font-medium text-[var(--v2-text-primary)]">
                          {businessProfile.clients_per_week}
                        </p>
                      </div>
                    )}
                    {businessProfile.revenue_tier && (
                      <div className="p-2 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                        <p className="text-[10px] text-[var(--v2-text-muted)]">{t('settings.business.revenue_tier')}</p>
                        <p className="text-xs font-medium text-[var(--v2-text-primary)] capitalize">
                          {businessProfile.revenue_tier.replace(/_/g, ' ')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={saveBusiness}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-[var(--v2-primary)] text-white font-medium disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.business.save')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Invoice Settings */}
        <div id="settings-section-invoice">
        <InvoiceSettingsSection
          userId={user?.id || ''}
          expanded={expandedSection === 'invoice'}
          onToggle={() => setExpandedSection(expandedSection === 'invoice' ? null : 'invoice')}
        />
        </div>

        {/* Account Actions */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] divide-y divide-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {/* Change Password */}
          <div>
            <button
              onClick={() => setExpandedSection(expandedSection === 'password' ? null : 'password')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.security.change_password')}</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${expandedSection === 'password' ? 'rotate-90' : ''}`} />
            </button>
            {expandedSection === 'password' && (
              <div className="px-4 pb-4 space-y-3">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordForm.current}
                  onChange={(e) => setPasswordForm(p => ({ ...p, current: e.target.value }))}
                  placeholder={t('settings.security.current_password')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordForm.new}
                  onChange={(e) => setPasswordForm(p => ({ ...p, new: e.target.value }))}
                  placeholder={t('settings.security.new_password')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm(p => ({ ...p, confirm: e.target.value }))}
                  placeholder={t('settings.security.confirm_password')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs text-[var(--v2-text-secondary)] flex items-center gap-1"
                  >
                    {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showPassword ? t('common.hide') : t('common.show')}
                  </button>
                  <button
                    onClick={handlePasswordChange}
                    disabled={changingPassword}
                    className="px-4 py-2 text-sm bg-[var(--v2-primary)] text-white font-medium disabled:opacity-50"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.security.update_password')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Export Data */}
          <button
            onClick={handleExportData}
            disabled={exporting}
            className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-[var(--v2-text-muted)]" />
              <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.security.export_data')}</span>
            </div>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />}
          </button>

          {/* Delete Account */}
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="w-full flex items-center justify-between p-4 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-red-500" />
              <span className="text-sm text-red-600 dark:text-red-400">{t('settings.security.delete_account')}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-red-400" />
          </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) {
          setDeleteConfirmation('');
          setErrorMessage('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              {t('settings.security.delete_dialog_title')}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {t('settings.security.delete_dialog_desc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Warning Box */}
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                {t('settings.security.delete_warning')}
              </p>
            </div>

            {/* Confirmation Input */}
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                {t('settings.security.delete_confirm_label')}
              </label>
              <input
                type="text"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder={t('settings.security.delete_confirm_placeholder')}
                className="w-full px-3 py-2.5 text-sm border border-red-200 dark:border-red-800 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                dir={isRTL ? 'rtl' : 'ltr'}
              />
              <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                {language === 'es' ? 'ELIMINAR' : language === 'he' ? 'מחק' : 'DELETE'}
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => {
                setShowDeleteDialog(false);
                setDeleteConfirmation('');
              }}
              className="px-4 py-2 text-sm text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={deleting || deleteConfirmation !== getDeleteConfirmWord()}
              className="px-4 py-2 text-sm bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('settings.security.delete_confirm_button')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

export default function BusinessOSSettingsPage() {
  return (
    <Suspense fallback={null}>
      <BusinessOSSettingsContent />
    </Suspense>
  );
}
