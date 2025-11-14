'use client'

import React, { useState, useMemo } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, CheckCircle, AlertCircle, User, Building, Briefcase, Clock, Search, X, Shield, Globe } from 'lucide-react'
import { UserProfile } from '@/types/settings'
import AvatarUpload from '@/components/ui/AvatarUpload'
import CurrencySelector from '@/components/settings/CurrencySelector'

interface ProfileTabV2Props {
  profileForm: Partial<UserProfile>
  setProfileForm: React.Dispatch<React.SetStateAction<Partial<UserProfile>>>
}

export default function ProfileTabV2({
  profileForm,
  setProfileForm
}: ProfileTabV2Props) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  // Timezone search state
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const [isTimezoneDropdownOpen, setIsTimezoneDropdownOpen] = useState(false)

  // Role dropdown state
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false)

  // Role options
  const roleOptions = [
    {
      value: 'admin',
      label: 'Administrator',
      description: 'Full access to all features',
      icon: Shield
    },
    {
      value: 'user',
      label: 'User',
      description: 'Standard access',
      icon: User
    },
    {
      value: 'viewer',
      label: 'Viewer',
      description: 'Read-only access',
      icon: Globe
    }
  ]

  const getRoleConfig = (role: string) => {
    return roleOptions.find(option => option.value === role) || roleOptions[1] // Default to 'user'
  }

  const currentRoleConfig = getRoleConfig(profileForm.role || 'user')

  // Comprehensive timezone list
  const timezones = [
    'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'America/Phoenix', 'America/Toronto', 'America/Vancouver',
    'America/Mexico_City', 'America/Sao_Paulo', 'America/Buenos_Aires',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
    'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna', 'Europe/Stockholm',
    'Europe/Copenhagen', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Warsaw',
    'Europe/Prague', 'Europe/Budapest', 'Europe/Zurich', 'Europe/Athens',
    'Europe/Moscow', 'Europe/Istanbul',
    'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
    'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Manila',
    'Asia/Jakarta', 'Asia/Ho_Chi_Minh', 'Asia/Taipei',
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth',
    'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu',
    'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Nairobi', 'Africa/Lagos',
  ]

  // Helper function to format timezone display names
  const formatTimezone = (timezone: string) => {
    if (timezone === 'UTC') return 'UTC'

    const parts = timezone.split('/')
    const city = parts[parts.length - 1].replace(/_/g, ' ')
    const region = parts[0]

    try {
      const now = new Date()
      const formatter = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        timeZoneName: 'short'
      })
      const timeZoneName = formatter.formatToParts(now)
        .find(part => part.type === 'timeZoneName')?.value || ''

      return `${city} (${region}) - ${timeZoneName}`
    } catch {
      return `${city} (${region})`
    }
  }

  // Smart search for timezones
  const filteredTimezones = useMemo(() => {
    if (!timezoneSearch.trim()) return timezones.slice(0, 20)

    const searchTerm = timezoneSearch.toLowerCase().trim()
    const results = timezones.filter(timezone => {
      const formatted = formatTimezone(timezone).toLowerCase()
      const parts = timezone.toLowerCase().split('/')
      const city = parts[parts.length - 1].replace(/_/g, ' ')
      const region = parts[0]

      return (
        formatted.includes(searchTerm) ||
        timezone.toLowerCase().includes(searchTerm) ||
        city.includes(searchTerm) ||
        region.includes(searchTerm) ||
        (searchTerm === 'pst' && timezone.includes('Los_Angeles')) ||
        (searchTerm === 'est' && timezone.includes('New_York')) ||
        (searchTerm === 'mst' && timezone.includes('Denver')) ||
        (searchTerm === 'cst' && timezone.includes('Chicago')) ||
        (searchTerm === 'gmt' && timezone.includes('London')) ||
        (searchTerm === 'jst' && timezone.includes('Tokyo'))
      )
    })

    return results.slice(0, 50)
  }, [timezoneSearch, timezones])

  const handleTimezoneSelect = (timezone: string) => {
    setProfileForm(prev => ({ ...prev, timezone }))
    setTimezoneSearch('')
    setIsTimezoneDropdownOpen(false)
  }

  const getSelectedTimezoneDisplay = () => {
    if (!profileForm.timezone) return ''
    return formatTimezone(profileForm.timezone)
  }

  const saveProfile = async () => {
    if (!user) return

    try {
      setSaving(true)
      setSuccessMessage('')
      setErrorMessage('')

      // Get existing profile for audit trail
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      // Save profile fields
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: profileForm.full_name,
          avatar_url: profileForm.avatar_url,
          company: profileForm.company,
          job_title: profileForm.job_title,
          role: profileForm.role,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        })

      if (profileError) throw profileError

      // Save preferences to user_preferences table (timezone, language)
      if (profileForm.timezone || profileForm.language) {
        const { error: prefsError } = await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            timezone: profileForm.timezone,
            preferred_language: profileForm.language,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          })

        if (prefsError) throw prefsError
      }

      // AUDIT TRAIL: Log profile update
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id
          },
          body: JSON.stringify({
            action: 'SETTINGS_PROFILE_UPDATED',
            entityType: 'user',
            entityId: user.id,
            userId: user.id,
            resourceName: profileForm.full_name || user.email || 'User Profile',
            before: existingProfile,
            after: profileForm,
            details: {
              fields_updated: Object.keys(profileForm).filter(key =>
                existingProfile?.[key] !== (profileForm as any)[key]
              ),
              timestamp: new Date().toISOString()
            },
            severity: 'info'
          })
        })
      } catch (auditError) {
        console.error('Audit logging failed (non-critical):', auditError)
      }

      setSuccessMessage('Profile updated successfully!')

    } catch (error) {
      console.error('Error saving profile:', error)
      setErrorMessage('Failed to save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Profile Header with Avatar */}
      <div className="flex items-center gap-3 pb-3">
        <div className="relative">
          <AvatarUpload
            currentAvatarUrl={profileForm.avatar_url}
            userName={profileForm.full_name}
            userEmail={user?.email}
            size="md"
            onAvatarChange={(avatarUrl) => {
              setProfileForm(prev => ({ ...prev, avatar_url: avatarUrl }))
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-[var(--v2-text-primary)] text-base truncate">
            {profileForm.full_name || user?.email || 'User'}
          </h4>
          <p className="text-xs text-[var(--v2-text-secondary)] truncate">
            {profileForm.job_title && profileForm.company
              ? `${profileForm.job_title} at ${profileForm.company}`
              : profileForm.job_title || profileForm.company || 'Complete your profile'
            }
          </p>
        </div>
      </div>

      {/* Form Fields - Compact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">Full Name</label>
          <div className="relative">
            <User className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
            <input
              type="text"
              value={profileForm.full_name || ''}
              onChange={(e) => setProfileForm(prev => ({ ...prev, full_name: e.target.value }))}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              placeholder="Enter your full name"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">Email</label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-muted)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">Company</label>
          <div className="relative">
            <Building className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
            <input
              type="text"
              value={profileForm.company || ''}
              onChange={(e) => setProfileForm(prev => ({ ...prev, company: e.target.value }))}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              placeholder="Your company name"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">Job Title</label>
          <div className="relative">
            <Briefcase className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
            <input
              type="text"
              value={profileForm.job_title || ''}
              onChange={(e) => setProfileForm(prev => ({ ...prev, job_title: e.target.value }))}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              placeholder="Your job title"
            />
          </div>
        </div>

        {/* Role Selection - Compact Dropdown */}
        <div className="space-y-1 relative">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">Role</label>

          {/* Selected role display button */}
          <button
            type="button"
            onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors text-left focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <currentRoleConfig.icon className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                <span className="text-xs font-medium">{currentRoleConfig.label}</span>
              </div>
              <svg
                className={`h-3 w-3 text-[var(--v2-text-muted)] transition-transform ${isRoleDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {/* Dropdown menu */}
          {isRoleDropdownOpen && (
            <>
              {/* Backdrop to close dropdown */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsRoleDropdownOpen(false)}
              />

              {/* Dropdown options */}
              <div className="absolute z-20 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                {roleOptions.map((option) => {
                  const isSelected = (profileForm.role || 'user') === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setProfileForm(prev => ({ ...prev, role: option.value }))
                        setIsRoleDropdownOpen(false)
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-[var(--v2-bg)] transition-colors border-b border-gray-200 dark:border-gray-700 last:border-b-0 ${
                        isSelected ? 'bg-[var(--v2-bg)]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <option.icon className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-[var(--v2-text-primary)]">
                              {option.label}
                            </span>
                            {isSelected && (
                              <CheckCircle className="w-3 h-3 text-[var(--v2-primary)]" />
                            )}
                          </div>
                          <p className="text-xs text-[var(--v2-text-muted)]">
                            {option.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Smart Timezone Search - Compact */}
        <div className="space-y-1 relative">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">Timezone</label>

          {/* Selected timezone display */}
          {profileForm.timezone && !isTimezoneDropdownOpen && (
            <div className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className="text-xs text-[var(--v2-text-primary)] truncate">{getSelectedTimezoneDisplay()}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsTimezoneDropdownOpen(true)
                    setTimezoneSearch('')
                  }}
                  className="text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] text-xs px-1.5 py-0.5"
                >
                  Change
                </button>
              </div>
            </div>
          )}

          {/* Search input */}
          {(!profileForm.timezone || isTimezoneDropdownOpen) && (
            <>
              <div className="relative">
                <Clock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search timezone..."
                  value={timezoneSearch}
                  onChange={(e) => setTimezoneSearch(e.target.value)}
                  className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                  autoComplete="off"
                  autoFocus={isTimezoneDropdownOpen}
                />

                {/* Search/Clear icon */}
                <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center">
                  {timezoneSearch ? (
                    <button
                      type="button"
                      onClick={() => setTimezoneSearch('')}
                      className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <Search className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  )}
                </div>
              </div>

              {/* Dropdown results */}
              <div className="absolute z-50 w-full mt-1 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                {filteredTimezones.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[var(--v2-text-muted)]">
                    {timezoneSearch.trim() ?
                      `No timezones found for "${timezoneSearch}"` :
                      'Start typing to search timezones...'
                    }
                  </div>
                ) : (
                  <>
                    {timezoneSearch.trim() && (
                      <div className="px-3 py-1.5 text-xs text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] border-b border-gray-200 dark:border-gray-700">
                        {filteredTimezones.length} timezone{filteredTimezones.length !== 1 ? 's' : ''} found
                      </div>
                    )}

                    {filteredTimezones.map((timezone) => (
                      <button
                        key={timezone}
                        type="button"
                        onClick={() => handleTimezoneSelect(timezone)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--v2-bg)] focus:bg-[var(--v2-bg)] focus:outline-none"
                      >
                        <div className="font-medium text-[var(--v2-text-primary)] text-xs">
                          {formatTimezone(timezone)}
                        </div>
                        <div className="text-xs text-[var(--v2-text-muted)]">
                          {timezone}
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>

              {/* Cancel button */}
              {profileForm.timezone && (
                <button
                  type="button"
                  onClick={() => {
                    setIsTimezoneDropdownOpen(false)
                    setTimezoneSearch('')
                  }}
                  className="mt-1 text-xs text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>

        {/* Currency */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-[var(--v2-text-primary)]">Currency</label>
          {user && (
            <CurrencySelector
              userId={user.id}
              currentCurrency={profileForm.preferred_currency || 'USD'}
              onCurrencyChange={(currency) => {
                setProfileForm(prev => ({ ...prev, preferred_currency: currency }))
              }}
            />
          )}
        </div>
      </div>

      {/* Save Button - Compact */}
      <div className="flex gap-2 pt-3">
        <button
          onClick={saveProfile}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Changes
        </button>
      </div>

      {/* Success/Error Messages - Compact */}
      {successMessage && (
        <div className="p-2.5 border" style={{
          backgroundColor: 'var(--v2-success-bg)',
          borderColor: 'var(--v2-success-border)',
          borderRadius: 'var(--v2-radius-card)'
        }}>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-success-icon)' }} />
            <p className="text-xs font-medium" style={{ color: 'var(--v2-success-text)' }}>{successMessage}</p>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="p-2.5 border" style={{
          backgroundColor: 'var(--v2-error-bg)',
          borderColor: 'var(--v2-error-border)',
          borderRadius: 'var(--v2-radius-card)'
        }}>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-error-icon)' }} />
            <p className="text-xs font-medium" style={{ color: 'var(--v2-error-text)' }}>{errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  )
}
