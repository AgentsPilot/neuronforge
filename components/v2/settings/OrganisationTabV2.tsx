'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import {
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Building2,
  Target,
  Users,
  Briefcase,
  Clock,
  Sparkles,
  ChevronDown
} from 'lucide-react'

// Define options locally to avoid importing server-side code
const INDUSTRY_OPTIONS = [
  { value: 'b2b_saas', label: 'B2B SaaS' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'agency', label: 'Agency / Consulting' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'finance', label: 'Finance / Banking' },
  { value: 'education', label: 'Education' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
] as const

const COMPANY_SIZE_OPTIONS = [
  { value: 'solo', label: 'Solo / Freelancer' },
  { value: 'small', label: 'Small (2-10 employees)' },
  { value: 'medium', label: 'Medium (11-50 employees)' },
  { value: 'large', label: 'Large (51-500 employees)' },
  { value: 'enterprise', label: 'Enterprise (500+ employees)' },
] as const

const PRIMARY_GOAL_OPTIONS = [
  { value: 'reduce_costs', label: 'Reduce operational costs' },
  { value: 'grow_revenue', label: 'Grow revenue' },
  { value: 'improve_efficiency', label: 'Improve efficiency' },
  { value: 'scale_operations', label: 'Scale operations' },
  { value: 'better_cx', label: 'Better customer experience' },
] as const

const TECHNICAL_LEVEL_OPTIONS = [
  { value: 'non_technical', label: 'Non-technical team' },
  { value: 'some_technical', label: 'Some technical skills' },
  { value: 'technical', label: 'Technical team' },
] as const

interface BusinessSettings {
  hourly_rate_usd?: number
  currency?: string
  work_hours_per_day?: number
  industry?: string
  company_size?: string
  primary_goal?: string
  technical_level?: string
}

interface OrganizationData {
  id: string
  name: string
  settings: Partial<BusinessSettings>
}

// Custom Dropdown Component
interface DropdownOption {
  value: string
  label: string
}

interface CustomDropdownProps {
  label: string
  required?: boolean
  icon: React.ReactNode
  placeholder: string
  options: readonly DropdownOption[]
  value: string
  onChange: (value: string) => void
  helpText?: string
}

function CustomDropdown({ label, required, icon, placeholder, options, value, onChange, helpText }: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption = options.find(opt => opt.value === value)

  return (
    <div className="space-y-1.5 relative">
      <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
        {label} {required && '*'}
      </label>

      {/* Selected value display button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors text-left focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[var(--v2-text-muted)]">{icon}</span>
            <span className={`text-xs font-medium ${selectedOption ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}`}>
              {selectedOption?.label || placeholder}
            </span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          {/* Backdrop to close dropdown */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown options */}
          <div
            className="absolute z-20 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden max-h-60 overflow-y-auto"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {options.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className={`w-full px-3 py-2.5 text-left hover:bg-[var(--v2-bg)] transition-colors border-b border-gray-200 dark:border-gray-700 last:border-b-0 ${
                    isSelected ? 'bg-[var(--v2-bg)]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--v2-text-primary)]">
                      {option.label}
                    </span>
                    {isSelected && (
                      <CheckCircle className="w-3.5 h-3.5 text-[var(--v2-primary)]" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {helpText && (
        <p className="text-xs text-[var(--v2-text-muted)]">{helpText}</p>
      )}
    </div>
  )
}

export default function OrganisationTabV2() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  // Form state
  const [orgData, setOrgData] = useState<OrganizationData | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    industry: '',
    company_size: '',
    primary_goal: '',
    technical_level: '',
    work_hours_per_day: 8
  })

  // Load organisation data
  useEffect(() => {
    if (user?.id) {
      loadOrganization()
    }
  }, [user?.id])

  const loadOrganization = async () => {
    if (!user) return

    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, settings')
        .eq('owner_user_id', user.id)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No organization found - this shouldn't happen normally
          setErrorMessage('No organisation found. Please contact support.')
        } else {
          throw error
        }
        return
      }

      setOrgData(data)
      const settings = (data.settings || {}) as Partial<BusinessSettings>
      setFormData({
        name: data.name || '',
        industry: settings.industry || '',
        company_size: settings.company_size || '',
        primary_goal: settings.primary_goal || '',
        technical_level: settings.technical_level || '',
        work_hours_per_day: settings.work_hours_per_day || 8
      })
    } catch (error) {
      console.error('Error loading organisation:', error)
      setErrorMessage('Failed to load organisation data.')
    } finally {
      setLoading(false)
    }
  }

  const saveOrganization = async () => {
    if (!user || !orgData) return

    try {
      setSaving(true)
      setSuccessMessage('')
      setErrorMessage('')

      // Build settings object (merge with existing)
      const newSettings: Partial<BusinessSettings> = {
        ...(orgData.settings || {}),
        industry: formData.industry || undefined,
        company_size: formData.company_size || undefined,
        primary_goal: formData.primary_goal || undefined,
        technical_level: formData.technical_level || undefined,
        work_hours_per_day: formData.work_hours_per_day
      }

      // Update organisation
      const { error } = await supabase
        .from('organizations')
        .update({
          name: formData.name,
          settings: newSettings,
          updated_at: new Date().toISOString()
        })
        .eq('id', orgData.id)
        .eq('owner_user_id', user.id)

      if (error) throw error

      // Update local state
      setOrgData({
        ...orgData,
        name: formData.name,
        settings: newSettings
      })

      setSuccessMessage('Organisation settings saved successfully!')

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Error saving organisation:', error)
      setErrorMessage('Failed to save organisation settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Calculate completeness
  const completedFields = [
    formData.name,
    formData.industry,
    formData.company_size,
    formData.primary_goal
  ].filter(Boolean).length
  const totalFields = 4
  const completionPercentage = Math.round((completedFields / totalFields) * 100)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with completion indicator */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">Organisation Settings</h2>
          <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
            Help the AI Advisor understand your business context for better insights
          </p>
        </div>

        {/* Completion indicator */}
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] transition-all duration-300"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
          <span className="text-xs font-medium text-[var(--v2-text-secondary)]">
            {completionPercentage}%
          </span>
        </div>
      </div>

      {/* AI Context hint */}
      <div className="p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-lg">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-[var(--v2-text-secondary)]">
            These settings help the AI Advisor provide more relevant insights tailored to your industry,
            company size, and business goals.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Organisation Name */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            Organisation Name *
          </label>
          <div className="relative">
            <Building2 className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              placeholder="Your company name"
            />
          </div>
        </div>

        {/* Industry */}
        <CustomDropdown
          label="Industry"
          required
          icon={<Briefcase className="w-4 h-4" />}
          placeholder="Select your industry"
          options={INDUSTRY_OPTIONS}
          value={formData.industry}
          onChange={(value) => setFormData(prev => ({ ...prev, industry: value }))}
        />

        {/* Company Size */}
        <CustomDropdown
          label="Company Size"
          required
          icon={<Users className="w-4 h-4" />}
          placeholder="Select company size"
          options={COMPANY_SIZE_OPTIONS}
          value={formData.company_size}
          onChange={(value) => setFormData(prev => ({ ...prev, company_size: value }))}
        />

        {/* Primary Goal */}
        <CustomDropdown
          label="Primary Business Goal"
          required
          icon={<Target className="w-4 h-4" />}
          placeholder="Select primary goal"
          options={PRIMARY_GOAL_OPTIONS}
          value={formData.primary_goal}
          onChange={(value) => setFormData(prev => ({ ...prev, primary_goal: value }))}
        />

        {/* Technical Level */}
        <CustomDropdown
          label="Team Technical Level"
          icon={<Users className="w-4 h-4" />}
          placeholder="Select technical level"
          options={TECHNICAL_LEVEL_OPTIONS}
          value={formData.technical_level}
          onChange={(value) => setFormData(prev => ({ ...prev, technical_level: value }))}
          helpText="Helps adjust the language and complexity of AI recommendations"
        />

        {/* Work Hours Per Day */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">
            Work Hours Per Day
          </label>
          <div className="relative">
            <Clock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
            <input
              type="number"
              min="1"
              max="24"
              value={formData.work_hours_per_day}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                work_hours_per_day: Math.min(24, Math.max(1, parseInt(e.target.value) || 8))
              }))}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>
          <p className="text-xs text-[var(--v2-text-muted)]">
            Used to calculate &quot;work days saved&quot; in insights
          </p>
        </div>
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
          <span className="text-sm text-green-600 dark:text-green-400">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-600 dark:text-red-400">{errorMessage}</span>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={saveOrganization}
          disabled={saving || !formData.name}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[var(--v2-shadow-button)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  )
}
