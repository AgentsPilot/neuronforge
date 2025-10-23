'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { pluginList as availablePlugins, categoryMetadata } from '@/lib/plugins/pluginList'
import PluginCard from '@/components/settings/PluginCard'
import { useAuth } from '@/components/UserProvider'
import { getPluginAPIClient } from '@/lib/client/plugin-api-client'
import type { PluginInfo, UserPluginStatus } from '@/lib/types/plugin-types'
import {
  Link,
  Search,
  X,
  Sparkles,
  Globe,
  CheckCircle,
  Plus,
  RefreshCw,
  Clock,
  Filter,
  TrendingUp,
  ChevronDown,
  ChevronUp
} from 'lucide-react'

export default function ConnectionsPage() {
  const [search, setSearch] = useState('')
  const [connectedPlugins, setConnectedPlugins] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [availablePluginsData, setAvailablePluginsData] = useState<PluginInfo[]>([])
  const [userPluginStatus, setUserPluginStatus] = useState<UserPluginStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [showConnectedOnly, setShowConnectedOnly] = useState(false)
  const [sortByPopular, setSortByPopular] = useState(false)
  const [connectedExpanded, setConnectedExpanded] = useState(true)
  const [availableExpanded, setAvailableExpanded] = useState(true)
  const [comingSoonExpanded, setComingSoonExpanded] = useState(false)
  const { user } = useAuth()

  // Fetch all data at page level (optimization - single batch request instead of per-card)
  useEffect(() => {
    let mounted = true
    const fetchAllPluginData = async () => {
      if (!user?.id) {
        if (mounted) setLoading(false)
        return
      }

      if (mounted) setLoading(true)
      const apiClient = getPluginAPIClient()

      try {
        console.log('[Connections] Fetching plugin data...')

        // Fetch both available plugins and user status in parallel (no timeout)
        // Let requests complete naturally - better to wait than show nothing
        const [available, status] = await Promise.all([
          apiClient.getAvailablePlugins(),
          apiClient.getUserPluginStatus(user.id)
        ])

        console.log('[Connections] Data fetched successfully', {
          availableCount: available.length,
          connectedCount: status?.connected?.length || 0,
          disconnectedCount: status?.disconnected?.length || 0
        })

        if (mounted) {
          setAvailablePluginsData(available)
          setUserPluginStatus(status)

          // Update connected plugins list from status
          if (status?.connected) {
            setConnectedPlugins(status.connected.map(p => p.key))
          }
        }
      } catch (error) {
        console.error('[Connections] Error fetching plugin data:', error)
        // Even on error, stop loading
      } finally {
        if (mounted) {
          console.log('[Connections] Setting loading to false')
          setLoading(false)
        }
      }
    }

    fetchAllPluginData()

    return () => {
      mounted = false
    }
  }, [user?.id])

  const handleConnectionChange = (pluginKey: string, connected: boolean) => {
    if (connected) {
      setConnectedPlugins(prev => [...prev, pluginKey])
    } else {
      setConnectedPlugins(prev => prev.filter(key => key !== pluginKey))
    }
  }

  const filteredPlugins = availablePlugins.filter((plugin) => {
    const matchesSearch = plugin.name.toLowerCase().includes(search.toLowerCase()) ||
      plugin.description.toLowerCase().includes(search.toLowerCase())

    const matchesCategory = !selectedCategory ||
      selectedCategory === 'connected' && connectedPlugins.includes(plugin.pluginKey) ||
      selectedCategory === 'popular' && plugin.isPopular ||
      plugin.category === selectedCategory

    // Quick filter: connected only
    const matchesConnectedFilter = !showConnectedOnly || connectedPlugins.includes(plugin.pluginKey)

    return matchesSearch && matchesCategory && matchesConnectedFilter
  })

  // Sort plugins: connected ones first, then by popularity or alphabetical
  const sortedPlugins = filteredPlugins.sort((a, b) => {
    const aConnected = connectedPlugins.includes(a.pluginKey)
    const bConnected = connectedPlugins.includes(b.pluginKey)

    // Connected plugins always first
    if (aConnected && !bConnected) return -1
    if (!aConnected && bConnected) return 1

    // Then by popularity if enabled
    if (sortByPopular) {
      if (a.isPopular && !b.isPopular) return -1
      if (!a.isPopular && b.isPopular) return 1
    }

    // Finally alphabetical
    return a.name.localeCompare(b.name)
  })

  // Helper to check if a plugin is available in the backend
  const isPluginAvailable = (pluginKey: string): boolean => {
    return availablePluginsData.some(p => p.key === pluginKey)
  }

  const connectedCount = sortedPlugins.filter(plugin =>
    connectedPlugins.includes(plugin.pluginKey)
  ).length

  // ⭐ CHANGED: Calculate available count - only truly available plugins (not connected)
  const availableCount = sortedPlugins.filter(plugin =>
    !connectedPlugins.includes(plugin.pluginKey) && isPluginAvailable(plugin.pluginKey)
  ).length

  // ⭐ ADDED: Calculate coming soon count
  const comingSoonCount = sortedPlugins.filter(plugin =>
    !connectedPlugins.includes(plugin.pluginKey) && !isPluginAvailable(plugin.pluginKey)
  ).length

  // Get popular plugins count
  const popularCount = availablePlugins.filter(plugin => plugin.isPopular).length

  // Active filters count
  const activeFiltersCount = [search, selectedCategory, showConnectedOnly, sortByPopular].filter(Boolean).length

  // Clear all filters
  const clearAllFilters = () => {
    setSearch('')
    setSelectedCategory(null)
    setShowConnectedOnly(false)
    setSortByPopular(false)
  }

  const refreshConnections = async () => {
    if (!user?.id) return

    setLoading(true)
    const apiClient = getPluginAPIClient()

    try {
      const status = await apiClient.getUserPluginStatus(user.id)
      setUserPluginStatus(status)

      if (status.connected) {
        setConnectedPlugins(status.connected.map(p => p.key))
      }
    } catch (error) {
      console.error('Error refreshing connections:', error)
    } finally {
      setLoading(false)
    }
  }

  // Helper to get connection details for a plugin
  const getPluginConnectionDetails = (pluginKey: string) => {
    return userPluginStatus?.connected.find(p => p.key === pluginKey) || null
  }

  // Helper to get additional config for a plugin
  const getPluginAdditionalConfig = (pluginKey: string) => {
    const pluginData = availablePluginsData.find(p => p.key === pluginKey)
    return (pluginData as any)?.additional_config || undefined
  }

  // Loading skeleton component
  const PluginSkeleton = () => (
    <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
        <div className="flex-1">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-gray-200 rounded w-full"></div>
        <div className="h-3 bg-gray-200 rounded w-5/6"></div>
      </div>
      <div className="mt-4 h-10 bg-gray-200 rounded-lg"></div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header - Analytics Style */}
      <header className="text-center" role="banner">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4" aria-hidden="true">
          <Link className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
          Integrations
        </h1>
        <p className="text-gray-600 mt-2">
          Connect your favorite tools and services to streamline your workflow
        </p>
      </header>

      {/* Connection Stats - Compact Analytics Style */}
      <section aria-label="Integration statistics" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-3 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
              <CheckCircle className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-blue-600 font-semibold mb-0.5">Connected</p>
              <p className="text-2xl font-bold text-blue-900 leading-none">
                {loading ? (
                  <span className="inline-block w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></span>
                ) : (
                  connectedPlugins.length
                )}
              </p>
              <p className="text-xs text-blue-600/70 font-medium mt-1">{loading ? 'Loading...' : 'Active'}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200/50 rounded-xl p-3 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
              <Globe className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-emerald-600 font-semibold mb-0.5">Available</p>
              <p className="text-2xl font-bold text-emerald-900 leading-none">{availableCount}</p>
              <p className="text-xs text-emerald-600/70 font-medium mt-1">Ready</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200/50 rounded-xl p-3 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
              <Clock className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-orange-600 font-semibold mb-0.5">Coming Soon</p>
              <p className="text-2xl font-bold text-orange-900 leading-none">{comingSoonCount}</p>
              <p className="text-xs text-orange-600/70 font-medium mt-1">In dev</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-purple-600 font-semibold mb-0.5">Popular</p>
              <p className="text-2xl font-bold text-purple-900 leading-none">{popularCount}</p>
              <p className="text-xs text-purple-600/70 font-medium mt-1">Trending</p>
            </div>
          </div>
        </div>
      </section>

      {/* Search and Controls - Enhanced Style */}
      <section aria-label="Search and filter controls" className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          {/* Search Input */}
          <div className="flex-1 relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
            </div>
            <Input
              placeholder="Search for integrations (e.g., Gmail, Slack, Notion...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-12 pr-12 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/40 bg-white hover:border-gray-300 transition-all placeholder-gray-400 text-sm"
              aria-label="Search integrations"
              role="searchbox"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute inset-y-0 right-0 pr-4 flex items-center group/clear"
                aria-label="Clear search"
              >
                <div className="p-1 rounded-md hover:bg-gray-100 transition-colors">
                  <X className="h-4 w-4 text-gray-400 group-hover/clear:text-gray-600 transition-colors" />
                </div>
              </button>
            )}
          </div>

          {/* Refresh Button */}
          <button
            onClick={refreshConnections}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 text-sm font-semibold shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md whitespace-nowrap"
            aria-label={loading ? 'Refreshing connections...' : 'Refresh connections'}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </section>

      {/* Quick Actions Bar */}
      <section aria-label="Active filters and quick actions" className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          {/* Active Filters Breadcrumb */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-500" />
            {activeFiltersCount > 0 ? (
              <>
                <span className="text-sm text-gray-600">
                  {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} active:
                </span>
                {search && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-md text-xs font-medium">
                    Search: "{search.substring(0, 20)}{search.length > 20 ? '...' : ''}"
                    <button onClick={() => setSearch('')} className="hover:bg-blue-200 rounded p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {selectedCategory && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-md text-xs font-medium">
                    Category: {selectedCategory === 'connected' ? 'Connected' : selectedCategory === 'popular' ? 'Popular' : (categoryMetadata as any)[selectedCategory]?.label || selectedCategory}
                    <button onClick={() => setSelectedCategory(null)} className="hover:bg-purple-200 rounded p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {showConnectedOnly && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-md text-xs font-medium">
                    Connected Only
                    <button onClick={() => setShowConnectedOnly(false)} className="hover:bg-green-200 rounded p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {sortByPopular && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-md text-xs font-medium">
                    Popular First
                    <button onClick={() => setSortByPopular(false)} className="hover:bg-amber-200 rounded p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-gray-500 hover:text-gray-700 underline font-medium"
                >
                  Clear all
                </button>
              </>
            ) : (
              <span className="text-sm text-gray-500">No active filters</span>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConnectedOnly(!showConnectedOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                showConnectedOnly
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              aria-label="Show connected only"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Connected Only
            </button>
            <button
              onClick={() => setSortByPopular(!sortByPopular)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sortByPopular
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              aria-label="Sort by popular"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Popular First
            </button>
          </div>
        </div>
      </section>

      {/* Quick Categories - Analytics Style Pills */}
      {!search && (
        <section aria-label="Category filters" className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
          <div className="flex flex-wrap justify-center gap-2">
            <div className="flex bg-gray-100/80 rounded-lg p-1 flex-wrap gap-1" role="group" aria-label="Filter by category">
              {/* Connected */}
              <button
                onClick={() => setSelectedCategory(selectedCategory === 'connected' ? null : 'connected')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedCategory === 'connected'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                aria-label={`Filter by connected integrations (${connectedPlugins.length})`}
                aria-pressed={selectedCategory === 'connected'}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Connected
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  selectedCategory === 'connected'
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-200 text-gray-600'
                }`} aria-hidden="true">
                  {connectedPlugins.length}
                </span>
              </button>

              {/* Popular */}
              <button
                onClick={() => setSelectedCategory(selectedCategory === 'popular' ? null : 'popular')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedCategory === 'popular'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                aria-label={`Filter by popular integrations (${popularCount})`}
                aria-pressed={selectedCategory === 'popular'}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Popular
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  selectedCategory === 'popular'
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-200 text-gray-600'
                }`} aria-hidden="true">
                  {popularCount}
                </span>
              </button>

              {/* Category buttons */}
              {Object.entries(categoryMetadata).map(([categoryKey, category]) => (
                <button
                  key={categoryKey}
                  onClick={() => setSelectedCategory(selectedCategory === categoryKey ? null : categoryKey)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                    selectedCategory === categoryKey
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  aria-label={`Filter by ${category.label}`}
                  aria-pressed={selectedCategory === categoryKey}
                >
                  {category.icon}
                  {category.label}
                </button>
              ))}
            </div>
          </div>

          {/* Clear filter button */}
          {selectedCategory && (
            <div className="text-center mt-4">
              <button
                onClick={() => setSelectedCategory(null)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 text-sm font-medium shadow-sm"
                aria-label="Clear category filter"
              >
                <X className="w-3.5 h-3.5" />
                Clear filter
              </button>
            </div>
          )}
        </section>
      )}

      {/* Plugins Grid */}
      <main className="relative" role="main" aria-label="Integration catalog">
        {loading ? (
          /* Loading Skeletons */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" aria-label="Loading integrations" role="status">
            {[...Array(8)].map((_, i) => (
              <PluginSkeleton key={i} />
            ))}
          </div>
        ) : sortedPlugins.length > 0 ? (
          <>
            {/* Connected Apps Section */}
            {connectedCount > 0 && !search && !selectedCategory && (
              <section className="mb-8" aria-labelledby="connected-section-title">
                <button
                  onClick={() => setConnectedExpanded(!connectedExpanded)}
                  className="w-full bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 mb-4 border border-blue-100 hover:from-blue-100 hover:to-indigo-100 transition-all duration-200"
                  aria-expanded={connectedExpanded}
                  aria-controls="connected-plugins-grid"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
                        <CheckCircle className="w-5 h-5 text-white" />
                      </div>
                      <div className="text-left">
                        <h2 id="connected-section-title" className="text-lg font-bold text-gray-900">Connected</h2>
                        <p className="text-sm text-gray-600">{connectedCount} active integration{connectedCount !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="text-gray-600">
                      {connectedExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>
                </button>

                {connectedExpanded && (
                  <div id="connected-plugins-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {sortedPlugins
                      .filter(plugin => connectedPlugins.includes(plugin.pluginKey))
                      .map((plugin) => (
                      <div key={plugin.pluginKey}>
                        <PluginCard
                          pluginKey={plugin.pluginKey}
                          pluginName={plugin.name}
                          description={plugin.description}
                          detailedDescription={plugin.detailedDescription}
                          icon={plugin.icon}
                          category={plugin.category}
                          isPopular={plugin.isPopular}
                          isAvailable={isPluginAvailable(plugin.pluginKey)}
                          isConnected={connectedPlugins.includes(plugin.pluginKey)}
                          connectionDetails={getPluginConnectionDetails(plugin.pluginKey)}
                          additionalConfig={getPluginAdditionalConfig(plugin.pluginKey)}
                          onConnectionChange={handleConnectionChange}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Available Apps Section */}
            {availableCount > 0 && !selectedCategory && (
              <section className="mb-8" aria-labelledby="available-section-title">
                <button
                  onClick={() => setAvailableExpanded(!availableExpanded)}
                  className="w-full bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl p-4 mb-4 border border-emerald-100 hover:from-emerald-100 hover:to-green-100 transition-all duration-200"
                  aria-expanded={availableExpanded}
                  aria-controls="available-plugins-grid"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow-sm">
                        <Globe className="w-5 h-5 text-white" />
                      </div>
                      <div className="text-left">
                        <h2 id="available-section-title" className="text-lg font-bold text-gray-900">Available</h2>
                        <p className="text-sm text-gray-600">{availableCount} integration{availableCount !== 1 ? 's' : ''} ready</p>
                      </div>
                    </div>
                    <div className="text-gray-600">
                      {availableExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>
                </button>

                {availableExpanded && (
                  <div id="available-plugins-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {sortedPlugins
                      .filter(plugin => !connectedPlugins.includes(plugin.pluginKey) && isPluginAvailable(plugin.pluginKey))
                      .map((plugin) => (
                      <div key={plugin.pluginKey}>
                        <PluginCard
                          pluginKey={plugin.pluginKey}
                          pluginName={plugin.name}
                          description={plugin.description}
                          detailedDescription={plugin.detailedDescription}
                          icon={plugin.icon}
                          category={plugin.category}
                          isPopular={plugin.isPopular}
                          isAvailable={isPluginAvailable(plugin.pluginKey)}
                          isConnected={false}
                          connectionDetails={null}
                          additionalConfig={getPluginAdditionalConfig(plugin.pluginKey)}
                          onConnectionChange={handleConnectionChange}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Coming Soon Apps Section */}
            {comingSoonCount > 0 && !search && !selectedCategory && (
              <section className="mb-8" aria-labelledby="coming-soon-section-title">
                <button
                  onClick={() => setComingSoonExpanded(!comingSoonExpanded)}
                  className="w-full bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-4 mb-4 border border-orange-100 hover:from-orange-100 hover:to-amber-100 transition-all duration-200"
                  aria-expanded={comingSoonExpanded}
                  aria-controls="coming-soon-plugins-grid"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center shadow-sm">
                        <Clock className="w-5 h-5 text-white" />
                      </div>
                      <div className="text-left">
                        <h2 id="coming-soon-section-title" className="text-lg font-bold text-gray-900">Coming Soon</h2>
                        <p className="text-sm text-gray-600">{comingSoonCount} in development</p>
                      </div>
                    </div>
                    <div className="text-gray-600">
                      {comingSoonExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>
                </button>

                {comingSoonExpanded && (
                  <div id="coming-soon-plugins-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {sortedPlugins
                      .filter(plugin => !connectedPlugins.includes(plugin.pluginKey) && !isPluginAvailable(plugin.pluginKey))
                      .map((plugin) => (
                      <div key={plugin.pluginKey}>
                        <PluginCard
                          pluginKey={plugin.pluginKey}
                          pluginName={plugin.name}
                          description={plugin.description}
                          detailedDescription={plugin.detailedDescription}
                          icon={plugin.icon}
                          category={plugin.category}
                          isPopular={plugin.isPopular}
                          isAvailable={isPluginAvailable(plugin.pluginKey)}
                          isConnected={false}
                          connectionDetails={null}
                          additionalConfig={getPluginAdditionalConfig(plugin.pluginKey)}
                          onConnectionChange={handleConnectionChange}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Search/Filter Results - All Apps */}
            {(search || selectedCategory) && (
              <section className="mb-8" aria-labelledby="filtered-section-title">
                {selectedCategory && !search && (
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4 mb-4 border border-purple-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center shadow-sm">
                          {selectedCategory === 'connected' ? <CheckCircle className="w-5 h-5 text-white" /> :
                           selectedCategory === 'popular' ? <Sparkles className="w-5 h-5 text-white" /> :
                           <Globe className="w-5 h-5 text-white" />}
                        </div>
                        <div>
                          <h2 id="filtered-section-title" className="text-lg font-bold text-gray-900">
                            {selectedCategory === 'connected' ? 'Connected' :
                             selectedCategory === 'popular' ? 'Popular' :
                             (categoryMetadata as any)[selectedCategory]?.label || selectedCategory}
                          </h2>
                          <p className="text-sm text-gray-600">{sortedPlugins.length} integration{sortedPlugins.length !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {sortedPlugins.map((plugin) => {
                    const isConnected = connectedPlugins.includes(plugin.pluginKey)
                    return (
                      <div key={plugin.pluginKey} className="h-full">
                        <div className="h-full">
                          <PluginCard
                            pluginKey={plugin.pluginKey}
                            pluginName={plugin.name}
                            description={plugin.description}
                            detailedDescription={plugin.detailedDescription}
                            icon={plugin.icon}
                            category={plugin.category}
                            isPopular={plugin.isPopular}
                            isAvailable={isPluginAvailable(plugin.pluginKey)}
                            isConnected={isConnected}
                            connectionDetails={getPluginConnectionDetails(plugin.pluginKey)}
                            additionalConfig={getPluginAdditionalConfig(plugin.pluginKey)}
                            onConnectionChange={handleConnectionChange}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        ) : (
          /* Empty State */
          <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl" role="status" aria-live="polite">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-400 to-slate-500 rounded-3xl mb-6 shadow-xl">
              <Search className="w-10 w-10 text-white" />
            </div>
            <h3 className="text-2xl font-bold text-slate-700 mb-3">No integrations found</h3>
            <p className="text-slate-500 font-medium mb-8 max-w-md mx-auto leading-relaxed">
              {search ? `We couldn't find any integrations matching "${search}".` :
               selectedCategory ? `No integrations found in the selected category.` :
               'No integrations found.'} Try adjusting your search terms or filters.
            </p>
            <div className="flex gap-3 justify-center">
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  Clear Search
                </button>
              )}
              {selectedCategory && (
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="px-6 py-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl transition-all duration-300 shadow-sm hover:shadow-md hover:scale-105"
                >
                  Clear Filter
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom CTA Section - Gradient Style */}
      <section aria-label="Custom integration request" className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-3xl p-8 text-white shadow-2xl">
        <div className="text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl shadow-xl mb-2">
            <Plus className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold">Need a Custom Integration?</h3>
          <p className="text-indigo-100 font-medium max-w-2xl mx-auto leading-relaxed">
            Don't see the service you need? We're constantly adding new integrations.
            Request a custom integration and we'll build it for you.
          </p>
          <div className="flex justify-center pt-4">
            <button className="inline-flex items-center gap-2 px-6 py-3 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105">
              <Sparkles className="w-4 h-4" />
              Request Integration
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
