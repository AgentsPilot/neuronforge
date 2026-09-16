'use client'

import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { DangerZonePanel } from '@/components/business-os/purge/DangerZonePanel'
import { createLogger } from '@/lib/logger'
import {
  Download,
  Trash2,
  CheckCircle,
  AlertCircle,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react'

const logger = createLogger({ module: 'SecurityTabV2' })

export default function SecurityTabV2() {
  const { user } = useAuth()
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  const handlePasswordChange = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setErrorMessage('Please fill in all password fields.')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setErrorMessage('New passwords do not match.')
      return
    }

    if (passwordForm.newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.')
      return
    }

    try {
      setSuccessMessage('')
      setErrorMessage('')

      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword
      })

      if (error) throw error

      // AUDIT TRAIL: Log password change
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user?.id || ''
          },
          body: JSON.stringify({
            action: 'USER_PASSWORD_CHANGED',
            entityType: 'user',
            entityId: user?.id,
            userId: user?.id,
            resourceName: user?.email || 'User Account',
            details: {
              timestamp: new Date().toISOString(),
              method: 'user_initiated'
            },
            severity: 'critical',
            complianceFlags: ['SOC2', 'GDPR']
          })
        })
      } catch (auditError) {
        logger.error({ err: auditError }, 'Audit logging failed (non-blocking)')
      }

      setSuccessMessage('Password updated successfully!')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      logger.error({ err: error }, 'Password change failed')
      setErrorMessage('Failed to change password. Please try again.')
    }
  }

  const handleExportData = async () => {
    if (!user) return

    try {
      setSuccessMessage('')
      setErrorMessage('')

      const [profileRes, preferencesRes, notificationsRes, connectionsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id),
        supabase.from('user_preferences').select('*').eq('user_id', user.id),
        supabase.from('notification_settings').select('*').eq('user_id', user.id),
        supabase.from('plugin_connections').select('*').eq('user_id', user.id)
      ])

      const userData = {
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at
        },
        profile: profileRes.data?.[0] || null,
        preferences: preferencesRes.data?.[0] || null,
        notifications: notificationsRes.data?.[0] || null,
        connections: connectionsRes.data || []
      }

      const dataStr = JSON.stringify(userData, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `user-data-${user.id}-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      // AUDIT TRAIL: Log data export
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id
          },
          body: JSON.stringify({
            action: 'USER_DATA_EXPORTED',
            entityType: 'user',
            entityId: user.id,
            userId: user.id,
            resourceName: user.email || 'User Account',
            details: {
              timestamp: new Date().toISOString(),
              export_type: 'full_account_data',
              data_categories: ['profile', 'preferences', 'notifications', 'connections']
            },
            severity: 'medium',
            complianceFlags: ['GDPR', 'CCPA']
          })
        })
      } catch (auditError) {
        logger.error({ err: auditError }, 'Audit logging failed (non-blocking)')
      }

      setSuccessMessage('Data exported successfully! Check your downloads folder.')
    } catch (error) {
      logger.error({ err: error }, 'User data export failed')
      setErrorMessage('Failed to export data. Please try again.')
    }
  }

  /*
   * `handleDeleteAccount` removed — it POSTed to `/api/user/delete-account`,
   * which deleted `auth.users` and, for every onboarded user, failed partway
   * through and left a half-destroyed account. That route is now a 410
   * tombstone, so the handler is deleted rather than repointed: leaving it
   * would surface an error toast, which is the broken-delete experience
   * retiring the route was meant to end.
   *
   * The Danger Zone below now renders the shared `DangerZonePanel`, the same
   * component `/business-os/settings` uses, so the copy and the erasure contact
   * address exist in exactly one place.
   */

  return (
    <div className="space-y-4">
      {/* Password & Authentication - Compact */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">Password & Authentication</h3>

        <div className="p-3 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="mb-3">
            <h4 className="font-semibold text-sm text-[var(--v2-text-primary)]">Change Password</h4>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">Current Password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                  className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                  placeholder="Enter current password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                >
                  {showCurrentPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">New Password</label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                    className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    placeholder="Enter new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                  >
                    {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">Confirm Password</label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    placeholder="Confirm new password"
                  />
                </div>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={handlePasswordChange}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Lock className="w-3.5 h-3.5" />
                Update Password
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Account Management - Compact */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">Account Management</h3>

        <div className="flex items-center justify-between p-3 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div>
            <h4 className="font-semibold text-sm text-[var(--v2-text-primary)]">Export Account Data</h4>
            <p className="text-xs text-[var(--v2-text-secondary)]">Download all your data</p>
          </div>
          <button
            onClick={handleExportData}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <Download className="w-3.5 h-3.5" />
            Export Data
          </button>
        </div>

        {/* Danger Zone — shared with /business-os/settings (N7) */}
        <DangerZonePanel />
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
