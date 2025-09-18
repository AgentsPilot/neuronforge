'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Badge } from '@/components/ui/badge'
import { 
  Bot, 
  Plus, 
  Search, 
  Filter,
  MoreVertical,
  Play,
  Pause,
  Edit,
  Archive,
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  Zap,
  Calendar,
  Activity,
  Settings,
  SortAsc,
  ArrowUpDown,
  ChevronDown
} from 'lucide-react'

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  deactivation_reason?: string
  created_at?: string
  mode?: string
  last_run_at?: string
}

type FilterType = 'all' | 'active' | 'inactive' | 'draft'
type ViewType = 'grid' | 'list'
type SortType = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'status_asc' | 'status_desc'

export default function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterType>('all')
  const [viewType, setViewType] = useState<ViewType>('grid')
  const [sortBy, setSortBy] = useState<SortType>('created_desc')

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
        case 'status_asc':
          return a.status.localeCompare(b.status)
        case 'status_desc':
          return b.status.localeCompare(a.status)
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
          bg: 'bg-green-50',
          badge: 'bg-green-100 text-green-800 border-green-200',
          label: 'Active'
        }
      case 'inactive':
        return {
          icon: Pause,
          color: 'text-red-600',
          bg: 'bg-red-50',
          badge: 'bg-red-100 text-red-800 border-red-200',
          label: 'Inactive'
        }
      case 'draft':
        return {
          icon: FileText,
          color: 'text-yellow-600',
          bg: 'bg-yellow-50',
          badge: 'bg-yellow-100 text-yellow-800 border-yellow-200',
          label: 'Draft'
        }
      default:
        return {
          icon: Clock,
          color: 'text-gray-600',
          bg: 'bg-gray-50',
          badge: 'bg-gray-100 text-gray-800 border-gray-200',
          label: status
        }
    }
  }

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'on_demand': return Play
      case 'scheduled': return Calendar
      case 'triggered': return Zap
      default: return Activity
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

  const getSortLabel = (sortType: SortType) => {
    switch (sortType) {
      case 'created_desc': return 'Newest First'
      case 'created_asc': return 'Oldest First'
      case 'name_asc': return 'Name A-Z'
      case 'name_desc': return 'Name Z-A'
      case 'status_asc': return 'Status A-Z'
      case 'status_desc': return 'Status Z-A'
      default: return 'Sort'
    }
  }

  const AgentCard = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const StatusIcon = statusConfig.icon
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')

    return (
      <div className="group bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg hover:border-gray-300 transition-all duration-300">
        {/* Status bar */}
        <div className={`h-1 rounded-t-2xl ${
          agent.status === 'active' ? 'bg-gradient-to-r from-green-400 to-green-600' :
          agent.status === 'inactive' ? 'bg-gradient-to-r from-red-400 to-red-600' :
          agent.status === 'draft' ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' :
          'bg-gradient-to-r from-gray-400 to-gray-600'
        }`}></div>
        
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4 flex-1">
              <div className={`w-12 h-12 rounded-xl ${statusConfig.bg} flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm`}>
                <Bot className={`h-6 w-6 ${statusConfig.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg text-gray-900 group-hover:text-blue-600 transition-colors mb-2 truncate">
                  {agent.agent_name}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border ${statusConfig.badge}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>
            
            <Link
              href={`/agents/${agent.id}/edit`}
              className="opacity-0 group-hover:opacity-100 p-2 hover:bg-blue-50 text-blue-600 rounded-xl transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <Edit className="h-4 w-4" />
            </Link>
          </div>

          <p className="text-sm text-gray-600 line-clamp-2 min-h-[2.5rem] leading-relaxed">
            {agent.description || (
              <span className="italic text-gray-400">No description provided</span>
            )}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-gray-100">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Calendar className="h-3 w-3" />
              Created {agent.created_at ? formatTimeAgo(agent.created_at) : 'Unknown'}
            </span>
            
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = `/agents/${agent.id}`;
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-xs font-semibold rounded-lg group-hover:from-blue-700 group-hover:to-blue-800 transition-all shadow-sm hover:shadow-md cursor-pointer"
            >
              <Settings className="h-3 w-3" />
              Manage
            </button>
          </div>
        </div>

        {/* Inactive reason */}
        {agent.status === 'inactive' && agent.deactivation_reason && (
          <div className="px-6 py-3 border-t border-red-200 bg-gradient-to-r from-red-50 to-red-100">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs font-medium text-red-800">{agent.deactivation_reason}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  const AgentRow = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const StatusIcon = statusConfig.icon
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')

    return (
      <div className="group bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all overflow-hidden">
        {/* Status indicator */}
        <div className={`h-0.5 ${
          agent.status === 'active' ? 'bg-gradient-to-r from-green-400 to-green-600' :
          agent.status === 'inactive' ? 'bg-gradient-to-r from-red-400 to-red-600' :
          agent.status === 'draft' ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' :
          'bg-gradient-to-r from-gray-400 to-gray-600'
        }`}></div>
        
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className={`w-10 h-10 rounded-xl ${statusConfig.bg} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                <Bot className={`h-5 w-5 ${statusConfig.color}`} />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-gray-900 truncate">{agent.agent_name}</h3>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full border ${statusConfig.badge}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-gray-600 truncate">
                  {agent.description || <span className="italic">No description</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-600">
                {agent.created_at ? formatTimeAgo(agent.created_at) : 'Unknown'}
              </span>
              
              <Link
                href={`/agents/${agent.id}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-xs font-semibold rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-sm"
              >
                <Settings className="h-3 w-3" />
                Manage
              </Link>
            </div>
          </div>

          {agent.status === 'inactive' && agent.deactivation_reason && (
            <div className="mt-3 pt-3 border-t border-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs font-medium text-red-800">{agent.deactivation_reason}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading agents...</p>
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
            <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <Bot className="h-6 w-6 text-white" />
            </div>
            AI Agents
          </h1>
          <p className="text-gray-600 mt-2 font-medium">Manage and monitor your intelligent automation agents</p>
        </div>
        
      </div>

      {/* Enhanced Controls */}
      <div className="flex flex-col gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-1 w-full lg:w-auto">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as FilterType)}
                  className="border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              
              {/* Sort */}
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-gray-500" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortType)}
                  className="border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="created_desc">Newest First</option>
                  <option value="created_asc">Oldest First</option>
                  <option value="name_asc">Name A-Z</option>
                  <option value="name_desc">Name Z-A</option>
                  <option value="status_asc">Status A-Z</option>
                  <option value="status_desc">Status Z-A</option>
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
            Showing {filteredAndSortedAgents.length} of {agents.length} agents
            {searchQuery && ` for "${searchQuery}"`}
            {statusFilter !== 'all' && ` with status "${statusFilter}"`}
          </span>
          <span>Sorted by {getSortLabel(sortBy)}</span>
        </div>
      </div>

      {/* Enhanced Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-2xl border-2 border-blue-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Bot className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-blue-700 font-semibold">Total Agents</p>
              <p className="text-2xl font-bold text-blue-900">{agents.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-2xl border-2 border-green-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-green-700 font-semibold">Active</p>
              <p className="text-2xl font-bold text-green-900">
                {agents.filter(a => a.status === 'active').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 p-6 rounded-2xl border-2 border-yellow-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-yellow-500 rounded-2xl flex items-center justify-center shadow-lg">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-yellow-700 font-semibold">Drafts</p>
              <p className="text-2xl font-bold text-yellow-900">
                {agents.filter(a => a.status === 'draft').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-red-50 to-red-100 p-6 rounded-2xl border-2 border-red-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Pause className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-red-700 font-semibold">Inactive</p>
              <p className="text-2xl font-bold text-red-900">
                {agents.filter(a => a.status === 'inactive').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent List */}
      {filteredAndSortedAgents.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Bot className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            {searchQuery || statusFilter !== 'all' ? 'No agents found' : 'No agents yet'}
          </h3>
          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            {searchQuery || statusFilter !== 'all' 
              ? 'Try adjusting your search or filter criteria to find what you\'re looking for.' 
              : 'Get started by creating your first AI agent to automate your workflows.'}
          </p>
          {!searchQuery && statusFilter === 'all' && (
            <Link
              href="/agents/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all transform hover:scale-105 shadow-lg"
            >
              <Plus className="h-5 w-5" />
              Create Your First Agent
            </Link>
          )}
        </div>
      ) : (
        <div className={
          viewType === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'
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