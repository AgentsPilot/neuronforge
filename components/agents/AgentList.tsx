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
  ChevronUp,
  TrendingUp,
  Activity,
  MoreHorizontal,
  Eye,
  Copy,
  Archive,
  Trash2,
  ExternalLink,
  Square,
  Loader2,
  StopCircle,
  Timer,
  PlayCircle,
  Cpu,
  BarChart3,
  Shield,
  Workflow,
  History
} from 'lucide-react'
import { useAgentExecution, useExecuteAgent } from '@/lib/hooks/useAgentExecution'
import { ExecutionStatusBadge } from '@/components/ExecutionStatusBadge'
import { formatScheduleDisplay, formatNextRun, calculateNextRun } from '@/lib/utils/scheduleFormatter'

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  deactivation_reason?: string
  created_at?: string
  mode?: string
  schedule_cron?: string
}

type FilterType = 'all' | 'active' | 'inactive' | 'draft'
type ViewType = 'grid' | 'list'
type SortType = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'

interface ExecutionHistoryItem {
  id: string;
  status: 'completed' | 'failed' | 'running' | 'pending';
  started_at: string;
  completed_at?: string;
  execution_duration_ms?: number;
  error_message?: string;
  progress: number;
}

// UPDATED: Enhanced execution history that checks both old and new systems
const AgentExecutionHistory = ({ agent }: { agent: Agent }) => {
  const [history, setHistory] = useState<ExecutionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!expanded || loading) return;
    
    setLoading(true);
    try {
      // NEW: Try to fetch from the unified agent_executions table first
      const unifiedResponse = await fetch(`/api/run-agent?agent_id=${agent.id}`);
      const unifiedData = await unifiedResponse.json();
      
      if (unifiedData.success && unifiedData.executions?.length > 0) {
        // Use unified execution data
        setHistory(unifiedData.executions);
        setError(null);
      } else {
        // FALLBACK: Use legacy execution-history endpoint
        const legacyResponse = await fetch(`/api/agents/${agent.id}/execution-history?limit=3`);
        const legacyData = await legacyResponse.json();
        
        if (legacyData.success) {
          setHistory(legacyData.history || []);
          setError(null);
        } else {
          setError(legacyData.error || 'Failed to fetch history');
        }
      }
    } catch (err) {
      setError('Network error');
      console.error('Error fetching execution history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) fetchHistory();
  }, [expanded, agent.id]);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  };

  const formatTimeAgo = (dateString: string) => {
    const diffInSeconds = Math.floor((new Date().getTime() - new Date(dateString).getTime()) / 1000);
    if (diffInSeconds < 60) return 'now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
    return `${Math.floor(diffInSeconds / 86400)}d`;
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'completed':
        return { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Done' };
      case 'failed':
        return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' };
      case 'running':
        return { icon: Loader2, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Running', pulse: true };
      default:
        return { icon: Clock, color: 'text-gray-600', bg: 'bg-gray-50', label: 'Pending' };
    }
  };

  const getSuccessRate = () => {
    if (history.length === 0) return 0;
    const successCount = history.filter(h => h.status === 'completed').length;
    return Math.round((successCount / history.length) * 100);
  };

  return (
    <div className="border-t border-gray-100 pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left hover:bg-gray-50 p-1.5 rounded transition-all duration-200 group"
      >
        <div className="flex items-center gap-2">
          <div className="p-1 bg-purple-50 rounded group-hover:bg-purple-100 transition-colors">
            <History className="w-3 h-3 text-purple-600" />
          </div>
          <div>
            <span className="text-xs font-medium text-gray-800">Recent Activity</span>
            {history.length > 0 && !loading && (
              <div className="text-xs text-emerald-600 font-medium">
                {getSuccessRate()}% success
              </div>
            )}
          </div>
        </div>
        
        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {loading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
              <AlertCircle className="w-3 h-3 text-red-600" />
              <span className="text-red-600">{error}</span>
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <div className="text-center py-3">
              <History className="w-4 h-4 text-gray-400 mx-auto mb-1" />
              <div className="text-xs text-gray-500">No runs yet</div>
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <>
              {/* Compact Summary */}
              <div className="grid grid-cols-3 gap-2 p-2 bg-gray-50 rounded text-center">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{history.length}</div>
                  <div className="text-xs text-gray-600">Runs</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-emerald-600">{getSuccessRate()}%</div>
                  <div className="text-xs text-gray-600">Success</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-blue-600">
                    {formatDuration(history.filter(h => h.execution_duration_ms).reduce((sum, h) => sum + (h.execution_duration_ms || 0), 0) / history.filter(h => h.execution_duration_ms).length || 0)}
                  </div>
                  <div className="text-xs text-gray-600">Avg</div>
                </div>
              </div>

              {/* Compact Execution List */}
              <div className="space-y-1">
                {history.map((execution) => {
                  const statusConfig = getStatusConfig(execution.status);
                  const StatusIcon = statusConfig.icon;
                  
                  return (
                    <div key={execution.id} className="flex items-center gap-2 p-1.5 bg-white border border-gray-200 rounded text-xs hover:border-gray-300 transition-colors">
                      <div className={`p-1 rounded ${statusConfig.bg}`}>
                        <StatusIcon className={`w-2.5 h-2.5 ${statusConfig.color} ${statusConfig.pulse ? 'animate-spin' : ''}`} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${statusConfig.color}`}>{statusConfig.label}</span>
                          {execution.status === 'running' && (
                            <span className="text-blue-600">{execution.progress}%</span>
                          )}
                        </div>
                        <div className="text-gray-500 truncate">
                          {formatTimeAgo(execution.started_at)}
                          {execution.execution_duration_ms && ` • ${formatDuration(execution.execution_duration_ms)}`}
                        </div>
                      </div>

                      {execution.status === 'running' && (
                        <div className="w-6 h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${execution.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {history.length >= 3 && (
                <div className="text-center pt-1">
                  <button className="text-xs text-purple-600 hover:text-purple-800 font-medium">
                    View all →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortType>('created_desc')
  const [viewType, setViewType] = useState<ViewType>('grid')

  const { executeAgent, isExecuting, stopTracking } = useExecuteAgent()

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

  // UPDATED: Enhanced execute agent function to use new queue-based system
  const handleExecuteAgent = async (agentId: string) => {
    try {
      console.log(`🚀 Starting queue-based execution for agent ${agentId}`);
      
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: agentId,
          use_queue: true, // Use the new unified scheduling system
        }),
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Agent execution queued successfully:', result.data);
        
        // Show success notification
        alert(`Agent queued successfully! Execution ID: ${result.data.execution_id}`);
        
        return { success: true, data: result.data };
      } else {
        console.error('❌ Failed to queue agent:', result.error);
        alert(`Failed to start agent: ${result.error}`);
        return { success: false, error: result.error };
      }
      
    } catch (error) {
      console.error('❌ Network error executing agent:', error);
      
      // FALLBACK: Try the legacy executeAgent hook if new system fails
      console.log('Falling back to legacy execution system...');
      const legacyResult = await executeAgent(agentId);
      if (!legacyResult.success) {
        alert(`Failed to start agent: ${legacyResult.error}`);
      }
      return legacyResult;
    }
  };

  useEffect(() => {
    async function fetchAgents() {
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, description, status, deactivation_reason, created_at, mode, schedule_cron')
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
          label: 'Active',
          glow: 'shadow-emerald-500/10'
        }
      case 'inactive':
        return { 
          icon: Pause, 
          color: 'text-slate-600', 
          bg: 'bg-slate-50',
          border: 'border-slate-200',
          dot: 'bg-slate-400',
          label: 'Paused',
          glow: 'shadow-slate-500/10'
        }
      case 'draft':
        return { 
          icon: FileText, 
          color: 'text-amber-600', 
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          dot: 'bg-amber-500',
          label: 'Draft',
          glow: 'shadow-amber-500/10'
        }
      default:
        return { 
          icon: Clock, 
          color: 'text-gray-600', 
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          dot: 'bg-gray-400',
          label: status,
          glow: 'shadow-gray-500/10'
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

  const AgentExecutionStatus = ({ agent }: { agent: Agent }) => {
    const { executionStatus, loading: statusLoading } = useAgentExecution(agent.id);
    
    if (statusLoading) {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-gray-50 text-gray-500 border border-gray-200">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Loading...</span>
        </div>
      );
    }

    if (!executionStatus) return null;

    const currentProgress = executionStatus.runningExecutions[0]?.progress || 0;
    const lastExecution = executionStatus.latestExecution;
    const lastStatus = lastExecution?.status || 'pending';

    return (
      <ExecutionStatusBadge
        status={lastStatus}
        isRunning={executionStatus.isRunning}
        progress={currentProgress}
        lastExecution={lastExecution}
        nextRunFormatted={executionStatus.nextRunFormatted}
        compact={true}
      />
    );
  };

  const AgentActionButtons = ({ agent }: { agent: Agent }) => {
    const { executionStatus } = useAgentExecution(agent.id);
    
    // FIXED: Clear executing state when execution completes
    useEffect(() => {
      if (executionStatus && !executionStatus.isRunning && isExecuting(agent.id)) {
        console.log(`Clearing executing state for agent ${agent.id}`);
        stopTracking(agent.id);
      }
    }, [executionStatus?.isRunning, agent.id, isExecuting, stopTracking]);

    // FIXED: Only use executionStatus.isRunning for the button state
    const isCurrentlyRunning = executionStatus?.isRunning || false;
    
    return (
      <div className="flex gap-2">
        {/* Execute/Stop Button */}
        {agent.status === 'active' && (
          <button
            onClick={() => handleExecuteAgent(agent.id)}
            disabled={isCurrentlyRunning}
            className={`group flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
              isCurrentlyRunning
                ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-105'
            }`}
          >
            {isCurrentlyRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 group-hover:scale-110 transition-transform" />
                {agent.mode === 'scheduled' ? 'Run Now' : 'Run'}
              </>
            )}
          </button>
        )}
        
        {/* Manage Button */}
        <Link
          href={`/agents/${agent.id}`}
          className="group flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 text-white text-sm font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-slate-500/25 hover:shadow-slate-500/40 hover:scale-105"
        >
          <Settings className="h-4 w-4 group-hover:rotate-90 transition-transform duration-300" />
          Manage
        </Link>
      </div>
    );
  };

  // COMPACT REDESIGNED CARD COMPONENT
  const ModernAgentCard = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const { executionStatus } = useAgentExecution(agent.id);
    const isRunning = executionStatus?.isRunning;
    const StatusIcon = statusConfig.icon

    return (
      <div className="group relative">
        {/* Glow effect for running agents */}
        {isRunning && (
          <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400 rounded-lg blur opacity-25 group-hover:opacity-40 transition duration-1000 animate-pulse" />
        )}
        
        <div className="relative bg-white/95 backdrop-blur-sm rounded-lg border border-gray-200/80 hover:border-purple-300/60 transition-all duration-300 overflow-hidden hover:shadow-lg hover:-translate-y-1 group">
          
          {/* Compact top accent */}
          <div className="h-0.5 bg-gradient-to-r from-violet-500 via-purple-500 to-blue-500 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />

          <div className="relative p-3">
            {/* Compact Header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Smaller avatar */}
                <div className="relative flex-shrink-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm transition-all duration-300 group-hover:scale-105 ${
                    isRunning 
                      ? 'bg-gradient-to-br from-emerald-500 via-blue-500 to-purple-500 animate-pulse' 
                      : 'bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600'
                  }`}>
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 ${statusConfig.dot} rounded-full border border-white shadow-sm`} />
                </div>
                
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1 group-hover:text-purple-700 transition-colors truncate">
                    {agent.agent_name}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${statusConfig.bg} ${statusConfig.color}`}>
                      <StatusIcon className="w-2.5 h-2.5" />
                      {statusConfig.label}
                    </div>
                    <AgentExecutionStatus agent={agent} />
                  </div>
                </div>
              </div>
              
              {/* Compact performance */}
              <div className="text-right flex-shrink-0 ml-2">
                <div className="flex items-center gap-0.5 text-xs text-gray-500 mb-0.5">
                  <Activity className="w-2.5 h-2.5" />
                  <span>98%</span>
                </div>
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`w-0.5 h-1.5 rounded-full ${i < 4 ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                  ))}
                </div>
              </div>
            </div>

            {/* Compact Description */}
            {agent.description && (
              <p className="text-xs text-gray-600 line-clamp-1 mb-2">
                {agent.description}
              </p>
            )}

            {/* Compact Schedule */}
            {agent.mode === 'scheduled' && agent.schedule_cron && (
              <div className="mb-2 p-1.5 bg-blue-50 rounded text-xs flex items-center gap-1.5">
                <Timer className="w-3 h-3 text-blue-600 flex-shrink-0" />
                <span className="text-blue-700 font-medium truncate">
                  {formatScheduleDisplay(agent.mode, agent.schedule_cron)}
                </span>
              </div>
            )}

            {/* Compact Action Buttons */}
            <div className="mb-2">
              <AgentActionButtons agent={agent} />
            </div>

            {/* Compact History */}
            <AgentExecutionHistory agent={agent} />
          </div>
        </div>
      </div>
    )
  }

  const ModernAgentRow = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)

    return (
      <div className="group bg-white rounded-xl border border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-lg transition-all duration-300 p-4 hover:-translate-y-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="relative">
              <div className="w-12 h-12 bg-gradient-to-br from-violet-500 via-purple-500 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
                <Bot className="h-6 w-6 text-white" />
              </div>
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 ${statusConfig.dot} rounded-full border-2 border-white shadow-lg`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h3 className="font-bold text-gray-900 truncate text-lg group-hover:text-purple-600 transition-colors">
                  {agent.agent_name}
                </h3>
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.color} ${statusConfig.border} border`}>
                  <div className={`w-1.5 h-1.5 ${statusConfig.dot} rounded-full`} />
                  {statusConfig.label}
                </div>
                <AgentExecutionStatus agent={agent} />
              </div>
              <p className="text-sm text-gray-600 truncate mb-1">
                {agent.description || 'An intelligent assistant ready to automate workflows'}
              </p>
              {agent.mode === 'scheduled' && agent.schedule_cron && (
                <div className="flex items-center gap-1.5">
                  <Timer className="w-3 h-3 text-blue-600" />
                  <p className="text-xs text-blue-600 font-medium">
                    {formatScheduleDisplay(agent.mode, agent.schedule_cron)}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right hidden lg:block">
              <p className="text-xs text-gray-500 font-medium">Created</p>
              <p className="text-sm text-gray-700 font-semibold">
                {agent.created_at ? formatTimeAgo(agent.created_at) : 'Recently'}
              </p>
            </div>
            
            <AgentActionButtons agent={agent} />
          </div>
        </div>

        {agent.status === 'inactive' && agent.deactivation_reason && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700 leading-snug">{agent.deactivation_reason}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/30 to-blue-50">
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <Bot className="h-10 w-10 text-white animate-pulse" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">Loading your agents</h3>
            <p className="text-gray-600 text-lg">Gathering your AI assistants...</p>
            <div className="mt-4 flex items-center justify-center gap-1">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-100" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-200" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/30 to-blue-50">
      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {/* Compact Controls */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-white/50 p-4 shadow-lg">
          <div className="space-y-4">
            
            {/* Search and View Toggle */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-lg">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 bg-white/70 backdrop-blur-sm transition-all placeholder-gray-400"
                />
              </div>

              {/* Compact View Toggle */}
              <div className="flex bg-gray-100/80 backdrop-blur-sm rounded-lg p-1">
                <button
                  onClick={() => setViewType('grid')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 ${
                    viewType === 'grid'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  Cards
                </button>
                <button
                  onClick={() => setViewType('list')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 ${
                    viewType === 'list'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  List
                </button>
              </div>
            </div>

            {/* Compact Filters and Sort */}
            <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
              
              {/* Status Filters */}
              <div className="flex items-center bg-gray-100/80 backdrop-blur-sm rounded-lg p-1 gap-1">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => setStatusFilter(filter.value as FilterType)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${
                      statusFilter === filter.value
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }`}
                  >
                    <span>{filter.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                      statusFilter === filter.value
                        ? 'bg-purple-100 text-purple-600'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {filter.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Sort Options */}
              <div className="flex items-center bg-gray-100/80 backdrop-blur-sm rounded-lg p-1 gap-1">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSortBy(option.value as SortType)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${
                      sortBy === option.value
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }`}
                  >
                    <option.icon className="w-3.5 h-3.5" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Compact Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { 
              label: 'Total', 
              value: agents.length, 
              icon: Bot, 
              gradient: 'from-violet-500 via-purple-500 to-indigo-600',
              bg: 'from-violet-50 to-purple-50'
            },
            { 
              label: 'Active', 
              value: agents.filter(a => a.status === 'active').length, 
              icon: CheckCircle, 
              gradient: 'from-emerald-500 via-green-500 to-teal-600',
              bg: 'from-emerald-50 to-green-50'
            },
            { 
              label: 'Draft', 
              value: agents.filter(a => a.status === 'draft').length, 
              icon: FileText, 
              gradient: 'from-amber-500 via-orange-500 to-red-600',
              bg: 'from-amber-50 to-orange-50'
            },
            { 
              label: 'Paused', 
              value: agents.filter(a => a.status === 'inactive').length, 
              icon: Pause, 
              gradient: 'from-slate-500 via-gray-500 to-zinc-600',
              bg: 'from-slate-50 to-gray-50'
            }
          ].map((stat, index) => (
            <div key={index} className={`group bg-gradient-to-br ${stat.bg} rounded-lg border border-white/50 hover:shadow-lg transition-all duration-300 p-3 hover:-translate-y-0.5`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 bg-gradient-to-br ${stat.gradient} rounded-lg flex items-center justify-center shadow-md group-hover:scale-105 transition-transform`}>
                  <stat.icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-0.5">{stat.label}</p>
                  <p className="text-xl font-bold text-gray-900">{stat.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Compact Results Info */}
        <div className="text-center">
          <p className="text-sm text-gray-600 bg-white/70 backdrop-blur-sm rounded-lg px-4 py-2 inline-block border border-white/50 shadow-sm">
            <span className="font-semibold text-purple-600">{filteredAndSortedAgents.length}</span> of <span className="font-semibold">{agents.length}</span> agents
          </p>
        </div>

        {/* Compact Agent Grid/List */}
        {filteredAndSortedAgents.length === 0 ? (
          <div className="text-center py-12 bg-white/80 backdrop-blur-sm rounded-xl border border-white/50 shadow-lg">
            <div className="w-16 h-16 bg-gradient-to-br from-gray-400 via-gray-500 to-slate-600 rounded-xl flex items-center justify-center mx-auto mb-4 opacity-60 shadow-lg">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
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
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
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