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
  Settings
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

export default function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterType>('all')
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

  const filteredAgents = agents.filter(agent => {
    const matchesSearch = agent.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         agent.description?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = statusFilter === 'all' || agent.status === statusFilter
    return matchesSearch && matchesFilter
  })

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return {
          icon: CheckCircle,
          color: 'text-green-600',
          bg: 'bg-green-50',
          badge: 'bg-green-100 text-green-800',
          label: 'Active'
        }
      case 'inactive':
        return {
          icon: Pause,
          color: 'text-red-600',
          bg: 'bg-red-50',
          badge: 'bg-red-100 text-red-800',
          label: 'Inactive'
        }
      case 'draft':
        return {
          icon: FileText,
          color: 'text-yellow-600',
          bg: 'bg-yellow-50',
          badge: 'bg-yellow-100 text-yellow-800',
          label: 'Draft'
        }
      default:
        return {
          icon: Clock,
          color: 'text-gray-600',
          bg: 'bg-gray-50',
          badge: 'bg-gray-100 text-gray-800',
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

  const AgentCard = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const StatusIcon = statusConfig.icon
    const ModeIcon = getModeIcon(agent.mode || 'on_demand')

    return (
      <div className="group bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200">
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${statusConfig.bg} flex items-center justify-center`}>
                <Bot className={`h-5 w-5 ${statusConfig.color}`} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {agent.agent_name}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${statusConfig.badge}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>
            
            <button className="opacity-0 group-hover:opacity-100 p-2 hover:bg-gray-100 rounded-lg transition-all">
              <MoreVertical className="h-4 w-4 text-gray-500" />
            </button>
          </div>

          <p className="text-sm text-gray-600 line-clamp-2 min-h-[2.5rem]">
            {agent.description || (
              <span className="italic text-gray-400">No description provided</span>
            )}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Created {agent.created_at ? formatTimeAgo(agent.created_at) : 'Unknown'}
            </span>
            {/* ✅ Changed from Link to span - whole card will be clickable via outer Link */}
            <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg group-hover:bg-blue-700 transition-colors cursor-pointer">
              <Settings className="h-3 w-3" />
              Manage
            </span>
          </div>
        </div>

        {/* Inactive reason */}
        {agent.status === 'inactive' && agent.deactivation_reason && (
          <div className="px-6 py-3 border-t border-red-100 bg-red-50">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">{agent.deactivation_reason}</p>
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
      <div className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className={`w-8 h-8 rounded-lg ${statusConfig.bg} flex items-center justify-center flex-shrink-0`}>
                <Bot className={`h-4 w-4 ${statusConfig.color}`} />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-medium text-gray-900 truncate">{agent.agent_name}</h3>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.badge}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-gray-600 bg-gray-100 rounded-full">
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
              <span className="text-xs text-gray-500">
                {agent.created_at ? formatTimeAgo(agent.created_at) : 'Unknown'}
              </span>
              {/* ✅ Changed from Link to span - whole row will be clickable via outer Link */}
              <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
                <Settings className="h-3 w-3" />
                Manage
              </span>
            </div>
          </div>

          {agent.status === 'inactive' && agent.deactivation_reason && (
            <div className="mt-3 pt-3 border-t border-red-100">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{agent.deactivation_reason}</p>
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
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bot className="h-6 w-6 text-blue-600" />
            AI Agents
          </h1>
          <p className="text-gray-600 mt-1">Manage and monitor your intelligent automation agents</p>
        </div>
        
        <Link
          href="/agents/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </Link>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-lg border border-gray-200">
        <div className="flex items-center gap-4 flex-1">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterType)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="draft">Draft</option>
            </select>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewType('grid')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewType === 'grid' 
                ? 'bg-white text-gray-900 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewType('list')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              viewType === 'list' 
                ? 'bg-white text-gray-900 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Bot className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Agents</p>
              <p className="text-lg font-semibold text-gray-900">{agents.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Active</p>
              <p className="text-lg font-semibold text-gray-900">
                {agents.filter(a => a.status === 'active').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-yellow-50 rounded-lg flex items-center justify-center">
              <FileText className="h-4 w-4 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Drafts</p>
              <p className="text-lg font-semibold text-gray-900">
                {agents.filter(a => a.status === 'draft').length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
              <Pause className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Inactive</p>
              <p className="text-lg font-semibold text-gray-900">
                {agents.filter(a => a.status === 'inactive').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent List */}
      {filteredAgents.length === 0 ? (
        <div className="text-center py-12">
          <Bot className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery || statusFilter !== 'all' ? 'No agents found' : 'No agents yet'}
          </h3>
          <p className="text-gray-600 mb-6">
            {searchQuery || statusFilter !== 'all' 
              ? 'Try adjusting your search or filter criteria.' 
              : 'Get started by creating your first AI agent.'}
          </p>
          {!searchQuery && statusFilter === 'all' && (
            <Link
              href="/agents/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Your First Agent
            </Link>
          )}
        </div>
      ) : (
        <div className={
          viewType === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
            : 'space-y-3'
        }>
          {/* ✅ FIXED: Each agent wrapped in Link - no nested Links inside components */}
          {filteredAgents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="block">
              {viewType === 'grid' ? <AgentCard agent={agent} /> : <AgentRow agent={agent} />}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}