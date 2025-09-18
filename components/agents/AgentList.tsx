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
  Heart
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
          color: 'text-green-600', 
          badge: 'bg-gradient-to-r from-green-100 to-emerald-100 text-green-700 border border-green-200', 
          label: 'Running' 
        }
      case 'inactive':
        return { 
          icon: Pause, 
          color: 'text-red-600', 
          badge: 'bg-gradient-to-r from-red-100 to-rose-100 text-red-700 border border-red-200', 
          label: 'Paused' 
        }
      case 'draft':
        return { 
          icon: FileText, 
          color: 'text-amber-600', 
          badge: 'bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 border border-amber-200', 
          label: 'Draft' 
        }
      default:
        return { 
          icon: Clock, 
          color: 'text-gray-600', 
          badge: 'bg-gradient-to-r from-gray-100 to-slate-100 text-gray-700 border border-gray-200', 
          label: status 
        }
    }
  }

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'on_demand': return Play
      case 'scheduled': return Calendar
      case 'triggered': return Zap
      default: return Settings
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
    return date.toLocaleDateString()
  }

  const AgentRow = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const StatusIcon = statusConfig.icon
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')

    return (
      <div className="group relative bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 hover:border-blue-300/50 hover:shadow-lg transition-all duration-300">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-50/30 via-purple-50/20 to-pink-50/30 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        
        <div className="relative p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-105 transition-all duration-300">
                  <Bot className="h-6 w-6 text-white" />
                </div>
                {agent.status === 'active' && (
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl animate-ping opacity-20 group-hover:opacity-30"></div>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-bold text-gray-900 truncate text-base group-hover:text-blue-600 transition-colors">
                    {agent.agent_name}
                  </h3>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${statusConfig.badge}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                </div>
                <p className="text-sm text-gray-600 truncate leading-relaxed">
                  {agent.description || <span className="italic text-gray-400">Ready to help you automate tasks</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right hidden md:block">
                <p className="text-xs text-gray-500 font-medium">Created</p>
                <p className="text-sm text-gray-700 font-semibold">
                  {agent.created_at ? formatTimeAgo(agent.created_at) : 'Unknown'}
                </p>
              </div>
              
              <Link
                href={`/agents/${agent.id}`}
                className="group/btn inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
              >
                <Settings className="h-4 w-4" />
                <span>Manage</span>
              </Link>
            </div>
          </div>

          {agent.status === 'inactive' && agent.deactivation_reason && (
            <div className="mt-4 p-3 bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 rounded-xl">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 font-medium">{agent.deactivation_reason}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const AgentCard = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const StatusIcon = statusConfig.icon
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')

    return (
      <div className="group relative bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 hover:border-blue-300/50 hover:shadow-xl transition-all duration-300">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-purple-50/30 to-pink-50/50 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        
        <div className="relative p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-300">
                  <Bot className="h-6 w-6 text-white" />
                </div>
                {agent.status === 'active' && (
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl animate-ping opacity-20 group-hover:opacity-40"></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 truncate text-base mb-2 group-hover:text-blue-600 transition-colors">
                  {agent.agent_name}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${statusConfig.badge}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-600 bg-gradient-to-r from-gray-100 to-slate-100 border border-gray-200 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>
            
            <Link
              href={`/agents/${agent.id}/edit`}
              className="opacity-0 group-hover:opacity-100 p-2 hover:bg-blue-50 text-blue-600 rounded-xl transition-all duration-300 transform hover:scale-110"
            >
              <Edit className="h-4 w-4" />
            </Link>
          </div>

          <p className="text-sm text-gray-600 line-clamp-2 mb-4 leading-relaxed min-h-[2.5rem]">
            {agent.description || <span className="italic text-gray-400">Ready to help you automate tasks and save time</span>}
          </p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">
                Created {agent.created_at ? formatTimeAgo(agent.created_at) : 'Unknown'}
              </span>
            </div>
            
            <Link
              href={`/agents/${agent.id}`}
              className="group/btn inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
            >
              <Settings className="h-4 w-4" />
              <span>Manage</span>
              <div className="w-1 h-1 bg-white/40 rounded-full group-hover/btn:bg-white/60 transition-colors"></div>
            </Link>
          </div>

          {agent.status === 'inactive' && agent.deactivation_reason && (
            <div className="mt-4 p-4 bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 rounded-xl -mx-5 -mb-5 mt-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 font-medium">{agent.deactivation_reason}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="relative mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl">
              <Bot className="h-8 w-8 text-white" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl animate-ping opacity-20"></div>
          </div>
          <p className="text-gray-600 font-medium">Loading your AI assistants...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Modern Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-purple-800 bg-clip-text text-transparent">
          What's Working For You
        </h1>
        <p className="text-gray-600 font-medium">Manage your intelligent automation helpers</p>
      </div>

      {/* Modern Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-1 w-full lg:w-auto">
            {/* Modern Search */}
            <div className="relative flex-1 max-w-md">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-xl blur-sm"></div>
              <div className="relative bg-white border border-gray-300 rounded-xl shadow-sm hover:shadow-md focus-within:shadow-lg transition-all duration-300">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search your assistants..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border-none rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-transparent"
                />
              </div>
            </div>

            {/* Modern Filters */}
            <div className="flex items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FilterType)}
                className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm hover:shadow-md transition-all"
              >
                <option value="all">All Assistants</option>
                <option value="active">Running</option>
                <option value="inactive">Paused</option>
                <option value="draft">Draft</option>
              </select>
              
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortType)}
                className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm hover:shadow-md transition-all"
              >
                <option value="created_desc">Newest First</option>
                <option value="created_asc">Oldest First</option>
                <option value="name_asc">A to Z</option>
                <option value="name_desc">Z to A</option>
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
        <div className="group relative overflow-hidden bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-2xl border-2 border-blue-200 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Bot className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-blue-700 font-semibold">Total Assistants</p>
              <p className="text-2xl font-bold text-blue-900">{agents.length}</p>
            </div>
          </div>
        </div>
        
        <div className="group relative overflow-hidden bg-gradient-to-br from-green-50 to-emerald-100 p-4 rounded-2xl border-2 border-green-200 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-green-700 font-semibold">Running</p>
              <p className="text-2xl font-bold text-green-900">
                {agents.filter(a => a.status === 'active').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="group relative overflow-hidden bg-gradient-to-br from-amber-50 to-yellow-100 p-4 rounded-2xl border-2 border-amber-200 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-yellow-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-yellow-500 rounded-2xl flex items-center justify-center shadow-lg">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-amber-700 font-semibold">Drafts</p>
              <p className="text-2xl font-bold text-amber-900">
                {agents.filter(a => a.status === 'draft').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="group relative overflow-hidden bg-gradient-to-br from-red-50 to-rose-100 p-4 rounded-2xl border-2 border-red-200 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-rose-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Pause className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-red-700 font-semibold">Paused</p>
              <p className="text-2xl font-bold text-red-900">
                {agents.filter(a => a.status === 'inactive').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Results Info */}
      <div className="text-center">
        <p className="text-sm text-gray-600 font-medium">
          Showing {filteredAndSortedAgents.length} of {agents.length} assistants
        </p>
      </div>

      {/* Agent Grid/List */}
      {filteredAndSortedAgents.length === 0 ? (
        <div className="text-center py-16 bg-gradient-to-br from-white/80 to-blue-50/80 backdrop-blur-sm rounded-3xl border border-gray-200/50 shadow-xl">
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-gray-400 to-gray-500 rounded-3xl flex items-center justify-center mx-auto shadow-xl">
              <Bot className="h-10 w-10 text-white" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-gray-400 to-gray-500 rounded-3xl animate-ping opacity-20"></div>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3">
            {searchQuery || statusFilter !== 'all' ? 'No assistants found' : 'No assistants yet'}
          </h3>
          <p className="text-gray-600 mb-8 font-medium max-w-md mx-auto leading-relaxed">
            {searchQuery || statusFilter !== 'all' 
              ? 'Try adjusting your search or filter to find what you\'re looking for.' 
              : 'Create your first AI assistant to start automating your tasks and workflows.'}
          </p>
        </div>
      ) : (
        <div className={
          viewType === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
            : 'space-y-4'
        }>
          {filteredAndSortedAgents.map((agent) => (
            viewType === 'grid' ? 
              <AgentCard key={agent.id} agent={agent} /> : 
              <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}