'use client'

import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, CheckCircle, AlertCircle, User, Building, Briefcase } from 'lucide-react'
import { UserProfile } from '@/types/settings'
import AvatarUpload from '@/components/ui/AvatarUpload'
import CurrencySelector from '@/components/settings/CurrencySelector'

interface ProfileTabV2Props {
  profile: UserProfile | null
  profileForm: Partial<UserProfile>
  setProfileForm: React.Dispatch<React.SetStateAction<Partial<UserProfile>>>
  onSave: () => void
}

export default function ProfileTabV2({
  profile,
  profileForm,
  setProfileForm,
  onSave
}: ProfileTabV2Props) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

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

      await onSave()

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
                existingProfile?.[key] !== profileForm[key]
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
      setTimeout(() => setSuccessMessage(''), 5000)

    } catch (error) {
      console.error('Error saving profile:', error)
      setErrorMessage('Failed to save profile. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile Header with Avatar */}
      <div className="flex items-start gap-4 pb-6 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <AvatarUpload
            currentAvatarUrl={profileForm.avatar_url}
            userName={profileForm.full_name}
            userEmail={user?.email}
            size="lg"
            onAvatarChange={(avatarUrl) => {
              setProfileForm(prev => ({ ...prev, avatar_url: avatarUrl }))
            }}
          />
        </div>

        <div className="flex-1">
          <h4 className="font-semibold text-[var(--v2-text-primary)] text-lg">
            {profileForm.full_name || user?.email || 'User'}
          </h4>
          <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
            {profileForm.job_title && profileForm.company
              ? `${profileForm.job_title} at ${profileForm.company}`
              : profileForm.job_title || profileForm.company || 'Complete your profile'
            }
          </p>
          {profile?.created_at && (
            <p className="text-xs text-[var(--v2-text-muted)] mt-2">
              Member since {new Date(profile.created_at).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[var(--v2-text-primary)]">Full Name</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                value={profileForm.full_name || ''}
                onChange={(e) => setProfileForm(prev => ({ ...prev, full_name: e.target.value }))}
                className="w-full pl-10 pr-4 py-3 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                placeholder="Enter your full name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[var(--v2-text-primary)]">Email</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[var(--v2-text-muted)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
            <p className="text-xs text-[var(--v2-text-muted)]">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[var(--v2-text-primary)]">Company</label>
            <div className="relative">
              <Building className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                value={profileForm.company || ''}
                onChange={(e) => setProfileForm(prev => ({ ...prev, company: e.target.value }))}
                className="w-full pl-10 pr-4 py-3 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                placeholder="Your company name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[var(--v2-text-primary)]">Job Title</label>
            <div className="relative">
              <Briefcase className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                value={profileForm.job_title || ''}
                onChange={(e) => setProfileForm(prev => ({ ...prev, job_title: e.target.value }))}
                className="w-full pl-10 pr-4 py-3 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                placeholder="Your job title"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[var(--v2-text-primary)]">Currency</label>
            {user && (
              <CurrencySelector
                userId={user.id}
                currentCurrency={profileForm.preferred_currency || 'USD'}
                onCurrencyChange={(currency) => {
                  setProfileForm(prev => ({ ...prev, preferred_currency: currency }))
                }}
              />
            )}
            <p className="text-xs text-[var(--v2-text-muted)]">Your preferred currency for billing display</p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={saveProfile}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            <p className="text-sm font-semibold text-green-900 dark:text-green-100">{successMessage}</p>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="text-sm font-semibold text-red-900 dark:text-red-100">{errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  )
}
