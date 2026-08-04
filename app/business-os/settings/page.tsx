'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import AvatarUpload from '@/components/ui/AvatarUpload';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export default function BusinessOSSettingsPage() {
  const router = useRouter();
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

  // Business data (from business_profiles - read only from onboarding)
  const [businessProfile, setBusinessProfile] = useState({
    vertical: '',
    sub_vertical: '',
    company_name: '',
    website_url: '',
    clients_per_week: 0,
    revenue_tier: '',
  });

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

  const loadData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [profileRes, prefsRes, businessRes, orgRes] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url, job_title').eq('id', user.id).single(),
        supabase.from('user_preferences').select('timezone').eq('user_id', user.id).maybeSingle(),
        supabase.from('business_profiles').select('vertical, sub_vertical, company_name, website_url, clients_per_week, revenue_tier').eq('user_id', user.id).maybeSingle(),
        supabase.from('organizations').select('id, name, settings').eq('owner_user_id', user.id).maybeSingle(),
      ]);

      if (profileRes.data) {
        setProfile({
          full_name: profileRes.data.full_name || '',
          avatar_url: profileRes.data.avatar_url || '',
          job_title: profileRes.data.job_title || '',
          timezone: prefsRes.data?.timezone || '',
        });
      }

      if (businessRes.data) {
        setBusinessProfile({
          vertical: businessRes.data.vertical || '',
          sub_vertical: businessRes.data.sub_vertical || '',
          company_name: businessRes.data.company_name || '',
          website_url: businessRes.data.website_url || '',
          clients_per_week: businessRes.data.clients_per_week || 0,
          revenue_tier: businessRes.data.revenue_tier || '',
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

    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      // Update business_profiles
      await supabase.from('business_profiles').upsert({
        user_id: user.id,
        company_name: businessProfile.company_name,
        vertical: businessProfile.vertical,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

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
        <BusinessOSHeader />
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
      <BusinessOSHeader />

      {/* Main Content with max-width like CRM page */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
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
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
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
                        <p className="text-xs font-medium text-[var(--v2-text-primary)] capitalize">
                          {businessProfile.vertical.replace(/_/g, ' ')}
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
    </div>
  );
}
