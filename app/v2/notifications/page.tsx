'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft } from 'lucide-react'
import { V2Header } from '@/components/v2/V2Header'
import NotificationsTabV2 from '@/components/v2/settings/NotificationsTabV2'
import { NotificationSettings } from '@/types/settings'

export default function V2NotificationsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null)
  const [notificationsForm, setNotificationsForm] = useState<Partial<NotificationSettings>>({})
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (user?.id) {
      loadNotificationSettings()
    }
  }, [user?.id])

  const loadNotificationSettings = async () => {
    if (!user) return

    try {
      setLoading(true)

      const { data: notificationsRes } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (notificationsRes) {
        setNotifications(notificationsRes)
        setNotificationsForm(notificationsRes)
      }

    } catch (error) {
      console.error('Error loading notification settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveNotifications = async () => {
    if (!user) {
      setErrorMessage('User not authenticated')
      return
    }

    try {
      setSuccessMessage('')
      setErrorMessage('')

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
        setErrorMessage('Failed to save notification settings. Please try again.')
        return
      }

      await loadNotificationSettings()
      setSuccessMessage('Notification settings updated successfully!')
      console.log('✅ Notifications saved successfully')
    } catch (error) {
      console.error('Error saving notifications:', error)
      setErrorMessage('Failed to save notification settings. Please try again.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-[var(--v2-text-secondary)] font-medium">Loading notifications...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Top Bar: Back Button + Token Display + User Menu */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <V2Header />
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-[var(--v2-text-primary)] mb-1 leading-tight">
          Notifications
        </h1>
        <p className="text-base sm:text-lg text-[var(--v2-text-secondary)] font-normal">
          Configure your notification preferences
        </p>
      </div>

      {/* Main Content */}
      <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-4 sm:p-5 lg:p-6" style={{ borderRadius: 'var(--v2-radius-card)' }}>
        <NotificationsTabV2
          notifications={notifications}
          notificationsForm={notificationsForm}
          setNotificationsForm={setNotificationsForm}
          onSave={saveNotifications}
          successMessage={successMessage}
          errorMessage={errorMessage}
        />
      </div>
    </div>
  )
}
