'use client'

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import {
  PlugZap,
  Search,
  Filter,
  Plus,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Mail,
  Github,
  Slack,
  Calendar,
  Cloud,
  MessageCircle,
  Phone,
  Activity,
  Unplug,
  FileText,
  Table,
  HardDrive,
  Briefcase,
  Bot,
  Loader2
} from 'lucide-react'
import { PluginConnection } from '@/types/settings'
import Image from 'next/image'

// Plugin icons mapping with real brand icons
const pluginIcons: Record<string, React.ReactNode> = {
  'google-mail': <Mail className="w-5 h-5 text-white" />,
  'gmail': <Mail className="w-5 h-5 text-white" />,
  'google-calendar': <Calendar className="w-5 h-5 text-white" />,
  'google-drive': <HardDrive className="w-5 h-5 text-white" />,
  'google-docs': <FileText className="w-5 h-5 text-white" />,
  'google-sheets': <Table className="w-5 h-5 text-white" />,
  'github': <Github className="w-5 h-5 text-white" />,
  'slack': <Slack className="w-5 h-5 text-white" />,
  'hubspot': <Briefcase className="w-5 h-5 text-white" />,
  'outlook': <Mail className="w-5 h-5 text-white" />,
  'whatsapp-business': <MessageCircle className="w-5 h-5 text-white" />,
  'twilio': <Phone className="w-5 h-5 text-white" />,
  'aws': <Cloud className="w-5 h-5 text-white" />,
  'chatgpt-research': <Activity className="w-5 h-5 text-white" />,
}

// Plugin icon background colors for brand consistency
const pluginIconColors: Record<string, string> = {
  'google-mail': 'from-red-500 to-red-600',
  'gmail': 'from-red-500 to-red-600',
  'google-calendar': 'from-blue-500 to-blue-600',
  'google-drive': 'from-green-500 to-green-600',
  'google-docs': 'from-blue-500 to-indigo-600',
  'google-sheets': 'from-green-500 to-emerald-600',
  'github': 'from-gray-700 to-gray-900',
  'slack': 'from-purple-500 to-purple-600',
  'hubspot': 'from-orange-500 to-orange-600',
  'outlook': 'from-blue-600 to-blue-700',
  'whatsapp-business': 'from-green-500 to-green-600',
  'twilio': 'from-red-600 to-red-700',
  'aws': 'from-orange-500 to-yellow-600',
  'chatgpt-research': 'from-emerald-500 to-teal-600',
  'default': 'from-purple-500 to-pink-600'
}

interface PluginsTabProps {
  connections: PluginConnection[]
  setConnections: React.Dispatch<React.SetStateAction<PluginConnection[]>>
}

export default function PluginsTab({ connections, setConnections }: PluginsTabProps) {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)
  const [selectedConnection, setSelectedConnection] = useState<PluginConnection | null>(null)
  const [mounted, setMounted] = useState(false)
  const [connectedAgents, setConnectedAgents] = useState<Array<{id: string, agent_name: string}>>([])
  const [loadingAgents, setLoadingAgents] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  const getStatusBadge = (status: string) => {
    const configs = {
      active: { icon: CheckCircle, color: 'emerald', text: 'Connected' },
      error: { icon: AlertTriangle, color: 'red', text: 'Error' },
      expired: { icon: Clock, color: 'gray', text: 'Expired' },
      disabled: { icon: XCircle, color: 'gray', text: 'Disconnected' }
    }

    const config = configs[status as keyof typeof configs] || configs.disabled
    const Icon = config.icon

    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-${config.color}-50 border border-${config.color}-200`}>
        <Icon className={`w-3.5 h-3.5 text-${config.color}-600`} />
        <span className={`text-xs font-semibold text-${config.color}-700`}>{config.text}</span>
      </div>
    )
  }

  const fetchConnectedAgents = async (pluginKey: string) => {
    if (!user) return

    setLoadingAgents(true)
    try {
      console.log('🔍 Fetching agents for plugin:', pluginKey)

      // Get all agents and filter in JavaScript since JSONB array querying is tricky
      const { data: allAgents, error } = await supabase
        .from('agents')
        .select('id, agent_name, connected_plugins')
        .eq('user_id', user.id)

      console.log('📊 All agents for user:', allAgents)

      if (error) {
        console.error('Error fetching agents:', error)
        setConnectedAgents([])
      } else {
        // Filter agents that have this plugin in their connected_plugins array
        const filtered = (allAgents || []).filter(agent => {
          const plugins = agent.connected_plugins
          console.log(`Agent "${agent.agent_name}" connected_plugins:`, plugins)

          // Check if connected_plugins is an array and includes the plugin
          if (Array.isArray(plugins)) {
            return plugins.includes(pluginKey)
          }

          // If it's an object (old format), check if the key exists and is true
          if (plugins && typeof plugins === 'object') {
            return plugins[pluginKey] === true
          }

          return false
        })

        console.log('🎯 Filtered agents using plugin:', filtered)
        setConnectedAgents(filtered.map(a => ({ id: a.id, agent_name: a.agent_name })))
      }
    } catch (error) {
      console.error('Error fetching connected agents:', error)
      setConnectedAgents([])
    } finally {
      setLoadingAgents(false)
    }
  }

  const openDisconnectModal = async (connection: PluginConnection) => {
    setSelectedConnection(connection)
    setShowDisconnectModal(true)
    // Fetch agents using this plugin
    await fetchConnectedAgents(connection.plugin_key)
  }

  const handleDisconnectPlugin = async () => {
    if (!selectedConnection || !user) return

    try {
      setSuccessMessage('')
      setErrorMessage('')
      setShowDisconnectModal(false)

      // Calculate connection duration for audit trail
      const connectedAt = selectedConnection.connected_at ? new Date(selectedConnection.connected_at) : null
      const connectionDurationDays = connectedAt
        ? Math.floor((Date.now() - connectedAt.getTime()) / (1000 * 60 * 60 * 24))
        : null

      const { error } = await supabase
        .from('plugin_connections')
        .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
        .eq('id', selectedConnection.id)

      if (!error) {
        setConnections(prev => prev.filter(conn => conn.id !== selectedConnection.id))
        setSuccessMessage('Plugin disconnected successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)

        // Log to audit trail
        try {
          await fetch('/api/audit-trail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'PLUGIN_DISCONNECTED',
              entityType: 'connection',
              entityId: selectedConnection.id,
              resourceName: selectedConnection.plugin_name,
              userId: user.id,
              details: {
                plugin_key: selectedConnection.plugin_key,
                plugin_name: selectedConnection.plugin_name,
                provider_email: selectedConnection.email,
                username: selectedConnection.username,
                connection_duration_days: connectionDurationDays,
                disconnected_from: 'settings_page'
              },
              severity: 'warning',
              complianceFlags: ['SOC2']
            })
          })
        } catch (auditError) {
          console.error('Failed to log audit trail:', auditError)
          // Don't fail the disconnect if audit logging fails
        }
      } else {
        setErrorMessage('Failed to disconnect plugin. Please try again.')
        setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (error) {
      console.error('Error disconnecting plugin:', error)
      setErrorMessage('Failed to disconnect plugin. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setSelectedConnection(null)
    }
  }

  const filteredConnections = connections.filter(connection => {
    const matchesSearch = connection.plugin_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      connection.username?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filterStatus === 'all' || connection.status === filterStatus
    return matchesSearch && matchesFilter
  })

  const activeConnections = connections.filter(c => c.status === 'active').length
  const errorConnections = connections.filter(c => c.status === 'error').length

  return (
    <div className="space-y-4">
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <p className="text-xs font-semibold text-emerald-900">{successMessage}</p>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <p className="text-xs font-semibold text-red-900">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Plugin Stats - Horizontal Compact Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <PlugZap className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-purple-700 font-medium">Total</p>
              <p className="text-xl font-bold text-purple-900">{connections.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <CheckCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-emerald-700 font-medium">Active</p>
              <p className="text-xl font-bold text-emerald-900">{activeConnections}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-pink-50 border border-red-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <AlertTriangle className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-red-700 font-medium">Errors</p>
              <p className="text-xl font-bold text-red-900">{errorConnections}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-blue-700 font-medium">Available</p>
              <p className="text-xl font-bold text-blue-900">50+</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header and Controls */}
      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Plugin Connections</h2>
            <p className="text-xs text-gray-600 mt-0.5">Manage your connected plugins and integrations</p>
          </div>
          <Link href="/settings/connections">
            <button className="inline-flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-xs font-semibold shadow-md">
              <Plus className="w-3.5 h-3.5" />
              Connect Plugin
            </button>
          </Link>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search plugins..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-400"
            />
          </div>
          <div className="relative">
            <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white text-gray-900"
            >
              <option value="all">All Status</option>
              <option value="active">Connected</option>
              <option value="error">Error</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>
      </div>

      {/* Connected Plugins */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Connected Plugins</h3>
          <div className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-semibold text-gray-700">
            {filteredConnections.length} found
          </div>
        </div>

        {filteredConnections.length === 0 ? (
          <div className="text-center py-16 bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl shadow-sm">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <PlugZap className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-2">No plugins connected yet</h3>
            <p className="text-sm text-gray-600 mb-4 max-w-md mx-auto">Start connecting your favorite tools and services</p>
            <Link href="/settings/connections">
              <button className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 text-sm font-semibold shadow-md">
                <Plus className="w-4 h-4" />
                Browse Plugins
              </button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredConnections.map((connection) => {
              return (
                <div
                  key={connection.id}
                  className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-4 hover:shadow-md transition-all duration-300"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`p-2.5 rounded-lg bg-gradient-to-br ${pluginIconColors[connection.plugin_key] || pluginIconColors.default} shadow-md`}>
                        {pluginIcons[connection.plugin_key] || <PlugZap className="w-5 h-5 text-white" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-semibold text-gray-900">
                            {connection.plugin_name}
                          </h4>
                          {getStatusBadge(connection.status)}
                        </div>

                        <div className="space-y-0.5">
                          <p className="text-xs text-gray-700">
                            Connected as <span className="font-semibold text-gray-900">{connection.username || connection.email}</span>
                          </p>
                          <p className="text-xs text-gray-500">
                            Last used: {connection.last_used ? formatDate(connection.last_used) : 'Never'} •
                            Connected: {formatDate(connection.connected_at)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => openDisconnectModal(connection)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors group relative"
                        aria-label="Disconnect plugin"
                      >
                        <Unplug className="w-4 h-4" />
                        <span className="absolute bottom-full right-0 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                          Disconnect Plugin
                        </span>
                      </button>
                    </div>
                  </div>

                  {connection.status === 'error' && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-red-900 mb-1">
                            Connection error detected
                          </p>
                          <p className="text-xs text-red-800 mb-2">
                            The plugin may need to be reconnected to work properly.
                          </p>
                          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs font-semibold">
                            Reconnect Plugin
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Disconnect Confirmation Modal */}
      {mounted && showDisconnectModal && selectedConnection && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={() => {
              setShowDisconnectModal(false)
              setSelectedConnection(null)
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-red-500 to-pink-600 p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                  <Unplug className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white">Disconnect Plugin</h3>
                  <p className="text-sm text-white/90">This action cannot be undone</p>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900 mb-1">
                    Warning: This may affect your agents
                  </p>
                  <p className="text-xs text-amber-800">
                    Any agents currently using this plugin may stop working properly after disconnection.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  You are about to disconnect:
                </p>
                <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className={`p-2 rounded-lg bg-gradient-to-br ${pluginIconColors[selectedConnection.plugin_key] || pluginIconColors.default} shadow-md`}>
                    {pluginIcons[selectedConnection.plugin_key] || <PlugZap className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-gray-900">
                      {selectedConnection.plugin_name}
                    </h4>
                    <p className="text-xs text-gray-600 truncate">
                      {selectedConnection.username || selectedConnection.email}
                    </p>
                  </div>
                </div>

                {/* Connected Agents List */}
                {loadingAgents ? (
                  <div className="flex items-center justify-center p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin text-gray-500 mr-2" />
                    <span className="text-xs text-gray-600">Loading connected agents...</span>
                  </div>
                ) : connectedAgents.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-red-600" />
                      <p className="text-sm font-semibold text-red-900">
                        {connectedAgents.length} {connectedAgents.length === 1 ? 'agent is' : 'agents are'} using this plugin:
                      </p>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1 p-3 bg-red-50 border border-red-200 rounded-lg">
                      {connectedAgents.map((agent) => (
                        <div key={agent.id} className="flex items-center gap-2 text-xs text-red-800">
                          <Bot className="w-3 h-3 flex-shrink-0" />
                          <span className="font-medium truncate">{agent.agent_name}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-red-700 font-medium">
                      ⚠️ These agents will no longer work after disconnection
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <p className="text-xs text-green-800">
                      No agents are currently using this plugin
                    </p>
                  </div>
                )}

                <p className="text-xs text-gray-600">
                  You can reconnect this plugin anytime from the connections page.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowDisconnectModal(false)
                  setSelectedConnection(null)
                }}
                className="px-4 py-2 text-sm font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnectPlugin}
                className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 rounded-lg shadow-md transition-all duration-300 flex items-center gap-2"
              >
                <Unplug className="w-4 h-4" />
                Disconnect Plugin
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
