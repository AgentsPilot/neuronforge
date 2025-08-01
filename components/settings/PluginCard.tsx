'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle, PlugZap, XCircle, Loader2, AlertTriangle, Clock, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'

interface PluginCardProps {
  pluginKey: string
  pluginName: string
  description: string
  icon?: React.ReactNode
  category?: string
  isPopular?: boolean
  onConnectionChange?: (pluginKey: string, connected: boolean) => void
}

interface PluginConnection {
  id: string
  plugin_key: string
  plugin_name: string
  username?: string
  email?: string
  status: 'active' | 'expired' | 'error' | 'disabled'
  connected_at: string
  last_used?: string
  profile_data?: any
}

export default function PluginCard({ 
  pluginKey, 
  pluginName, 
  description, 
  icon,
  category,
  isPopular,
  onConnectionChange
}: PluginCardProps) {
  const [connection, setConnection] = useState<PluginConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()
  const { user } = useAuth()

  useEffect(() => {
    const checkConnection = async () => {
      if (!user) return

      try {
        setError(null)
        const { data, error } = await supabase
          .from('plugin_connections')
          .select('*')
          .eq('plugin_key', pluginKey)
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) {
          console.error('Error checking connection:', error)
          setError('Failed to check connection status')
        } else if (data) {
          setConnection(data)
        } else {
          setConnection(null)
        }
      } catch (err) {
        console.error('Unexpected error:', err)
        setError('Unexpected error occurred')
      } finally {
        setLoading(false)
      }
    }

    checkConnection()
  }, [pluginKey, user])

  const handleConnect = async () => {
    if (!user) {
      alert('Please sign in to connect plugins')
      return
    }

    setConnecting(true)
    setError(null)

    try {
      // Check if plugin strategy exists
      const strategy = pluginRegistry[pluginKey]
      if (!strategy) {
        throw new Error(`Plugin "${pluginName}" is not available yet. Coming soon!`)
      }

      if (!strategy.connect) {
        throw new Error(`Plugin "${pluginName}" does not support direct connection yet. Please check back later.`)
      }

      const popup = window.open('', '_blank', 'width=500,height=600,scrollbars=yes,resizable=yes')
      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.')
      }

      await strategy.connect({ supabase, popup, userId: user.id })
      
      // Refresh connection status after successful connection
      const { data, error } = await supabase
        .from('plugin_connections')
        .select('*')
        .eq('plugin_key', pluginKey)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!error && data) {
        setConnection(data)
        onConnectionChange?.(pluginKey, true)
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect plugin'
      console.error('🔌 Plugin connection error:', err)
      setError(errorMessage)
      
      // Close popup if it was opened
      try {
        if (popup && !popup.closed) {
          popup.close()
        }
      } catch (popupError) {
        // Ignore popup errors
      }
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm(`Are you sure you want to disconnect ${pluginName}? Agents using this plugin may be affected.`)) {
      return
    }

    setDisconnecting(true)
    setError(null)

    try {
      // Use direct Supabase delete instead of API endpoint
      const { error } = await supabase
        .from('plugin_connections')
        .delete()
        .eq('plugin_key', pluginKey)
        .eq('user_id', user?.id)

      if (error) {
        throw new Error(error.message)
      }

      setConnection(null)
      onConnectionChange?.(pluginKey, false)
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect plugin'
      console.error('❌ Plugin disconnection error:', err)
      setError(errorMessage)
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

  const isConnected = connection?.status === 'active'
  const hasError = connection?.status === 'error'
  const isAvailable = !!pluginRegistry[pluginKey]?.connect

  // Connection status indicator (green dot)
  const ConnectionDot = () => {
    if (loading) return null
    
    if (isConnected) {
      return <div className="w-2 h-2 bg-green-500 rounded-full absolute top-4 left-4"></div>
    }
    return null
  }

  return (
    <Card className={`
      relative w-full max-w-sm bg-white border transition-all duration-200 hover:shadow-md
      ${isConnected ? 'border-green-200' : 'border-gray-200'}
    `}>
      <ConnectionDot />
      
      <CardContent className="p-6">
        {/* Coming Soon Badge */}
        {!isAvailable && (
          <div className="absolute top-4 right-4">
            <span className="bg-orange-100 text-orange-600 text-xs font-medium px-2 py-1 rounded">
              Coming Soon
            </span>
          </div>
        )}

        {/* Icon and Title */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="mb-4">
            {icon || <PlugZap className="w-8 h-8 text-gray-600" />}
          </div>
          
          <div className="space-y-2">
            <h3 className="text-base font-medium text-gray-900 leading-tight">
              {description}
            </h3>
          </div>
        </div>

        {/* Connection Details */}
        {isConnected && connection && (
          <div className="mb-6 text-center">
            <p className="text-sm text-gray-900 font-medium mb-1">
              Connected as <span className="text-gray-700">{connection.username || connection.email}</span>
            </p>
            <div className="text-xs text-gray-500 space-y-1">
              <div>Last used: {formatLastUsed(connection.last_used)}</div>
              <div>Connected: {new Date(connection.connected_at).toLocaleDateString()}</div>
            </div>
          </div>
        )}

        {/* Status Section */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-6">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                  <span className="text-sm text-gray-500">Checking</span>
                </>
              ) : isConnected ? (
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
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-center">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Action Button */}
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
                variant="destructive"
                onClick={handleDisconnect}
                disabled={disconnecting}
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
              disabled={loading || connecting || !isAvailable}
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
      </CardContent>
    </Card>
  )
}