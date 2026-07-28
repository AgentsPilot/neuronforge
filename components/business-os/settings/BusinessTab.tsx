'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import {
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  Building2,
  Briefcase,
  Users,
  Target,
  Globe,
  Sparkles,
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface BusinessSettings {
  work_hours_per_day?: number;
  industry?: string;
  company_size?: string;
  primary_goal?: string;
  technical_level?: string;
}

interface OrganizationData {
  id: string;
  name: string;
  settings: Partial<BusinessSettings>;
}

interface BusinessProfile {
  vertical?: string;
  sub_vertical?: string;
  company_name?: string;
  website_url?: string;
  clients_per_week?: number;
  revenue_tier?: string;
}

export function BusinessTab() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Organization data
  const [orgData, setOrgData] = useState<OrganizationData | null>(null);
  const [businessForm, setBusinessForm] = useState({
    name: '',
    industry: '',
    company_size: '',
    primary_goal: '',
    technical_level: '',
    work_hours_per_day: 8,
  });

  // Business profile data (from onboarding)
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);

  // Dropdown states
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Load all data
  useEffect(() => {
    if (user?.id) {
      loadAllData();
    }
  }, [user?.id]);

  const loadAllData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [orgRes, businessProfileRes] = await Promise.all([
        supabase.from('organizations').select('id, name, settings').eq('owner_user_id', user.id).single(),
        supabase.from('business_profiles').select('vertical, sub_vertical, company_name, website_url, clients_per_week, revenue_tier').eq('user_id', user.id).maybeSingle(),
      ]);

      if (orgRes.data) {
        setOrgData(orgRes.data);
        const settings = (orgRes.data.settings || {}) as Partial<BusinessSettings>;
        setBusinessForm({
          name: orgRes.data.name || '',
          industry: settings.industry || '',
          company_size: settings.company_size || '',
          primary_goal: settings.primary_goal || '',
          technical_level: settings.technical_level || '',
          work_hours_per_day: settings.work_hours_per_day || 8,
        });
      }

      if (businessProfileRes.data) {
        setBusinessProfile(businessProfileRes.data);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Industry options
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

  // Company size options
  const companySizeOptions = [
    { value: 'solo', label: t('settings.size.solo') },
    { value: 'small', label: t('settings.size.small') },
    { value: 'medium', label: t('settings.size.medium') },
    { value: 'large', label: t('settings.size.large') },
    { value: 'enterprise', label: t('settings.size.enterprise') },
  ];

  // Primary goal options
  const primaryGoalOptions = [
    { value: 'reduce_costs', label: t('settings.goal.reduce_costs') },
    { value: 'grow_revenue', label: t('settings.goal.grow_revenue') },
    { value: 'improve_efficiency', label: t('settings.goal.improve_efficiency') },
    { value: 'scale_operations', label: t('settings.goal.scale_operations') },
    { value: 'better_cx', label: t('settings.goal.better_cx') },
  ];

  // Technical level options
  const technicalLevelOptions = [
    { value: 'non_technical', label: t('settings.tech.non_technical') },
    { value: 'some_technical', label: t('settings.tech.some_technical') },
    { value: 'technical', label: t('settings.tech.technical') },
  ];

  const saveAll = async () => {
    if (!user) return;

    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      // Save organization if exists
      if (orgData) {
        const newSettings: Partial<BusinessSettings> = {
          ...(orgData.settings || {}),
          industry: businessForm.industry || undefined,
          company_size: businessForm.company_size || undefined,
          primary_goal: businessForm.primary_goal || undefined,
          technical_level: businessForm.technical_level || undefined,
          work_hours_per_day: businessForm.work_hours_per_day,
        };

        const { error: orgError } = await supabase
          .from('organizations')
          .update({
            name: businessForm.name,
            settings: newSettings,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orgData.id)
          .eq('owner_user_id', user.id);

        if (orgError) throw orgError;
      }

      setSuccessMessage(t('settings.business.saved'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error saving:', error);
      setErrorMessage(t('settings.business.error'));
    } finally {
      setSaving(false);
    }
  };

  // Dropdown component
  const Dropdown = ({
    id,
    label,
    icon: Icon,
    placeholder,
    options,
    value,
    onChange,
  }: {
    id: string;
    label: string;
    icon: React.ElementType;
    placeholder: string;
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  }) => {
    const isOpen = openDropdown === id;
    const selectedOption = options.find((opt) => opt.value === value);

    return (
      <div className="space-y-1.5 relative">
        <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
          {label}
        </label>
        <button
          type="button"
          onClick={() => setOpenDropdown(isOpen ? null : id)}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] transition-colors flex items-center justify-between"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-[var(--v2-text-muted)]" />
            <span className={selectedOption ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
              {selectedOption?.label || placeholder}
            </span>
          </div>
          <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
            <div
              className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden max-h-48 overflow-y-auto"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpenDropdown(null);
                  }}
                  className={`w-full px-3 py-2.5 ${isRTL ? 'text-right' : 'text-left'} text-sm hover:bg-[var(--v2-bg)] flex items-center justify-between ${
                    value === option.value ? 'bg-[var(--v2-bg)]' : ''
                  }`}
                >
                  <span>{option.label}</span>
                  {value === option.value && <CheckCircle className="w-4 h-4 text-[var(--v2-primary)]" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Organisation Settings Section */}
      <div>
        <div className="mb-4">
          <h4 className="text-base font-semibold text-[var(--v2-text-primary)]">
            {t('settings.business.title')}
          </h4>
          <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
            {t('settings.business.subtitle')}
          </p>
        </div>

        {/* AI Hint */}
        <div className="p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 mb-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {t('settings.business.ai_hint')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Organisation Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
              {t('settings.business.org_name')}
            </label>
            <div className="relative">
              <Building2 className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
              <input
                type="text"
                value={businessForm.name}
                onChange={(e) => setBusinessForm((prev) => ({ ...prev, name: e.target.value }))}
                className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                placeholder={t('settings.business.org_name_placeholder')}
              />
            </div>
          </div>

          {/* Industry */}
          <Dropdown
            id="industry"
            label={t('settings.business.industry')}
            icon={Briefcase}
            placeholder={t('settings.business.industry_placeholder')}
            options={industryOptions}
            value={businessForm.industry}
            onChange={(value) => setBusinessForm((prev) => ({ ...prev, industry: value }))}
          />

          {/* Company Size */}
          <Dropdown
            id="company_size"
            label={t('settings.business.company_size')}
            icon={Users}
            placeholder={t('settings.business.company_size_placeholder')}
            options={companySizeOptions}
            value={businessForm.company_size}
            onChange={(value) => setBusinessForm((prev) => ({ ...prev, company_size: value }))}
          />

          {/* Primary Goal */}
          <Dropdown
            id="primary_goal"
            label={t('settings.business.primary_goal')}
            icon={Target}
            placeholder={t('settings.business.primary_goal_placeholder')}
            options={primaryGoalOptions}
            value={businessForm.primary_goal}
            onChange={(value) => setBusinessForm((prev) => ({ ...prev, primary_goal: value }))}
          />

          {/* Technical Level */}
          <Dropdown
            id="technical_level"
            label={t('settings.business.technical_level')}
            icon={Users}
            placeholder={t('settings.business.technical_level_placeholder')}
            options={technicalLevelOptions}
            value={businessForm.technical_level}
            onChange={(value) => setBusinessForm((prev) => ({ ...prev, technical_level: value }))}
          />

          {/* Work Hours Per Day */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
              {t('settings.business.work_hours')}
            </label>
            <div className="relative">
              <Clock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
              <input
                type="number"
                min="1"
                max="24"
                value={businessForm.work_hours_per_day}
                onChange={(e) =>
                  setBusinessForm((prev) => ({
                    ...prev,
                    work_hours_per_day: Math.min(24, Math.max(1, parseInt(e.target.value) || 8)),
                  }))
                }
                className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>
            <p className="text-xs text-[var(--v2-text-muted)]">{t('settings.business.work_hours_hint')}</p>
          </div>
        </div>
      </div>

      {/* Business Profile from Onboarding (read-only display) */}
      {businessProfile && (businessProfile.vertical || businessProfile.website_url) && (
        <div className="pt-6 border-t border-[var(--v2-border)]">
          <h4 className="text-base font-semibold text-[var(--v2-text-primary)] mb-3">
            {t('settings.business.profile_title')}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {businessProfile.vertical && (
              <div className="p-3 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <p className="text-xs text-[var(--v2-text-muted)]">{t('settings.business.vertical')}</p>
                <p className="text-sm font-medium text-[var(--v2-text-primary)] capitalize mt-0.5">
                  {businessProfile.vertical.replace(/_/g, ' ')}
                </p>
              </div>
            )}
            {businessProfile.website_url && (
              <div className="p-3 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <p className="text-xs text-[var(--v2-text-muted)]">{t('settings.business.website')}</p>
                <a
                  href={businessProfile.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-[var(--v2-primary)] hover:underline flex items-center gap-1 mt-0.5"
                >
                  <Globe className="w-3 h-3" />
                  {businessProfile.website_url.replace(/^https?:\/\//, '').slice(0, 25)}
                </a>
              </div>
            )}
            {businessProfile.clients_per_week && (
              <div className="p-3 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <p className="text-xs text-[var(--v2-text-muted)]">{t('settings.business.clients_per_week')}</p>
                <p className="text-sm font-medium text-[var(--v2-text-primary)] mt-0.5">
                  {businessProfile.clients_per_week}
                </p>
              </div>
            )}
            {businessProfile.revenue_tier && (
              <div className="p-3 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <p className="text-xs text-[var(--v2-text-muted)]">{t('settings.business.revenue_tier')}</p>
                <p className="text-sm font-medium text-[var(--v2-text-primary)] capitalize mt-0.5">
                  {businessProfile.revenue_tier.replace(/_/g, ' ')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="pt-4 border-t border-[var(--v2-border)]">
        <button
          onClick={saveAll}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? t('settings.business.saving') : t('settings.business.save')}
        </button>
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
