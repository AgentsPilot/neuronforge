import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { DangerZonePanel } from '@/components/business-os/purge/DangerZonePanel'
import { createLogger } from '@/lib/logger'
import {
  Key,
  Download,
  Trash2,
  CheckCircle,
  AlertCircle,
  Shield,
  Lock,
  Eye,
  EyeOff,
  Clock,
  Database,
  UserX,
  Zap,
  Loader2,
  Save
} from 'lucide-react'

const logger = createLogger({ module: 'SettingsSecurityTab' })

export default function SecurityTab() {
  const { user } = useAuth()
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [securitySettings, setSecuritySettings] = useState({
    sessionTimeout: 240,
    twoFactorEnabled: false
  })

  const handleSecuritySettingsSave = async () => {
    if (!user) {
      setErrorMessage('User not authenticated. Please log in again.')
      return
    }

    try {
      setSaving(true)
      setSuccessMessage('')
      setErrorMessage('')

      // Get existing settings for audit trail
      const { data: existingSettings } = await supabase
        .from('security_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      const { error } = await supabase
        .from('security_settings')
        .upsert({
          user_id: user.id,
          session_timeout_minutes: securitySettings.sessionTimeout,
          two_factor_enabled: securitySettings.twoFactorEnabled,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })
        .select()

      if (error) {
        throw new Error(`Database error: ${error.message || 'Unknown error'}`)
      }

      // AUDIT TRAIL: Log security settings update
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id
          },
          body: JSON.stringify({
            action: 'SETTINGS_SECURITY_UPDATED',
            entityType: 'settings',
            entityId: user.id,
            userId: user.id,
            resourceName: 'Security Settings',
            before: existingSettings,
            after: {
              session_timeout_minutes: securitySettings.sessionTimeout,
              two_factor_enabled: securitySettings.twoFactorEnabled
            },
            details: {
              fields_updated: ['session_timeout_minutes', 'two_factor_enabled'].filter(field => {
                const oldVal = existingSettings?.[field];
                const newVal = field === 'session_timeout_minutes'
                  ? securitySettings.sessionTimeout
                  : securitySettings.twoFactorEnabled;
                return oldVal !== newVal;
              }),
              timestamp: new Date().toISOString()
            },
            severity: 'critical',
            complianceFlags: ['SOC2', 'GDPR']
          })
        });
      } catch (auditError) {
        logger.error({ err: auditError }, 'Audit logging failed (non-blocking)');
      }

      setSuccessMessage('Security settings updated successfully!')

    } catch (error: any) {
      logger.error({ err: error }, 'Failed to save security settings')
      setErrorMessage(`Failed to save security settings: ${error.message || 'Database connection issue'}`)
    } finally {
      setSaving(false)
    }
  }

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
        });
      } catch (auditError) {
        logger.error({ err: auditError }, 'Audit logging failed (non-blocking)');
      }

      setSuccessMessage('Password updated successfully!')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      logger.error({ err: error }, 'Password change failed')
      setErrorMessage('Failed to change password. Please try again.')
    }
  }

  const handleEnable2FA = async () => {
    try {
      setSuccessMessage('')
      setErrorMessage('')
      setSuccessMessage('Two-factor authentication setup started! This feature will be available soon.')
    } catch (error) {
      setErrorMessage('Failed to enable 2FA. Please try again.')
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
    } catch (error) {
      logger.error({ err: error }, 'User data export failed')
      setErrorMessage('Failed to export data. Please try again.')
    }
  }

  /*
   * `handleDeleteAccount` removed (CR-1).
   *
   * It deleted four tables straight from the browser —
   *   profiles, user_preferences, notification_settings, plugin_connections
   * — and then told the customer "Account deletion initiated. Please check your
   * email within 24 hours to complete the process."
   *
   * Three things were wrong with that, and they compound:
   *   1. `profiles` must never be deleted (FR-30 / D3), and `user_preferences`
   *      is retained by BOTH purge levels by design, so the owner's next
   *      sign-in is not rendered in the wrong language. `plugin_connections` is
   *      an opt-in extra that defaults to OFF.
   *   2. No email is ever sent. There is no 24-hour process. The account
   *      survives; only the four tables do not.
   *   3. `Promise.all` inspected no result, and supabase-js does not throw on an
   *      RLS denial — it returns `{ error }`. So the customer saw the same
   *      confirmation whether all four deletes landed or none did. Both
   *      outcomes were lies, in opposite directions.
   *
   * Replaced by the shared, non-destructive Danger Zone panel. Real deletion
   * arrives through the Business OS purge flow, which is gated on live payment
   * state, snapshotted before it touches anything, descriptor-scoped, and
   * audited on outcome rather than intent.
   */

  return (
    <div className="space-y-4">
      {/* Security Stats - Horizontal Compact Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-blue-700 font-medium">Security</p>
              <p className="text-xl font-bold text-blue-900">Active</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Lock className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-emerald-700 font-medium">Password</p>
              <p className="text-xl font-bold text-emerald-900">Set</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-purple-700 font-medium">Session</p>
              <p className="text-xl font-bold text-purple-900">4h</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Database className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-orange-700 font-medium">Data</p>
              <p className="text-xl font-bold text-orange-900">Safe</p>
            </div>
          </div>
        </div>
      </div>

      {/* Password & Authentication */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Password & Authentication</h3>
          <p className="text-xs text-gray-600 mt-0.5">Secure your account with strong authentication</p>
        </div>

        <div className="space-y-3">
          {/* Change Password Section */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50 hover:shadow-md transition-all duration-300">
            <div className="mb-3">
              <h4 className="font-semibold text-gray-900 text-sm mb-0.5">Change Password</h4>
              <p className="text-xs text-gray-600">Update your account password</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Current Password</label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                    className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-400"
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showCurrentPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">New Password</label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                      className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-400"
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Confirm Password</label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-400"
                      placeholder="Confirm new password"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handlePasswordChange}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-xs font-semibold shadow-md"
                >
                  <Lock className="w-4 h-4" />
                  Update Password
                </button>
                <button
                  onClick={() => setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Management */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Account Management</h3>
          <p className="text-xs text-gray-600 mt-0.5">Export data and manage account lifecycle</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50 hover:shadow-md transition-all duration-300">
            <div>
              <h4 className="font-semibold text-sm text-gray-900">Export Account Data</h4>
              <p className="text-xs text-gray-600">Download all your data</p>
            </div>
            <button
              onClick={handleExportData}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-xs font-semibold shadow-md"
            >
              <Download className="w-4 h-4" />
              Export Data
            </button>
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/50">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="font-semibold text-sm text-emerald-900">Data Portability</h4>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Your data export includes all agents, conversations, and settings in JSON format.
                </p>
              </div>
            </div>
          </div>

          {/* Danger Zone — shared with the other settings surfaces (N7 / CR-1) */}
          <div className="border-t-2 border-red-200 pt-4 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-pink-600 rounded-lg flex items-center justify-center shadow-md">
                <UserX className="w-4 h-4 text-white" />
              </div>
              <h4 className="text-sm font-semibold text-red-900">Danger Zone</h4>
            </div>

            <DangerZonePanel />
          </div>
        </div>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <p className="text-xs font-semibold text-emerald-900">{successMessage}</p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-xs font-semibold text-red-900">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
