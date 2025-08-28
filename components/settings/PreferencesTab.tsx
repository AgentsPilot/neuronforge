'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, Monitor, Sun, Moon, CheckCircle, AlertCircle } from 'lucide-react'
import { UserPreferences } from '@/types/settings'

interface PreferencesTabProps {
  preferences: UserPreferences | null
  preferencesForm: Partial<UserPreferences>
  setPreferencesForm: React.Dispatch<React.SetStateAction<Partial<UserPreferences>>>
  onSave: () => void
}

export default function PreferencesTab({ 
  preferences, 
  preferencesForm, 
  setPreferencesForm, 
  onSave 
}: PreferencesTabProps) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark' | 'system'>('light')

  // Simple theme management that only affects specific elements
  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    setCurrentTheme(newTheme)
    setPreferencesForm(prev => ({ ...prev, theme: newTheme }))

    // Apply basic dark mode by adding/removing a class to body
    const body = document.body
    body.classList.remove('theme-light', 'theme-dark', 'theme-system')
    body.classList.add(`theme-${newTheme}`)

    // Save to database
    if (user) {
      try {
        await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            theme: newTheme,
            updated_at: new Date().toISOString()
          })
          
        setSuccessMessage(`Theme preference saved: ${newTheme}`)
        setTimeout(() => setSuccessMessage(''), 3000)
      } catch (error) {
        console.error('Error saving theme:', error)
        setErrorMessage('Failed to save theme preference.')
        setTimeout(() => setErrorMessage(''), 3000)
      }
    }
  }

  const savePreferences = async () => {
    if (!user) return
    
    try {
      setSaving(true)
      setSuccessMessage('')
      setErrorMessage('')
      
      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: user.id,
          ...preferencesForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      
      setSuccessMessage('Preferences updated successfully!')
      setTimeout(() => setSuccessMessage(''), 3000)
      
    } catch (error) {
      console.error('Error saving preferences:', error)
      setErrorMessage('Failed to save preferences. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Preferences</h2>
      
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-sm font-medium text-green-800">{successMessage}</p>
          </div>
        </div>
      )}
      
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-sm font-medium text-red-800">{errorMessage}</p>
          </div>
        </div>
      )}
      
      {/* Appearance Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Appearance</h3>
        <div className="space-y-4">
          
          {/* Theme Selection */}
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="mb-4">
              <h4 className="font-medium text-gray-900">Theme</h4>
              <p className="text-sm text-gray-600">Choose your preferred color scheme</p>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
                { value: 'system', label: 'System', icon: Monitor }
              ].map(({ value, label, icon: Icon }) => {
                const isSelected = currentTheme === value
                return (
                  <button
                    key={value}
                    onClick={() => handleThemeChange(value as 'light' | 'dark' | 'system')}
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Other preferences with standard styling */}
          {[
            { key: 'compact_mode', label: 'Compact Mode', desc: 'Use a more compact interface', default: false },
            { key: 'show_timestamps', label: 'Show Timestamps', desc: 'Display timestamps in conversations', default: true }
          ].map((setting) => (
            <div key={setting.key} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div>
                <h4 className="font-medium text-gray-900">{setting.label}</h4>
                <p className="text-sm text-gray-600">{setting.desc}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferencesForm[setting.key as keyof UserPreferences] ?? setting.default}
                  onChange={(e) => setPreferencesForm(prev => ({ ...prev, [setting.key]: e.target.checked }))}
                  className="sr-only"
                />
                <div className={`w-11 h-6 rounded-full transition-colors ${(preferencesForm[setting.key as keyof UserPreferences] ?? setting.default) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(preferencesForm[setting.key as keyof UserPreferences] ?? setting.default) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>
      
      {/* AI Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">AI Settings</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Default Model</h4>
              <p className="text-sm text-gray-600">Default AI model for new agents</p>
            </div>
            <select
              value={preferencesForm.default_model || 'gpt-4'}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, default_model: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="claude-3">Claude 3</option>
              <option value="gemini-pro">Gemini Pro</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Max Tokens</h4>
              <p className="text-sm text-gray-600">Maximum tokens per response</p>
            </div>
            <select
              value={preferencesForm.max_tokens || 2000}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, max_tokens: parseInt(e.target.value) }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            >
              <option value="1000">1,000</option>
              <option value="2000">2,000</option>
              <option value="4000">4,000</option>
              <option value="8000">8,000</option>
            </select>
          </div>

          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="font-medium text-gray-900">Temperature</h4>
                <p className="text-sm text-gray-600">Creativity level (0.0 - 2.0)</p>
              </div>
              <span className="text-sm font-medium text-gray-700">
                {preferencesForm.temperature || 0.7}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={preferencesForm.temperature || 0.7}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Focused</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
          </div>
        </div>
      </div>

      {/* Data & Privacy */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Data & Privacy</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Data Retention</h4>
              <p className="text-sm text-gray-600">How long to keep your conversation data</p>
            </div>
            <select
              value={preferencesForm.data_retention_days || 365}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, data_retention_days: parseInt(e.target.value) }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="-1">Forever</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Analytics</h4>
              <p className="text-sm text-gray-600">Help improve the platform with usage analytics</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferencesForm.analytics_enabled ?? true}
                onChange={(e) => setPreferencesForm(prev => ({ ...prev, analytics_enabled: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(preferencesForm.analytics_enabled ?? true) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(preferencesForm.analytics_enabled ?? true) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-6">
          <button 
            onClick={savePreferences}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button 
            onClick={() => setPreferencesForm(preferences || {})}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
      
      {/* Theme Status */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-900">Theme Setting Saved</p>
            <p className="text-xs text-blue-700">
              Current selection: <strong>{currentTheme}</strong> - This saves your preference for future dark mode implementation.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}