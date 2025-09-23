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
  Globe,
  Zap,
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

const pluginGradients: Record<string, { gradient: string; bgGradient: string }> = {
  'google-mail': { gradient: 'from-purple-500 to-indigo-500', bgGradient: 'from-purple-50 to-indigo-50' },
  'gmail': { gradient: 'from-purple-500 to-indigo-500', bgGradient: 'from-purple-50 to-indigo-50' },
  'github': { gradient: 'from-indigo-500 to-purple-500', bgGradient: 'from-indigo-50 to-purple-50' },
  'slack': { gradient: 'from-purple-500 to-violet-500', bgGradient: 'from-purple-50 to-violet-50' },
  'google-calendar': { gradient: 'from-indigo-500 to-purple-500', bgGradient: 'from-indigo-50 to-purple-50' },
  'outlook': { gradient: 'from-purple-500 to-indigo-500', bgGradient: 'from-purple-50 to-indigo-50' },
  'whatsapp': { gradient: 'from-purple-500 to-pink-500', bgGradient: 'from-purple-50 to-pink-50' },
  'twilio': { gradient: 'from-indigo-500 to-violet-500', bgGradient: 'from-indigo-50 to-violet-50' },
  'aws': { gradient: 'from-violet-500 to-purple-500', bgGradient: 'from-violet-50 to-purple-50' },
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
      active: { icon: CheckCircle, gradient: 'from-purple-500 to-indigo-500', bgGradient: 'from-purple-50 to-indigo-50', text: 'Connected' },
      error: { icon: AlertTriangle, gradient: 'from-red-500 to-pink-500', bgGradient: 'from-red-50 to-pink-50', text: 'Error' },
      expired: { icon: Clock, gradient: 'from-gray-500 to-slate-500', bgGradient: 'from-gray-50 to-slate-50', text: 'Expired' },
      disabled: { icon: XCircle, gradient: 'from-indigo-500 to-purple-500', bgGradient: 'from-indigo-50 to-purple-50', text: 'Disconnected' }
    }
    
    const config = configs[status as keyof typeof configs] || configs.disabled
    const Icon = config.icon
    
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl shadow-sm bg-gradient-to-r ${config.bgGradient}`}>
        <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${config.gradient} flex items-center justify-center shadow-sm`}>
          <Icon className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-semibold text-slate-700">{config.text}</span>
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
    <div className="space-y-6">
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-purple-800">Success!</p>
              <p className="text-sm text-purple-700">{successMessage}</p>
            </div>
          </div>
        </div>
      )}
      
      {errorMessage && (
        <div className="bg-gradient-to-r from-red-50 to-pink-50 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-red-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-red-800">Error</p>
              <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Plugin Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <PlugZap className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Total</p>
              <p className="text-2xl font-bold text-purple-900">{connections.length}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Active</p>
              <p className="text-2xl font-bold text-indigo-900">{activeConnections}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Errors</p>
              <p className="text-2xl font-bold text-purple-900">{errorConnections}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Available</p>
              <p className="text-2xl font-bold text-indigo-900">50+</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header and Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
              <PlugZap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Plugin Connections</h2>
              <p className="text-sm text-slate-600 font-medium">Manage your connected plugins and integrations</p>
            </div>
          </div>
          <Link href="/settings/connections">
            <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold">
              <Plus className="w-4 h-4" />
              Connect New Plugin
            </button>
          </Link>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search plugins..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium placeholder-slate-400"
            />
          </div>
          <div className="relative">
            <Filter className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="pl-10 pr-8 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium"
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
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full shadow-sm"></div>
          <h3 className="text-lg font-bold text-slate-800">Connected Plugins</h3>
          <div className="flex-1 h-px bg-gradient-to-r from-indigo-200 to-transparent"></div>
          <div className="px-3 py-1 bg-indigo-100 text-indigo-700 text-sm font-semibold rounded-full">
            {filteredConnections.length} found
          </div>
        </div>
        
        {filteredConnections.length === 0 ? (
          <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-400 to-slate-500 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-6">
              <PlugZap className="w-10 h-10 text-white" />
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">No plugins connected yet</h3>
            <p className="text-slate-500 font-medium mb-6">Start connecting your favorite tools and services</p>
            <Link href="/settings/connections">
              <button className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold">
                <Plus className="w-4 h-4" />
                Browse Plugins
              </button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredConnections.map((connection, index) => {
              const pluginStyle = pluginGradients[connection.plugin_key] || {
                gradient: 'from-slate-500 to-gray-500',
                bgGradient: 'from-slate-50 to-gray-50'
              }
              
              return (
                <div 
                  key={connection.id}
                  className="group bg-white/80 backdrop-blur-sm rounded-2xl p-6 hover:shadow-xl transition-all duration-300 shadow-lg"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`p-3 rounded-2xl shadow-lg bg-gradient-to-br ${pluginStyle.gradient}`}>
                        <div className="text-white">
                          {pluginIcons[connection.plugin_key] || <PlugZap className="w-5 h-5" />}
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                          <h4 className="text-lg font-bold text-slate-900">
                            {connection.plugin_name}
                          </h4>
                          {getStatusBadge(connection.status)}
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-sm text-slate-700 font-medium">
                            Connected as <span className="font-bold text-slate-900">{connection.username || connection.email}</span>
                          </p>
                          <p className="text-xs text-slate-500 font-medium">
                            Last used: {connection.last_used ? formatDate(connection.last_used) : 'Never'} • 
                            Connected: {formatDate(connection.connected_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      <button 
                        className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all duration-200" 
                        title="Settings"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDisconnectPlugin(connection.id)}
                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200" 
                        title="Disconnect"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  {connection.status === 'error' && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-red-50 to-pink-50 rounded-xl shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-r from-red-500 to-pink-500 rounded-lg flex items-center justify-center shadow-sm">
                          <AlertTriangle className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-red-800">
                            Connection error detected
                          </p>
                          <p className="text-xs text-red-700">
                            The plugin may need to be reconnected to work properly.
                          </p>
                        </div>
                      </div>
                      <button className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-lg hover:from-red-700 hover:to-pink-700 transition-all duration-300 shadow-sm font-semibold text-sm">
                        <Zap className="w-3 h-3" />
                        Reconnect Plugin
                      </button>
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