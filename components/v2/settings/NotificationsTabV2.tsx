'use client'

import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, CheckCircle, AlertCircle, Mail, Bell, Megaphone } from 'lucide-react'
import { NotificationSettings } from '@/types/settings'

interface NotificationsTabV2Props {
  notifications: NotificationSettings | null
  notificationsForm: Partial<NotificationSettings>
  setNotificationsForm: React.Dispatch<React.SetStateAction<Partial<NotificationSettings>>>
  onSave: () => void
  successMessage: string
  errorMessage: string
}

export default function NotificationsTabV2({
  notifications,
  notificationsForm,
  setNotificationsForm,
  onSave,
  successMessage,
  errorMessage
}: NotificationsTabV2Props) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)

  const saveNotifications = async () => {
    if (!user) return

    try {
      setSaving(true)

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

    } catch (error) {
      console.error('Error saving notification settings:', error)
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
      icon: Bell
    },
    {
      key: 'email_marketing',
      label: 'Marketing Updates',
      desc: 'Product updates and promotional content',
      default: false,
      icon: Megaphone
    }
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {notificationSettings.map((setting) => {
          const isEnabled = Boolean(notificationsForm[setting.key as keyof NotificationSettings] ?? setting.default)
          const Icon = setting.icon

          return (
            <div
              key={setting.key}
              className="p-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 hover:shadow-sm transition-all duration-200"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[var(--v2-bg)] flex items-center justify-center" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    <Icon className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-[var(--v2-text-primary)]">{setting.label}</h4>
                    <p className="text-xs text-[var(--v2-text-secondary)]">{setting.desc}</p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => setNotificationsForm(prev => ({ ...prev, [setting.key]: e.target.checked }))}
                    className="sr-only"
                  />
                  <div className={`w-11 h-6 rounded-full transition-all duration-200 ${
                    isEnabled ? 'bg-[var(--v2-primary)]' : 'bg-gray-300 dark:bg-gray-600'
                  }`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${
                      isEnabled ? 'translate-x-6' : 'translate-x-1'
                    } mt-1`} />
                  </div>
                </label>
              </div>
            </div>
          )
        })}
      </div>

      {/* Save Button */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={saveNotifications}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-primary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
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
