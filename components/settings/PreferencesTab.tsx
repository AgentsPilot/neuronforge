'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { 
  Save, 
  Loader2, 
  Monitor, 
  Sun, 
  Moon, 
  CheckCircle, 
  AlertCircle,
  Palette,
  Settings,
  Brain,
  Shield,
  Database,
  BarChart3,
  Globe,
  Zap
} from 'lucide-react'
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
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-4 shadow-lg">
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
        <div className="bg-gradient-to-r from-red-50 to-pink-50 rounded-2xl p-4 shadow-lg">
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

      {/* Preferences Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Palette className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Theme</p>
              <p className="text-2xl font-bold text-purple-900 capitalize">{currentTheme}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">AI Model</p>
              <p className="text-2xl font-bold text-indigo-900">{preferencesForm.default_model?.replace('gpt-', 'GPT-') || 'GPT-4'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Temperature</p>
              <p className="text-2xl font-bold text-purple-900">{preferencesForm.temperature || 0.7}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Analytics</p>
              <p className="text-2xl font-bold text-indigo-900">{preferencesForm.analytics_enabled ? 'On' : 'Off'}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Main Preferences Card - Single Card Like ProfileTab */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Settings className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">Preferences Settings</h3>
            <p className="text-sm text-slate-600 font-medium">Configure your application preferences and settings</p>
          </div>
        </div>

        {/* All content goes inside this single card */}
        <div className="space-y-8">
          {/* Appearance Settings */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
                <Palette className="w-5 h-5 text-white" />
              </div>
              <h4 className="text-lg font-bold text-slate-800">Appearance</h4>
            </div>
            
            {/* Theme Selection */}
            <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-50 to-indigo-50">
              <div className="mb-4">
                <h4 className="font-bold text-slate-900 mb-1">Theme</h4>
                <p className="text-sm text-slate-600 font-medium">Choose your preferred color scheme</p>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                {[
                  { value: 'light', label: 'Light', icon: Sun, gradient: 'from-yellow-400 to-orange-400', bgGradient: 'from-yellow-50 to-orange-50', borderColor: 'border-yellow-200' },
                  { value: 'dark', label: 'Dark', icon: Moon, gradient: 'from-slate-600 to-gray-700', bgGradient: 'from-slate-50 to-gray-50', borderColor: 'border-slate-200' },
                  { value: 'system', label: 'System', icon: Monitor, gradient: 'from-blue-500 to-indigo-500', bgGradient: 'from-blue-50 to-indigo-50', borderColor: 'border-blue-200' }
                ].map(({ value, label, icon: Icon, gradient, bgGradient, borderColor }) => {
                  const isSelected = currentTheme === value
                  return (
                    <button
                      key={value}
                      onClick={() => handleThemeChange(value as 'light' | 'dark' | 'system')}
                      className={`group relative overflow-hidden flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all duration-300 ${
                        isSelected
                          ? `bg-gradient-to-r ${bgGradient} ${borderColor} shadow-lg transform scale-105`
                          : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 hover:shadow-md hover:scale-102'
                      }`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      <div className={`relative w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-200 ${
                        isSelected 
                          ? `bg-gradient-to-br ${gradient}`
                          : 'bg-gradient-to-br from-slate-400 to-slate-500 group-hover:from-slate-500 group-hover:to-slate-600'
                      }`}>
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      <span className={`text-sm font-semibold transition-colors ${
                        isSelected ? 'text-slate-800' : 'text-slate-600 group-hover:text-slate-800'
                      }`}>
                        {label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Other Interface Preferences */}
            {[
              { key: 'compact_mode', label: 'Compact Mode', desc: 'Use a more compact interface', default: false, icon: Settings, gradient: 'from-slate-500 to-gray-500' },
              { key: 'show_timestamps', label: 'Show Timestamps', desc: 'Display timestamps in conversations', default: true, icon: Globe, gradient: 'from-green-500 to-emerald-500' }
            ].map((setting, index) => {
              const isEnabled = preferencesForm[setting.key as keyof UserPreferences] ?? setting.default
              
              return (
                <div 
                  key={setting.key} 
                  className={`group relative overflow-hidden p-5 rounded-2xl border-2 transition-all duration-300 hover:shadow-lg ${
                    isEnabled 
                      ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 shadow-md'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-200 ${
                        isEnabled 
                          ? `bg-gradient-to-br ${setting.gradient}`
                          : 'bg-gradient-to-br from-slate-400 to-slate-500'
                      }`}>
                        <setting.icon className="w-6 h-6 text-white" />
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
                        onChange={(e) => setPreferencesForm(prev => ({ ...prev, [setting.key]: e.target.checked }))}
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

          {/* AI Settings */}
          <div className="space-y-6 pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <h4 className="text-lg font-bold text-slate-800">AI Settings</h4>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-purple-50 to-indigo-50">
                <div>
                  <h4 className="font-bold text-slate-900">Default Model</h4>
                  <p className="text-sm text-slate-600 font-medium">Default AI model for new agents</p>
                </div>
                <select
                  value={preferencesForm.default_model || 'gpt-4'}
                  onChange={(e) => setPreferencesForm(prev => ({ ...prev, default_model: e.target.value }))}
                  className="px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-900 font-medium shadow-sm"
                >
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  <option value="claude-3">Claude 3</option>
                  <option value="gemini-pro">Gemini Pro</option>
                </select>
              </div>

              <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50">
                <div>
                  <h4 className="font-bold text-slate-900">Max Tokens</h4>
                  <p className="text-sm text-slate-600 font-medium">Maximum tokens per response</p>
                </div>
                <select
                  value={preferencesForm.max_tokens || 2000}
                  onChange={(e) => setPreferencesForm(prev => ({ ...prev, max_tokens: parseInt(e.target.value) }))}
                  className="px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 bg-white text-slate-900 font-medium shadow-sm"
                >
                  <option value="1000">1,000</option>
                  <option value="2000">2,000</option>
                  <option value="4000">4,000</option>
                  <option value="8000">8,000</option>
                </select>
              </div>

              <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-50 to-violet-50">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-slate-900">Temperature</h4>
                    <p className="text-sm text-slate-600 font-medium">Creativity level (0.0 - 2.0)</p>
                  </div>
                  <div className="px-3 py-2 bg-white border-2 border-amber-200 rounded-xl shadow-sm">
                    <span className="text-sm font-bold text-slate-700">
                      {preferencesForm.temperature || 0.7}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={preferencesForm.temperature || 0.7}
                  onChange={(e) => setPreferencesForm(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="w-full h-3 bg-gradient-to-r from-amber-200 to-orange-200 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-amber-500 [&::-webkit-slider-thumb]:to-orange-500 [&::-webkit-slider-thumb]:shadow-lg"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-2 font-medium">
                  <span>Focused</span>
                  <span>Balanced</span>
                  <span>Creative</span>
                </div>
              </div>
            </div>
          </div>

          {/* Data & Privacy */}
          <div className="space-y-6 pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-violet-500 rounded-xl flex items-center justify-center shadow-lg">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <h4 className="text-lg font-bold text-slate-800">Data & Privacy</h4>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-purple-50 to-violet-50">
                <div>
                  <h4 className="font-bold text-slate-900">Data Retention</h4>
                  <p className="text-sm text-slate-600 font-medium">How long to keep your conversation data</p>
                </div>
                <select
                  value={preferencesForm.data_retention_days || 365}
                  onChange={(e) => setPreferencesForm(prev => ({ ...prev, data_retention_days: parseInt(e.target.value) }))}
                  className="px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-slate-900 font-medium shadow-sm"
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                  <option value="-1">Forever</option>
                </select>
              </div>

              <div className="group relative overflow-hidden p-5 rounded-2xl transition-all duration-300 hover:shadow-lg bg-gradient-to-r from-indigo-50 to-purple-50 shadow-md">
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-indigo-500 to-purple-500">
                      <BarChart3 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-slate-800">Analytics</h4>
                      <p className="text-sm font-medium text-slate-600">Help improve the platform with usage analytics</p>
                    </div>
                  </div>
                  
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferencesForm.analytics_enabled ?? true}
                      onChange={(e) => setPreferencesForm(prev => ({ ...prev, analytics_enabled: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-14 h-8 rounded-full transition-all duration-300 shadow-lg ${
                      (preferencesForm.analytics_enabled ?? true) 
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500' 
                        : 'bg-slate-300'
                    }`}>
                      <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
                        (preferencesForm.analytics_enabled ?? true) ? 'translate-x-7' : 'translate-x-1'
                      } mt-1`} />
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Save/Cancel Buttons */}
          <div className="flex gap-3 pt-8 border-t border-gray-200">
            <button 
              onClick={savePreferences}
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold disabled:opacity-50 disabled:transform-none"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
            <button 
              onClick={() => setPreferencesForm(preferences || {})}
              className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 shadow-sm hover:shadow-md font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      
      {/* Theme Status */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
            <CheckCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-purple-900">Theme Setting Saved</p>
            <p className="text-sm text-purple-700 font-medium">
              Current selection: <strong>{currentTheme}</strong> - This saves your preference for future dark mode implementation.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}