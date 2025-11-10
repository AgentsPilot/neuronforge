'use client'

import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, CheckCircle, AlertCircle, Mail, Bell, Globe } from 'lucide-react'
import { NotificationSettings } from '@/types/settings'

interface NotificationsTabV2Props {
  notifications: NotificationSettings | null
  notificationsForm: Partial<NotificationSettings>
  setNotificationsForm: React.Dispatch<React.SetStateAction<Partial<NotificationSettings>>>
  onSave: () => void
}

export default function NotificationsTabV2({
  notifications,
  notificationsForm,
  setNotificationsForm,
  onSave
}: NotificationsTabV2Props) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const saveNotifications = async () => {
    if (!user) return

    try {
      setSaving(true)
      setSuccessMessage('')
      setErrorMessage('')

      // Get existing settings for audit trail
      const { data: existingSettings } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      await onSave()

      // AUDIT TRAIL: Log notification settings update
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id
          },
          body: JSON.stringify({
            action: 'SETTINGS_NOTIFICATIONS_UPDATED',
            entityType: 'settings',
            entityId: user.id,
            userId: user.id,
            resourceName: 'Notification Settings',
            before: existingSettings,
            after: notificationsForm,
            details: {
              fields_updated: Object.keys(notificationsForm).filter(key =>
                existingSettings?.[key] !== notificationsForm[key]
              ),
              timestamp: new Date().toISOString()
            },
            severity: 'info'
          })
        })
      } catch (auditError) {
        console.error('Audit logging failed (non-critical):', auditError)
      }

      setSuccessMessage('Notification settings updated successfully!')
      setTimeout(() => setSuccessMessage(''), 5000)

    } catch (error) {
      console.error('Error saving notification settings:', error)
      setErrorMessage('Failed to save notification settings. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setSaving(false)
    }
  }

  const notificationSettings = [
    {
      key: 'email_enabled',
      label: 'Email Notifications',
      desc: 'Receive notifications via email',
      default: true,
      icon: Mail
    },
    {
      key: 'email_system_alerts',
      label: 'System Alerts',
      desc: 'Important system notifications and updates',
      default: true,
      icon: AlertCircle
    },
    {
      key: 'email_marketing',
      label: 'Marketing Updates',
      desc: 'Product updates and promotional content',
      default: false,
      icon: Globe
    }
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {notificationSettings.map((setting) => {
          const isEnabled = Boolean(notificationsForm[setting.key as keyof NotificationSettings] ?? setting.default)
          const Icon = setting.icon

          return (
            <div
              key={setting.key}
              className="p-5 bg-[var(--v2-bg)] dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all duration-300"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-secondary)] flex items-center justify-center shadow-lg" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-base text-[var(--v2-text-primary)]">{setting.label}</h4>
                    <p className="text-sm text-[var(--v2-text-secondary)]">{setting.desc}</p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => setNotificationsForm(prev => ({ ...prev, [setting.key]: e.target.checked }))}
                    className="sr-only"
                  />
                  <div className={`w-14 h-7 rounded-full transition-all duration-300 ${
                    isEnabled ? 'bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)]' : 'bg-gray-300 dark:bg-gray-600'
                  }`}>
                    <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                      isEnabled ? 'translate-x-8' : 'translate-x-1'
                    } mt-1`} />
                  </div>
                </label>
              </div>
            </div>
          )
        })}
      </div>

      {/* Save/Cancel Buttons */}
      <div className="flex gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={saveNotifications}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
        <button
          onClick={() => setNotificationsForm(notifications || {})}
          className="px-5 py-3 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all duration-300 text-sm font-semibold"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          Cancel
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
