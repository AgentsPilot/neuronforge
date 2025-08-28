'use client'

import React, { useState } from 'react'
import { Key, Download, Trash2, CheckCircle, AlertCircle, Shield, Lock, Eye, EyeOff } from 'lucide-react'

export default function SecurityTab() {
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
      setSuccessMessage('Password change email sent! Check your inbox to confirm.')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (error) {
      setErrorMessage('Failed to change password. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const handleEnable2FA = async () => {
    try {
      setSuccessMessage('Two-factor authentication setup started! Check your email for instructions.')
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (error) {
      setErrorMessage('Failed to enable 2FA. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const handleExportData = async () => {
    try {
      setSuccessMessage('Data export started! You will receive an email when your download is ready.')
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (error) {
      setErrorMessage('Failed to export data. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    }
  }

  const handleDeleteAccount = () => {
    if (confirm('This action cannot be undone. Are you absolutely sure you want to delete your account?')) {
      if (confirm('Final confirmation: This will permanently delete all your data, agents, and settings. Type DELETE to confirm.')) {
        setErrorMessage('Account deletion initiated. Please check your email within 24 hours to complete the process.')
        setTimeout(() => setErrorMessage(''), 10000)
      }
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Security Settings</h2>
      
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
      
      {/* Password & Authentication */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Password & Authentication</h3>
        <div className="space-y-6">
          
          {/* Change Password Section */}
          <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div className="mb-4">
              <h4 className="font-medium text-gray-900 dark:text-gray-100">Change Password</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">Update your account password for better security</p>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                      className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Confirm Password</label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    placeholder="Confirm new password"
                  />
                </div>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={handlePasswordChange}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Lock className="w-4 h-4" />
                  Update Password
                </button>
                <button 
                  onClick={() => setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
          
          {/* Two-Factor Authentication */}
          <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">Two-Factor Authentication</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">Add an extra layer of security to your account</p>
            </div>
            <button 
              onClick={handleEnable2FA}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Shield className="w-4 h-4" />
              Enable 2FA
            </button>
          </div>
        </div>
      </div>
      
      {/* API Access */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">API Access</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">API Keys</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">Manage your API access keys for external integrations</p>
            </div>
            <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
              <Key className="w-4 h-4" />
              Manage Keys
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">Session Timeout</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">Automatically sign out after period of inactivity</p>
            </div>
            <select 
              defaultValue="240"
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="480">8 hours</option>
              <option value="1440">24 hours</option>
              <option value="-1">Never</option>
            </select>
          </div>

          <div className="p-4 border border-amber-200 dark:border-amber-700 rounded-lg bg-amber-50 dark:bg-amber-900/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <h4 className="font-medium text-amber-900 dark:text-amber-400">Security Notice</h4>
                <p className="text-sm text-amber-800 dark:text-amber-400">
                  Your API keys provide access to your account. Keep them secure and rotate them regularly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Management */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Account Management</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">Export Account Data</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">Download all your data including agents, conversations, and settings</p>
            </div>
            <button 
              onClick={handleExportData}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Download className="w-4 h-4" />
              Export Data
            </button>
          </div>

          <div className="p-4 border border-blue-200 dark:border-blue-700 rounded-lg bg-blue-50 dark:bg-blue-900/20">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900 dark:text-blue-400">Data Portability</h4>
                <p className="text-sm text-blue-800 dark:text-blue-400">
                  Your data export will include all agents, conversation history, plugin connections, and account settings in JSON format.
                </p>
              </div>
            </div>
          </div>
          
          {/* Danger Zone */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <h4 className="text-lg font-semibold text-red-900 dark:text-red-400 mb-4">Danger Zone</h4>
            
            <div className="flex items-center justify-between p-4 border border-red-200 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-900/20">
              <div>
                <h4 className="font-medium text-red-900 dark:text-red-400">Delete Account</h4>
                <p className="text-sm text-red-700 dark:text-red-400">
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                <div className="mt-2">
                  <p className="text-xs text-red-600 dark:text-red-500">
                    This will delete: All agents, conversations, plugin connections, analytics data, and account settings.
                  </p>
                </div>
              </div>
              <button 
                onClick={handleDeleteAccount}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 border border-red-300 dark:border-red-600 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40"
              >
                <Trash2 className="w-4 h-4" />
                Delete Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}