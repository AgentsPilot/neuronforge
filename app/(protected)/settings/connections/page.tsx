'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { pluginList as availablePlugins } from '@/lib/plugins/pluginList'
import PluginCard from '@/components/settings/PluginCard'

export default function ConnectionsPage() {
  const [search, setSearch] = useState('')

  const filteredPlugins = availablePlugins.filter((plugin) =>
    plugin.name.toLowerCase().includes(search.toLowerCase()) ||
    plugin.description.toLowerCase().includes(search.toLowerCase())
  )

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
                    Showing <span className="font-semibold text-blue-600">{filteredPlugins.length}</span> of {availablePlugins.length} integrations
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
          {filteredPlugins.length > 0 ? (
            <>
              {/* Grid Container */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredPlugins.map((plugin, index) => (
                  <div
                    key={plugin.pluginKey}
                    className="animate-in fade-in-0 slide-in-from-bottom-4 duration-300"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="group h-full">
                      <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] border border-white/40 h-full">
                        <PluginCard
                          pluginKey={plugin.pluginKey}
                          pluginName={plugin.pluginName}
                          description={plugin.description}
                          icon={plugin.icon}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More Button (if needed) */}
              {filteredPlugins.length > 12 && (
                <div className="text-center mt-12">
                  <button className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105">
                    Load More Integrations
                  </button>
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