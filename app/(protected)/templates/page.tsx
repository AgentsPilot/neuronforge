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
  Settings,
  Globe
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
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
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
      // Search functionality - check multiple fields
      const searchTerm = searchQuery.toLowerCase().trim()
      const matchesSearch = !searchTerm || 
                           agent.agent_name.toLowerCase().includes(searchTerm) ||
                           (agent.description && agent.description.toLowerCase().includes(searchTerm)) ||
                           (agent.ai_reasoning && agent.ai_reasoning.toLowerCase().includes(searchTerm)) ||
                           (agent.detected_categories && agent.detected_categories.some(cat => 
                             cat.toLowerCase().includes(searchTerm)
                           ))
      
      // Quality/type filters
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
          matchesFilter = (agent.ai_confidence || 0) >= 0.7
          break
        case 'all':
        default:
          matchesFilter = true
      }
      
      // Category filter
      let matchesCategory = true
      if (selectedCategory !== 'all') {
        matchesCategory = agent.detected_categories && 
                         agent.detected_categories.includes(selectedCategory)
      }
      
      return matchesSearch && matchesFilter && matchesCategory
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
    if (confidence >= 0.8) return 'text-purple-600'
    if (confidence >= 0.6) return 'text-indigo-600'
    return 'text-violet-600'
  }

  const getConfidenceBg = (confidence?: number) => {
    if (!confidence) return 'bg-gradient-to-r from-gray-100 to-slate-100 text-gray-700'
    if (confidence >= 0.8) return 'bg-gradient-to-r from-purple-100 to-violet-100 text-purple-700'
    if (confidence >= 0.6) return 'bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-700'
    return 'bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700'
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
      <div className="group relative bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50/30 via-indigo-50/20 to-pink-50/30 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        
        <div className="relative p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-300">
                <Share2 className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 truncate text-base mb-2 group-hover:text-purple-600 transition-colors">
                  {agent.agent_name}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-gradient-to-r from-purple-100 to-indigo-100 text-purple-800">
                    <Globe className="h-3 w-3" />
                    Template
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-600 bg-gradient-to-r from-gray-100 to-slate-100 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                  {agent.ai_confidence && (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${confidenceBg}`}>
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
              className="opacity-0 group-hover:opacity-100 p-2 hover:bg-purple-50 text-purple-600 rounded-xl transition-all duration-300 transform hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingAgents.has(agent.id) ? (
                <div className="animate-spin h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
          </div>

          <p className="text-sm text-gray-600 line-clamp-2 mb-4 leading-relaxed min-h-[2.5rem]">
            {agent.description || agent.ai_reasoning || <span className="italic text-gray-400">Ready to help you automate tasks and workflows</span>}
          </p>

          {/* Categories */}
          {agent.detected_categories && agent.detected_categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {agent.detected_categories.slice(0, 3).map((category, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium text-indigo-700 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-full"
                >
                  {category}
                </span>
              ))}
              {agent.detected_categories.length > 3 && (
                <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-500 bg-gradient-to-r from-gray-100 to-slate-100 rounded-full">
                  +{agent.detected_categories.length - 3} more
                </span>
              )}
            </div>
          )}

          {/* Plugins Required */}
          {agent.plugins_required && agent.plugins_required.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1 bg-gradient-to-r from-purple-100 to-indigo-100 rounded-lg">
                <Zap className="h-3 w-3 text-purple-600" />
              </div>
              <span className="text-xs text-gray-600 font-medium">
                Requires: {agent.plugins_required.slice(0, 2).join(', ')}
                {agent.plugins_required.length > 2 && ` +${agent.plugins_required.length - 2} more`}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">
                Shared {formatTimeAgo(agent.shared_at)}
              </span>
            </div>
            
            <button
              onClick={() => handleImportAgent(agent)}
              disabled={importingAgents.has(agent.id)}
              className="group/btn inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-sm font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingAgents.has(agent.id) ? (
                <>
                  <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  <span>Import</span>
                  <div className="w-1 h-1 bg-white/40 rounded-full group-hover/btn:bg-white/60 transition-colors"></div>
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
    const confidenceBg = getConfidenceBg(agent.ai_confidence)

    return (
      <div className="group relative bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-50/20 via-indigo-50/15 to-pink-50/20 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        
        <div className="relative p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-105 transition-all duration-300">
                <Share2 className="h-6 w-6 text-white" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-bold text-gray-900 truncate text-base group-hover:text-purple-600 transition-colors">
                    {agent.agent_name}
                  </h3>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-gradient-to-r from-purple-100 to-indigo-100 text-purple-800">
                    <Globe className="h-3 w-3" />
                    Template
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-600 bg-gradient-to-r from-gray-100 to-slate-100 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                  {agent.ai_confidence && (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${confidenceBg}`}>
                      <Sparkles className="h-3 w-3" />
                      {Math.round((agent.ai_confidence || 0) * 100)}%
                    </span>
                  )}
                </div>
                <div className="flex items-start gap-4">
                  <p className="text-sm text-gray-600 flex-1 max-w-md line-clamp-2 leading-relaxed">
                    {agent.description || agent.ai_reasoning || <span className="italic text-gray-400">Ready to help automate tasks</span>}
                  </p>
                  {agent.detected_categories && agent.detected_categories.length > 0 && (
                    <div className="flex gap-1 flex-shrink-0">
                      {agent.detected_categories.slice(0, 2).map((category, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-0.5 text-xs font-medium text-indigo-700 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-full whitespace-nowrap"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right hidden md:block">
                <p className="text-xs text-gray-500 font-medium">Shared</p>
                <p className="text-sm text-gray-700 font-semibold">
                  {formatTimeAgo(agent.shared_at)}
                </p>
              </div>
              
              <button
                onClick={() => handleImportAgent(agent)}
                disabled={importingAgents.has(agent.id)}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-sm font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importingAgents.has(agent.id) ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    <span>Import</span>
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
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-6">
            <Share2 className="h-8 w-8 text-white" />
          </div>
          <p className="text-gray-600 font-medium">Loading community templates...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Modern Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 via-indigo-500 to-pink-500 rounded-3xl shadow-xl mb-4">
          <Share2 className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-purple-800 to-indigo-800 bg-clip-text text-transparent">
          Community Templates
        </h1>
        <p className="text-gray-600 font-medium">Discover and import AI assistants shared by the community</p>
      </div>

      {/* Status Messages */}
      {importStatus && (
        <div className={`relative overflow-hidden p-4 rounded-2xl border-l-4 shadow-lg ${
          importStatus.type === 'success' 
            ? 'bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-400 text-purple-800' 
            : 'bg-gradient-to-r from-red-50 to-rose-50 border-red-400 text-red-800'
        }`}>
          <div className="flex items-center gap-3">
            {importStatus.type === 'success' ? (
              <div className="p-1 bg-purple-500 rounded-full">
                <CheckCircle className="h-4 w-4 text-white" />
              </div>
            ) : (
              <div className="p-1 bg-red-500 rounded-full">
                <AlertCircle className="h-4 w-4 text-white" />
              </div>
            )}
            <p className="font-semibold">{importStatus.message}</p>
            <button
              onClick={() => setImportStatus(null)}
              className="ml-auto p-1 hover:bg-white/50 rounded-full transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Modern Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-1 w-full lg:w-auto">
            {/* Modern Search */}
            <div className="relative flex-1 max-w-md">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 rounded-xl blur-sm"></div>
              <div className="relative bg-white border border-gray-300 rounded-xl shadow-sm hover:shadow-md focus-within:shadow-lg transition-all duration-300">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border-none rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-transparent"
                />
              </div>
            </div>

            {/* Modern Filters */}
            <div className="flex items-center gap-3">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as FilterType)}
                className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm hover:shadow-md transition-all"
              >
                <option value="all">All Templates</option>
                <option value="high_confidence">High Quality (80%+)</option>
                <option value="recent">Recently Shared</option>
                <option value="popular">Popular</option>
              </select>
              
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm hover:shadow-md transition-all"
              >
                <option value="all">All Categories</option>
                {availableCategories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortType)}
                className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm hover:shadow-md transition-all"
              >
                <option value="shared_desc">Newest First</option>
                <option value="shared_asc">Oldest First</option>
                <option value="name_asc">A to Z</option>
                <option value="name_desc">Z to A</option>
                <option value="confidence_desc">Highest Quality</option>
                <option value="confidence_asc">Lowest Quality</option>
              </select>
            </div>
          </div>

          {/* Modern View Toggle */}
          <div className="bg-gradient-to-r from-gray-100 to-slate-100 rounded-xl p-1.5 shadow-inner">
            <button
              onClick={() => setViewType('grid')}
              className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-all duration-300 ${
                viewType === 'grid' 
                  ? 'bg-white text-gray-900 shadow-lg transform scale-105' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setViewType('list')}
              className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-all duration-300 ${
                viewType === 'list' 
                  ? 'bg-white text-gray-900 shadow-lg transform scale-105' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Modern Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Total Templates</p>
              <p className="text-2xl font-bold text-purple-900">{sharedAgents.length}</p>
            </div>
          </div>
        </div>
        
        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">High Quality</p>
              <p className="text-2xl font-bold text-indigo-900">
                {sharedAgents.filter(a => (a.ai_confidence || 0) >= 0.8).length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Recent (24h)</p>
              <p className="text-2xl font-bold text-purple-900">
                {sharedAgents.filter(a => {
                  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
                  return new Date(a.shared_at) > oneDayAgo
                }).length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Categories</p>
              <p className="text-2xl font-bold text-indigo-900">{availableCategories.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Results Info */}
      <div className="text-center">
        <p className="text-sm text-gray-600 font-medium">
          Showing {filteredAndSortedAgents.length} of {sharedAgents.length} templates
        </p>
      </div>

      {/* Template List */}
      {filteredAndSortedAgents.length === 0 ? (
        <div className="text-center py-16 bg-gradient-to-br from-white/80 to-purple-50/80 backdrop-blur-sm rounded-3xl border border-gray-200/50 shadow-xl">
          <div className="w-20 h-20 bg-gradient-to-br from-gray-400 to-gray-500 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-6">
            <Share2 className="h-10 w-10 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3">
            {searchQuery || categoryFilter !== 'all' || selectedCategory !== 'all' ? 'No templates found' : 'No templates available'}
          </h3>
          <p className="text-gray-600 mb-8 font-medium max-w-md mx-auto leading-relaxed">
            {searchQuery || categoryFilter !== 'all' || selectedCategory !== 'all'
              ? 'Try adjusting your search or filter criteria to find what you\'re looking for.' 
              : 'Check back later for community-shared agent templates.'}
          </p>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all transform hover:scale-105 shadow-lg"
          >
            <Bot className="h-5 w-5" />
            View My Assistants
          </Link>
        </div>
      ) : (
        <div className={
          viewType === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
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