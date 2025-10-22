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
import PlanManagementTab from '@/components/settings/PlanManagementTab'
import { UserProfile, UserPreferences, NotificationSettings, PluginConnection } from '@/types/settings'

export default function SettingsPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('profile')
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
      id: 'profile',
      label: 'Profile',
      icon: <User className="w-4 h-4" />,
      description: 'Personal information and settings'
    },
    {
      id: 'plugins',
      label: 'Plugins',
      icon: <PlugZap className="w-4 h-4" />,
      description: 'Manage integrations and connections'
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: <Bell className="w-4 h-4" />,
      description: 'Configure alerts and updates'
    },
    {
      id: 'security',
      label: 'Security',
      icon: <Shield className="w-4 h-4" />,
      description: 'Privacy and security options'
    },
    {
      id: 'plan',
      label: 'Plan',
      icon: <BarChart3 className="w-4 h-4" />,
      description: 'Manage your subscription plan'
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
        supabase.from('plugin_connections').select('*').eq('user_id', user.id).neq('status', 'disconnected').order('connected_at', { ascending: false })
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
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
              <Settings className="h-8 w-8 text-white animate-pulse" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Loading Settings</h3>
            <p className="text-gray-600 text-sm">Loading your preferences...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header - Like Analytics */}
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
          <Settings className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
          Settings
        </h1>
        <p className="text-gray-600 mt-2">
          Manage your account, plugins, and preferences
        </p>
      </div>

      {/* Metrics Cards - Horizontal Compact */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <PlugZap className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-gray-600 font-medium">Plugins</p>
              <p className="text-xl font-bold text-gray-900">{connections.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Check className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-gray-600 font-medium">Sections</p>
              <p className="text-xl font-bold text-gray-900">{tabs.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-gray-600 font-medium">Updated</p>
              <p className="text-xl font-bold text-gray-900">Today</p>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-gray-600 font-medium">Status</p>
              <p className="text-xl font-bold text-gray-900">Active</p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls Card - Like Analytics */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            {/* View Navigation - Overview/Insights Style */}
            <div className="flex bg-gray-100/80 rounded-xl p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={loadUserData}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-sm font-medium shadow-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
        {activeTab === 'profile' && (
          <ProfileTab
            profile={profile}
            profileForm={profileForm}
            setProfileForm={setProfileForm}
            onSave={() => {/* handle save */}}
          />
        )}
        {activeTab === 'plugins' && (
          <PluginsTab
            connections={connections}
            setConnections={setConnections}
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
        {activeTab === 'plan' && <PlanManagementTab />}
      </div>
    </div>
  )
}