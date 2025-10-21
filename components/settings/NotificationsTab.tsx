'use client'

import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, CheckCircle, AlertCircle, Bell, Mail, Smartphone, Globe } from 'lucide-react'
import { NotificationSettings } from '@/types/settings'

interface NotificationsTabProps {
  notifications: NotificationSettings | null
  notificationsForm: Partial<NotificationSettings>
  setNotificationsForm: React.Dispatch<React.SetStateAction<Partial<NotificationSettings>>>
  onSave: () => void
}

export default function NotificationsTab({
  notifications,
  notificationsForm,
  setNotificationsForm,
  onSave
}: NotificationsTabProps) {
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

      const { error } = await supabase
        .from('notification_settings')
        .upsert({
          user_id: user.id,
          ...notificationsForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error

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
        });
      } catch (auditError) {
        // Silent failure for audit logging - don't break the user experience
        console.error('Audit logging failed (non-critical):', auditError);
      }

      setSuccessMessage('Notification settings updated successfully!')

    } catch (error) {
      console.error('Error saving notification settings:', error)
      setErrorMessage('Failed to save notification settings. Please try again.')
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
      key: 'email_agent_updates',
      label: 'Agent Updates',
      desc: 'Get notified when your agents complete tasks',
      default: true,
      icon: Bell
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
    <div className="space-y-4">
      {/* Notification Stats - Horizontal Compact Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-blue-700 font-medium">Email</p>
              <p className="text-xl font-bold text-blue-900">{notificationsForm.email_enabled ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Bell className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-purple-700 font-medium">Agents</p>
              <p className="text-xl font-bold text-purple-900">{notificationsForm.email_agent_updates ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <AlertCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-orange-700 font-medium">System</p>
              <p className="text-xl font-bold text-orange-900">{notificationsForm.email_system_alerts ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-emerald-700 font-medium">Marketing</p>
              <p className="text-xl font-bold text-emerald-900">{notificationsForm.email_marketing ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Notifications Card */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Email Notifications</h3>
          <p className="text-xs text-gray-600 mt-0.5">Configure your notification preferences</p>
        </div>

        <div className="space-y-3">
          {notificationSettings.map((setting) => {
            const isEnabled = Boolean(notificationsForm[setting.key as keyof NotificationSettings] ?? setting.default)
            const Icon = setting.icon

            return (
              <div
                key={setting.key}
                className="p-4 rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-200/50 hover:shadow-md transition-all duration-300"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-gray-900">{setting.label}</h4>
                      <p className="text-xs text-gray-600">{setting.desc}</p>
                    </div>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => setNotificationsForm(prev => ({ ...prev, [setting.key]: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-11 h-6 rounded-full transition-all duration-300 ${
                      isEnabled ? 'bg-gradient-to-r from-emerald-500 to-teal-600' : 'bg-gray-300'
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

        {/* Save/Cancel Buttons */}
        <div className="flex gap-2 pt-4 border-t border-gray-200 mt-4">
          <button
            onClick={saveNotifications}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-xs font-semibold shadow-md disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button
            onClick={() => setNotificationsForm(notifications || {})}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 text-xs font-semibold"
          >
            Cancel
          </button>
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
