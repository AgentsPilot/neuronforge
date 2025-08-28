'use client'

import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
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
      
      const { error } = await supabase
        .from('notification_settings')
        .upsert({
          user_id: user.id,
          ...notificationsForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      
      setSuccessMessage('Notification settings updated successfully!')
      setTimeout(() => setSuccessMessage(''), 3000)
      
    } catch (error) {
      console.error('Error saving notification settings:', error)
      setErrorMessage('Failed to save notification settings. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setSaving(false)
    }
  }

  const notificationSettings = [
    { key: 'email_enabled', label: 'Email Notifications', desc: 'Receive notifications via email', default: true },
    { key: 'email_agent_updates', label: 'Agent Updates', desc: 'Get notified when your agents complete tasks', default: true },
    { key: 'email_system_alerts', label: 'System Alerts', desc: 'Important system notifications and updates', default: true },
    { key: 'email_marketing', label: 'Marketing Updates', desc: 'Product updates and promotional content', default: false }
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Notification Settings</h2>
      
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            <p className="text-sm font-medium text-green-800 dark:text-green-400">{successMessage}</p>
          </div>
        </div>
      )}
      
      {errorMessage && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="text-sm font-medium text-red-800 dark:text-red-400">{errorMessage}</p>
          </div>
        </div>
      )}
      
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Email Notifications</h3>
        <div className="space-y-4">
          {notificationSettings.map((setting) => (
            <div key={setting.key} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div>
                <h4 className="font-medium text-gray-900 dark:text-gray-100">{setting.label}</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">{setting.desc}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationsForm[setting.key as keyof NotificationSettings] ?? setting.default}
                  onChange={(e) => setNotificationsForm(prev => ({ ...prev, [setting.key]: e.target.checked }))}
                  className="sr-only"
                />
                <div className={`w-11 h-6 rounded-full transition-colors ${(notificationsForm[setting.key as keyof NotificationSettings] ?? setting.default) ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(notificationsForm[setting.key as keyof NotificationSettings] ?? setting.default) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
                </div>
              </label>
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-6">
          <button 
            onClick={saveNotifications}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button 
            onClick={() => setNotificationsForm(notifications || {})}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}