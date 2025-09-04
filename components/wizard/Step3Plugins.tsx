'use client'

import { useEffect, useState } from 'react'
import PluginCard from './PluginCard'
import { useAuth } from '@/components/UserProvider'
import { pluginList } from '@/lib/plugins/pluginList'
import {
  Puzzle,
  Loader2,
  Lightbulb,
  AlertTriangle,
  CheckCircle,
  Info,
  Zap,
  Link2,
  Settings,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
  Bot,
  X,
  Star,
  Brain,
  Sparkles,
  Target
} from 'lucide-react'

type PluginStatus = {
  connected: boolean
}

export default function Step3Plugins({ data, onUpdate }: any) {
  const { user } = useAuth()
  const [suggestedPlugins, setSuggestedPlugins] = useState<string[]>([])
  const [allPluginStatus, setAllPluginStatus] = useState<Record<string, PluginStatus>>({})
  const [loading, setLoading] = useState(true)
  const [showAllPlugins, setShowAllPlugins] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  // AI Assistant state
  const [assistantActive, setAssistantActive] = useState(false)
  const [assistantMode, setAssistantMode] = useState<'idle' | 'thinking' | 'suggesting' | 'celebrating'>('idle')
  const [showOverlay, setShowOverlay] = useState(false)
  const [assistantMessages, setAssistantMessages] = useState<string[]>([])

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
        
        // AI Assistant feedback based on suggested plugins
        if (json.plugins && json.plugins.length > 0) {
          setAssistantActive(true)
          setAssistantMode('suggesting')
          addAssistantMessage(`I found ${json.plugins.length} plugins that could enhance your agent! Check out the recommended ones.`)
        }
      } catch (err) {
        console.error('Failed to get plugin suggestions:', err)
        setSuggestedPlugins([])
      } finally {
        setLoading(false)
      }
    }

    if (data.userPrompt) {
      fetchSuggested()
    } else {
      setLoading(false)
      setSuggestedPlugins([])
    }
  }, [data.userPrompt])

  useEffect(() => {
    const fetchConnections = async () => {
      if (!user?.id) return

      try {
        const res = await fetch('/api/user/plugins')
        const json = await res.json()
        console.log('Plugin connection status:', json)
        setAllPluginStatus(json || {})
        setConnectionError(null)
      } catch (err) {
        console.error('Failed to fetch plugin connections:', err)
        setConnectionError('Failed to load plugin connections')
      }
    }

    fetchConnections()
  }, [user])

  const isConnected = (pluginKey: string) => {
    // ChatGPT is always "connected" since it uses your platform's API key
    if (pluginKey === 'chatgpt-research') {
      return true
    }
    return allPluginStatus[pluginKey]?.connected === true
  }

  const addAssistantMessage = (message: string) => {
    setAssistantMessages(prev => [...prev.slice(-2), message])
  }

  const activateOverlayMode = () => {
    setShowOverlay(true)
    setAssistantMode('thinking')
    addAssistantMessage("Focus mode activated! Let me help you select the best plugins for your agent.")
  }

  const togglePlugin = (pluginKey: string) => {
    const updatedPlugins = { ...data.plugins }

    if (updatedPlugins[pluginKey]) {
      delete updatedPlugins[pluginKey]
      addAssistantMessage(`Removed ${pluginKey}. Your agent will work without this plugin.`)
    } else {
      // Special handling for ChatGPT - doesn't need individual connection
      if (pluginKey === 'chatgpt-research') {
        updatedPlugins[pluginKey] = { connected: true }
        setAssistantMode('celebrating')
        addAssistantMessage("Great choice! ChatGPT Research will give your agent powerful analysis capabilities.")
        setTimeout(() => setAssistantMode('idle'), 2000)
      } else if (!isConnected(pluginKey)) {
        alert(`Please connect ${pluginKey} before selecting.`)
        return
      } else {
        updatedPlugins[pluginKey] = { connected: true }
        setAssistantMode('celebrating')
        addAssistantMessage(`Perfect! ${pluginKey} is now connected and will enhance your agent's capabilities.`)
        setTimeout(() => setAssistantMode('idle'), 2000)
      }
      setAssistantActive(true)
    }

    onUpdate({ plugins: updatedPlugins })
  }

  const selectedPlugins = Object.keys(data.plugins || {})
  const connectedPlugins = Object.keys(allPluginStatus).filter(key => isConnected(key))
  
  // Add ChatGPT to connected count since it's always available
  const totalConnectedPlugins = [...connectedPlugins, 'chatgpt-research'].filter((value, index, self) => self.indexOf(value) === index).length
  
  const availablePlugins = pluginList.filter(plugin => 
    !suggestedPlugins.includes(plugin.pluginKey)
  )

  const noSelectedPluginWarning =
    suggestedPlugins.length > 0 &&
    !selectedPlugins.some((pluginKey) => suggestedPlugins.includes(pluginKey))

  const refreshConnections = async () => {
    if (!user?.id) return
    
    try {
      const res = await fetch('/api/user/plugins')
      const json = await res.json()
      setAllPluginStatus(json || {})
      setConnectionError(null)
      addAssistantMessage("Connection status refreshed! Check which plugins are now available.")
      setAssistantActive(true)
    } catch (err) {
      console.error('Failed to refresh plugin connections:', err)
      setConnectionError('Failed to refresh connections')
    }
  }

  // AI Assistant Component
  const AIAssistant = () => {
    if (!assistantActive) return null

    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer group ${
            assistantMode === 'celebrating' 
              ? 'bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 animate-spin' 
              : assistantMode === 'thinking'
              ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 animate-pulse'
              : 'bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-600 hover:scale-110'
          }`}
          onClick={() => activateOverlayMode()}
          >
            {assistantMode === 'celebrating' ? (
              <Star className="h-8 w-8 text-white animate-bounce" />
            ) : assistantMode === 'thinking' ? (
              <Brain className="h-8 w-8 text-white animate-pulse" />
            ) : (
              <Puzzle className="h-8 w-8 text-white group-hover:rotate-12 transition-transform" />
            )}
          </div>

          {/* Floating particles */}
          <div className="absolute inset-0 animate-spin">
            <div className="absolute -top-2 -right-2 w-3 h-3 bg-yellow-400 rounded-full animate-ping"></div>
            <div className="absolute -bottom-2 -left-2 w-2 h-2 bg-pink-400 rounded-full animate-bounce"></div>
            <div className="absolute top-0 -left-3 w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          </div>

          {/* Message Bubbles - Positioned to the right of agent UI */}
          {assistantMessages.length > 0 && (
            <div className="fixed bottom-6 right-24 space-y-3 z-40" style={{ width: '350px' }}>
              {assistantMessages.map((message, index) => (
                <div 
                  key={index}
                  className="bg-gradient-to-r from-white to-purple-50 border-2 border-purple-200 rounded-2xl shadow-xl animate-in slide-in-from-right-2 duration-300"
                  style={{ 
                    animationDelay: `${index * 100}ms`,
                    width: '350px',
                    minWidth: '350px',
                    maxWidth: '350px',
                    padding: '20px 28px',
                    boxSizing: 'border-box'
                  }}
                >
                  <p 
                    className="text-base font-semibold text-gray-800 leading-relaxed"
                    style={{
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      whiteSpace: 'normal',
                      width: '100%'
                    }}
                  >
                    {message}
                  </p>
                  <div 
                    className="absolute bottom-0 left-8"
                    style={{
                      width: '0',
                      height: '0',
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '6px solid white'
                    }}
                  ></div>
                </div>
              ))}
            </div>
          )}

          {/* Dismiss button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setAssistantActive(false)
              setShowOverlay(false)
              setAssistantMessages([])
            }}
            className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  // Overlay System
  const OverlaySystem = () => {
    if (!showOverlay) return null

    return (
      <div className="fixed inset-0 z-40 pointer-events-none">
        <div className="absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm"></div>
        
        {/* Floating help cards */}
        <div className="absolute top-20 right-20 space-y-4 pointer-events-auto">
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-5 rounded-2xl shadow-2xl max-w-sm animate-float">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-6 w-6" />
              <span className="font-semibold text-lg">Recommended Plugins</span>
            </div>
            <p className="text-base leading-relaxed mb-3">Based on your prompt analysis</p>
            <p className="text-sm">Select plugins that match your agent's tasks for best results.</p>
          </div>

          <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white p-5 rounded-2xl shadow-2xl max-w-sm animate-float" style={{ animationDelay: '0.5s' }}>
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-6 w-6" />
              <span className="font-semibold text-lg">Connection Status</span>
            </div>
            <p className="text-base leading-relaxed mb-3">Only connected plugins can be selected</p>
            <button
              onClick={() => {
                refreshConnections()
                setShowOverlay(false)
              }}
              className="block w-full text-left bg-white bg-opacity-20 hover:bg-opacity-30 px-3 py-2 rounded text-sm transition-colors"
            >
              Refresh Connections
            </button>
          </div>
        </div>

        <button
          onClick={() => setShowOverlay(false)}
          className="absolute top-6 right-6 bg-white bg-opacity-20 backdrop-blur-sm text-white px-4 py-2 rounded-full hover:bg-opacity-30 transition-colors pointer-events-auto"
        >
          Exit Focus Mode
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8 relative">
      {/* Introduction */}
      <div className="text-center pb-6 border-b border-gray-200">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Puzzle className="h-8 w-8 text-white" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">
          Connect external services
        </h3>
        <p className="text-gray-600">
          Select plugins to give your agent access to external tools and data
        </p>

        {/* AI Assistant Activation */}
        {!assistantActive && (
          <button
            onClick={() => setAssistantActive(true)}
            className="mt-4 inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-2 rounded-full hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 shadow-lg"
          >
            <Puzzle className="h-4 w-4" />
            Activate Plugin Assistant
            <Sparkles className="h-4 w-4 animate-pulse" />
          </button>
        )}
      </div>

      {/* Connection Status */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-blue-600" />
            <span className="font-medium text-blue-900">Connection Status</span>
          </div>
          <button
            onClick={refreshConnections}
            className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-3 border border-blue-200">
            <div className="text-2xl font-bold text-blue-600">{totalConnectedPlugins}</div>
            <div className="text-sm text-blue-800">Connected</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-blue-200">
            <div className="text-2xl font-bold text-purple-600">{selectedPlugins.length}</div>
            <div className="text-sm text-purple-800">Selected</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-blue-200">
            <div className="text-2xl font-bold text-gray-600">{pluginList.length}</div>
            <div className="text-sm text-gray-800">Available</div>
          </div>
        </div>

        {connectionError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {connectionError}
            </p>
          </div>
        )}
      </div>

      {/* Suggested Plugins */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-600" />
          <h4 className="text-lg font-semibold text-gray-900">
            Recommended for Your Agent
          </h4>
        </div>

        {loading ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">Analyzing your prompt...</p>
            <p className="text-gray-500 text-sm mt-1">
              Finding the best plugins for your agent's tasks
            </p>
          </div>
        ) : suggestedPlugins.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <Puzzle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="font-medium text-gray-900 mb-2">No plugins recommended</h3>
            <p className="text-gray-600 text-sm">
              Your agent can work without external plugins, or you can browse all available plugins below.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggestedPlugins.map((pluginKey) => {
                const localDef = pluginList.find((p) => p.pluginKey === pluginKey)
                const connected = isConnected(pluginKey)
                const selected = !!data.plugins[pluginKey]

                return (
                  <div key={pluginKey} className="relative">
                    <div className="absolute -top-2 -right-2 z-10">
                      <div className="bg-yellow-500 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        Recommended
                      </div>
                    </div>
                    <PluginCard
                      pluginKey={pluginKey}
                      pluginName={localDef?.name || pluginKey}
                      icon={localDef?.icon ?? <span>🔌</span>}
                      description={localDef?.description || ''}
                      connected={connected}
                      selected={selected}
                      disabled={!connected}
                      onToggle={() => togglePlugin(pluginKey)}
                    />
                  </div>
                )
              })}
            </div>

            {noSelectedPluginWarning && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-900 mb-1">
                      Recommended plugins not selected
                    </p>
                    <p className="text-yellow-800 text-sm">
                      Based on your prompt, some plugins are recommended but not selected. 
                      Your agent may have limited functionality without them.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* All Available Plugins */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-600" />
            <h4 className="text-lg font-semibold text-gray-900">
              All Available Plugins
            </h4>
          </div>
          <button
            onClick={() => setShowAllPlugins(!showAllPlugins)}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm"
          >
            {showAllPlugins ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showAllPlugins ? 'Hide' : 'Show'} All Plugins
          </button>
        </div>

        {showAllPlugins && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availablePlugins.map((plugin) => {
              const connected = isConnected(plugin.pluginKey)
              const selected = !!data.plugins[plugin.pluginKey]

              return (
                <PluginCard
                  key={plugin.pluginKey}
                  pluginKey={plugin.pluginKey}
                  pluginName={plugin.name}
                  icon={plugin.icon}
                  description={plugin.description}
                  connected={connected}
                  selected={selected}
                  disabled={!connected}
                  onToggle={() => togglePlugin(plugin.pluginKey)}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Selected Plugins Summary */}
      {selectedPlugins.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="font-medium text-green-900">
              Selected Plugins ({selectedPlugins.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedPlugins.map((pluginKey) => {
              const plugin = pluginList.find(p => p.pluginKey === pluginKey)
              return (
                <span
                  key={pluginKey}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full border border-green-200"
                >
                  {plugin?.icon || '🔌'}
                  {plugin?.name || pluginKey}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Plugin Management Link */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-gray-900 mb-1">
              Need to connect more plugins?
            </p>
            <p className="text-gray-600 text-sm mb-3">
              Manage your plugin connections to unlock more capabilities for your agents.
            </p>
            <a
              href="/settings/connections"
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              <ExternalLink className="h-4 w-4" />
              Manage Plugin Connections
            </a>
          </div>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <CheckCircle className="h-6 w-6 text-green-500" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900">
              {selectedPlugins.length > 0 
                ? `${selectedPlugins.length} plugin${selectedPlugins.length > 1 ? 's' : ''} selected` 
                : 'Plugin selection complete'}
            </p>
            <p className="text-sm text-gray-600">
              {selectedPlugins.length > 0 
                ? 'Your agent will have access to these external services' 
                : 'Your agent will work without external plugins'}
            </p>
          </div>
        </div>
      </div>

      {/* Tips Section */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Lightbulb className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-purple-900 mb-2">Plugin selection tips</p>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• Select only the plugins your agent actually needs</li>
              <li>• Connect plugins in Settings before selecting them here</li>
              <li>• Recommended plugins are based on your prompt analysis</li>
              <li>• You can modify plugin selection later when editing the agent</li>
            </ul>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant />

      {/* Overlay System */}
      <OverlaySystem />

      {/* Custom CSS */}
      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}