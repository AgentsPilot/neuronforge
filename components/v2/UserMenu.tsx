'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import {
  Settings,
  CreditCard,
  Bell,
  LogOut,
  User,
  ChevronDown
} from 'lucide-react'

interface UserMenuProps {
  triggerIcon?: 'avatar' | 'settings'
}

export function UserMenu({ triggerIcon = 'avatar' }: UserMenuProps) {
  const router = useRouter()
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Fetch user profile (reuse V1 logic)
  useEffect(() => {
    if (!user?.id) return

    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, avatar_url, company, job_title')
          .eq('id', user.id)
          .single()

        if (!error && data) {
          setProfile(data)
        }
      } catch (err) {
        console.error('Profile fetch error:', err)
      }
    }

    fetchProfile()
  }, [user?.id])

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Logout handler (reuse V1 logic)
  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut()

      if (error) {
        console.error('Logout error:', error)
      }

      // Use window.location.href for clean redirect
      window.location.href = '/login'

    } catch (error) {
      console.error('Unexpected logout error:', error)
      window.location.href = '/login'
    }
  }

  const getUserInitials = () => {
    if (profile?.full_name) {
      return profile.full_name.charAt(0).toUpperCase()
    }
    if (user?.email) {
      return user.email.charAt(0).toUpperCase()
    }
    return 'U'
  }

  const getUserName = () => {
    return profile?.full_name || user?.email?.split('@')[0] || 'User'
  }

  const getUserEmail = () => {
    return user?.email || 'user@example.com'
  }

  const menuItems = [
    {
      icon: Settings,
      label: 'Settings',
      onClick: () => {
        setIsOpen(false)
        router.push('/v2/settings') // V2 settings page (Profile + Security)
      }
    },
    {
      icon: CreditCard,
      label: 'Billing',
      onClick: () => {
        setIsOpen(false)
        router.push('/v2/billing') // V2 billing page
      }
    },
    {
      icon: Bell,
      label: 'Notifications',
      onClick: () => {
        setIsOpen(false)
        router.push('/v2/notifications') // V2 notifications page
      }
    },
    {
      icon: LogOut,
      label: 'Logout',
      onClick: handleLogout,
      danger: true
    }
  ]

  return (
    <div className="relative" ref={menuRef}>
      {/* User Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:scale-105 transition-all duration-200 ${
          triggerIcon === 'settings' ? 'px-4 py-2.5' : 'p-2'
        }`}
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        {triggerIcon === 'settings' ? (
          /* Settings Icon */
          <Settings className="w-5 h-5 text-[var(--v2-text-secondary)]" />
        ) : (
          <>
            {/* User Avatar */}
            <div
              className="w-8 h-8 bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-secondary)] flex items-center justify-center text-white font-semibold text-sm overflow-hidden"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Profile"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                  }}
                />
              ) : (
                getUserInitials()
              )}
            </div>

            {/* Dropdown indicator - hidden on mobile */}
            <ChevronDown
              className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform duration-200 hidden sm:block ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-64 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] border border-gray-200 dark:border-gray-700 overflow-hidden z-50"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          {/* User Info */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-secondary)] flex items-center justify-center text-white font-semibold overflow-hidden"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                    }}
                  />
                ) : (
                  getUserInitials()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                  {getUserName()}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)] truncate">
                  {getUserEmail()}
                </p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            {menuItems.map((item, index) => {
              const Icon = item.icon
              return (
                <button
                  key={index}
                  onClick={item.onClick}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    item.danger
                      ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                      : 'text-[var(--v2-text-primary)] hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
