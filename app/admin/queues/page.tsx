'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle, Clock, Loader2, AlertCircle, RefreshCw, BarChart3,
  TrendingUp, Zap, Eye, Filter, Search, Calendar, Database, Activity,
  ChevronDown, Copy, Pause, Play
} from 'lucide-react';

interface AgentExecution {
  id: string;
  agent_id: string;
  user_id: string;
  execution_type: 'manual' | 'scheduled';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  scheduled_at: string;
  started_at?: string;
  completed_at?: string;
  execution_duration_ms?: number;
  error_message?: string;
  result?: any;
  agent_name?: string;
  user_email?: string;
}

interface ExecutionStats {
  pending: { count: number; executions: AgentExecution[] };
  running: { count: number; executions: AgentExecution[] };
  completed: { count: number; executions: AgentExecution[] };
  failed: { count: number; executions: AgentExecution[] };
}

interface SystemMetrics {
  totalProcessed: number;
  avgProcessingTime: number;
  successRate: number;
  throughputPerHour: number;
  queueHealth: 'excellent' | 'good' | 'warning' | 'critical';
  errorRate: number;
  activeExecutions: number;
}

export default function QueueManagerV2() {
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<AgentExecution | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/agent-executions/stats');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setStats(data.stats);
      setMetrics(data.metrics);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch execution stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    if (autoRefresh) {
      const interval = setInterval(fetchStats, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const getExecutionsByFilter = () => {
    if (!stats) return [];

    let executions: AgentExecution[] = [];
    switch (filter) {
      case 'pending': executions = stats.pending.executions; break;
      case 'running': executions = stats.running.executions; break;
      case 'completed': executions = stats.completed.executions; break;
      case 'failed': executions = stats.failed.executions; break;
      default:
        executions = [
          ...stats.pending.executions,
          ...stats.running.executions,
          ...stats.completed.executions,
          ...stats.failed.executions
        ];
    }

    // Apply search filter
    if (searchTerm) {
      executions = executions.filter(exec =>
        exec.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exec.agent_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exec.agent_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exec.user_email?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return executions.sort((a, b) =>
      new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-blue-500/20 text-blue-300 border-blue-500/20';
      case 'pending': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/20';
      case 'completed': return 'bg-green-500/20 text-green-300 border-green-500/20';
      case 'failed': return 'bg-red-500/20 text-red-300 border-red-500/20';
      default: return 'bg-slate-500/20 text-slate-300 border-slate-500/20';
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'excellent': return 'text-green-400';
      case 'good': return 'text-yellow-400';
      case 'warning': return 'text-orange-400';
      case 'critical': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const ExecutionDetailsModal = ({ execution, onClose }: { execution: AgentExecution; onClose: () => void }) => (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800/95 backdrop-blur-xl rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-white/10">
        <div className="sticky top-0 bg-slate-800/95 backdrop-blur-xl px-6 py-4 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">Execution Details</h2>
            <p className="text-sm text-slate-400 font-mono">#{execution.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigator.clipboard.writeText(execution.id)}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Execution Overview */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/20 p-4 rounded-lg border border-blue-500/20">
              <p className="text-sm font-medium text-blue-300">Status</p>
              <p className="font-mono text-lg text-white">{execution.status}</p>
            </div>
            <div className="bg-gradient-to-br from-green-500/20 to-green-600/20 p-4 rounded-lg border border-green-500/20">
              <p className="text-sm font-medium text-green-300">Progress</p>
              <p className="font-mono text-lg text-white">{execution.progress}%</p>
            </div>
            <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/20 p-4 rounded-lg border border-purple-500/20">
              <p className="text-sm font-medium text-purple-300">Type</p>
              <p className="font-mono text-lg text-white">{execution.execution_type}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-500/20 to-orange-600/20 p-4 rounded-lg border border-orange-500/20">
              <p className="text-sm font-medium text-orange-300">Duration</p>
              <p className="font-mono text-lg text-white">
                {execution.execution_duration_ms ? formatDuration(execution.execution_duration_ms) : 'N/A'}
              </p>
            </div>
          </div>

          {/* Timing */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white">
              <Clock className="w-5 h-5" />
              Timeline
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center p-3 bg-slate-700/50 rounded">
                <span className="text-slate-300">Scheduled</span>
                <span className="text-white font-mono text-sm">{new Date(execution.scheduled_at).toLocaleString()}</span>
              </div>
              {execution.started_at && (
                <div className="flex justify-between items-center p-3 bg-slate-700/50 rounded">
                  <span className="text-slate-300">Started</span>
                  <span className="text-white font-mono text-sm">{new Date(execution.started_at).toLocaleString()}</span>
                </div>
              )}
              {execution.completed_at && (
                <div className="flex justify-between items-center p-3 bg-slate-700/50 rounded">
                  <span className="text-slate-300">Completed</span>
                  <span className="text-white font-mono text-sm">{new Date(execution.completed_at).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {execution.error_message && (
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-400">
                <AlertCircle className="w-5 h-5" />
                Error
              </h3>
              <div className="bg-red-500/20 border border-red-500/20 p-4 rounded-lg">
                <p className="text-red-200 font-mono text-sm">{execution.error_message}</p>
              </div>
            </div>
          )}

          {/* Result */}
          {execution.result && (
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-green-400">
                <CheckCircle className="w-5 h-5" />
                Result
              </h3>
              <div className="bg-slate-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto border border-slate-700">
                <pre>{JSON.stringify(execution.result, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-indigo-400" />
          <p className="text-lg text-slate-400">Loading execution stats...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h2 className="text-xl font-semibold text-white mb-2">Connection Error</h2>
          <p className="text-red-400 mb-6">{error}</p>
          <button
            onClick={fetchStats}
            className="px-6 py-2 bg-indigo-500/20 text-indigo-300 rounded-lg hover:bg-indigo-500/30 flex items-center gap-2 mx-auto transition-colors border border-indigo-500/20"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const filteredExecutions = getExecutionsByFilter();

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <div className="bg-slate-800/50 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <Activity className="w-8 h-8 text-indigo-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Agent Execution Monitor</h1>
                <p className="text-slate-400 mt-1">QStash-powered execution tracking</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/20 rounded-lg">
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-400'}`} />
                <span className="text-sm font-medium text-green-300">
                  {autoRefresh ? 'Live' : 'Paused'}
                </span>
              </div>

              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-3 py-1 text-sm rounded border transition-colors ${
                  autoRefresh
                    ? 'bg-green-500/20 text-green-300 border-green-500/20'
                    : 'bg-slate-700/50 text-slate-300 border-slate-600'
                }`}
              >
                {autoRefresh ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <button
                onClick={fetchStats}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 text-indigo-300 rounded-lg hover:bg-indigo-500/30 border border-indigo-500/20"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>

              {lastUpdate && (
                <div className="text-sm text-slate-400 bg-slate-700/50 px-3 py-1 rounded border border-slate-600">
                  {lastUpdate.toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Metrics */}
        {metrics && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/30 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Total Processed</p>
                  <p className="text-2xl font-bold text-white">{metrics.totalProcessed}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/30 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-green-300" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Success Rate</p>
                  <p className="text-2xl font-bold text-white">{metrics.successRate.toFixed(1)}%</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/30 rounded-lg">
                  <Zap className="w-5 h-5 text-blue-300" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Avg Time</p>
                  <p className="text-2xl font-bold text-white">{metrics.avgProcessingTime.toFixed(1)}s</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/30 rounded-lg">
                  <Activity className="w-5 h-5 text-purple-300" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Health</p>
                  <p className={`text-2xl font-bold ${getHealthColor(metrics.queueHealth)}`}>
                    {metrics.queueHealth.charAt(0).toUpperCase() + metrics.queueHealth.slice(1)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { key: 'pending', label: 'Pending', icon: Clock, color: 'yellow' },
            { key: 'running', label: 'Running', icon: Loader2, color: 'blue' },
            { key: 'completed', label: 'Completed', icon: CheckCircle, color: 'green' },
            { key: 'failed', label: 'Failed', icon: AlertCircle, color: 'red' },
          ].map(({ key, label, icon: Icon, color }) => (
            <div
              key={key}
              onClick={() => setFilter(key as any)}
              className={`bg-slate-800/50 rounded-xl p-4 border cursor-pointer transition-all hover:shadow-lg ${
                filter === key ? 'ring-2 ring-indigo-400/50' : ''
              } border-white/10 border-l-4 border-l-${color}-400`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">{label}</p>
                  <p className="text-2xl font-bold text-white">
                    {stats?.[key as keyof ExecutionStats]?.count || 0}
                  </p>
                </div>
                <Icon className={`w-6 h-6 text-${color}-400 ${key === 'running' ? 'animate-spin' : ''}`} />
              </div>
            </div>
          ))}
        </div>

        {/* Executions Table */}
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10">
          <div className="px-6 py-4 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database className="w-5 h-5" />
                Recent Executions
              </h2>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search executions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-transparent text-white placeholder-slate-400 text-sm focus:outline-none flex-1"
                />
              </div>

              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Agent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Progress</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Duration</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {filteredExecutions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      <Database className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                      <p className="text-lg font-medium">No executions found</p>
                    </td>
                  </tr>
                ) : (
                  filteredExecutions.slice(0, 50).map((exec) => (
                    <tr key={exec.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-mono text-sm text-white">{exec.id.slice(0, 8)}...</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-white truncate max-w-xs">
                          {exec.agent_name || exec.agent_id}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-300">{exec.execution_type}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(exec.status)}`}>
                          {exec.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-slate-700 rounded-full h-2">
                            <div
                              className="bg-indigo-500 h-2 rounded-full transition-all"
                              style={{ width: `${exec.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400">{exec.progress}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">
                        {exec.execution_duration_ms ? formatDuration(exec.execution_duration_ms) : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedExecution(exec)}
                          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-indigo-500/20"
                        >
                          <Eye className="w-4 h-4" />
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filteredExecutions.length > 50 && (
            <div className="px-6 py-3 bg-slate-700/30 border-t border-slate-600">
              <p className="text-sm text-slate-400">
                Showing first 50 of {filteredExecutions.length} executions
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedExecution && (
        <ExecutionDetailsModal
          execution={selectedExecution}
          onClose={() => setSelectedExecution(null)}
        />
      )}
    </div>
  );
}
