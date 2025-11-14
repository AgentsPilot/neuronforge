'use client'

import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import {
  Download,
  Trash2,
  CheckCircle,
  AlertCircle,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react'

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
        console.error('Audit logging failed (non-critical):', auditError)
      }

      setSuccessMessage('Password updated successfully!')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      console.error('Error changing password:', error)
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
        console.error('Audit logging failed (non-critical):', auditError)
      }

      setSuccessMessage('Data exported successfully! Check your downloads folder.')
    } catch (error) {
      console.error('Error exporting data:', error)
      setErrorMessage('Failed to export data. Please try again.')
    }
  }

  const handleDeleteAccount = async () => {
    if (!user) return

    if (confirm('This action cannot be undone. Are you absolutely sure you want to delete your account?')) {
      if (confirm('Final confirmation: This will permanently delete all your data, agents, and settings.')) {
        try {
          setSuccessMessage('')
          setErrorMessage('')

          // AUDIT TRAIL: Log account deletion attempt
          try {
            await fetch('/api/audit/log', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-user-id': user.id
              },
              body: JSON.stringify({
                action: 'USER_ACCOUNT_DELETION_INITIATED',
                entityType: 'user',
                entityId: user.id,
                userId: user.id,
                resourceName: user.email || 'User Account',
                details: {
                  timestamp: new Date().toISOString(),
                  method: 'user_initiated',
                  deletion_scope: ['profiles', 'preferences', 'notifications', 'connections']
                },
                severity: 'critical',
                complianceFlags: ['SOC2', 'GDPR', 'CCPA']
              })
            })
          } catch (auditError) {
            console.error('Audit logging failed (non-critical):', auditError)
          }

          await Promise.all([
            supabase.from('profiles').delete().eq('id', user.id),
            supabase.from('user_preferences').delete().eq('user_id', user.id),
            supabase.from('notification_settings').delete().eq('user_id', user.id),
            supabase.from('plugin_connections').delete().eq('user_id', user.id)
          ])

          setErrorMessage('Account deletion initiated. Please check your email within 24 hours to complete the process.')
        } catch (error) {
          console.error('Error deleting account:', error)
          setErrorMessage('Failed to delete account. Please contact support.')
        }
      }
    }
  }

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

        {/* Danger Zone - Compact */}
        <div className="border-2 p-3 danger-zone" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm mb-1 danger-zone-title">Delete Account</h4>
              <p className="text-xs mb-2 danger-zone-text">
                Permanently delete your account and all data. This cannot be undone.
              </p>
              <div className="border p-2 danger-zone-warning" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <p className="text-xs font-medium danger-zone-warning-text">
                  This will delete: All agents, conversations, plugin connections, and settings.
                </p>
              </div>
            </div>
            <button
              onClick={handleDeleteAccount}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-md"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>
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
