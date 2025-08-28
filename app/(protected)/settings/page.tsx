'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Settings, RefreshCw, PlugZap, User, Bell, Shield } from 'lucide-react'
import PluginsTab from '@/components/settings/PluginsTab'
import ProfileTab from '@/components/settings/ProfileTab'
import NotificationsTab from '@/components/settings/NotificationsTab'
import SecurityTab from '@/components/settings/SecurityTab'
import PreferencesTab from '@/components/settings/PreferencesTab'
import { UserProfile, UserPreferences, NotificationSettings, PluginConnection } from '@/types/settings'

export default function SettingsPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('plugins')
  const [loading, setLoading] = useState(true)
  
  // Data states
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null)
  const [connections, setConnections] = useState<PluginConnection[]>([])
  
  // Form states
  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({})
  const [preferencesForm, setPreferencesForm] = useState<Partial<UserPreferences>>({})
  const [notificationsForm, setNotificationsForm] = useState<Partial<NotificationSettings>>({})

  const tabs = [
    { id: 'plugins', label: 'Plugins', icon: <PlugZap className="w-4 h-4" /> },
    { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
    { id: 'preferences', label: 'Preferences', icon: <Settings className="w-4 h-4" /> }
  ]

  useEffect(() => {
    if (user) {
      loadUserData()
    }
  }, [user])

  const loadUserData = async () => {
    if (!user) return
    
    try {
      setLoading(true)
      
      // Load all data in parallel
      const [profileRes, preferencesRes, notificationsRes, connectionsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('user_preferences').select('*').eq('user_id', user.id).single(),
        supabase.from('notification_settings').select('*').eq('user_id', user.id).single(),
        supabase.from('plugin_connections').select('*').eq('user_id', user.id).order('connected_at', { ascending: false })
      ])

      // Set profile data
      if (profileRes.data) {
        setProfile(profileRes.data)
        setProfileForm(profileRes.data)
      } else {
        const defaultProfile = {
          id: user.id,
          full_name: user.user_metadata?.full_name || '',
          avatar_url: user.user_metadata?.avatar_url || ''
        }
        setProfile(defaultProfile)
        setProfileForm(defaultProfile)
      }

      // Set other data
      if (preferencesRes.data) {
        setPreferences(preferencesRes.data)
        setPreferencesForm(preferencesRes.data)
      }

      if (notificationsRes.data) {
        setNotifications(notificationsRes.data)
        setNotificationsForm(notificationsRes.data)
      }

      if (connectionsRes.data) {
        setConnections(connectionsRes.data)
      }

    } catch (error) {
      console.error('Error loading user data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
        <span className="ml-3 text-gray-600 dark:text-gray-300">Loading settings...</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Settings className="w-8 h-8 text-gray-700 dark:text-gray-300" />
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
            </div>
            <p className="text-gray-600 dark:text-gray-400">Manage your account, plugins, and preferences</p>
          </div>
          <button 
            onClick={loadUserData}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            title="Refresh settings"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Tab Navigation */}
        <div className="lg:w-64">
          <nav className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 sticky top-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {tab.icon}
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {activeTab === 'plugins' && (
            <PluginsTab 
              connections={connections} 
              setConnections={setConnections}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileTab 
              profile={profile}
              profileForm={profileForm}
              setProfileForm={setProfileForm}
              onSave={() => {/* handle save */}}
            />
          )}
          {activeTab === 'notifications' && (
            <NotificationsTab 
              notifications={notifications}
              notificationsForm={notificationsForm}
              setNotificationsForm={setNotificationsForm}
              onSave={() => {/* handle save */}}
            />
          )}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'preferences' && (
            <PreferencesTab 
              preferences={preferences}
              preferencesForm={preferencesForm}
              setPreferencesForm={setPreferencesForm}
              onSave={() => {/* handle save */}}
            />
          )}
        </div>
      </div>
    </div>
  )
}