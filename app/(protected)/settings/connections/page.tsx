'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { pluginList as availablePlugins } from '@/lib/plugins/pluginList'
import PluginCard from '@/components/settings/PluginCard'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'

export default function ConnectionsPage() {
  const [search, setSearch] = useState('')
  const [connectedPlugins, setConnectedPlugins] = useState<string[]>([])
  const { user } = useAuth()

  // Fetch connected plugins
  useEffect(() => {
    const fetchConnectedPlugins = async () => {
      if (!user?.id) return

      const { data, error } = await supabase
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', user.id)
        .eq('status', 'active')

      if (!error && data) {
        setConnectedPlugins(data.map(connection => connection.plugin_key))
      }
    }

    fetchConnectedPlugins()
  }, [user])

  const filteredPlugins = availablePlugins.filter((plugin) =>
    plugin.name.toLowerCase().includes(search.toLowerCase()) ||
    plugin.description.toLowerCase().includes(search.toLowerCase())
  )

  // Sort plugins: connected ones first, then alphabetical
  const sortedPlugins = filteredPlugins.sort((a, b) => {
    const aConnected = connectedPlugins.includes(a.pluginKey)
    const bConnected = connectedPlugins.includes(b.pluginKey)
    
    if (aConnected && !bConnected) return -1
    if (!aConnected && bConnected) return 1
    return a.name.localeCompare(b.name)
  })

  const connectedCount = sortedPlugins.filter(plugin => 
    connectedPlugins.includes(plugin.pluginKey)
  ).length

  const availableCount = sortedPlugins.length - connectedCount

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Connect Your Services
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Integrate your favorite tools and services to streamline your workflow and boost productivity
          </p>
          
          {/* Connection Stats */}
          <div className="mt-6 flex justify-center gap-6">
            <div className="bg-green-50 px-4 py-2 rounded-full border border-green-200">
              <span className="text-green-700 font-semibold">{connectedCount} Connected</span>
            </div>
            <div className="bg-blue-50 px-4 py-2 rounded-full border border-blue-200">
              <span className="text-blue-700 font-semibold">{availableCount} Available</span>
            </div>
          </div>
        </div>

        {/* Search Section */}
        <div className="mb-12">
          <div className="max-w-2xl mx-auto">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <Input
                placeholder="Search for an integration (e.g. Gmail, Notion, Slack...)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-white/70 backdrop-blur-sm border-0 rounded-2xl shadow-lg focus:shadow-xl focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 text-lg placeholder-slate-500"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center"
                >
                  <svg className="h-5 w-5 text-slate-400 hover:text-slate-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            
            {/* Search Stats */}
            <div className="mt-4 text-center">
              <p className="text-sm text-slate-500">
                {search ? (
                  <>
                    Showing <span className="font-semibold text-blue-600">{sortedPlugins.length}</span> of {availablePlugins.length} integrations
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-blue-600">{availablePlugins.length}</span> integrations available
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Categories */}
        {!search && (
          <div className="mb-12">
            <div className="flex flex-wrap justify-center gap-3">
              <button className="px-6 py-2 bg-green-100 hover:bg-green-200 border border-green-300 rounded-full text-green-800 font-medium transition-all duration-200 hover:shadow-md hover:scale-105">
                Connected ({connectedCount})
              </button>
              {['Popular', 'Productivity', 'Communication', 'Storage', 'Development'].map((category) => (
                <button
                  key={category}
                  className="px-6 py-2 bg-white/70 backdrop-blur-sm hover:bg-blue-50 border border-blue-100 rounded-full text-blue-700 font-medium transition-all duration-200 hover:shadow-md hover:scale-105"
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Plugins Grid */}
        <div className="relative">
          {sortedPlugins.length > 0 ? (
            <>
              {/* Connected Apps Section */}
              {connectedCount > 0 && !search && (
                <div className="mb-12">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <h2 className="text-xl font-semibold text-slate-800">Connected Apps</h2>
                    <div className="flex-1 h-px bg-gradient-to-r from-green-200 to-transparent"></div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {sortedPlugins
                      .filter(plugin => connectedPlugins.includes(plugin.pluginKey))
                      .map((plugin, index) => (
                      <div
                        key={plugin.pluginKey}
                        className="animate-in fade-in-0 slide-in-from-bottom-4 duration-300"
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="group h-full">
                          <div className="bg-gradient-to-br from-green-50 to-white border-2 border-green-200 rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] h-full relative">
                            <div className="absolute top-3 right-3">
                              <div className="w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow-sm"></div>
                            </div>
                            <PluginCard
                              pluginKey={plugin.pluginKey}
                              pluginName={plugin.name}
                              description={plugin.description}
                              icon={plugin.icon}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Available Apps Section */}
              {availableCount > 0 && (
                <div>
                  {!search && connectedCount > 0 && (
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <h2 className="text-xl font-semibold text-slate-800">Available Apps</h2>
                      <div className="flex-1 h-px bg-gradient-to-r from-blue-200 to-transparent"></div>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {sortedPlugins
                      .filter(plugin => !connectedPlugins.includes(plugin.pluginKey))
                      .map((plugin, index) => (
                      <div
                        key={plugin.pluginKey}
                        className="animate-in fade-in-0 slide-in-from-bottom-4 duration-300"
                        style={{ animationDelay: `${(index + connectedCount) * 50}ms` }}
                      >
                        <div className="group h-full">
                          <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] border border-white/40 h-full">
                            <PluginCard
                              pluginKey={plugin.pluginKey}
                              pluginName={plugin.name}
                              description={plugin.description}
                              icon={plugin.icon}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Results - All Apps */}
              {search && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {sortedPlugins.map((plugin, index) => {
                    const isConnected = connectedPlugins.includes(plugin.pluginKey)
                    return (
                      <div
                        key={plugin.pluginKey}
                        className="animate-in fade-in-0 slide-in-from-bottom-4 duration-300"
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="group h-full">
                          <div className={`rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] h-full relative ${
                            isConnected 
                              ? 'bg-gradient-to-br from-green-50 to-white border-2 border-green-200'
                              : 'bg-white/70 backdrop-blur-sm border border-white/40'
                          }`}>
                            {isConnected && (
                              <div className="absolute top-3 right-3">
                                <div className="w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow-sm"></div>
                              </div>
                            )}
                            <PluginCard
                              pluginKey={plugin.pluginKey}
                              pluginName={plugin.name}
                              description={plugin.description}
                              icon={plugin.icon}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            /* Empty State */
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-slate-100 rounded-full mb-6">
                <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-700 mb-2">No integrations found</h3>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                We couldn't find any integrations matching "{search}". Try adjusting your search terms.
              </p>
              <button
                onClick={() => setSearch('')}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors duration-200"
              >
                Clear Search
              </button>
            </div>
          )}
        </div>

        {/* Bottom CTA Section */}
        <div className="mt-20 text-center">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-8 text-white">
            <h3 className="text-2xl font-bold mb-4">Need a Custom Integration?</h3>
            <p className="text-blue-100 mb-6 max-w-2xl mx-auto">
              Don't see the service you need? We're constantly adding new integrations. 
              Request a custom integration or build your own using our API.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-6 py-3 bg-white text-blue-600 font-semibold rounded-xl hover:bg-blue-50 transition-colors duration-200">
                Request Integration
              </button>
              <button className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-xl transition-colors duration-200">
                View API Docs
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}