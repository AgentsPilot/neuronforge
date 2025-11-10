'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Settings,
  RefreshCw,
  PlugZap,
  User,
  Bell,
  Shield,
  BarChart3,
  ArrowLeft
} from 'lucide-react'
import { UserMenu } from '@/components/v2/UserMenu'
import ProfileTabV2 from '@/components/v2/settings/ProfileTabV2'
import SecurityTabV2 from '@/components/v2/settings/SecurityTabV2'
import { UserProfile, NotificationSettings, PluginConnection } from '@/types/settings'

export default function V2SettingsPage() {
  const { user } = useAuth()
  const router = useRouter()
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
    }
  ]

  useEffect(() => {
    if (user?.id) {
      loadUserData()
    }
  }, [user?.id])

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
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-[var(--v2-text-secondary)] font-medium">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* User Menu with Settings Icon */}
      <div className="absolute top-0 right-0 z-10">
        <UserMenu triggerIcon="settings" />
      </div>

      <div className="space-y-4 sm:space-y-5 lg:space-y-6">
        {/* Back Button */}
        <div>
          <button
            onClick={() => router.push('/v2/dashboard')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>

        {/* Header */}
        <div className="pr-12 sm:pr-14">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-[var(--v2-text-primary)] mb-1 leading-tight">
            Settings
          </h1>
          <p className="text-base sm:text-lg text-[var(--v2-text-secondary)] font-normal">
            Manage your account, preferences, and billing
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-1.5" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex flex-col sm:flex-row gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white shadow-[var(--v2-shadow-button)]'
                    : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Refresh Button */}
        <div className="flex justify-end">
          <button
            onClick={loadUserData}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-medium shadow-[var(--v2-shadow-button)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Main Content */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-4 sm:p-5 lg:p-6" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {activeTab === 'profile' && (
            <ProfileTabV2
              profile={profile}
              profileForm={profileForm}
              setProfileForm={setProfileForm}
              onSave={saveProfile}
            />
          )}
          {activeTab === 'security' && <SecurityTabV2 />}
        </div>
      </div>
    </div>
  )
}
