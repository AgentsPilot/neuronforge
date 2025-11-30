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
  Globe,
  Grid3X3,
  List
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
  import_count?: number
  average_score?: number
  total_ratings?: number
}

type FilterType = 'all' | 'high_confidence' | 'recent' | 'popular'
type ViewType = 'grid' | 'list'
type SortType = 'shared_desc' | 'shared_asc' | 'name_asc' | 'name_desc'

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

  // Filter and sort options for button groups
  const qualityFilters = [
    { value: 'all', label: 'All', count: sharedAgents.length },
    { value: 'high_confidence', label: 'High Quality', count: sharedAgents.filter(a => (a.ai_confidence || 0) >= 0.8).length },
    { value: 'recent', label: 'Recent', count: sharedAgents.filter(a => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      return new Date(a.shared_at) > oneDayAgo
    }).length },
    { value: 'popular', label: 'Popular', count: sharedAgents.filter(a => (a.ai_confidence || 0) >= 0.7).length }
  ];

  const sortOptions = [
    { value: 'shared_desc', label: 'Newest first', icon: TrendingUp },
    { value: 'shared_asc', label: 'Oldest first', icon: TrendingUp },
    { value: 'name_asc', label: 'A to Z', icon: ArrowUpDown },
    { value: 'name_desc', label: 'Z to A', icon: ArrowUpDown }
  ];

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
        // Track import in shared_agent_imports table
        // This will automatically trigger import_count increment via database trigger
        const { error: trackError } = await supabase
          .from('shared_agent_imports')
          .insert({
            shared_agent_id: agent.id,
            imported_by_user_id: user.id,
            created_agent_id: data.id
          })

        if (trackError) {
          // Log error but don't fail the import (it's just analytics)
          console.error('Error tracking import:', trackError)
          // If it's a unique constraint violation (user already imported this template),
          // that's okay - just skip the tracking
        }

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

    return (
      <div className="group relative bg-white rounded-xl border border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
        {/* Header */}
        <div className="p-5">
          {/* Top section with icon and import button */}
          <div className="flex items-start justify-between mb-3">
            <div className="relative flex-shrink-0">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-sm">
                <Share2 className="h-6 w-6 text-white" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-sm" />
            </div>

            <button
              onClick={() => handleImportAgent(agent)}
              disabled={importingAgents.has(agent.id)}
              className="flex items-center gap-2 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingAgents.has(agent.id) ? (
                <>
                  <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                  Import
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Import
                </>
              )}
            </button>
          </div>

          {/* Agent name - full width */}
          <div className="mb-3">
            <h3 className="text-lg font-bold text-gray-900 leading-tight mb-2">
              {agent.agent_name}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                Template
              </div>
              {agent.import_count !== undefined && agent.import_count > 0 && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Download className="h-3 w-3" />
                  {agent.import_count} imports
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200">
                <ModeIcon className="h-3 w-3" />
                {(agent.mode || 'on_demand').replace('_', ' ')}
              </div>
              {agent.ai_confidence && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                  <Sparkles className="h-3 w-3" />
                  {Math.round((agent.ai_confidence || 0) * 100)}% AI
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-600 mb-4 line-clamp-2 leading-relaxed">
            {agent.description || agent.ai_reasoning || 'An intelligent assistant ready to automate your workflows and handle complex tasks.'}
          </p>

          {/* Categories - KEPT */}
          {agent.detected_categories && agent.detected_categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {agent.detected_categories.slice(0, 3).map((category, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full"
                >
                  {category}
                </span>
              ))}
              {agent.detected_categories.length > 3 && (
                <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full">
                  +{agent.detected_categories.length - 3} more
                </span>
              )}
            </div>
          )}

          {/* Plugins Required - KEPT */}
          {agent.plugins_required && agent.plugins_required.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1 bg-purple-50 border border-purple-200 rounded-lg">
                <Zap className="h-3 w-3 text-purple-600" />
              </div>
              <span className="text-xs text-gray-600 font-medium">
                Requires: {agent.plugins_required.slice(0, 2).join(', ')}
                {agent.plugins_required.length > 2 && ` +${agent.plugins_required.length - 2} more`}
              </span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Calendar className="h-3.5 w-3.5" />
              <span>Shared {formatTimeAgo(agent.shared_at)}</span>
            </div>

            {/* Rating Display */}
            {agent.average_score !== undefined && agent.average_score > 0 && (
              <div className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                <span className="text-xs font-semibold text-gray-700">
                  {agent.average_score.toFixed(1)}
                </span>
                {agent.total_ratings !== undefined && agent.total_ratings > 0 && (
                  <span className="text-xs text-gray-500">
                    ({agent.total_ratings})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const AgentTemplateRow = ({ agent }: { agent: SharedAgent }) => {
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')

    return (
      <div className="group bg-white rounded-lg border border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md transition-all duration-200 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Share2 className="h-4 w-4 text-white" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-white" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="font-bold text-gray-900 truncate text-sm">
                  {agent.agent_name}
                </h3>
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  <div className="w-1 h-1 bg-blue-500 rounded-full" />
                  Template
                </div>
                {agent.import_count !== undefined && agent.import_count > 0 && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Download className="w-2.5 h-2.5" />
                    {agent.import_count}
                  </div>
                )}
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                  <ModeIcon className="w-2.5 h-2.5" />
                  {(agent.mode || 'on_demand').replace('_', ' ')}
                </div>
                {agent.ai_confidence && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                    <Sparkles className="w-2.5 h-2.5" />
                    {Math.round((agent.ai_confidence || 0) * 100)}%
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-600 truncate">
                {agent.description || agent.ai_reasoning || 'An intelligent assistant ready to automate workflows'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Rating Display */}
            {agent.average_score !== undefined && agent.average_score > 0 && (
              <div className="flex items-center gap-1 hidden sm:flex">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                <span className="text-xs font-semibold text-gray-700">
                  {agent.average_score.toFixed(1)}
                </span>
                {agent.total_ratings !== undefined && agent.total_ratings > 0 && (
                  <span className="text-xs text-gray-500">
                    ({agent.total_ratings})
                  </span>
                )}
              </div>
            )}

            <div className="text-right hidden md:block">
              <p className="text-xs text-gray-500">Shared</p>
              <p className="text-xs text-gray-700 font-medium">
                {formatTimeAgo(agent.shared_at)}
              </p>
            </div>

            <button
              onClick={() => handleImportAgent(agent)}
              disabled={importingAgents.has(agent.id)}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium rounded-md transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingAgents.has(agent.id) ? (
                <>
                  <div className="animate-spin h-2.5 w-2.5 border-2 border-white border-t-transparent rounded-full" />
                  <span className="hidden sm:inline">Import</span>
                </>
              ) : (
                <>
                  <Download className="h-2.5 w-2.5" />
                  <span className="hidden sm:inline">Import</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto p-4">
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Share2 className="h-8 w-8 text-white animate-pulse" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Loading templates...</h3>
              <p className="text-gray-600">Gathering community templates...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl mb-4">
          <Share2 className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">
          Community Templates
        </h1>
        <p className="text-gray-600 font-medium">Discover and import AI assistants shared by the community</p>
      </div>

      {/* Status Messages */}
      {importStatus && (
        <div className={`relative overflow-hidden p-4 rounded-2xl border-l-4 ${
          importStatus.type === 'success' 
            ? 'bg-green-50 border-green-400 text-green-800' 
            : 'bg-red-50 border-red-400 text-red-800'
        }`}>
          <div className="flex items-center gap-3">
            {importStatus.type === 'success' ? (
              <div className="p-1 bg-green-500 rounded-full">
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

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="space-y-4">
          
          {/* First Row: Search Bar and View Toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-2xl">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all"
              />
            </div>

            {/* View Toggle */}
            <div className="flex bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setViewType('grid')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  viewType === 'grid'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <Grid3X3 className="w-4 h-4" />
                Cards
              </button>
              <button
                onClick={() => setViewType('list')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  viewType === 'list'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <List className="w-4 h-4" />
                List
              </button>
            </div>
          </div>

          {/* Second Row: Quality Filters and Sort Buttons */}
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            
            {/* Quality Filter Buttons */}
            <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
              {qualityFilters.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setCategoryFilter(filter.value as FilterType)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                    categoryFilter === filter.value
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    categoryFilter === filter.value
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Sort Button Group */}
            <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSortBy(option.value as SortType)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                    sortBy === option.value
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <option.icon className="w-4 h-4" />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter (if categories exist) */}
          {availableCategories.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Categories:</span>
              <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1 overflow-x-auto">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
                    selectedCategory === 'all'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  All Categories
                </button>
                {availableCategories.slice(0, 6).map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
                      selectedCategory === category
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }`}
                  >
                    {category}
                  </button>
                ))}
                {availableCategories.length > 6 && (
                  <span className="text-sm text-gray-500 px-2">+{availableCategories.length - 6} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results Info */}
      <div className="text-center">
        <p className="text-sm text-gray-600 bg-white rounded-full px-3 py-1.5 inline-block border border-gray-200">
          Showing {filteredAndSortedAgents.length} of {sharedAgents.length} templates
        </p>
      </div>

      {/* Template List */}
      {filteredAndSortedAgents.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <div className="w-20 h-20 bg-gradient-to-br from-gray-400 to-gray-500 rounded-xl flex items-center justify-center mx-auto mb-6">
            <Share2 className="h-10 w-10 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3">
            {searchQuery || categoryFilter !== 'all' || selectedCategory !== 'all' ? 'No templates found' : 'No templates available'}
          </h3>
          <p className="text-gray-600 mb-8 font-medium max-w-md mx-auto">
            {searchQuery || categoryFilter !== 'all' || selectedCategory !== 'all'
              ? 'Try adjusting your search or filter criteria to find what you\'re looking for.' 
              : 'Check back later for community-shared agent templates.'}
          </p>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-all"
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
    </div>
  )
}