// components/dashboard/StandaloneAgentVisualizer.tsx

import React, { useState, useEffect, useRef } from 'react';
import { Brain, Zap, Database, FileText, Cog, CheckCircle, AlertCircle, Clock, Target, TrendingUp, Shield, Lightbulb, Cpu, BarChart3, Activity, Eye, Layers, Play, Pause, RotateCcw, RefreshCw } from 'lucide-react';

interface ExecutionLog {
  id: string
  execution_id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  phase?: string
}

interface ExecutionData {
  id: string
  agent_id: string
  status: 'running' | 'completed' | 'failed'
  total_logs: number
  confidence: number
  quality_score: string
  duration_ms: number
  plugins_used: string[]
  business_context: string
  data_processed: boolean
  completed_at?: string
  created_at: string
}

interface StandaloneAgentVisualizerProps {
  executionId: string | null
  agentId?: string
  autoRefresh?: boolean
  onExecutionSelect?: (executionId: string) => void
}

const StandaloneAgentVisualizer: React.FC<StandaloneAgentVisualizerProps> = ({ 
  executionId, 
  agentId,
  autoRefresh = true, 
  onExecutionSelect 
}) => {
  const [executionData, setExecutionData] = useState<ExecutionData | null>(null)
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableExecutions, setAvailableExecutions] = useState<ExecutionData[]>([])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Dynamic phase mapping based on actual log patterns
  const phaseMapping = {
    'memory': {
      title: 'Contextual Memory Loading',
      icon: Database,
      color: 'from-purple-500 to-indigo-600',
      keywords: ['loading contextual memory', 'memory', 'patterns', 'history']
    },
    'intent': {
      title: 'Intent Analysis',
      icon: Brain, 
      color: 'from-emerald-500 to-teal-600',
      keywords: ['intent analysis', 'analyzing intent', 'primaryIntent', 'confidence']
    },
    'strategy': {
      title: 'Strategy Generation',
      icon: Target,
      color: 'from-green-500 to-emerald-600', 
      keywords: ['generating adaptive strategy', 'strategy', 'fallback', 'optimization']
    },
    'plugins': {
      title: 'Plugin Execution',
      icon: Cog,
      color: 'from-orange-500 to-red-600',
      keywords: ['executing smart plugin', 'plugin coordination', 'chatgpt-research', 'google-mail', 'google-drive']
    },
    'documents': {
      title: 'Document Processing',
      icon: FileText,
      color: 'from-yellow-500 to-orange-600',
      keywords: ['processing documents', 'document intelligence', 'extracted content', 'pdf']
    },
    'prompt': {
      title: 'Prompt Generation', 
      icon: Lightbulb,
      color: 'from-pink-500 to-rose-600',
      keywords: ['generating universal smart prompt', 'prompt generation', 'context being sent']
    },
    'llm': {
      title: 'LLM Execution',
      icon: Cpu,
      color: 'from-violet-500 to-purple-600',
      keywords: ['executing with gpt-4o', 'data-aware intelligence', 'llm execution']
    },
    'validation': {
      title: 'Quality Validation',
      icon: Shield,
      color: 'from-teal-500 to-green-600',
      keywords: ['quality validation', 'learning system', 'execution completed', 'confidence']
    }
  }

  // Fetch execution data
  const fetchExecutionData = async () => {
    if (!executionId) return

    try {
      setError(null)
      const response = await fetch(`/api/agent-logs/${executionId}`)
      
      if (!response.ok) {
        throw new Error(`Failed to fetch execution data: ${response.statusText}`)
      }
      
      const data = await response.json()
      setExecutionData(data.execution)
      setLogs(data.logs || [])
    } catch (err: any) {
      setError(err.message)
      console.error('Failed to fetch execution data:', err)
    }
  }

  // Fetch available executions for selection
  const fetchAvailableExecutions = async () => {
    try {
      const url = agentId ? `/api/agent-executions?agent_id=${agentId}&limit=20` : '/api/agent-executions?limit=20'
      const response = await fetch(url)
      
      if (response.ok) {
        const data = await response.json()
        setAvailableExecutions(data.executions || [])
      }
    } catch (err) {
      console.error('Failed to fetch available executions:', err)
    }
  }

  // Detect current phase from latest logs
  const getCurrentPhase = () => {
    if (logs.length === 0) return null
    
    const recentLogs = logs.slice(-10) // Check last 10 logs
    
    // Look for phase keywords in reverse chronological order
    for (let i = recentLogs.length - 1; i >= 0; i--) {
      const log = recentLogs[i]
      if (log.phase) return log.phase
      
      // Fallback: detect from message content
      const message = log.message.toLowerCase()
      for (const [phaseId, phase] of Object.entries(phaseMapping)) {
        if (phase.keywords.some(keyword => message.includes(keyword.toLowerCase()))) {
          return phaseId
        }
      }
    }
    
    return null
  }

  // Calculate phase completion based on logs
  const getPhaseCompletion = (phaseId: string) => {
    const phaseLogs = logs.filter(log => log.phase === phaseId)
    
    if (phaseLogs.length === 0) return 0
    
    const currentPhase = getCurrentPhase()
    const phaseOrder = Object.keys(phaseMapping)
    const currentIndex = phaseOrder.indexOf(currentPhase || '')
    const phaseIndex = phaseOrder.indexOf(phaseId)
    
    if (currentIndex > phaseIndex) return 100 // Completed
    if (currentIndex === phaseIndex && executionData?.status === 'running') return 75 // In progress
    if (currentIndex === phaseIndex && executionData?.status === 'completed') return 100 // Completed
    
    return phaseLogs.length > 0 ? 50 : 0 // Has some activity
  }

  // Format duration
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
  }

  // Auto-refresh effect
  useEffect(() => {
    if (executionId) {
      fetchExecutionData()
    }
    fetchAvailableExecutions()
  }, [executionId, agentId])

  useEffect(() => {
    if (autoRefresh && executionId && executionData?.status === 'running') {
      intervalRef.current = setInterval(fetchExecutionData, 2000) // Poll every 2 seconds
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
        }
      }
    }
  }, [executionId, autoRefresh, executionData?.status])

  const currentPhase = getCurrentPhase()
  const isLive = executionData?.status === 'running'

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-700 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-red-400 mb-2">Failed to Load Execution Data</h2>
            <p className="text-gray-400 mb-4">{error}</p>
            <button 
              onClick={() => {setError(null); fetchExecutionData();}}
              className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!executionId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-700 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl p-8 border border-gray-600/50 text-center">
            <Brain className="h-12 w-12 text-blue-400 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-white mb-4">Select an Execution to Visualize</h2>
            
            {availableExecutions.length > 0 ? (
              <div className="space-y-4 mt-6">
                <p className="text-gray-300">Recent executions:</p>
                <div className="grid gap-3">
                  {availableExecutions.map((execution) => (
                    <button
                      key={execution.id}
                      onClick={() => onExecutionSelect?.(execution.id)}
                      className="bg-slate-700/50 hover:bg-slate-600/50 border border-gray-600/30 rounded-lg p-4 text-left transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-white font-medium">
                            {execution.id.split('_')[2]?.slice(0, 8) || execution.id.slice(0, 8)}
                          </div>
                          <div className="text-gray-400 text-sm">
                            {new Date(execution.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded text-xs ${
                            execution.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                            execution.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {execution.status}
                          </span>
                          <span className="text-gray-400 text-xs">
                            {execution.total_logs} logs
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-gray-400">No executions found. Run an agent with visualization enabled to see data here.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!executionData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-700 p-6">
        <div className="max-w-4xl mx-auto flex items-center justify-center">
          <div className="text-center text-white">
            <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p>Loading execution data...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-700 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl shadow-lg">
              <Brain className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              Agent Execution Visualizer
            </h1>
          </div>
          <p className="text-gray-300 text-lg">Real-time execution monitoring and intelligence</p>
          
          {/* Execution Selector */}
          {availableExecutions.length > 0 && (
            <div className="mt-4">
              <select
                value={executionId}
                onChange={(e) => onExecutionSelect?.(e.target.value)}
                className="bg-slate-800 text-white border border-gray-600 rounded-lg px-4 py-2"
              >
                <option value="">Select execution...</option>
                {availableExecutions.map((execution) => (
                  <option key={execution.id} value={execution.id}>
                    {execution.id.split('_')[2]?.slice(0, 8) || execution.id.slice(0, 8)} - {execution.status} ({execution.total_logs} logs)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Status Bar */}
        <div className="mb-8 bg-slate-800/60 backdrop-blur-sm rounded-2xl p-6 border border-gray-600/50">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">
                {executionData.id.split('_')[2]?.slice(0, 8) || executionData.id.slice(0, 8)}
              </div>
              <div className="text-gray-400 text-sm">Execution ID</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">
                {(executionData.confidence * 100).toFixed(1)}%
              </div>
              <div className="text-gray-400 text-sm">Confidence</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{executionData.quality_score}</div>
              <div className="text-gray-400 text-sm">Quality Score</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-400">{executionData.plugins_used.length}</div>
              <div className="text-gray-400 text-sm">Plugins Used</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-teal-400">
                {formatDuration(executionData.duration_ms)}
              </div>
              <div className="text-gray-400 text-sm">Duration</div>
            </div>
          </div>

          {/* Live Status Indicator */}
          <div className="flex items-center justify-center gap-4">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              isLive 
                ? 'bg-green-500/20 text-green-400' 
                : executionData.status === 'completed'
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                isLive ? 'bg-green-400 animate-pulse' : 
                executionData.status === 'completed' ? 'bg-blue-400' : 'bg-red-400'
              }`} />
              {executionData.status.charAt(0).toUpperCase() + executionData.status.slice(1)}
            </div>
            {executionData.business_context && (
              <div className="px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg">
                {executionData.business_context}
              </div>
            )}
            <button
              onClick={fetchExecutionData}
              className="px-4 py-2 bg-gray-500/20 text-gray-400 rounded-lg hover:bg-gray-500/30 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Execution Phases */}
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
              <Activity className="h-6 w-6 text-emerald-400" />
              Execution Phases
            </h2>
            
            {Object.entries(phaseMapping).map(([phaseId, phase]) => {
              const completion = getPhaseCompletion(phaseId)
              const isActive = currentPhase === phaseId && isLive
              const isCompleted = completion === 100
              const IconComponent = phase.icon
              const phaseLogs = logs.filter(log => log.phase === phaseId)

              return (
                <div
                  key={phaseId}
                  className={`relative bg-slate-800/40 backdrop-blur-sm rounded-xl p-6 border transition-all duration-500 ${
                    isActive 
                      ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/20 scale-105' 
                      : isCompleted
                      ? 'border-green-500/50 shadow-lg shadow-green-500/20'
                      : 'border-gray-600/30'
                  }`}
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className={`p-3 rounded-lg bg-gradient-to-r ${phase.color} shadow-lg`}>
                      <IconComponent className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-white">{phase.title}</h3>
                      <div className="text-gray-400 text-sm">
                        {phaseLogs.length} log{phaseLogs.length !== 1 ? 's' : ''}
                        {phaseLogs.length > 0 && ` • Last: ${new Date(phaseLogs[phaseLogs.length - 1].timestamp).toLocaleTimeString()}`}
                      </div>
                    </div>
                    <div className="text-right">
                      {isCompleted && (
                        <CheckCircle className="h-6 w-6 text-green-400" />
                      )}
                      {isActive && (
                        <div className="animate-spin">
                          <Clock className="h-6 w-6 text-emerald-400" />
                        </div>
                      )}
                      {!isActive && !isCompleted && phaseLogs.length > 0 && (
                        <div className="w-6 h-6 border-2 border-yellow-500 border-dashed rounded-full" />
                      )}
                      {phaseLogs.length === 0 && (
                        <div className="w-6 h-6 border-2 border-gray-600 rounded-full" />
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${phase.color} transition-all duration-300`}
                        style={{ width: `${completion}%` }}
                      />
                    </div>
                    <div className="text-right text-sm text-gray-400 mt-1">
                      {completion}%
                    </div>
                  </div>

                  {/* Recent Logs */}
                  {phaseLogs.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs text-gray-400 mb-2">Recent logs ({phaseLogs.length}):</div>
                      {phaseLogs.slice(-2).map((log, logIndex) => (
                        <div
                          key={logIndex}
                          className={`text-xs p-2 rounded ${
                            log.level === 'error' ? 'bg-red-900/50 text-red-300' :
                            log.level === 'warn' ? 'bg-yellow-900/50 text-yellow-300' :
                            'bg-slate-700/50 text-gray-300'
                          }`}
                        >
                          <div className="font-mono text-xs break-all">
                            {log.message.slice(0, 120)}
                            {log.message.length > 120 && '...'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Live Logs */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
              <Eye className="h-6 w-6 text-purple-400" />
              Execution Logs ({logs.length})
            </h2>

            <div className="bg-slate-800/40 backdrop-blur-sm rounded-xl p-6 border border-gray-600/50 h-96 overflow-y-auto">
              {logs.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <Clock className="h-8 w-8 mx-auto mb-4" />
                  <p>No execution logs found.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.slice(-20).map((log, index) => (
                    <div
                      key={log.id}
                      className={`text-sm p-2 rounded ${
                        log.level === 'error' ? 'bg-red-800/30 text-red-300' :
                        log.level === 'warn' ? 'bg-yellow-800/30 text-yellow-300' :
                        'bg-slate-700/30 text-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-gray-500 text-xs">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded uppercase ${
                          log.level === 'error' ? 'bg-red-500/20 text-red-300' :
                          log.level === 'warn' ? 'bg-yellow-500/20 text-yellow-300' :
                          'bg-blue-500/20 text-blue-300'
                        }`}>
                          {log.level}
                        </span>
                        {log.phase && (
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-xs">
                            {log.phase}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs break-all">
                        {log.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Stats */}
            <div className="bg-slate-800/40 backdrop-blur-sm rounded-xl p-6 border border-gray-600/50">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-green-400" />
                Execution Statistics
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-400">{logs.length}</div>
                  <div className="text-gray-400 text-xs">Total Logs</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-400">
                    {executionData.data_processed ? 'Yes' : 'No'}
                  </div>
                  <div className="text-gray-400 text-xs">Data Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-400">{currentPhase || 'N/A'}</div>
                  <div className="text-gray-400 text-xs">Current Phase</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-400">
                    {logs.filter(l => l.level === 'error').length}
                  </div>
                  <div className="text-gray-400 text-xs">Errors</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StandaloneAgentVisualizer;