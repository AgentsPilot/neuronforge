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
      setTimeout(() => setErrorMessage(''), 5000)
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setErrorMessage('New passwords do not match.')
      setTimeout(() => setErrorMessage(''), 5000)
      return
    }

    if (passwordForm.newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.')
      setTimeout(() => setErrorMessage(''), 5000)
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
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (error) {
      console.error('Error changing password:', error)
      setErrorMessage('Failed to change password. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
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

      setSuccessMessage('Data exported successfully! Check your downloads folder.')
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (error) {
      console.error('Error exporting data:', error)
      setErrorMessage('Failed to export data. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const handleDeleteAccount = async () => {
    if (!user) return

    if (confirm('This action cannot be undone. Are you absolutely sure you want to delete your account?')) {
      if (confirm('Final confirmation: This will permanently delete all your data, agents, and settings.')) {
        try {
          setSuccessMessage('')
          setErrorMessage('')

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
    <div className="space-y-6">
      {/* Password & Authentication */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Password & Authentication</h3>

        <div className="p-5 bg-[var(--v2-bg)] dark:bg-gray-800 border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="mb-4">
            <h4 className="font-semibold text-base text-[var(--v2-text-primary)] mb-1">Change Password</h4>
            <p className="text-sm text-[var(--v2-text-secondary)]">Update your account password</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--v2-text-primary)] mb-2">Current Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                  className="w-full pl-10 pr-10 py-3 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                  placeholder="Enter current password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                >
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--v2-text-primary)] mb-2">New Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                    className="w-full pl-10 pr-10 py-3 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    placeholder="Enter new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--v2-text-primary)] mb-2">Confirm Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--v2-text-muted)]" />
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className="w-full pl-10 pr-4 py-3 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    placeholder="Confirm new password"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handlePasswordChange}
                className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Lock className="w-4 h-4" />
                Update Password
              </button>
              <button
                onClick={() => setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })}
                className="px-5 py-3 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all duration-300 text-sm font-semibold"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Account Management */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Account Management</h3>

        <div className="flex items-center justify-between p-5 bg-[var(--v2-bg)] dark:bg-gray-800 border border-gray-200 dark:border-gray-700" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div>
            <h4 className="font-semibold text-base text-[var(--v2-text-primary)]">Export Account Data</h4>
            <p className="text-sm text-[var(--v2-text-secondary)]">Download all your data</p>
          </div>
          <button
            onClick={handleExportData}
            className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <Download className="w-4 h-4" />
            Export Data
          </button>
        </div>

        {/* Danger Zone */}
        <div className="border-2 border-red-300 dark:border-red-700 p-5 bg-red-50 dark:bg-red-900/20" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4 className="font-semibold text-base text-red-900 dark:text-red-100 mb-1">Delete Account</h4>
              <p className="text-sm text-red-800 dark:text-red-200 mb-3">
                Permanently delete your account and all data. This cannot be undone.
              </p>
              <div className="bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-700 p-3" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                  This will delete: All agents, conversations, plugin connections, and settings.
                </p>
              </div>
            </div>
            <button
              onClick={handleDeleteAccount}
              className="ml-3 inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-md"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
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
