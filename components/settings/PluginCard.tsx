'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle, PlugZap, XCircle, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'

interface PluginCardProps {
  pluginKey: string
  pluginName: string
  description: string
  icon?: React.ReactNode
}

export default function PluginCard({ pluginKey, pluginName, description, icon }: PluginCardProps) {
  const [connected, setConnected] = useState<boolean>(false)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [username, setUsername] = useState<string | null>(null)

  const router = useRouter()
  const { user } = useAuth()

  useEffect(() => {
    const checkConnection = async () => {
      if (!user) return

      const { data, error } = await supabase
        .from('plugin_connections')
        .select('id, username')
        .eq('plugin_key', pluginKey)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!error && data) {
        setConnected(true)
        setUsername(data.username || null)
      }

      setLoading(false)
    }

    checkConnection()
  }, [pluginKey, user])

  const handleConnect = async () => {
    const popup = window.open('', '_blank', 'width=500,height=600')
    if (!popup) return

    try {
      const strategy = pluginRegistry[pluginKey]
      if (!strategy?.connect) throw new Error(`No connect strategy for plugin "${pluginKey}"`)
      await strategy.connect({ supabase, popup })
    } catch (err) {
      console.error('🔌 Plugin connection error:', err)
      popup.close()
    }
  }

  const handleDisconnect = async () => {
    if (!confirm(`Are you sure you want to disconnect ${pluginName}? Agents using this plugin may be deactivated.`)) {
      return
    }

    setDisconnecting(true)

    const res = await fetch('/api/plugin-connections/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin_key: pluginKey }),
    })

    setDisconnecting(false)

    if (!res.ok) {
      alert('❌ Failed to disconnect plugin')
      return
    }

    setConnected(false)
    setUsername(null)
  }

  return (
    <Card className="w-full max-w-md border border-gray-200 shadow-sm min-h-[180px]">
      <CardContent className="p-4 flex flex-col h-full justify-between">
        <div className="flex items-start gap-3">
          {icon || <PlugZap className="w-6 h-6 text-blue-600" />}
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800">{pluginName}</h3>
            <p className="text-sm text-gray-500">{description}</p>
            {username && (
              <p className="text-xs text-gray-400 mt-1">
                Connected as <strong>{username}</strong>
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1 text-sm">
            {loading ? (
              <div className="flex items-center gap-1 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking...
              </div>
            ) : connected ? (
              <div className="flex items-center gap-1 text-green-600">
                <CheckCircle className="w-4 h-4" /> Connected
              </div>
            ) : (
              <div className="flex items-center gap-1 text-gray-400">
                <XCircle className="w-4 h-4" /> Not Connected
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={handleConnect}
              disabled={loading || disconnecting}
              variant={connected ? 'secondary' : 'default'}
            >
              {connected ? 'Reconnect' : 'Connect'}
            </Button>

            {connected && (
              <Button
                size="sm"
                className="h-7 px-3 text-xs"
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
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}