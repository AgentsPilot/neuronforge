'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { 
  Bot, 
  Plus, 
  Search, 
  Filter,
  Play,
  Pause,
  Edit,
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  Zap,
  Calendar,
  Settings,
  ArrowUpDown,
  Sparkles,
  Rocket,
  Star,
  Heart,
  Grid3X3,
  List,
  ChevronDown,
  TrendingUp,
  Activity,
  MoreHorizontal,
  Eye,
  Copy,
  Archive,
  Trash2,
  ExternalLink
} from 'lucide-react'

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  deactivation_reason?: string
  created_at?: string
  mode?: string
}

type FilterType = 'all' | 'active' | 'inactive' | 'draft'
type ViewType = 'grid' | 'list'
type SortType = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'

export default function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortType>('created_desc')
  const [viewType, setViewType] = useState<ViewType>('grid')

  // Status filter options
  const statusFilters = [
    { value: 'all', label: 'All', count: agents.length },
    { value: 'active', label: 'Active', count: agents.filter(a => a.status === 'active').length },
    { value: 'draft', label: 'Draft', count: agents.filter(a => a.status === 'draft').length },
    { value: 'inactive', label: 'Paused', count: agents.filter(a => a.status === 'inactive').length }
  ];

  // Sort options
  const sortOptions = [
    { value: 'created_desc', label: 'Newest first', icon: TrendingUp },
    { value: 'created_asc', label: 'Oldest first', icon: TrendingUp },
    { value: 'name_asc', label: 'A to Z', icon: ArrowUpDown },
    { value: 'name_desc', label: 'Z to A', icon: ArrowUpDown }
  ];

  useEffect(() => {
    async function fetchAgents() {
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, description, status, deactivation_reason, created_at, mode')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ Error fetching agents:', error)
      } else {
        setAgents(data || [])
      }
      setLoading(false)
    }
    fetchAgents()
  }, [])

  const sortAgents = (agents: Agent[], sortType: SortType) => {
    return [...agents].sort((a, b) => {
      switch (sortType) {
        case 'created_desc':
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        case 'created_asc':
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
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
    agents.filter(agent => {
      const matchesSearch = agent.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           agent.description?.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesFilter = statusFilter === 'all' || agent.status === statusFilter
      return matchesSearch && matchesFilter
    }),
    sortBy
  )

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return { 
          icon: CheckCircle, 
          color: 'text-emerald-600', 
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          dot: 'bg-emerald-500',
          label: 'Active' 
        }
      case 'inactive':
        return { 
          icon: Pause, 
          color: 'text-slate-600', 
          bg: 'bg-slate-50',
          border: 'border-slate-200',
          dot: 'bg-slate-400',
          label: 'Paused' 
        }
      case 'draft':
        return { 
          icon: FileText, 
          color: 'text-amber-600', 
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          dot: 'bg-amber-500',
          label: 'Draft' 
        }
      default:
        return { 
          icon: Clock, 
          color: 'text-gray-600', 
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          dot: 'bg-gray-400',
          label: status 
        }
    }
  }

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const date = new Date(dateString)
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
    return new Intl.DateTimeFormat('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    }).format(date)
  }

  const ModernAgentCard = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const StatusIcon = statusConfig.icon

    return (
      <div className="group relative bg-white rounded-xl border border-gray-200/60 hover:border-gray-300/60 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        {/* Header */}
        <div className="p-5">
          {/* Top section with icon and manage button */}
          <div className="flex items-start justify-between mb-3">
            <div className="relative flex-shrink-0">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                <Bot className="h-6 w-6 text-white" />
              </div>
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 ${statusConfig.dot} rounded-full border-2 border-white shadow-sm`} />
            </div>
            
            <Link
              href={`/agents/${agent.id}`}
              className="flex items-center gap-2 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <Settings className="h-3.5 w-3.5" />
              Manage
            </Link>
          </div>

          {/* Agent name - full width */}
          <div className="mb-3">
            <h3 className="text-lg font-bold text-gray-900 leading-tight mb-2">
              {agent.agent_name}
            </h3>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.color} ${statusConfig.border} border`}>
              <div className={`w-1.5 h-1.5 ${statusConfig.dot} rounded-full`} />
              {statusConfig.label}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-600 mb-4 line-clamp-2 leading-relaxed">
            {agent.description || 'An intelligent assistant ready to automate your workflows and handle complex tasks.'}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-center pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Calendar className="h-3.5 w-3.5" />
              <span>Created {agent.created_at ? formatTimeAgo(agent.created_at) : 'recently'}</span>
            </div>
          </div>
        </div>

        {agent.status === 'inactive' && agent.deactivation_reason && (
          <div className="mx-5 mb-5 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700 leading-relaxed">{agent.deactivation_reason}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  const ModernAgentRow = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const StatusIcon = statusConfig.icon

    return (
      <div className="group bg-white rounded-lg border border-gray-200/60 hover:border-gray-300/60 shadow-sm hover:shadow-md transition-all duration-200 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-lg flex items-center justify-center shadow-md">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 ${statusConfig.dot} rounded-full border border-white shadow-sm`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="font-bold text-gray-900 truncate text-sm">
                  {agent.agent_name}
                </h3>
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.color} ${statusConfig.border} border`}>
                  <div className={`w-1 h-1 ${statusConfig.dot} rounded-full`} />
                  {statusConfig.label}
                </div>
              </div>
              <p className="text-xs text-gray-600 truncate">
                {agent.description || 'An intelligent assistant ready to automate workflows'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <p className="text-xs text-gray-500">Created</p>
              <p className="text-xs text-gray-700 font-medium">
                {agent.created_at ? formatTimeAgo(agent.created_at) : 'Recently'}
              </p>
            </div>
            
            <Link
              href={`/agents/${agent.id}`}
              className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium rounded-md transition-all duration-150"
            >
              <Settings className="h-2.5 w-2.5" />
              <span className="hidden sm:inline">Manage</span>
            </Link>
          </div>
        </div>

        {agent.status === 'inactive' && agent.deactivation_reason && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-start gap-1.5">
              <AlertCircle className="h-3 w-3 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700 leading-snug">{agent.deactivation_reason}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-6">
              <Bot className="h-8 w-8 text-white animate-pulse" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Loading your agents</h3>
            <p className="text-gray-600">Gathering your AI assistants...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto p-4 space-y-5">
        {/* Modern Controls */}
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl border border-white/60 shadow-lg p-5">
          <div className="space-y-4">
            
            {/* First Row: Search Bar and View Toggle */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-2xl">
                <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-14 pr-5 py-3.5 border border-gray-200/60 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/40 bg-white/80 backdrop-blur-sm shadow-sm transition-all"
                />
              </div>

              {/* View Toggle */}
              <div className="flex bg-gray-100/80 rounded-xl p-1">
                <button
                  onClick={() => setViewType('grid')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    viewType === 'grid'
                      ? 'bg-white text-indigo-600 shadow-md'
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
                      ? 'bg-white text-indigo-600 shadow-md'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <List className="w-4 h-4" />
                  List
                </button>
              </div>
            </div>

            {/* Second Row: Status Filters and Sort Buttons */}
            <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
              
              {/* Status Filter Buttons */}
              <div className="flex items-center bg-gray-100/80 rounded-xl p-1 gap-1">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => setStatusFilter(filter.value as FilterType)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                      statusFilter === filter.value
                        ? 'bg-white text-indigo-600 shadow-md'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }`}
                  >
                    <span>{filter.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      statusFilter === filter.value
                        ? 'bg-indigo-100 text-indigo-600'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {filter.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Sort Button Group */}
              <div className="flex items-center bg-gray-100/80 rounded-xl p-1 gap-1">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSortBy(option.value as SortType)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                      sortBy === option.value
                        ? 'bg-white text-indigo-600 shadow-md'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }`}
                  >
                    <option.icon className="w-4 h-4" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Modern Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Agents', value: agents.length, icon: Bot, color: 'from-indigo-500 to-purple-600' },
            { label: 'Active', value: agents.filter(a => a.status === 'active').length, icon: CheckCircle, color: 'from-emerald-500 to-green-600' },
            { label: 'In Draft', value: agents.filter(a => a.status === 'draft').length, icon: FileText, color: 'from-amber-500 to-orange-600' },
            { label: 'Paused', value: agents.filter(a => a.status === 'inactive').length, icon: Pause, color: 'from-slate-500 to-gray-600' }
          ].map((stat, index) => (
            <div key={index} className="bg-white/70 backdrop-blur-xl rounded-xl border border-white/60 shadow-lg hover:shadow-xl transition-all duration-300 p-4">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 bg-gradient-to-br ${stat.color} rounded-xl flex items-center justify-center shadow-lg`}>
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600 mb-1">{stat.label}</p>
                  <p className="text-2xl font-black text-gray-900">{stat.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Results Info */}
        <div className="text-center">
          <p className="text-sm text-gray-600 bg-white/60 backdrop-blur-sm rounded-full px-3 py-1.5 inline-block border border-white/60">
            Showing {filteredAndSortedAgents.length} of {agents.length} agents
          </p>
        </div>

        {/* Agent Grid/List */}
        {filteredAndSortedAgents.length === 0 ? (
          <div className="text-center py-16 bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 shadow-xl">
            <div className="w-20 h-20 bg-gradient-to-br from-gray-400 to-gray-500 rounded-2xl flex items-center justify-center mx-auto mb-4 opacity-60">
              <Bot className="w-10 h-10 text-white" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              {searchQuery || statusFilter !== 'all' ? 'No agents found' : 'Ready to build?'}
            </h3>
            <p className="text-gray-600 max-w-md mx-auto leading-relaxed">
              {searchQuery || statusFilter !== 'all' 
                ? 'Try adjusting your search terms or filters to find what you\'re looking for.' 
                : 'Create your first AI agent to start automating workflows and boosting productivity.'}
            </p>
          </div>
        ) : (
          <div className={
            viewType === 'grid' 
              ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5'
              : 'space-y-3'
          }>
            {filteredAndSortedAgents.map((agent) => (
              viewType === 'grid' ? 
                <ModernAgentCard key={agent.id} agent={agent} /> : 
                <ModernAgentRow key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}