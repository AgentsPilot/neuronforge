import { useState } from 'react'
import { CheckCircle, RefreshCw, Link2 } from 'lucide-react'
import { availablePlugins } from '../../constants/plugins'

interface PluginConnectionManagerProps {
  requiredPlugins: string[]
  onPluginConnect: (pluginId: string) => void
}

export const PluginConnectionManager = ({ 
  requiredPlugins, 
  onPluginConnect 
}: PluginConnectionManagerProps) => {
  const [connectedPlugins, setConnectedPlugins] = useState<Set<string>>(new Set())
  const [connectingPlugin, setConnectingPlugin] = useState<string | null>(null)

  const simulateConnection = async (pluginId: string) => {
    setConnectingPlugin(pluginId)
    
    // Simulate OAuth flow
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    setConnectedPlugins(prev => new Set([...prev, pluginId]))
    setConnectingPlugin(null)
    onPluginConnect(pluginId)
  }

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-slate-900 mb-3">🔌 Required Integrations</h4>
      {requiredPlugins.map(pluginId => {
        const plugin = availablePlugins.find(p => p.id === pluginId)
        if (!plugin) return null

        const isConnected = connectedPlugins.has(pluginId)
        const isConnecting = connectingPlugin === pluginId

        return (
          <div key={pluginId} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
            <div className="flex items-center gap-3">
              <plugin.icon className="h-5 w-5 text-slate-600" />
              <div>
                <h5 className="font-medium text-slate-900">{plugin.name}</h5>
                <p className="text-xs text-slate-600">{plugin.description}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {isConnected ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Connected</span>
                </div>
              ) : (
                <button
                  onClick={() => simulateConnection(pluginId)}
                  disabled={isConnecting}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm rounded-md transition-colors flex items-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Link2 className="h-3 w-3" />
                      Connect
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}