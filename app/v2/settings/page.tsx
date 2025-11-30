'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  User,
  Shield,
  ArrowLeft
} from 'lucide-react'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import ProfileTabV2 from '@/components/v2/settings/ProfileTabV2'
import SecurityTabV2 from '@/components/v2/settings/SecurityTabV2'
import { UserProfile, NotificationSettings, PluginConnection } from '@/types/settings'
import { PageLoading } from '@/components/v2/ui/loading'

export default function V2SettingsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(tabParam || 'profile')
  const [loading, setLoading] = useState(true)

  // Data states
  const [, setProfile] = useState<UserProfile | null>(null)
  const [, setNotifications] = useState<NotificationSettings | null>(null)
  const [, setConnections] = useState<PluginConnection[]>([])

  // Form states
  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({})

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
    return <PageLoading message="Loading settings..." />
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Logo - First Line */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Back Button + Controls */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <V2Controls />
      </div>

      {/* Header */}
      <div>
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

      {/* Main Content */}
      <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-4 sm:p-5 lg:p-6" style={{ borderRadius: 'var(--v2-radius-card)' }}>
        {activeTab === 'profile' && (
          <ProfileTabV2
            profileForm={profileForm}
            setProfileForm={setProfileForm}
          />
        )}
        {activeTab === 'security' && <SecurityTabV2 />}
      </div>
    </div>
  )
}
