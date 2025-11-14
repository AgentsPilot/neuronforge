'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { useSearchParams } from 'next/navigation'
import {
  Settings,
  RefreshCw,
  PlugZap,
  User,
  Bell,
  Shield,
  BarChart3,
  Check,
  Clock,
  Globe
} from 'lucide-react'
import PluginsTab from '@/components/settings/PluginsTab'
import ProfileTab from '@/components/settings/ProfileTab'
import NotificationsTab from '@/components/settings/NotificationsTab'
import SecurityTab from '@/components/settings/SecurityTab'
import BillingSettings from '@/components/settings/BillingSettings'
import { UserProfile, NotificationSettings, PluginConnection } from '@/types/settings'

export default function SettingsPage() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(tabParam || 'profile')
  const [loading, setLoading] = useState(true)
  
  // Data states
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null)
  const [connections, setConnections] = useState<PluginConnection[]>([])

  // Form states
  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({})
  const [notificationsForm, setNotificationsForm] = useState<Partial<NotificationSettings>>({})

  const tabs = [
    {
      id: 'profile',
      label: 'Profile',
      icon: <User className="w-4 h-4" />,
      description: 'Personal information and settings'
    },
    {
      id: 'security',
      label: 'Security',
      icon: <Shield className="w-4 h-4" />,
      description: 'Privacy and security options'
    },
    {
      id: 'billing',
      label: 'Billing',
      icon: <BarChart3 className="w-4 h-4" />,
      description: 'Manage credits, plans, invoices, and usage'
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: <Bell className="w-4 h-4" />,
      description: 'Configure alerts and updates'
    },
    {
      id: 'plugins',
      label: 'Plugins',
      icon: <PlugZap className="w-4 h-4" />,
      description: 'Manage integrations and connections'
    }
  ]

  useEffect(() => {
    if (user?.id) {
      loadUserData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]) // Only reload when user ID changes, not the entire user object

  // Handle tab parameter from URL
  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam)
    }
  }, [tabParam])

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

      // Set profile data - merge profile and preferences
      if (profileRes.data) {
        const profileData = {
          ...profileRes.data,
          // Add preferences data
          preferred_currency: preferencesRes.data?.preferred_currency || 'USD',
          timezone: preferencesRes.data?.timezone,
          preferred_language: preferencesRes.data?.preferred_language
        }
        setProfile(profileData)
        setProfileForm(profileData)
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

  const saveProfile = async () => {
    if (!user) return

    try {
      // Update profiles table (only profile-specific fields)
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: profileForm.full_name,
          avatar_url: profileForm.avatar_url,
          company: profileForm.company,
          job_title: profileForm.job_title,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        })

      if (profileError) {
        console.error('Error saving profile:', profileError)
        throw profileError
      }

      // Update user_preferences table for timezone and language (currency is handled separately by CurrencySelector)
      if (profileForm.timezone || profileForm.language) {
        const { error: prefsError } = await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            timezone: profileForm.timezone,
            preferred_language: profileForm.language,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          })

        if (prefsError) {
          console.error('Error saving preferences:', prefsError)
          throw prefsError
        }
      }

      // Reload data to confirm changes
      await loadUserData()

      console.log('✅ Profile saved successfully')
    } catch (error) {
      console.error('Error saving profile:', error)
      throw error
    }
  }

  const saveNotifications = async () => {
    if (!user) return

    try {
      const { error } = await supabase
        .from('notification_settings')
        .upsert({
          user_id: user.id,
          ...notificationsForm,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })

      if (error) {
        console.error('Error saving notifications:', error)
        throw error
      }

      await loadUserData()
      console.log('✅ Notifications saved successfully')
    } catch (error) {
      console.error('Error saving notifications:', error)
      throw error
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
            onSave={saveProfile}
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
            onSave={saveNotifications}
          />
        )}
        {activeTab === 'security' && <SecurityTab />}
        {activeTab === 'billing' && <BillingSettings />}
      </div>
    </div>
  )
}