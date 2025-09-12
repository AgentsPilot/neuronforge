'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Badge } from '@/components/ui/badge'
import { 
  Bot, 
  Download, 
  Search, 
  Filter,
  Star,
  Users,
  Zap,
  Calendar,
  Activity,
  ArrowUpDown,
  Share2,
  Copy,
  CheckCircle,
  Clock,
  FileText,
  Play,
  Sparkles,
  TrendingUp,
  Heart,
  AlertCircle,
} from 'lucide-react'

type SharedAgent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  input_schema?: any
  output_schema?: any
  plugins_required?: string[]
  workflow_steps?: any
  mode?: string
  generated_plan?: string
  ai_reasoning?: string
  ai_confidence?: number
  detected_categories?: string[]
  created_from_prompt?: string
  ai_generated_at?: string
  connected_plugins?: any
  original_agent_id: string
  user_id: string
  shared_at: string
  created_at?: string
  updated_at?: string
}

type FilterType = 'all' | 'high_confidence' | 'recent' | 'popular'
type ViewType = 'grid' | 'list'
type SortType = 'shared_desc' | 'shared_asc' | 'name_asc' | 'name_desc' | 'confidence_desc' | 'confidence_asc'

export default function AgentTemplates() {
  const [sharedAgents, setSharedAgents] = useState<SharedAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<FilterType>('all')
  const [viewType, setViewType] = useState<ViewType>('grid')
  const [sortBy, setSortBy] = useState<SortType>('shared_desc')
  const [availableCategories, setAvailableCategories] = useState<string[]>([])
  const [importingAgents, setImportingAgents] = useState<Set<string>>(new Set())
  const [importStatus, setImportStatus] = useState<{type: 'success' | 'error', message: string} | null>(null)

  // Auto-hide status messages after 5 seconds
  useEffect(() => {
    if (importStatus) {
      const timer = setTimeout(() => {
        setImportStatus(null)
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [importStatus])

  useEffect(() => {
    async function fetchSharedAgents() {
      const { data, error } = await supabase
        .from('shared_agents')
        .select('*')
        .order('shared_at', { ascending: false })

      if (error) {
        console.error('❌ Error fetching shared agents:', error)
      } else {
        setSharedAgents(data || [])
        
        // Extract unique categories
        const categories = new Set<string>()
        data?.forEach(agent => {
          agent.detected_categories?.forEach((cat: string) => categories.add(cat))
        })
        setAvailableCategories(Array.from(categories).sort())
      }

      setLoading(false)
    }

    fetchSharedAgents()
  }, [])

  const sortAgents = (agents: SharedAgent[], sortType: SortType) => {
    return [...agents].sort((a, b) => {
      switch (sortType) {
        case 'shared_desc':
          return new Date(b.shared_at).getTime() - new Date(a.shared_at).getTime()
        case 'shared_asc':
          return new Date(a.shared_at).getTime() - new Date(b.shared_at).getTime()
        case 'name_asc':
          return a.agent_name.localeCompare(b.agent_name)
        case 'name_desc':
          return b.agent_name.localeCompare(a.agent_name)
        case 'confidence_desc':
          return (b.ai_confidence || 0) - (a.ai_confidence || 0)
        case 'confidence_asc':
          return (a.ai_confidence || 0) - (b.ai_confidence || 0)
        default:
          return 0
      }
    })
  }

  const filteredAndSortedAgents = sortAgents(
    sharedAgents.filter(agent => {
      const matchesSearch = agent.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           agent.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           agent.ai_reasoning?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           agent.detected_categories?.some(cat => cat.toLowerCase().includes(searchQuery.toLowerCase()))
      
      let matchesFilter = true
      switch (categoryFilter) {
        case 'high_confidence':
          matchesFilter = (agent.ai_confidence || 0) >= 0.8
          break
        case 'recent':
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
          matchesFilter = new Date(agent.shared_at) > oneDayAgo
          break
        case 'popular':
          // For now, we'll use confidence as a proxy for popularity
          matchesFilter = (agent.ai_confidence || 0) >= 0.7
          break
        case 'all':
        default:
          matchesFilter = true
      }
      
      return matchesSearch && matchesFilter
    }),
    sortBy
  )

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'on_demand': return Play
      case 'scheduled': return Calendar
      case 'triggered': return Zap
      default: return Activity
    }
  }

  const getConfidenceColor = (confidence?: number) => {
    if (!confidence) return 'text-gray-500'
    if (confidence >= 0.8) return 'text-green-600'
    if (confidence >= 0.6) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getConfidenceBg = (confidence?: number) => {
    if (!confidence) return 'bg-gray-50'
    if (confidence >= 0.8) return 'bg-green-50'
    if (confidence >= 0.6) return 'bg-yellow-50'
    return 'bg-red-50'
  }

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const date = new Date(dateString)
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
    return date.toLocaleDateString()
  }

  const getSortLabel = (sortType: SortType) => {
    switch (sortType) {
      case 'shared_desc': return 'Newest First'
      case 'shared_asc': return 'Oldest First'
      case 'name_asc': return 'Name A-Z'
      case 'name_desc': return 'Name Z-A'
      case 'confidence_desc': return 'Highest Confidence'
      case 'confidence_asc': return 'Lowest Confidence'
      default: return 'Sort'
    }
  }

  const handleImportAgent = async (agent: SharedAgent) => {
    try {
      setImportingAgents(prev => new Set(prev).add(agent.id))
      setImportStatus(null)

      // Get the current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        setImportStatus({
          type: 'error',
          message: 'You must be logged in to import agents.'
        })
        return
      }

      // Create a new agent based on the shared agent template
      const { data, error } = await supabase
        .from('agents')
        .insert({
          agent_name: `${agent.agent_name} (Imported)`,
          description: agent.description,
          system_prompt: agent.system_prompt,
          user_prompt: agent.user_prompt,
          user_id: user.id,
          input_schema: agent.input_schema,
          output_schema: agent.output_schema,
          plugins_required: agent.plugins_required,
          workflow_steps: agent.workflow_steps,
          mode: agent.mode || 'on_demand',
          generated_plan: agent.generated_plan,
          ai_reasoning: agent.ai_reasoning,
          ai_confidence: agent.ai_confidence,
          detected_categories: agent.detected_categories,
          created_from_prompt: agent.created_from_prompt,
          connected_plugins: agent.connected_plugins,
          status: 'draft',
          is_archived: false
        })
        .select()
        .single()

      if (error) {
        console.error('Error importing agent:', error)
        setImportStatus({
          type: 'error',
          message: `Failed to import "${agent.agent_name}". Please try again.`
        })
      } else {
        setImportStatus({
          type: 'success',
          message: `"${agent.agent_name}" imported successfully! Redirecting to edit...`
        })
        
        // Redirect after a short delay to show the success message
        setTimeout(() => {
          window.location.href = `/agents/${data.id}/edit`
        }, 1500)
      }
    } catch (error) {
      console.error('Error importing agent:', error)
      setImportStatus({
        type: 'error',
        message: `Failed to import "${agent.agent_name}". Please try again.`
      })
    } finally {
      setImportingAgents(prev => {
        const newSet = new Set(prev)
        newSet.delete(agent.id)
        return newSet
      })
    }
  }

  const AgentTemplateCard = ({ agent }: { agent: SharedAgent }) => {
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')
    const confidenceColor = getConfidenceColor(agent.ai_confidence)
    const confidenceBg = getConfidenceBg(agent.ai_confidence)

    return (
      <div className="group bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg hover:border-gray-300 transition-all duration-300">
        {/* Gradient top bar */}
        <div className="h-1 rounded-t-2xl bg-gradient-to-r from-purple-400 via-blue-500 to-green-400"></div>
        
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm border border-purple-100">
                <Share2 className="h-6 w-6 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg text-gray-900 group-hover:text-purple-600 transition-colors mb-2 truncate">
                  {agent.agent_name}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border bg-purple-100 text-purple-800 border-purple-200">
                    <Share2 className="h-3 w-3" />
                    Template
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                  {agent.ai_confidence && (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border ${confidenceBg} ${confidenceColor}`}>
                      <Sparkles className="h-3 w-3" />
                      {Math.round((agent.ai_confidence || 0) * 100)}% AI
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <button
              onClick={() => handleImportAgent(agent)}
              disabled={importingAgents.has(agent.id)}
              className="opacity-0 group-hover:opacity-100 p-2 hover:bg-purple-50 text-purple-600 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingAgents.has(agent.id) ? (
                <div className="animate-spin h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
          </div>

          <p className="text-sm text-gray-600 line-clamp-2 min-h-[2.5rem] leading-relaxed mb-3">
            {agent.description || agent.ai_reasoning || (
              <span className="italic text-gray-400">No description provided</span>
            )}
          </p>

          {/* Categories */}
          {agent.detected_categories && agent.detected_categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {agent.detected_categories.slice(0, 3).map((category, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-md"
                >
                  {category}
                </span>
              ))}
              {agent.detected_categories.length > 3 && (
                <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-500 bg-gray-100 rounded-md">
                  +{agent.detected_categories.length - 3} more
                </span>
              )}
            </div>
          )}

          {/* Plugins Required */}
          {agent.plugins_required && agent.plugins_required.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-3 w-3 text-amber-500" />
              <span className="text-xs text-gray-600">
                Requires: {agent.plugins_required.slice(0, 2).join(', ')}
                {agent.plugins_required.length > 2 && ` +${agent.plugins_required.length - 2} more`}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-purple-50">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Clock className="h-3 w-3" />
              Shared {formatTimeAgo(agent.shared_at)}
            </span>
            
            <button
              onClick={() => handleImportAgent(agent)}
              disabled={importingAgents.has(agent.id)}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-xs font-semibold rounded-lg group-hover:from-purple-700 group-hover:to-blue-700 transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingAgents.has(agent.id) ? (
                <>
                  <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="h-3 w-3" />
                  Import
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const AgentTemplateRow = ({ agent }: { agent: SharedAgent }) => {
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')
    const confidenceColor = getConfidenceColor(agent.ai_confidence)

    return (
      <div className="group bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all overflow-hidden">
        {/* Gradient indicator */}
        <div className="h-0.5 bg-gradient-to-r from-purple-400 via-blue-500 to-green-400"></div>
        
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center flex-shrink-0 shadow-sm border border-purple-100">
                <Share2 className="h-5 w-5 text-purple-600" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-gray-900 truncate">{agent.agent_name}</h3>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full border bg-purple-100 text-purple-800 border-purple-200">
                    <Share2 className="h-3 w-3" />
                    Template
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                  {agent.ai_confidence && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full ${confidenceColor}`}>
                      <Sparkles className="h-3 w-3" />
                      {Math.round((agent.ai_confidence || 0) * 100)}%
                    </span>
                  )}
                </div>
                <div className="flex items-start gap-4">
                  <p className="text-sm text-gray-600 flex-1 max-w-md line-clamp-2">
                    {agent.description || agent.ai_reasoning || <span className="italic">No description</span>}
                  </p>
                  {agent.detected_categories && agent.detected_categories.length > 0 && (
                    <div className="flex gap-1 flex-shrink-0">
                      {agent.detected_categories.slice(0, 2).map((category, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded whitespace-nowrap"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-600">
                {formatTimeAgo(agent.shared_at)}
              </span>
              
              <button
                onClick={() => handleImportAgent(agent)}
                disabled={importingAgents.has(agent.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-xs font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importingAgents.has(agent.id) ? (
                  <>
                    <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="h-3 w-3" />
                    Import
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading agent templates...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            Agent Templates
          </h1>
          <p className="text-gray-600 mt-2 font-medium">Discover and import AI agents shared by the community</p>
        </div>
        
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white font-semibold rounded-xl hover:from-gray-700 hover:to-gray-800 transition-all transform hover:scale-105 shadow-lg"
        >
          <Bot className="h-5 w-5" />
          My Agents
        </Link>
      </div>

      {/* Status Messages */}
      {importStatus && (
        <div className={`p-4 rounded-xl border-l-4 ${
          importStatus.type === 'success' 
            ? 'bg-green-50 border-green-400 text-green-800' 
            : 'bg-red-50 border-red-400 text-red-800'
        }`}>
          <div className="flex items-center gap-3">
            {importStatus.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600" />
            )}
            <p className="font-medium">{importStatus.message}</p>
            <button
              onClick={() => setImportStatus(null)}
              className="ml-auto text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Enhanced Controls */}
      <div className="flex flex-col gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-1 w-full lg:w-auto">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as FilterType)}
                  className="border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="all">All Templates</option>
                  <option value="high_confidence">High Quality (80%+)</option>
                  <option value="recent">Recently Shared</option>
                  <option value="popular">Popular</option>
                </select>
              </div>
              
              {/* Sort */}
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-gray-500" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortType)}
                  className="border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="shared_desc">Newest First</option>
                  <option value="shared_asc">Oldest First</option>
                  <option value="name_asc">Name A-Z</option>
                  <option value="name_desc">Name Z-A</option>
                  <option value="confidence_desc">Highest Quality</option>
                  <option value="confidence_asc">Lowest Quality</option>
                </select>
              </div>
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setViewType('grid')}
              className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                viewType === 'grid' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewType('list')}
              className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                viewType === 'list' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              List
            </button>
          </div>
        </div>
        
        {/* Results summary */}
        <div className="flex items-center justify-between text-sm text-gray-600 pt-2 border-t border-gray-100">
          <span>
            Showing {filteredAndSortedAgents.length} of {sharedAgents.length} templates
            {searchQuery && ` for "${searchQuery}"`}
            {categoryFilter !== 'all' && ` in "${categoryFilter}" category`}
          </span>
          <span>Sorted by {getSortLabel(sortBy)}</span>
        </div>
      </div>

      {/* Enhanced Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-2xl border-2 border-purple-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Total Templates</p>
              <p className="text-2xl font-bold text-purple-900">{sharedAgents.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-2xl border-2 border-green-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-green-700 font-semibold">High Quality</p>
              <p className="text-2xl font-bold text-green-900">
                {sharedAgents.filter(a => (a.ai_confidence || 0) >= 0.8).length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-2xl border-2 border-blue-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-blue-700 font-semibold">Recent (24h)</p>
              <p className="text-2xl font-bold text-blue-900">
                {sharedAgents.filter(a => {
                  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
                  return new Date(a.shared_at) > oneDayAgo
                }).length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-6 rounded-2xl border-2 border-amber-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-amber-700 font-semibold">Categories</p>
              <p className="text-2xl font-bold text-amber-900">{availableCategories.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Template List */}
      {filteredAndSortedAgents.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Share2 className="h-8 w-8 text-purple-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            {searchQuery || categoryFilter !== 'all' ? 'No templates found' : 'No templates available'}
          </h3>
          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            {searchQuery || categoryFilter !== 'all' 
              ? 'Try adjusting your search or filter criteria to find what you\'re looking for.' 
              : 'Check back later for community-shared agent templates.'}
          </p>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg"
          >
            <Bot className="h-5 w-5" />
            View My Agents
          </Link>
        </div>
      ) : (
        <div className={
          viewType === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'
            : 'space-y-4'
        }>
          {filteredAndSortedAgents.map((agent) => (
            viewType === 'grid' ? 
              <AgentTemplateCard key={agent.id} agent={agent} /> : 
              <AgentTemplateRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}