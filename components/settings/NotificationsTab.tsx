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
      
      const { error } = await supabase
        .from('notification_settings')
        .upsert({
          user_id: user.id,
          ...notificationsForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      
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
      icon: <Mail className="w-5 h-5" />,
      gradient: 'from-purple-500 to-indigo-500',
      bgGradient: 'from-purple-50 to-indigo-50'
    },
    { 
      key: 'email_agent_updates', 
      label: 'Agent Updates', 
      desc: 'Get notified when your agents complete tasks', 
      default: true,
      icon: <Bell className="w-5 h-5" />,
      gradient: 'from-indigo-500 to-purple-500',
      bgGradient: 'from-indigo-50 to-purple-50'
    },
    { 
      key: 'email_system_alerts', 
      label: 'System Alerts', 
      desc: 'Important system notifications and updates', 
      default: true,
      icon: <AlertCircle className="w-5 h-5" />,
      gradient: 'from-purple-500 to-violet-500',
      bgGradient: 'from-purple-50 to-violet-50'
    },
    { 
      key: 'email_marketing', 
      label: 'Marketing Updates', 
      desc: 'Product updates and promotional content', 
      default: false,
      icon: <Globe className="w-5 h-5" />,
      gradient: 'from-indigo-500 to-pink-500',
      bgGradient: 'from-indigo-50 to-pink-50'
    }
  ]

  return (
    <div className="space-y-6">
      {/* Notification Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Mail className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Email</p>
              <p className="text-2xl font-bold text-purple-900">{notificationsForm.email_enabled ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Bell className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Agents</p>
              <p className="text-2xl font-bold text-indigo-900">{notificationsForm.email_agent_updates ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <AlertCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">System</p>
              <p className="text-2xl font-bold text-purple-900">{notificationsForm.email_system_alerts ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Globe className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Marketing</p>
              <p className="text-2xl font-bold text-indigo-900">{notificationsForm.email_marketing ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Bell className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">Email Notifications</h3>
            <p className="text-sm text-slate-600 font-medium">Configure your notification preferences</p>
          </div>
        </div>
        
        <div className="space-y-4">
          {notificationSettings.map((setting, index) => {
            const isEnabled = notificationsForm[setting.key as keyof NotificationSettings] ?? setting.default
            
            return (
              <div 
                key={setting.key} 
                className={`group relative overflow-hidden p-5 rounded-2xl transition-all duration-300 hover:shadow-lg ${
                  isEnabled 
                    ? `bg-gradient-to-r ${setting.bgGradient} shadow-md`
                    : 'bg-white hover:bg-gray-50'
                }`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-200 ${
                      isEnabled 
                        ? `bg-gradient-to-br ${setting.gradient}`
                        : 'bg-gradient-to-br from-slate-400 to-slate-500'
                    }`}>
                      <div className="text-white">{setting.icon}</div>
                    </div>
                    <div>
                      <h4 className={`font-bold text-lg ${isEnabled ? 'text-slate-800' : 'text-slate-700'}`}>
                        {setting.label}
                      </h4>
                      <p className={`text-sm font-medium ${isEnabled ? 'text-slate-600' : 'text-slate-500'}`}>
                        {setting.desc}
                      </p>
                    </div>
                  </div>
                  
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => setNotificationsForm(prev => ({ ...prev, [setting.key]: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-14 h-8 rounded-full transition-all duration-300 shadow-lg ${
                      isEnabled 
                        ? `bg-gradient-to-r ${setting.gradient}` 
                        : 'bg-slate-300'
                    }`}>
                      <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
                        isEnabled ? 'translate-x-7' : 'translate-x-1'
                      } mt-1`} />
                    </div>
                  </label>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex gap-3 pt-8 border-t border-gray-200 mt-8">
          <button 
            onClick={saveNotifications}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold disabled:opacity-50 disabled:transform-none"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button 
            onClick={() => setNotificationsForm(notifications || {})}
            className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 shadow-sm hover:shadow-md font-semibold"
          >
            Cancel
          </button>
        </div>

        {/* Success/Error Messages - Below Save Button */}
        {successMessage && (
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-4 shadow-lg mt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-purple-800">Success!</p>
                <p className="text-sm text-purple-700">{successMessage}</p>
              </div>
            </div>
          </div>
        )}
        
        {errorMessage && (
          <div className="bg-gradient-to-r from-red-50 to-pink-50 rounded-2xl p-4 shadow-lg mt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-red-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                <AlertCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-red-800">Error</p>
                <p className="text-sm text-red-700">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}