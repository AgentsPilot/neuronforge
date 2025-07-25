'use client'

import { useEffect, useState } from 'react'
import PluginCard from './PluginCard'
import { useAuth } from '@/components/UserProvider'
import { pluginList } from '@/lib/plugins/pluginList'

type PluginStatus = {
  connected: boolean
}

export default function Step3Plugins({ data, onUpdate }: any) {
  const { user } = useAuth()
  const [suggestedPlugins, setSuggestedPlugins] = useState<string[]>([])
  const [allPluginStatus, setAllPluginStatus] = useState<Record<string, PluginStatus>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSuggested = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/plugins/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: data.userPrompt }),
        })

        const json = await res.json()
        setSuggestedPlugins(json.plugins || [])
      } catch (err) {
        console.error('❌ Failed to get plugin suggestions:', err)
        setSuggestedPlugins([])
      } finally {
        setLoading(false)
      }
    }

    fetchSuggested()
  }, [data.userPrompt])

  useEffect(() => {
    const fetchConnections = async () => {
      if (!user?.id) return

      try {
        const res = await fetch('/api/user/plugins')
        const json = await res.json()
        console.log('🔌 Plugin connection status:', json)
        setAllPluginStatus(json || {})
      } catch (err) {
        console.error('❌ Failed to fetch plugin connections:', err)
      }
    }

    fetchConnections()
  }, [user])

  const isConnected = (pluginKey: string) =>
    allPluginStatus[pluginKey]?.connected === true

  const togglePlugin = (pluginKey: string) => {
    const updatedPlugins = { ...data.plugins }

    if (updatedPlugins[pluginKey]) {
      delete updatedPlugins[pluginKey]
    } else {
      if (!isConnected(pluginKey)) {
        alert(`⚠️ Please connect ${pluginKey} before selecting.`)
        return
      }
      updatedPlugins[pluginKey] = { connected: true }
    }

    onUpdate({ plugins: updatedPlugins })
  }

  const noSelectedPluginWarning =
    suggestedPlugins.length > 0 &&
    !Object.keys(data.plugins).some((pluginKey) => suggestedPlugins.includes(pluginKey))

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">🔌 Select Relevant Plugin</h2>

      {loading ? (
        <p className="text-blue-500">Analyzing your prompt to suggest plugins...</p>
      ) : suggestedPlugins.length === 0 ? (
        <p className="text-gray-500">No plugin suggestions based on your prompt.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {suggestedPlugins.map((pluginKey) => {
            const localDef = pluginList.find((p) => p.pluginKey === pluginKey)
            const connected = isConnected(pluginKey)
            const selected = !!data.plugins[pluginKey]

            return (
              <PluginCard
                key={pluginKey}
                pluginKey={pluginKey}
                pluginName={localDef?.name || pluginKey}
                icon={localDef?.icon ?? <span>🔌</span>}
                description={localDef?.description || ''}
                connected={connected}
                selected={selected}
                disabled={!connected}
                onToggle={() => togglePlugin(pluginKey)}
              />
            )
          })}
        </div>
      )}

      {noSelectedPluginWarning && !loading && (
        <p className="text-sm text-yellow-600 mt-4">
          ⚠️ Based on your prompt, plugins like Gmail or Notion are recommended but none are selected.
          The agent will not be able to access those services.
        </p>
      )}
    </div>
  )
}