'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { 
  Settings, 
  RefreshCw, 
  PlugZap, 
  User, 
  Bell, 
  Shield, 
  BarChart3,
  Sparkles,
  Check,
  Clock,
  Globe
} from 'lucide-react'
import PluginsTab from '@/components/settings/PluginsTab'
import ProfileTab from '@/components/settings/ProfileTab'
import NotificationsTab from '@/components/settings/NotificationsTab'
import SecurityTab from '@/components/settings/SecurityTab'
import PreferencesTab from '@/components/settings/PreferencesTab'
import UsageTab from '@/components/settings/UsageTab'
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
    { 
      id: 'plugins', 
      label: 'Plugins', 
      icon: <PlugZap className="w-4 h-4" />,
      description: 'Manage integrations and connections',
      gradient: 'from-purple-500 to-indigo-500',
      bgGradient: 'from-purple-50 to-indigo-50',
      textColor: 'text-purple-700'
    },
    { 
      id: 'profile', 
      label: 'Profile', 
      icon: <User className="w-4 h-4" />,
      description: 'Personal information and settings',
      gradient: 'from-indigo-500 to-purple-500',
      bgGradient: 'from-indigo-50 to-purple-50',
      textColor: 'text-indigo-700'
    },
    { 
      id: 'notifications', 
      label: 'Notifications', 
      icon: <Bell className="w-4 h-4" />,
      description: 'Configure alerts and updates',
      gradient: 'from-purple-500 to-violet-500',
      bgGradient: 'from-purple-50 to-violet-50',
      textColor: 'text-purple-700'
    },
    { 
      id: 'security', 
      label: 'Security', 
      icon: <Shield className="w-4 h-4" />,
      description: 'Privacy and security options',
      gradient: 'from-indigo-500 to-violet-500',
      bgGradient: 'from-indigo-50 to-violet-50',
      textColor: 'text-indigo-700'
    },
    { 
      id: 'preferences', 
      label: 'Preferences', 
      icon: <Settings className="w-4 h-4" />,
      description: 'Customize your experience',
      gradient: 'from-violet-500 to-purple-500',
      bgGradient: 'from-violet-50 to-purple-50',
      textColor: 'text-violet-700'
    },
    { 
      id: 'usage', 
      label: 'Usage & Analytics', 
      icon: <BarChart3 className="w-4 h-4" />,
      description: 'Monitor usage and performance',
      gradient: 'from-purple-500 to-pink-500',
      bgGradient: 'from-purple-50 to-pink-50',
      textColor: 'text-purple-700'
    }
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

  const activeTabData = tabs.find(tab => tab.id === activeTab) || tabs[0]

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Loading Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
            <Settings className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-indigo-800 to-purple-800 bg-clip-text text-transparent">
            Settings
          </h1>
          <p className="text-gray-600 font-medium">Manage your account, plugins, and preferences</p>
        </div>

        <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-3xl shadow-xl mb-6">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">Loading Settings</h3>
          <p className="text-slate-500 font-medium">Please wait while we load your preferences...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Modern Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
          <Settings className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-indigo-800 to-purple-800 bg-clip-text text-transparent">
          Settings
        </h1>
        <p className="text-gray-600 font-medium">Manage your account, plugins, and preferences</p>
      </div>

      {/* Settings Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <PlugZap className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Plugins</p>
              <p className="text-2xl font-bold text-purple-900">{connections.length}</p>
            </div>
          </div>
          <p className="text-xs text-purple-600 font-medium mt-3">
            Active connections
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Check className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Configured</p>
              <p className="text-2xl font-bold text-indigo-900">{tabs.length}</p>
            </div>
          </div>
          <p className="text-xs text-indigo-600 font-medium mt-3">
            Settings sections
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Last Updated</p>
              <p className="text-2xl font-bold text-purple-900">Today</p>
            </div>
          </div>
          <p className="text-xs text-purple-600 font-medium mt-3">
            Profile synced
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Globe className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Status</p>
              <p className="text-2xl font-bold text-indigo-900">Active</p>
            </div>
          </div>
          <p className="text-xs text-indigo-600 font-medium mt-3">
            Account status
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Account Settings</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Currently viewing: <span className="font-semibold text-indigo-600">{activeTabData.label}</span>
            </p>
          </div>
          <button 
            onClick={loadUserData}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 text-sm font-semibold"
            title="Refresh settings"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Horizontal Tab Navigation */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl overflow-hidden">
        <div className="flex justify-center overflow-x-auto scrollbar-hide">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group relative flex-shrink-0 flex items-center gap-3 px-6 py-4 transition-all duration-300 border-b-2 ${
                activeTab === tab.id
                  ? `bg-gradient-to-r ${tab.bgGradient} border-indigo-500`
                  : 'border-transparent hover:bg-slate-50 hover:border-slate-200'
              }`}
              style={{ minWidth: '140px' }}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 ${
                activeTab === tab.id 
                  ? `bg-gradient-to-br ${tab.gradient} shadow-md`
                  : 'bg-gradient-to-br from-slate-400 to-slate-500 group-hover:from-slate-500 group-hover:to-slate-600'
              }`}>
                <div className="text-white">{tab.icon}</div>
              </div>
              <div className={`font-semibold text-sm transition-colors ${
                activeTab === tab.id ? tab.textColor : 'text-slate-700 group-hover:text-slate-900'
              }`}>
                {tab.label}
              </div>
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
        {/* Tab Header */}
        <div className={`p-6 border-b border-gray-200/50 bg-gradient-to-r ${activeTabData.bgGradient} rounded-t-2xl`}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 bg-gradient-to-br ${activeTabData.gradient} rounded-2xl flex items-center justify-center shadow-lg`}>
              <div className="text-white">{activeTabData.icon}</div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{activeTabData.label}</h2>
              <p className="text-sm text-slate-600 font-medium">{activeTabData.description}</p>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
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
          {activeTab === 'usage' && <UsageTab />}
        </div>
      </div>

      {/* Bottom Help Section */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-3xl p-8 text-white shadow-2xl">
        <div className="text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl shadow-xl mb-2">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold">Need Help with Settings?</h3>
          <p className="text-indigo-100 font-medium max-w-2xl mx-auto leading-relaxed">
            Having trouble configuring your account? Check out our help documentation or contact support for personalized assistance.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <button className="inline-flex items-center gap-2 px-6 py-3 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105">
              <Settings className="w-4 h-4" />
              Help Center
            </button>
            <button className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105">
              Contact Support
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}