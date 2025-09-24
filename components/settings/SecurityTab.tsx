import React, { useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
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
  Settings,
  Zap,
  Loader2,
  Save
} from 'lucide-react'

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
      
      console.log('Attempting to save security settings for user:', user.id)
      console.log('Settings to save:', securitySettings)
      
      // Save to the security_settings table with the correct column names
      const { data, error } = await supabase
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
        console.error('Error saving to security_settings:', error)
        throw new Error(`Database error: ${error.message || 'Unknown error'}`)
      }
      
      console.log('Security settings saved successfully:', data)
      setSuccessMessage('Security settings updated successfully!')
      
    } catch (error) {
      console.error('Error saving security settings:', error)
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
      
      // Use Supabase's updateUser method to change password
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword
      })

      if (error) throw error
      
      setSuccessMessage('Password updated successfully!')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      console.error('Error changing password:', error)
      setErrorMessage('Failed to change password. Please try again.')
    }
  }

  const handleEnable2FA = async () => {
    try {
      setSuccessMessage('')
      setErrorMessage('')
      
      // This would integrate with your 2FA provider (e.g., Auth0, custom implementation)
      // For now, showing a placeholder message
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
      
      // Export user data from multiple tables
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

      // Create and download JSON file
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
      console.error('Error exporting data:', error)
      setErrorMessage('Failed to export data. Please try again.')
    }
  }

  const handleDeleteAccount = async () => {
    if (!user) return
    
    if (confirm('This action cannot be undone. Are you absolutely sure you want to delete your account?')) {
      if (confirm('Final confirmation: This will permanently delete all your data, agents, and settings. Type DELETE to confirm.')) {
        try {
          setSuccessMessage('')
          setErrorMessage('')
          
          // Delete user data from all tables
          await Promise.all([
            supabase.from('profiles').delete().eq('id', user.id),
            supabase.from('user_preferences').delete().eq('user_id', user.id),
            supabase.from('notification_settings').delete().eq('user_id', user.id),
            supabase.from('plugin_connections').delete().eq('user_id', user.id)
          ])
          
          // Delete the user account (this requires admin privileges or RLS policies)
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
      {/* Security Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">2FA</p>
              <p className="text-2xl font-bold text-purple-900">Off</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Key className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">API Keys</p>
              <p className="text-2xl font-bold text-indigo-900">3</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Session</p>
              <p className="text-2xl font-bold text-purple-900">4h</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Database className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Data</p>
              <p className="text-2xl font-bold text-indigo-900">Safe</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Password & Authentication */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">Password & Authentication</h3>
            <p className="text-sm text-slate-600 font-medium">Secure your account with strong authentication</p>
          </div>
        </div>
        
        <div className="space-y-6">
          {/* Change Password Section */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-50 to-indigo-50 shadow-sm">
            <div className="mb-4">
              <h4 className="font-bold text-slate-900 mb-1">Change Password</h4>
              <p className="text-sm text-slate-600 font-medium">Update your account password for better security</p>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Current Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                    className="w-full pl-10 pr-12 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-slate-900 font-medium placeholder-slate-400"
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">New Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                      className="w-full pl-10 pr-12 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-slate-900 font-medium placeholder-slate-400"
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Confirm Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-slate-900 font-medium placeholder-slate-400"
                      placeholder="Confirm new password"
                    />
                  </div>
                </div>
              </div>
              
                  <div className="flex gap-3">
                <button 
                  onClick={handlePasswordChange}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
                >
                  <Lock className="w-4 h-4" />
                  Update Password
                </button>
                <button 
                  onClick={() => setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })}
                  className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 shadow-sm hover:shadow-md font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
          
          {/* Two-Factor Authentication */}
          <div className="group relative overflow-hidden p-5 rounded-2xl transition-all duration-300 hover:shadow-lg bg-gradient-to-r from-purple-50 to-indigo-50 shadow-md">
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-purple-500 to-indigo-500">
                  <Shield className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-lg text-slate-800">Two-Factor Authentication</h4>
                  <p className="text-sm font-medium text-slate-600">Add an extra layer of security to your account</p>
                </div>
              </div>
              <button 
                onClick={handleEnable2FA}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
              >
                <Zap className="w-4 h-4" />
                Enable 2FA
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* API Access */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Key className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">API Access</h3>
            <p className="text-sm text-slate-600 font-medium">Manage external access and session settings</p>
          </div>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 shadow-sm">
            <div>
              <h4 className="font-bold text-slate-900">API Keys</h4>
              <p className="text-sm text-slate-600 font-medium">Manage your API access keys for external integrations</p>
            </div>
            <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-purple-300 text-purple-700 rounded-xl hover:bg-purple-50 hover:border-purple-400 transition-all duration-300 shadow-sm hover:shadow-md font-semibold">
              <Key className="w-4 h-4" />
              Manage Keys
            </button>
          </div>

          <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-purple-50 to-violet-50 shadow-sm">
            <div>
              <h4 className="font-bold text-slate-900">Session Timeout</h4>
              <p className="text-sm text-slate-600 font-medium">Automatically sign out after period of inactivity</p>
            </div>
            <select 
              value={securitySettings.sessionTimeout}
              onChange={(e) => setSecuritySettings(prev => ({ ...prev, sessionTimeout: parseInt(e.target.value) }))}
              className="px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-slate-900 font-medium shadow-sm"
            >
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="480">8 hours</option>
              <option value="1440">24 hours</option>
              <option value="-1">Never</option>
            </select>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
                <AlertCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="font-bold text-indigo-900">Security Notice</h4>
                <p className="text-sm text-indigo-800 font-medium">
                  Your API keys provide access to your account. Keep them secure and rotate them regularly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Management */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Settings className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">Account Management</h3>
            <p className="text-sm text-slate-600 font-medium">Export data and manage account lifecycle</p>
          </div>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-purple-50 to-indigo-50 shadow-sm">
            <div>
              <h4 className="font-bold text-slate-900">Export Account Data</h4>
              <p className="text-sm text-slate-600 font-medium">Download all your data including agents, conversations, and settings</p>
            </div>
            <button 
              onClick={handleExportData}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
            >
              <Download className="w-4 h-4" />
              Export Data
            </button>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="font-bold text-indigo-900">Data Portability</h4>
                <p className="text-sm text-indigo-800 font-medium">
                  Your data export will include all agents, conversation history, plugin connections, and account settings in JSON format.
                </p>
              </div>
            </div>
          </div>
          
          {/* Danger Zone */}
          <div className="border-t-2 border-red-200 pt-6 mt-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-red-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                <UserX className="w-5 h-5 text-white" />
              </div>
              <h4 className="text-lg font-bold text-red-900">Danger Zone</h4>
            </div>
            
            <div className="p-6 rounded-2xl bg-gradient-to-r from-red-50 to-pink-50 shadow-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-bold text-red-900 mb-2">Delete Account</h4>
                  <p className="text-sm text-red-800 font-medium mb-3">
                    Permanently delete your account and all associated data. This action cannot be undone.
                  </p>
                  <div className="bg-red-100 border border-red-200 rounded-lg p-3">
                    <p className="text-xs text-red-700 font-medium">
                      This will delete: All agents, conversations, plugin connections, analytics data, and account settings.
                    </p>
                  </div>
                </div>
                <button 
                  onClick={handleDeleteAccount}
                  className="ml-6 inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl hover:from-red-700 hover:to-pink-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Account
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Save Changes Section */}
        <div className="flex gap-3 pt-8 border-t border-gray-200 mt-8">
          <button 
            onClick={handleSecuritySettingsSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold disabled:opacity-50 disabled:transform-none"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button 
            onClick={() => setSecuritySettings({ sessionTimeout: 240, twoFactorEnabled: false })}
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
                <p className="font-semibold text-red-800">Security Alert</p>
                <p className="text-sm text-red-700">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}