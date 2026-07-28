'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import {
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  User,
  Clock,
  Search,
  X,
  ChevronDown,
  Briefcase,
  Lock,
  Eye,
  EyeOff,
  Download,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import AvatarUpload from '@/components/ui/AvatarUpload';

interface ProfileForm {
  full_name: string;
  avatar_url: string;
  job_title: string;
  timezone: string;
}

export function ProfileTab() {
  const { user } = useAuth();
  const { t, isRTL, language, setLanguage, currencyCode, setCurrency, availableCurrencies } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Profile form state
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    full_name: '',
    avatar_url: '',
    job_title: '',
    timezone: '',
  });

  // Dropdown states
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [timezoneSearch, setTimezoneSearch] = useState('');
  const [jobTitleSearch, setJobTitleSearch] = useState('');

  // Security states
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Load profile data
  useEffect(() => {
    if (user?.id) {
      loadProfileData();
    }
  }, [user?.id]);

  const loadProfileData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [profileRes, preferencesRes] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url, job_title').eq('id', user.id).single(),
        supabase.from('user_preferences').select('timezone').eq('user_id', user.id).single(),
      ]);

      if (profileRes.data) {
        setProfileForm({
          full_name: profileRes.data.full_name || '',
          avatar_url: profileRes.data.avatar_url || '',
          job_title: profileRes.data.job_title || '',
          timezone: preferencesRes.data?.timezone || '',
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  // Job title options with translation keys
  const jobTitleOptions = [
    { key: 'software_engineer', label: t('settings.profile.job_titles.software_engineer') },
    { key: 'product_manager', label: t('settings.profile.job_titles.product_manager') },
    { key: 'designer', label: t('settings.profile.job_titles.designer') },
    { key: 'data_analyst', label: t('settings.profile.job_titles.data_analyst') },
    { key: 'project_manager', label: t('settings.profile.job_titles.project_manager') },
    { key: 'marketing_manager', label: t('settings.profile.job_titles.marketing_manager') },
    { key: 'sales_representative', label: t('settings.profile.job_titles.sales_representative') },
    { key: 'account_manager', label: t('settings.profile.job_titles.account_manager') },
    { key: 'customer_success_manager', label: t('settings.profile.job_titles.customer_success_manager') },
    { key: 'operations_manager', label: t('settings.profile.job_titles.operations_manager') },
    { key: 'business_analyst', label: t('settings.profile.job_titles.business_analyst') },
    { key: 'consultant', label: t('settings.profile.job_titles.consultant') },
    { key: 'founder', label: t('settings.profile.job_titles.founder') },
    { key: 'manager', label: t('settings.profile.job_titles.manager') },
    { key: 'ceo', label: t('settings.profile.job_titles.ceo') },
    { key: 'cto', label: t('settings.profile.job_titles.cto') },
    { key: 'cfo', label: t('settings.profile.job_titles.cfo') },
    { key: 'coo', label: t('settings.profile.job_titles.coo') },
    { key: 'cmo', label: t('settings.profile.job_titles.cmo') },
    { key: 'director', label: t('settings.profile.job_titles.director') },
    { key: 'vice_president', label: t('settings.profile.job_titles.vice_president') },
    { key: 'freelancer', label: t('settings.profile.job_titles.freelancer') },
    { key: 'other', label: t('settings.profile.job_titles.other') },
  ];

  const getJobTitleLabel = (key: string) => {
    const option = jobTitleOptions.find(opt => opt.key === key);
    return option?.label || key;
  };

  // Timezone list
  const timezones = [
    'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo',
    'Asia/Jerusalem',
    'Australia/Sydney', 'Australia/Melbourne',
    'Pacific/Auckland',
  ];

  const formatTimezone = (timezone: string) => {
    if (timezone === 'UTC') return 'UTC';
    const parts = timezone.split('/');
    const city = parts[parts.length - 1].replace(/_/g, ' ');
    return `${city} (${parts[0]})`;
  };

  const filteredTimezones = useMemo(() => {
    if (!timezoneSearch.trim()) return timezones;
    const searchTerm = timezoneSearch.toLowerCase().trim();
    return timezones.filter(tz =>
      tz.toLowerCase().includes(searchTerm) ||
      formatTimezone(tz).toLowerCase().includes(searchTerm)
    );
  }, [timezoneSearch]);

  const filteredJobTitles = useMemo(() => {
    if (!jobTitleSearch.trim()) return jobTitleOptions;
    const searchTerm = jobTitleSearch.toLowerCase().trim();
    return jobTitleOptions.filter(option =>
      option.label.toLowerCase().includes(searchTerm) ||
      option.key.toLowerCase().includes(searchTerm)
    );
  }, [jobTitleSearch, jobTitleOptions]);

  // Language options
  const languageOptions = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'he', label: 'עברית', flag: '🇮🇱' },
  ];

  const currentLanguage = languageOptions.find((l) => l.code === language) || languageOptions[0];

  // Currency options
  const currencyOptions = Object.entries(availableCurrencies).map(([code, config]) => ({
    code,
    symbol: config.symbol,
    label: `${code} (${config.symbol})`,
  }));

  const currentCurrency = currencyOptions.find((c) => c.code === currencyCode) || currencyOptions[0];

  const saveProfile = async () => {
    if (!user) return;

    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: profileForm.full_name,
          avatar_url: profileForm.avatar_url,
          job_title: profileForm.job_title,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (profileError) throw profileError;

      if (profileForm.timezone) {
        const { error: prefsError } = await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            timezone: profileForm.timezone,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });

        if (prefsError) throw prefsError;
      }

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
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setErrorMessage(t('settings.security.password_required'));
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setErrorMessage(t('settings.security.password_mismatch'));
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setErrorMessage(t('settings.security.password_short'));
      return;
    }

    try {
      setChangingPassword(true);
      setSuccessMessage('');
      setErrorMessage('');

      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      setSuccessMessage(t('settings.security.password_updated'));
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
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
      setSuccessMessage('');
      setErrorMessage('');

      const [profileRes, preferencesRes, connectionsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id),
        supabase.from('user_preferences').select('*').eq('user_id', user.id),
        supabase.from('plugin_connections').select('*').eq('user_id', user.id),
      ]);

      const userData = {
        user: { id: user.id, email: user.email, created_at: user.created_at },
        profile: profileRes.data?.[0] || null,
        preferences: preferencesRes.data?.[0] || null,
        connections: connectionsRes.data || [],
      };

      const dataStr = JSON.stringify(userData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `user-data-${user.id}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSuccessMessage(t('settings.security.export_success'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error exporting data:', error);
      setErrorMessage(t('settings.security.export_error'));
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    const firstConfirm = confirm(t('settings.security.delete_warning') + '\n\nAre you sure you want to proceed?');

    if (firstConfirm) {
      const typedConfirmation = prompt('Type "DELETE_MY_ACCOUNT" to confirm:');

      if (typedConfirmation === 'DELETE_MY_ACCOUNT') {
        try {
          setErrorMessage('Processing account deletion...');

          const response = await fetch('/api/user/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmation: 'DELETE_MY_ACCOUNT' }),
          });

          const result = await response.json();

          if (response.ok && result.success) {
            setSuccessMessage('Account deleted successfully. You will be signed out shortly.');
            setTimeout(async () => {
              await supabase.auth.signOut();
              window.location.href = '/';
            }, 3000);
          } else {
            setErrorMessage(result.message || 'Failed to delete account. Please contact support.');
          }
        } catch (error) {
          console.error('Error deleting account:', error);
          setErrorMessage('Failed to delete account. Please try again or contact support.');
        }
      } else if (typedConfirmation !== null) {
        setErrorMessage('Incorrect confirmation. Account deletion cancelled.');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Header with Avatar */}
      <div className="flex items-center gap-4 pb-4 border-b border-[var(--v2-border)]">
        <AvatarUpload
          currentAvatarUrl={profileForm.avatar_url}
          userName={profileForm.full_name}
          userEmail={user?.email}
          size="lg"
          onAvatarChange={(avatarUrl) => {
            setProfileForm((prev) => ({ ...prev, avatar_url: avatarUrl }));
          }}
        />
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {profileForm.full_name || user?.email || 'User'}
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)]">
            {profileForm.job_title ? getJobTitleLabel(profileForm.job_title) : t('settings.profile.job_title_placeholder')}
          </p>
        </div>
      </div>

      {/* Row 1: Name, Email, Title */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Full Name */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            {t('settings.profile.full_name')}
          </label>
          <div className="relative">
            <User className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
            <input
              type="text"
              value={profileForm.full_name}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, full_name: e.target.value }))}
              className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              placeholder={t('settings.profile.full_name_placeholder')}
            />
          </div>
        </div>

        {/* Email (Read-only) */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            {t('settings.profile.email')}
          </label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-muted)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          />
        </div>

        {/* Job Title - Searchable Dropdown */}
        <div className="space-y-1.5 relative">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            {t('settings.profile.job_title')}
          </label>
          <button
            type="button"
            onClick={() => setOpenDropdown(openDropdown === 'job_title' ? null : 'job_title')}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] transition-colors flex items-center justify-between"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-[var(--v2-text-muted)]" />
              <span className={profileForm.job_title ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                {profileForm.job_title ? getJobTitleLabel(profileForm.job_title) : t('settings.profile.job_title_placeholder')}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'job_title' ? 'rotate-180' : ''}`} />
          </button>

          {openDropdown === 'job_title' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setOpenDropdown(null); setJobTitleSearch(''); }} />
              <div
                className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                  <div className="relative">
                    <Search className={`w-4 h-4 absolute ${isRTL ? 'right-2.5' : 'left-2.5'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                    <input
                      type="text"
                      value={jobTitleSearch}
                      onChange={(e) => setJobTitleSearch(e.target.value)}
                      placeholder={t('settings.profile.job_title_placeholder')}
                      className={`w-full ${isRTL ? 'pr-8 pl-8' : 'pl-8 pr-8'} py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      autoFocus
                    />
                    {jobTitleSearch && (
                      <button
                        type="button"
                        onClick={() => setJobTitleSearch('')}
                        className={`absolute ${isRTL ? 'left-2.5' : 'right-2.5'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredJobTitles.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setProfileForm((prev) => ({ ...prev, job_title: option.key }));
                        setOpenDropdown(null);
                        setJobTitleSearch('');
                      }}
                      className={`w-full px-3 py-2.5 ${isRTL ? 'text-right' : 'text-left'} text-sm hover:bg-[var(--v2-bg)] flex items-center justify-between ${
                        profileForm.job_title === option.key ? 'bg-[var(--v2-bg)]' : ''
                      }`}
                    >
                      <span>{option.label}</span>
                      {profileForm.job_title === option.key && <CheckCircle className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 2: Language, Currency, Timezone */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Language */}
        <div className="space-y-1.5 relative">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            {t('settings.profile.language')}
          </label>
          <button
            type="button"
            onClick={() => setOpenDropdown(openDropdown === 'language' ? null : 'language')}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] transition-colors flex items-center justify-between"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <span className="text-[var(--v2-text-primary)]">
              {currentLanguage.flag} {currentLanguage.label}
            </span>
            <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'language' ? 'rotate-180' : ''}`} />
          </button>

          {openDropdown === 'language' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div
                className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                {languageOptions.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      setLanguage(lang.code as 'en' | 'es' | 'he');
                      setOpenDropdown(null);
                    }}
                    className={`w-full px-3 py-2.5 ${isRTL ? 'text-right' : 'text-left'} text-sm hover:bg-[var(--v2-bg)] flex items-center justify-between ${
                      language === lang.code ? 'bg-[var(--v2-bg)]' : ''
                    }`}
                  >
                    <span>{lang.flag} {lang.label}</span>
                    {language === lang.code && <CheckCircle className="w-4 h-4 text-[var(--v2-primary)]" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Currency */}
        <div className="space-y-1.5 relative">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            {t('settings.profile.currency')}
          </label>
          <button
            type="button"
            onClick={() => setOpenDropdown(openDropdown === 'currency' ? null : 'currency')}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] transition-colors flex items-center justify-between"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <span className="text-[var(--v2-text-primary)]">{currentCurrency.label}</span>
            <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'currency' ? 'rotate-180' : ''}`} />
          </button>

          {openDropdown === 'currency' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div
                className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                {currencyOptions.map((curr) => (
                  <button
                    key={curr.code}
                    type="button"
                    onClick={() => {
                      setCurrency(curr.code as 'USD' | 'EUR' | 'ILS' | 'GBP');
                      setOpenDropdown(null);
                    }}
                    className={`w-full px-3 py-2.5 ${isRTL ? 'text-right' : 'text-left'} text-sm hover:bg-[var(--v2-bg)] flex items-center justify-between ${
                      currencyCode === curr.code ? 'bg-[var(--v2-bg)]' : ''
                    }`}
                  >
                    <span>{curr.label}</span>
                    {currencyCode === curr.code && <CheckCircle className="w-4 h-4 text-[var(--v2-primary)]" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Timezone - Searchable Dropdown */}
        <div className="space-y-1.5 relative">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            {t('settings.profile.timezone')}
          </label>
          <button
            type="button"
            onClick={() => setOpenDropdown(openDropdown === 'timezone' ? null : 'timezone')}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] transition-colors flex items-center justify-between"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
              <span className={profileForm.timezone ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                {profileForm.timezone ? formatTimezone(profileForm.timezone) : t('settings.profile.timezone_placeholder')}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'timezone' ? 'rotate-180' : ''}`} />
          </button>

          {openDropdown === 'timezone' && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setOpenDropdown(null); setTimezoneSearch(''); }} />
              <div
                className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                  <div className="relative">
                    <Search className={`w-4 h-4 absolute ${isRTL ? 'right-2.5' : 'left-2.5'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                    <input
                      type="text"
                      value={timezoneSearch}
                      onChange={(e) => setTimezoneSearch(e.target.value)}
                      placeholder={t('settings.profile.timezone_placeholder')}
                      className={`w-full ${isRTL ? 'pr-8 pl-8' : 'pl-8 pr-8'} py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      autoFocus
                    />
                    {timezoneSearch && (
                      <button
                        type="button"
                        onClick={() => setTimezoneSearch('')}
                        className={`absolute ${isRTL ? 'left-2.5' : 'right-2.5'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredTimezones.map((tz) => (
                    <button
                      key={tz}
                      type="button"
                      onClick={() => {
                        setProfileForm((prev) => ({ ...prev, timezone: tz }));
                        setOpenDropdown(null);
                        setTimezoneSearch('');
                      }}
                      className={`w-full px-3 py-2.5 ${isRTL ? 'text-right' : 'text-left'} text-sm hover:bg-[var(--v2-bg)] flex items-center justify-between ${
                        profileForm.timezone === tz ? 'bg-[var(--v2-bg)]' : ''
                      }`}
                    >
                      <span>{formatTimezone(tz)}</span>
                      {profileForm.timezone === tz && <CheckCircle className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Save Profile Button */}
      <div className="pt-4 border-t border-[var(--v2-border)]">
        <button
          onClick={saveProfile}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? t('settings.profile.saving') : t('settings.profile.save')}
        </button>
      </div>

      {/* Row 3: Change Password */}
      <div className="pt-4 border-t border-[var(--v2-border)]">
        <h4 className="font-semibold text-sm text-[var(--v2-text-primary)] mb-4">
          {t('settings.security.change_password')}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Current Password */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
              {t('settings.security.current_password')}
            </label>
            <div className="relative">
              <Lock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                className={`w-full ${isRTL ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                placeholder={t('settings.security.current_password_placeholder')}
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className={`absolute ${isRTL ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]`}
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
              {t('settings.security.new_password')}
            </label>
            <div className="relative">
              <Lock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                className={`w-full ${isRTL ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                placeholder={t('settings.security.new_password_placeholder')}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className={`absolute ${isRTL ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]`}
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
              {t('settings.security.confirm_password')}
            </label>
            <div className="relative">
              <Lock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                placeholder={t('settings.security.confirm_password_placeholder')}
              />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={handlePasswordChange}
            disabled={changingPassword}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {t('settings.security.update_password')}
          </button>
        </div>
      </div>

      {/* Export & Delete Account */}
      <div className="pt-4 border-t border-[var(--v2-border)] space-y-4">
        {/* Export Data */}
        <div
          className={`flex items-center justify-between p-4 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700`}
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <div>
            <h4 className="font-semibold text-sm text-[var(--v2-text-primary)]">
              {t('settings.security.export_data')}
            </h4>
            <p className="text-xs text-[var(--v2-text-secondary)]">
              {t('settings.security.export_data_desc')}
            </p>
          </div>
          <button
            onClick={handleExportData}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t('settings.security.export_button')}
          </button>
        </div>

        {/* Danger Zone - Delete Account */}
        <div
          className="border-2 border-red-500/30 p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm text-red-600 dark:text-red-400 mb-1">
                {t('settings.security.delete_account')}
              </h4>
              <p className="text-xs text-[var(--v2-text-secondary)] mb-2">
                {t('settings.security.delete_account_desc')}
              </p>
              <div
                className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  {t('settings.security.delete_warning')}
                </p>
              </div>
            </div>
            <button
              onClick={handleDeleteAccount}
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-md"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Trash2 className="w-4 h-4" />
              {t('settings.security.delete_button')}
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {successMessage && (
        <div
          className="p-3 border flex items-center gap-2"
          style={{
            backgroundColor: 'var(--v2-success-bg)',
            borderColor: 'var(--v2-success-border)',
            borderRadius: 'var(--v2-radius-card)',
          }}
        >
          <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-success-icon)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--v2-success-text)' }}>{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div
          className="p-3 border flex items-center gap-2"
          style={{
            backgroundColor: 'var(--v2-error-bg)',
            borderColor: 'var(--v2-error-border)',
            borderRadius: 'var(--v2-radius-card)',
          }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-error-icon)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--v2-error-text)' }}>{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
