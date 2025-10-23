'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle, PlugZap, XCircle, Loader2, Clock, ChevronDown, ChevronUp, Settings, Bot } from 'lucide-react'
import { useAuth } from '@/components/UserProvider'
import { getPluginAPIClient } from '@/lib/client/plugin-api-client'
import AdditionalConfigModal from './AdditionalConfigModal'
import { AdditionalConfig } from '@/lib/types/plugin-additional-config'
import { supabase } from '@/lib/supabaseClient'

interface ConnectionDetails {
  key: string
  name: string
  username?: string
  email?: string
  last_used?: string
  connected_at?: string
}

interface PluginCardProps {
  pluginKey: string
  pluginName: string
  description: string
  detailedDescription?: string
  icon?: React.ReactNode
  category?: string
  isPopular?: boolean
  isAvailable: boolean
  isConnected: boolean
  connectionDetails: ConnectionDetails | null
  additionalConfig?: AdditionalConfig
  onConnectionChange?: (pluginKey: string, connected: boolean) => void
}

export default function PluginCard({
  pluginKey,
  pluginName,
  description,
  detailedDescription,
  icon,
  category,
  isPopular,
  isAvailable,
  isConnected,
  connectionDetails,
  additionalConfig,
  onConnectionChange
}: PluginCardProps) {
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDetailed, setShowDetailed] = useState(false)
  const [showAdditionalConfigModal, setShowAdditionalConfigModal] = useState(false)
  const [additionalConfigMode, setAdditionalConfigMode] = useState<'create' | 'view' | 'edit'>('view')
  const [existingAdditionalData, setExistingAdditionalData] = useState<Record<string, any>>({})
  const [connectedAgents, setConnectedAgents] = useState<Array<{id: string, agent_name: string}>>([])

  const { user } = useAuth()
  const apiClient = getPluginAPIClient()

  // Load existing additional config data when connected
  useEffect(() => {
    if (isConnected && additionalConfig?.enabled && user) {
      loadAdditionalConfig()
    }
  }, [isConnected, additionalConfig, user])

  const loadAdditionalConfig = async () => {
    try {
      const response = await fetch(`/api/plugins/additional-config?userId=${user!.id}&pluginKey=${pluginKey}`)
      const result = await response.json()
      if (result.success && result.data) {
        setExistingAdditionalData(result.data)
      }
    } catch (error) {
      console.error('Failed to load additional config:', error)
    }
  }

  const handleConnect = async () => {
    if (!user) {
      alert('Please sign in to connect plugins')
      return
    }

    setConnecting(true)
    setError(null)

    try {
      // Check if plugin is available
      if (!isAvailable) {
        throw new Error(`Plugin "${pluginName}" is not available yet. Coming soon!`)
      }

      // Use API client to handle OAuth flow with additional config callback
      const result = await apiClient.connectPlugin(
        user.id,
        pluginKey,
        (pluginKey, pluginName, additionalConfig) => {
          // OAuth succeeded and plugin requires additional config
          setAdditionalConfigMode('create')
          setShowAdditionalConfigModal(true)
        }
      )

      if (result.success) {
        // If additional config is required, modal will be shown by callback
        // Otherwise, connection is complete
        if (!result.requiresAdditionalConfig) {
          onConnectionChange?.(pluginKey, true)
        }
      } else {
        throw new Error(result.error || 'Failed to connect plugin')
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect plugin'
      console.error('Plugin connection error:', err)
      setError(errorMessage)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!user) return

    // Fetch connected agents first
    setDisconnecting(true)
    try {
      const { data: allAgents, error: fetchError } = await supabase
        .from('agents')
        .select('id, agent_name, connected_plugins')
        .eq('user_id', user.id)

      if (fetchError) {
        console.error('Error fetching connected agents:', fetchError)
      }

      // Filter agents that have this plugin in their connected_plugins array
      const agentsList = (allAgents || []).filter(agent => {
        const plugins = agent.connected_plugins

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

      // Build confirmation message
      let confirmMessage = `Are you sure you want to disconnect ${pluginName}?`

      if (agentsList.length > 0) {
        const agentNames = agentsList.map(a => `  • ${a.agent_name}`).join('\n')
        confirmMessage = `⚠️ WARNING: ${agentsList.length} agent${agentsList.length > 1 ? 's are' : ' is'} using this plugin:\n\n${agentNames}\n\nThese agents will no longer work after disconnection.\n\nAre you sure you want to disconnect ${pluginName}?`
      }

      if (!confirm(confirmMessage)) {
        setDisconnecting(false)
        return
      }

      setError(null)

      // Use API client to disconnect
      const result = await apiClient.disconnectPlugin(user.id, pluginKey)

      if (result.success) {
        onConnectionChange?.(pluginKey, false)
      } else {
        throw new Error(result.error || 'Failed to disconnect plugin')
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect plugin'
      console.error('Plugin disconnection error:', err)
      setError(errorMessage)
    } finally {
      setDisconnecting(false)
    }
  }

  const handleViewAdditionalConfig = () => {
    setAdditionalConfigMode('view')
    setShowAdditionalConfigModal(true)
  }

  const handleAdditionalConfigSuccess = (data: Record<string, any>) => {
    setExistingAdditionalData(data)
    // Refresh connection state if needed
    onConnectionChange?.(pluginKey, true)
  }

  const handleAdditionalConfigCancel = async () => {
    // User canceled with required fields - disconnect the plugin
    setDisconnecting(true)
    try {
      await apiClient.disconnectPlugin(user!.id, pluginKey)
      onConnectionChange?.(pluginKey, false)
    } catch (err) {
      console.error('Failed to disconnect plugin:', err)
    } finally {
      setDisconnecting(false)
    }
  }

  const formatLastUsed = (lastUsed?: string) => {
    if (!lastUsed) return 'Never'
    const date = new Date(lastUsed)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  // Connection status indicator (green dot)
  const ConnectionDot = () => {
    if (isConnected) {
      return <div className="w-2 h-2 bg-green-500 rounded-full absolute top-4 left-4"></div>
    }
    return null
  }

  return (
    <Card className={`
      relative w-full max-w-sm bg-white border transition-all duration-200 hover:shadow-md h-full flex flex-col
      ${isConnected ? 'border-green-200' : 'border-gray-200'}
    `}>
      <ConnectionDot />
      
      <CardContent className="p-6 flex-1 flex flex-col">
        {/* Coming Soon Badge */}
        {!isAvailable && (
          <div className="absolute top-4 right-4">
            <span className="bg-orange-100 text-orange-600 text-xs font-medium px-2 py-1 rounded">
              Coming Soon
            </span>
          </div>
        )}

        {/* Icon and Title */}
        <div className="flex flex-col items-center text-center mb-6 flex-shrink-0">
          <div className="mb-4">
            {icon || <PlugZap className="w-8 h-8 text-gray-600" />}
          </div>
          
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-gray-900 leading-tight">
              {pluginName}
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              {description}
            </p>
            
            {/* Detailed Description Toggle */}
            {detailedDescription && detailedDescription !== description && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowDetailed(!showDetailed)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                >
                  {showDetailed ? (
                    <>
                      <ChevronUp className="w-3 h-3" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      More details
                    </>
                  )}
                </button>
                
                {showDetailed && (
                  <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 p-3 rounded">
                    {detailedDescription}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Connection Details */}
        {isConnected && connectionDetails && (
          <div className="mb-6 text-center flex-shrink-0">
            <p className="text-sm text-gray-900 font-medium mb-1">
              Connected as <span className="text-gray-700">{connectionDetails.username || connectionDetails.email}</span>
            </p>
            <div className="text-xs text-gray-500 space-y-1">
              <div>Last used: {formatLastUsed(connectionDetails.last_used)}</div>
              {connectionDetails.connected_at && (
                <div>Connected: {new Date(connectionDetails.connected_at).toLocaleDateString()}</div>
              )}
            </div>
          </div>
        )}

        {/* Spacer to push content to bottom */}
        <div className="flex-1"></div>

        {/* Status Section */}
        <div className="flex items-center justify-center mb-6 flex-shrink-0">
          <div className="flex items-center gap-6">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-gray-900">Connected</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500">Not Connected</span>
                </>
              )}
            </div>

            {/* Available Status */}
            <div className="flex items-center gap-2">
              {isAvailable ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-gray-900">Available</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-orange-600">Coming Soon</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-center flex-shrink-0">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Action Button */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <div className="flex justify-center">
            {isConnected ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="px-6"
                  onClick={handleConnect}
                  disabled={connecting || disconnecting}
                >
                  {connecting ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin mr-2" />
                      Connecting...
                    </>
                  ) : (
                    'Reconnect'
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  {disconnecting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    'Disconnect'
                  )}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="px-8"
                onClick={handleConnect}
                disabled={connecting || !isAvailable}
                variant={isAvailable ? "default" : "secondary"}
              >
                {connecting ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin mr-2" />
                    Connecting...
                  </>
                ) : isAvailable ? (
                  'Connect'
                ) : (
                  'Coming Soon'
                )}
              </Button>
            )}
          </div>

          {/* Additional Config Button */}
          {isConnected && additionalConfig?.enabled && (
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleViewAdditionalConfig}
                className="text-xs text-gray-600 hover:text-gray-900"
              >
                <Settings className="w-3 h-3 mr-1" />
                View Additional Info
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      {/* Additional Config Modal */}
      {additionalConfig?.enabled && user && (
        <AdditionalConfigModal
          isOpen={showAdditionalConfigModal}
          onClose={() => setShowAdditionalConfigModal(false)}
          pluginKey={pluginKey}
          pluginName={pluginName}
          additionalConfig={additionalConfig}
          existingData={existingAdditionalData}
          mode={additionalConfigMode}
          userId={user.id}
          onSuccess={handleAdditionalConfigSuccess}
          onCancel={handleAdditionalConfigCancel}
        />
      )}
    </Card>
  )
}