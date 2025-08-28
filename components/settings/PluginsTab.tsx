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
  Phone
} from 'lucide-react'
import { PluginConnection } from '@/types/settings'

// Plugin icons mapping
const pluginIcons: Record<string, React.ReactNode> = {
  'google-mail': <Mail className="w-5 h-5 text-red-600" />,
  'gmail': <Mail className="w-5 h-5 text-red-600" />,
  'github': <Github className="w-5 h-5 text-gray-800 dark:text-gray-200" />,
  'slack': <Slack className="w-5 h-5 text-purple-600" />,
  'google-calendar': <Calendar className="w-5 h-5 text-blue-500" />,
  'outlook': <Mail className="w-5 h-5 text-blue-600" />,
  'whatsapp': <MessageCircle className="w-5 h-5 text-green-600" />,
  'twilio': <Phone className="w-5 h-5 text-red-500" />,
  'aws': <Cloud className="w-5 h-5 text-orange-500" />,
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
      active: { icon: CheckCircle, color: 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400', text: 'Connected' },
      error: { icon: AlertTriangle, color: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400', text: 'Error' },
      expired: { icon: Clock, color: 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400', text: 'Expired' },
      disabled: { icon: XCircle, color: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400', text: 'Disconnected' }
    }
    
    const config = configs[status as keyof typeof configs] || configs.disabled
    const Icon = config.icon
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full border ${config.color}`}>
        <Icon className="w-3 h-3" />
        {config.text}
      </span>
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

  return (
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            <p className="text-sm font-medium text-green-800 dark:text-green-400">{successMessage}</p>
          </div>
        </div>
      )}
      
      {errorMessage && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="text-sm font-medium text-red-800 dark:text-red-400">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Plugin Connections</h2>
          <p className="text-gray-600 dark:text-gray-400">Manage your connected plugins and integrations</p>
        </div>
        <Link href="/settings/connections">
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            Connect New Plugin
          </button>
        </Link>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="pl-10 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="all">All Status</option>
            <option value="active">Connected</option>
            <option value="error">Error</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      {/* Connected Plugins */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Connected Plugins ({filteredConnections.length})
        </h3>
        
        {filteredConnections.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <PlugZap className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <p>No plugins connected yet</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredConnections.map((connection) => (
              <div 
                key={connection.id} 
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      {pluginIcons[connection.plugin_key] || <PlugZap className="w-5 h-5 text-gray-600 dark:text-gray-400" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {connection.plugin_name}
                        </h4>
                        {getStatusBadge(connection.status)}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Connected as <span className="font-medium">{connection.username || connection.email}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-500">
                        Last used: {connection.last_used ? formatDate(connection.last_used) : 'Never'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors" 
                      title="Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDisconnectPlugin(connection.id)}
                      className="p-2 text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 transition-colors" 
                      title="Disconnect"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {connection.status === 'error' && (
                  <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                    <p className="text-sm text-amber-800 dark:text-amber-400">
                      Connection error detected. The plugin may need to be reconnected.
                    </p>
                    <button className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300">
                      Reconnect Plugin →
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}