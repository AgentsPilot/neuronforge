// components/v2/Footer.tsx
// Global footer component for V2 pages with Last Run info and action buttons

'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { DarkModeToggle } from '@/components/v2/DarkModeToggle'
import { PluginRefreshModal } from '@/components/v2/PluginRefreshModal'
import {
  Clock,
  Plus,
  Globe,
  Mail,
  MoreVertical,
  List,
  LayoutDashboard,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw
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
  connected_at?: string
  expires_at?: string
  last_used?: string
  last_refreshed?: string
  username?: string
}

export function V2Footer() {
  const router = useRouter()
  const { user, connectedPlugins: connectedPluginsFromContext } = useAuth()
  const [lastRunTime, setLastRunTime] = useState<Date | null>(null)
  const [displayPlugins, setDisplayPlugins] = useState<ConnectedPlugin[]>([])
  const [hoveredPlugin, setHoveredPlugin] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [refreshModalOpen, setRefreshModalOpen] = useState(false)
  const [selectedPlugin, setSelectedPlugin] = useState<ConnectedPlugin | null>(null)

  // New state for inline refresh
  const [refreshingPlugin, setRefreshingPlugin] = useState<string | null>(null)
  const [refreshStatus, setRefreshStatus] = useState<{
    plugin: string
    status: 'success' | 'error'
    message?: string
  } | null>(null)

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

    // Transform connected plugins from UserProvider context
    if (connectedPluginsFromContext) {
      const plugins: ConnectedPlugin[] = Object.values(connectedPluginsFromContext).map((plugin: any) => ({
        plugin_key: plugin.key,
        plugin_name: plugin.name || plugin.displayName,
        status: plugin.is_expired ? 'expired' : 'active',
        is_expired: plugin.is_expired || false
      }))
      setDisplayPlugins(plugins)
    }

    fetchLastRun()
  }, [user, connectedPluginsFromContext])

  const handleRefreshComplete = async () => {
    // Close the modal after refresh
    setRefreshModalOpen(false)
    setSelectedPlugin(null)
    // The UserProvider context will automatically update connected plugins
  }

  // Refresh plugin token via API
  const handlePluginRefresh = async (plugin: ConnectedPlugin) => {
    if (!plugin.is_expired || refreshingPlugin) return

    setRefreshingPlugin(plugin.plugin_key)
    setRefreshStatus(null)

    try {
      // Call the refresh token API
      const response = await fetch('/api/plugins/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pluginKeys: [plugin.plugin_key]
        })
      })

      const result = await response.json()

      if (result.success && result.refreshed?.includes(plugin.plugin_key)) {
        // Success!
        setRefreshStatus({
          plugin: plugin.plugin_key,
          status: 'success'
        })

        // Clear success message after 2 seconds
        setTimeout(() => {
          setRefreshStatus(null)
          setRefreshingPlugin(null)

          // UserProvider will auto-update on next fetch
          // Manually update local state for immediate UI feedback
          setDisplayPlugins(prev => prev.map(p =>
            p.plugin_key === plugin.plugin_key
              ? { ...p, is_expired: false, status: 'active' }
              : p
          ))
        }, 2000)
      } else {
        // Failed or skipped
        const errorMsg = result.failed?.includes(plugin.plugin_key)
          ? 'Failed to refresh token. Click to try again.'
          : result.notFound?.includes(plugin.plugin_key)
          ? 'Plugin not found.'
          : result.message || 'Token refresh unsuccessful.'

        setRefreshStatus({
          plugin: plugin.plugin_key,
          status: 'error',
          message: errorMsg
        })

        // Clear error after 3 seconds
        setTimeout(() => {
          setRefreshStatus(null)
          setRefreshingPlugin(null)
        }, 3000)
      }
    } catch (error: any) {
      console.error('Plugin refresh error:', error)
      setRefreshStatus({
        plugin: plugin.plugin_key,
        status: 'error',
        message: error.message || 'Network error. Please try again.'
      })

      setTimeout(() => {
        setRefreshStatus(null)
        setRefreshingPlugin(null)
      }, 3000)
    }
  }

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
    // Map plugin keys to their proper display names
    const nameMap: Record<string, string> = {
      'google-mail': 'Google Mail',
      'gmail': 'Gmail',
      'google-calendar': 'Google Calendar',
      'google-drive': 'Google Drive',
      'google-docs': 'Google Docs',
      'google-sheets': 'Google Sheets',
      'github': 'GitHub',
      'slack': 'Slack',
      'hubspot': 'HubSpot',
      'outlook': 'Outlook',
      'whatsapp': 'WhatsApp',
      'whatsapp-business': 'WhatsApp Business',
      'twilio': 'Twilio',
      'aws': 'AWS',
      'airtable': 'Airtable',
      'chatgpt-research': 'ChatGPT Research',
      'linkedin': 'LinkedIn',
    }

    // Return mapped name or format the key as fallback
    if (nameMap[pluginKey]) {
      return nameMap[pluginKey]
    }

    // Fallback: convert "google-mail" -> "Google Mail"
    return pluginKey
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
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
        {displayPlugins.length > 0 && (
          <div className="flex gap-2 sm:gap-3 flex-wrap justify-center">
            {displayPlugins.map((plugin) => (
              <div
                key={plugin.plugin_key}
                className={`relative w-12 h-12 sm:w-14 sm:h-14 bg-[var(--v2-surface)]
                  flex items-center justify-center flex-shrink-0
                  transition-all duration-200 border border-[var(--v2-border)]
                  ${plugin.is_expired && !refreshingPlugin
                    ? 'cursor-pointer hover:scale-110 hover:border-[var(--v2-primary)] hover:shadow-lg'
                    : 'cursor-default'
                  }`}
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  boxShadow: 'var(--v2-shadow-card)'
                }}
                onMouseEnter={() => setHoveredPlugin(plugin.plugin_key)}
                onMouseLeave={() => setHoveredPlugin(null)}
                onClick={() => plugin.is_expired && handlePluginRefresh(plugin)}
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

                {/* Loading Overlay */}
                {refreshingPlugin === plugin.plugin_key && (
                  <div
                    className="absolute inset-0 bg-[var(--v2-surface)]/95 flex items-center justify-center backdrop-blur-sm"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 text-[var(--v2-primary)] animate-spin" />
                  </div>
                )}

                {/* Success Overlay */}
                {refreshStatus?.plugin === plugin.plugin_key && refreshStatus.status === 'success' && (
                  <div
                    className="absolute inset-0 bg-green-500/95 flex items-center justify-center animate-fade-in"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                  </div>
                )}

                {/* Error Overlay */}
                {refreshStatus?.plugin === plugin.plugin_key && refreshStatus.status === 'error' && (
                  <div
                    className="absolute inset-0 bg-red-500/95 flex items-center justify-center animate-fade-in"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <AlertCircle className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                  </div>
                )}

                {/* Tooltip with V2 design and connection info */}
                {hoveredPlugin === plugin.plugin_key && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-3 py-2.5 text-xs pointer-events-none animate-fade-in min-w-[200px]"
                    style={{
                      backgroundColor: 'var(--v2-surface)',
                      border: '1px solid var(--v2-border)',
                      color: 'var(--v2-text-primary)',
                      borderRadius: 'var(--v2-radius-button)',
                      boxShadow: 'var(--v2-shadow-card)',
                      zIndex: 1000
                    }}
                  >
                    <div className="font-semibold mb-1">
                      {getPluginDisplayName(plugin.plugin_key)}
                    </div>

                    {/* Connection Status */}
                    <div className="space-y-0.5 text-[10px] text-[var(--v2-text-muted)]">
                      <div className="flex justify-between gap-3">
                        <span>Status:</span>
                        <span className={plugin.is_expired ? 'text-orange-500 font-medium' : 'text-green-500 font-medium'}>
                          {plugin.is_expired ? 'Token Expired' : 'Connected'}
                        </span>
                      </div>

                      {plugin.username && (
                        <div className="flex justify-between gap-3">
                          <span>Account:</span>
                          <span className="font-medium text-[var(--v2-text-primary)] truncate max-w-[150px]" title={plugin.username}>
                            {plugin.username}
                          </span>
                        </div>
                      )}

                      {plugin.connected_at && (
                        <div className="flex justify-between gap-3">
                          <span>Connected:</span>
                          <span className="font-medium text-[var(--v2-text-primary)]">
                            {new Date(plugin.connected_at).toLocaleDateString()}
                          </span>
                        </div>
                      )}

                      {plugin.expires_at && (
                        <div className="flex justify-between gap-3">
                          <span>Expires:</span>
                          <span className="font-medium text-[var(--v2-text-primary)]">
                            {new Date(plugin.expires_at).toLocaleDateString()}
                          </span>
                        </div>
                      )}

                      {plugin.last_refreshed && (
                        <div className="flex justify-between gap-3">
                          <span>Last Refresh:</span>
                          <span className="font-medium text-[var(--v2-text-primary)]">
                            {getTimeAgo(new Date(plugin.last_refreshed))}
                          </span>
                        </div>
                      )}

                      {plugin.last_used && (
                        <div className="flex justify-between gap-3">
                          <span>Last Used:</span>
                          <span className="font-medium text-[var(--v2-text-primary)]">
                            {getTimeAgo(new Date(plugin.last_used))}
                          </span>
                        </div>
                      )}
                    </div>

                    {plugin.is_expired && (
                      <div className="text-orange-600 dark:text-orange-400 text-[11px] mt-2 pt-2 border-t border-[var(--v2-border)] font-semibold flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3" />
                        Click to refresh token
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

      {/* Plugin Refresh Modal */}
      {selectedPlugin && user && (
        <PluginRefreshModal
          isOpen={refreshModalOpen}
          onClose={() => {
            setRefreshModalOpen(false)
            setSelectedPlugin(null)
          }}
          pluginKey={selectedPlugin.plugin_key}
          pluginName={selectedPlugin.plugin_name || getPluginDisplayName(selectedPlugin.plugin_key)}
          userId={user.id}
          onRefreshComplete={handleRefreshComplete}
        />
      )}

      {/* CSS Animation for fade-in effect */}
      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-in-out;
        }
      `}</style>
    </div>
  )
}
