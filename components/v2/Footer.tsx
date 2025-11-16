// components/v2/Footer.tsx
// Global footer component for V2 pages with Last Run info and action buttons

'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { getPluginAPIClient } from '@/lib/client/plugin-api-client'
import { DarkModeToggle } from '@/components/v2/DarkModeToggle'
import {
  Clock,
  Plus,
  Globe,
  Mail,
  MoreVertical,
  List,
  LayoutDashboard
} from 'lucide-react'
import {
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiGoogledocs,
  SiGooglesheets,
  SiGithub,
  SiSlack,
  SiHubspot,
  SiWhatsapp,
  SiTwilio,
  SiAmazon,
  SiOpenai,
  SiAirtable
} from 'react-icons/si'

interface ConnectedPlugin {
  plugin_key: string
  plugin_name?: string
  status: string
  is_expired?: boolean
}

export function V2Footer() {
  const router = useRouter()
  const { user } = useAuth()
  const [lastRunTime, setLastRunTime] = useState<Date | null>(null)
  const [connectedPlugins, setConnectedPlugins] = useState<ConnectedPlugin[]>([])
  const [hoveredPlugin, setHoveredPlugin] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!user) return

    const fetchLastRun = async () => {
      try {
        const { data: stats } = await supabase
          .from('agent_stats')
          .select('last_run_at')
          .eq('user_id', user.id)
          .order('last_run_at', { ascending: false })
          .limit(1)
          .single()

        if (stats?.last_run_at) {
          setLastRunTime(new Date(stats.last_run_at))
        }
      } catch (error) {
        console.error('Error fetching last run:', error)
      }
    }

    const fetchConnectedPlugins = async () => {
      try {
        // Use PluginAPIClient for request deduplication
        const apiClient = getPluginAPIClient()
        const status = await apiClient.getUserPluginStatus()

        console.log('Footer - API response:', status)
        console.log('Footer - active_expired:', status.active_expired)

        // Transform connected plugins
        const connected = status.connected?.map((plugin: any) => ({
          plugin_key: plugin.key,
          plugin_name: plugin.name,
          status: 'active',
          is_expired: false
        })) || []

        // Transform expired plugins from active_expired array
        const expiredKeys = status.active_expired || []
        console.log('Footer - expiredKeys:', expiredKeys)

        const expired = expiredKeys.map((pluginKey: string) => ({
          plugin_key: pluginKey,
          plugin_name: pluginKey, // Will be formatted by getPluginDisplayName
          status: 'expired',
          is_expired: true
        }))

        console.log('Footer - connected:', connected)
        console.log('Footer - expired:', expired)
        console.log('Footer - combined:', [...connected, ...expired])

        // Combine both lists
        setConnectedPlugins([...connected, ...expired])
      } catch (error) {
        console.error('Error fetching connected plugins:', error)
        setConnectedPlugins([])
      }
    }

    fetchLastRun()
    fetchConnectedPlugins()
  }, [user])

  const getTimeAgo = (date: Date | null) => {
    if (!date) return 'Never'
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 24) return `${Math.floor(hours / 24)}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  const getPluginDisplayName = (pluginKey: string) => {
    // Extract readable name from plugin key (e.g., "google_gmail" -> "Gmail")
    const name = pluginKey.split('_').pop() || pluginKey
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  // Plugin icons mapping with real brand icons from react-icons/si (Simple Icons)
  // Using authentic brand colors as seen in marketing page
  const pluginIcons: Record<string, React.ReactNode> = {
    'google-mail': <SiGmail className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#EA4335' }} />,
    'gmail': <SiGmail className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#EA4335' }} />,
    'google-calendar': <SiGooglecalendar className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#4285F4' }} />,
    'google-drive': <SiGoogledrive className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#4285F4' }} />,
    'google-docs': <SiGoogledocs className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#4285F4' }} />,
    'google-sheets': <SiGooglesheets className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#0F9D58' }} />,
    'github': <SiGithub className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#FFFFFF' }} />,
    'slack': <SiSlack className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#4A154B' }} />,
    'hubspot': <SiHubspot className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#FF7A59' }} />,
    'outlook': <Mail className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#0078D4' }} />,
    'whatsapp': <SiWhatsapp className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#25D366' }} />,
    'whatsapp-business': <SiWhatsapp className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#25D366' }} />,
    'twilio': <SiTwilio className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#F22F46' }} />,
    'aws': <SiAmazon className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#FF9900' }} />,
    'airtable': <SiAirtable className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#FCB400' }} />,
    'chatgpt-research': <SiOpenai className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#10A37F' }} />,
  }

  const getPluginIcon = (pluginKey: string) => {
    return pluginIcons[pluginKey] || <Globe className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
  }

  return (
    <div className="mt-6 sm:mt-8 lg:mt-10 pt-3 sm:pt-4 lg:pt-5">

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        {/* Last Run */}
        <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
          <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
          <span>Last Run</span>
          <span className="font-medium text-[var(--v2-text-primary)]">
            {getTimeAgo(lastRunTime)}
          </span>
        </div>

        {/* Connected Plugin Icons - Center */}
        {connectedPlugins.length > 0 && (
          <div className="flex gap-2 sm:gap-3 flex-wrap justify-center">
            {connectedPlugins.map((plugin) => (
              <div
                key={plugin.plugin_key}
                className="relative w-12 h-12 sm:w-14 sm:h-14 bg-[var(--v2-surface)] flex items-center justify-center flex-shrink-0 cursor-pointer transition-all duration-200 hover:scale-110 border border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:shadow-lg"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  boxShadow: 'var(--v2-shadow-card)'
                }}
                onMouseEnter={() => setHoveredPlugin(plugin.plugin_key)}
                onMouseLeave={() => setHoveredPlugin(null)}
                onClick={() => {
                  if (plugin.is_expired) {
                    router.push('/settings/connections')
                  }
                }}
              >
                {getPluginIcon(plugin.plugin_key)}
                {/* Status indicator - green for active, split green/orange for expired */}
                {plugin.is_expired ? (
                  // Split indicator: left green (connected), right orange (expired)
                  <div
                    className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border-2 shadow-sm overflow-hidden animate-pulse"
                    style={{ borderColor: 'var(--v2-bg)' }}
                  >
                    <div className="absolute inset-0 flex">
                      <div className="w-1/2 bg-green-500"></div>
                      <div className="w-1/2 bg-orange-500"></div>
                    </div>
                  </div>
                ) : (
                  // Solid green for fully active
                  <div
                    className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 shadow-sm"
                    style={{ borderColor: 'var(--v2-bg)' }}
                  ></div>
                )}

                {/* Tooltip with V2 design */}
                {hoveredPlugin === plugin.plugin_key && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-3 py-2 text-xs font-semibold whitespace-nowrap pointer-events-none animate-fade-in"
                    style={{
                      backgroundColor: 'var(--v2-surface)',
                      border: '1px solid var(--v2-border)',
                      color: 'var(--v2-text-primary)',
                      borderRadius: 'var(--v2-radius-button)',
                      boxShadow: 'var(--v2-shadow-card)',
                      zIndex: 1000
                    }}
                  >
                    {plugin.plugin_name || getPluginDisplayName(plugin.plugin_key)}
                    {plugin.is_expired && (
                      <div className="text-orange-500 text-[10px] mt-0.5">
                        Token Expired - Click to Reconnect
                      </div>
                    )}
                    {/* Tooltip arrow */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2"
                      style={{
                        top: '100%',
                        width: 0,
                        height: 0,
                        borderLeft: '6px solid transparent',
                        borderRight: '6px solid transparent',
                        borderTop: '6px solid var(--v2-surface)'
                      }}
                    ></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 sm:gap-2.5">
          {/* Dark Mode Toggle */}
          <DarkModeToggle />

          <button
            onClick={() => router.push('/agents/new')}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            title="Create New Agent"
          >
            <Plus className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[#3B82F6]" />
          </button>

          {/* 3-dot menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] flex items-center justify-center hover:scale-105 transition-transform duration-200 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title="Menu"
              aria-label="Menu"
            >
              <MoreVertical className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-[var(--v2-text-secondary)]" />
            </button>

            {menuOpen && (
              <>
                {/* Backdrop to close menu */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />

                {/* Dropdown menu */}
                <div className="absolute right-0 bottom-full mb-2 w-48 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] border border-[var(--v2-border)] z-50 overflow-hidden" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  <button
                    onClick={() => {
                      router.push('/v2/agent-list')
                      setMenuOpen(false)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <List className="w-4 h-4 text-[var(--v2-text-secondary)]" />
                    <span className="text-sm font-medium text-[var(--v2-text-primary)]">Agent List</span>
                  </button>
                  <button
                    onClick={() => {
                      router.push('/v2/dashboard')
                      setMenuOpen(false)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <LayoutDashboard className="w-4 h-4 text-[var(--v2-text-secondary)]" />
                    <span className="text-sm font-medium text-[var(--v2-text-primary)]">Dashboard</span>
                  </button>
                  <button
                    onClick={() => {
                      router.push('/agents/new')
                      setMenuOpen(false)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-[var(--v2-text-secondary)]" />
                    <span className="text-sm font-medium text-[var(--v2-text-primary)]">Create Agent</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
