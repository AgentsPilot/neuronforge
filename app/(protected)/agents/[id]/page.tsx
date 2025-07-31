'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import AgentStatsBlock from '@/components/dashboard/AgentStatsTable'
import AgentHistoryBlock from '@/components/dashboard/AgentHistoryBlock'
import AgentSandbox from '@/components/dashboard/AgentSandbox'
import {
  Bot,
  Edit,
  Trash2,
  Power,
  PowerOff,
  ArrowLeft,
  Calendar,
  Activity,
  Settings,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Zap,
  Link2,
  MoreVertical,
  Copy,
  Download,
  Eye,
  EyeOff
} from 'lucide-react'

type Agent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  status: string
  input_schema?: any
  connected_plugins?: Record<string, any>
  plugins_required?: string[]
  created_at?: string
  updated_at?: string
  mode?: string
}

export default function AgentPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  const agentId = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchAgent = async () => {
    const { data, error } = await supabase
      .from('agents')
      .select('*, connected_plugins, plugins_required')
      .eq('id', agentId)
      .eq('user_id', user?.id)
      .maybeSingle()

    if (error) {
      console.error('❌ Failed to fetch agent:', error.message)
      return
    }

    setAgent(data)
    setLoading(false)
  }

  useEffect(() => {
    if (user && agentId) {
      fetchAgent()
    }
  }, [user, agentId])

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this agent? This action cannot be undone.')) {
      return
    }
    
    setActionLoading('delete')
    try {
      await supabase.from('agents').update({ is_archived: true }).eq('id', agentId)
      router.push('/agents')
    } catch (error) {
      console.error('Error deleting agent:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleStatus = async () => {
    const newStatus = agent?.status === 'active' ? 'inactive' : 'active'
    setActionLoading('toggle')
    
    try {
      await supabase.from('agents').update({ status: newStatus }).eq('id', agentId)
      await fetchAgent()
    } catch (error) {
      console.error('Error toggling status:', error)
    } finally {
      setActionLoading(null)
    }
  }

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading agent...</p>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Bot className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-gray-900 mb-2">Agent not found</h2>
          <p className="text-gray-600 mb-6">This agent doesn't exist or you don't have access to it.</p>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agents
          </Link>
        </div>
      </div>
    )
  }

  const statusConfig = getStatusConfig(agent.status)
  const StatusIcon = statusConfig.icon
  const ModeIcon = getModeIcon(agent.mode || 'on_demand')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/agents"
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </Link>
              
              <div className={`w-12 h-12 rounded-xl ${statusConfig.bg} flex items-center justify-center`}>
                <Bot className={`h-6 w-6 ${statusConfig.color}`} />
              </div>
              
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{agent.agent_name}</h1>
                <div className="flex items-center gap-3 mt-1">
                  <span className={`inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-full border ${statusConfig.badge}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                  <span className="inline-flex items-center gap-1 px-3 py-1 text-sm text-gray-600 bg-gray-100 rounded-full">
                    <ModeIcon className="h-3 w-3" />
                    {(agent.mode || 'on_demand').replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleToggleStatus}
                disabled={actionLoading === 'toggle'}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  agent.status === 'active'
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                }`}
              >
                {actionLoading === 'toggle' ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                ) : agent.status === 'active' ? (
                  <PowerOff className="h-4 w-4" />
                ) : (
                  <Power className="h-4 w-4" />
                )}
                {agent.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>

              <Link
                href={`/agents/${agent.id}/edit`}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Edit className="h-4 w-4" />
                Edit
              </Link>

              <button
                onClick={handleDelete}
                disabled={actionLoading === 'delete'}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
              >
                {actionLoading === 'delete' ? (
                  <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete
              </button>
            </div>
          </div>

          {agent.description && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-gray-700">{agent.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Agent Sandbox */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Play className="h-5 w-5 text-blue-600" />
                  Test Agent
                </h2>
                <p className="text-gray-600 text-sm mt-1">Run your agent with custom inputs to test its functionality</p>
              </div>
              <div className="p-6">
                <AgentSandbox
                  agentId={agent.id}
                  inputSchema={agent.input_schema}
                  userPrompt={agent.user_prompt}
                  connectedPlugins={agent.connected_plugins}
                  pluginsRequired={agent.plugins_required}
                />
              </div>
            </div>

            {/* Stats and History */}
            {agent.status !== 'draft' ? (
              <>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Activity className="h-5 w-5 text-blue-600" />
                      Performance Stats
                    </h2>
                  </div>
                  <div className="p-6">
                    <AgentStatsBlock agentId={agent.id} />
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Clock className="h-5 w-5 text-blue-600" />
                      Execution History
                    </h2>
                  </div>
                  <div className="p-6">
                    <AgentHistoryBlock agentId={agent.id} />
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-yellow-600 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-yellow-900 mb-2">Draft Mode</h3>
                    <p className="text-yellow-800 text-sm">
                      This agent is in draft mode. Activate it to start collecting performance statistics and execution history.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Agent Details */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Settings className="h-4 w-4 text-gray-600" />
                  Agent Details
                </h3>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Agent ID</label>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-600">
                      {agent.id.substring(0, 8)}...
                    </code>
                    <button className="p-1 hover:bg-gray-100 rounded">
                      <Copy className="h-3 w-3 text-gray-500" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Status</label>
                  <div className="mt-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${statusConfig.badge}`}>
                      <StatusIcon className="h-3 w-3" />
                      {statusConfig.label}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Mode</label>
                  <div className="mt-1">
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded-full">
                      <ModeIcon className="h-3 w-3" />
                      {(agent.mode || 'on_demand').replace('_', ' ')}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Connected Plugins</label>
                  <div className="mt-1">
                    {agent.plugins_required && agent.plugins_required.length > 0 ? (
                      <div className="space-y-1">
                        {agent.plugins_required.map((plugin) => (
                          <span
                            key={plugin}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full mr-1"
                          >
                            <Link2 className="h-3 w-3" />
                            {plugin}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">No plugins connected</span>
                    )}
                  </div>
                </div>

                {agent.created_at && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">Created</label>
                    <p className="mt-1 text-sm text-gray-600">
                      {new Date(agent.created_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Quick Actions</h3>
              </div>
              <div className="p-6 space-y-3">
                <Link
                  href={`/agents/${agent.id}/edit`}
                  className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <Edit className="h-4 w-4" />
                  Edit Configuration
                </Link>

                <button className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
                  <Download className="h-4 w-4" />
                  Export Settings
                </button>

                <button className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
                  <Copy className="h-4 w-4" />
                  Duplicate Agent
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}