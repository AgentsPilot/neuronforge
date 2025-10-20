'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import {
  PlugZap,
  Search,
  Filter,
  Plus,
  Settings,
  Trash2,
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
  Activity
} from 'lucide-react'
import { PluginConnection } from '@/types/settings'

// Plugin icons mapping
const pluginIcons: Record<string, React.ReactNode> = {
  'google-mail': <Mail className="w-5 h-5" />,
  'gmail': <Mail className="w-5 h-5" />,
  'github': <Github className="w-5 h-5" />,
  'slack': <Slack className="w-5 h-5" />,
  'google-calendar': <Calendar className="w-5 h-5" />,
  'outlook': <Mail className="w-5 h-5" />,
  'whatsapp': <MessageCircle className="w-5 h-5" />,
  'twilio': <Phone className="w-5 h-5" />,
  'aws': <Cloud className="w-5 h-5" />,
}

interface PluginsTabProps {
  connections: PluginConnection[]
  setConnections: React.Dispatch<React.SetStateAction<PluginConnection[]>>
}

export default function PluginsTab({ connections, setConnections }: PluginsTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

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

  const handleDisconnectPlugin = async (connectionId: string) => {
    if (!confirm('Are you sure you want to disconnect this plugin? Any agents using this plugin may be affected.')) {
      return
    }

    try {
      setSuccessMessage('')
      setErrorMessage('')

      const { error } = await supabase
        .from('plugin_connections')
        .delete()
        .eq('id', connectionId)

      if (!error) {
        setConnections(prev => prev.filter(conn => conn.id !== connectionId))
        setSuccessMessage('Plugin disconnected successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error) {
      console.error('Error disconnecting plugin:', error)
      setErrorMessage('Failed to disconnect plugin. Please try again.')
      setTimeout(() => setErrorMessage(''), 5000)
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
                      <div className="p-2.5 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 shadow-md">
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
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Settings"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDisconnectPlugin(connection.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Disconnect"
                      >
                        <Trash2 className="w-4 h-4" />
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
    </div>
  )
}
