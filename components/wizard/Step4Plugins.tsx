'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'

interface Props {
  data: {
    connectedPlugins: { [key: string]: any }
  }
  onUpdate: (data: Partial<Props['data']>) => void
}

const AVAILABLE_PLUGINS = [
  {
    key: 'google-mail',
    name: 'Gmail',
    description: 'Connect your Gmail account to enable reading/sending emails.',
  },
  {
    key: 'slack',
    name: 'Slack',
    description: 'Connect Slack to post messages from your agents.',
  },
  {
    key: 'notion',
    name: 'Notion',
    description: 'Connect Notion to read/write content from databases or pages.',
  },
]

export default function Step4Plugins({ data, onUpdate }: Props) {
  const [loadingPlugin, setLoadingPlugin] = useState<string | null>(null)
  const [pluginErrors, setPluginErrors] = useState<{ [key: string]: string }>({})
  const [authPopup, setAuthPopup] = useState<Window | null>(null)

  const handleConnect = async (pluginKey: string) => {
    const strategy = pluginRegistry[pluginKey]
    if (!strategy) {
      setPluginErrors((prev) => ({ ...prev, [pluginKey]: 'Unsupported plugin' }))
      return
    }

    const width = 600
    const height = 700
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    const popup = window.open('about:blank', 'OAuthPopup', `width=${width},height=${height},left=${left},top=${top}`)

    if (!popup) {
      setPluginErrors((prev) => ({ ...prev, [pluginKey]: 'Popup was blocked by the browser.' }))
      return
    }

    setAuthPopup(popup)
    setLoadingPlugin(pluginKey)
    setPluginErrors((prev) => ({ ...prev, [pluginKey]: '' }))

    const popupListener = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'plugin-connected') {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return

        const { data: connections } = await supabase
          .from('plugin_connections')
          .select('*')
          .eq('user_id', user.id)

        const updated: Record<string, any> = {}
        connections?.forEach((conn) => {
          updated[conn.plugin_key] = {
            connected: true,
            username: conn.username,
          }
        })

        onUpdate({ connectedPlugins: updated })
        popup.close()
        setAuthPopup(null)
        window.removeEventListener('message', popupListener)
      }
    }

    window.addEventListener('message', popupListener)

    try {
      await strategy.connect({ supabase, onUpdate, popup })
    } catch (err) {
      console.error('Plugin connect error:', err)
      setPluginErrors((prev) => ({
        ...prev,
        [pluginKey]: (err as Error)?.message || 'Failed to connect.',
      }))
      popup.close()
      window.removeEventListener('message', popupListener)
    } finally {
      setLoadingPlugin(null)
    }
  }

  const handleDisconnect = async (pluginKey: string) => {
    setLoadingPlugin(pluginKey)
    setPluginErrors((prev) => ({ ...prev, [pluginKey]: '' }))

    const strategy = pluginRegistry[pluginKey]
    if (!strategy) {
      setPluginErrors((prev) => ({ ...prev, [pluginKey]: 'Unsupported plugin' }))
      setLoadingPlugin(null)
      return
    }

    try {
      await strategy.disconnect({ supabase, onUpdate })
    } catch (err) {
      console.error('Plugin disconnect error:', err)
      setPluginErrors((prev) => ({
        ...prev,
        [pluginKey]: (err as Error)?.message || 'Failed to disconnect.'
      }))
    } finally {
      setLoadingPlugin(null)
    }
  }

  const isConnected = (pluginKey: string) =>
    data.connectedPlugins?.[pluginKey]?.connected

  useEffect(() => {
    const timer = setInterval(() => {
      if (authPopup && authPopup.closed) {
        setAuthPopup(null)
      }
    }, 500)
    return () => clearInterval(timer)
  }, [authPopup])

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Select plugins you want to connect to this agent. You will be asked to authenticate.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {AVAILABLE_PLUGINS.map((plugin) => {
          const connected = isConnected(plugin.key)
          const isLoading = loadingPlugin === plugin.key
          const maskedUsername = data.connectedPlugins?.[plugin.key]?.username

          return (
            <div
              key={plugin.key}
              className="border rounded-xl p-4 shadow-sm flex flex-col justify-between"
            >
              <div>
                <h3 className="text-lg font-semibold">{plugin.name}</h3>
                <p className="text-sm text-gray-500">{plugin.description}</p>
                {connected && maskedUsername && (
                  <p className="mt-1 text-xs text-gray-400">
                    Connected as <span className="font-mono">{maskedUsername}</span>
                  </p>
                )}
              </div>

              <div>
                {connected ? (
                  <button
                    onClick={() => handleDisconnect(plugin.key)}
                    disabled={isLoading}
                    className="mt-4 px-4 py-2 rounded text-white bg-red-500 hover:bg-red-600"
                  >
                    {isLoading ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(plugin.key)}
                    disabled={isLoading}
                    className={`mt-4 px-4 py-2 rounded text-white ${
                      isLoading
                        ? 'bg-gray-400 cursor-wait'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {isLoading ? 'Connecting...' : `Connect ${plugin.name}`}
                  </button>
                )}
                {pluginErrors[plugin.key] && (
                  <p className="mt-2 text-sm text-red-600">{pluginErrors[plugin.key]}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
