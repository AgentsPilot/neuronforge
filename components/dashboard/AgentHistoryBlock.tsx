'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Calendar,
  Filter,
  Search,
  RefreshCw,
  Copy,
  Activity,
  FileText,
  Sparkles
} from 'lucide-react'

type LogEntry = {
  id: string
  created_at: string
  run_output: string
  full_output: any
  status?: string
  duration?: number
}

type FilterType = 'all' | 'success' | 'error' | 'warning'

export default function AgentHistoryBlock({ agentId }: { agentId: string }) {
  const { user } = useAuth()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterType>('all')
  const [currentPage, setCurrentPage] = useState(1)

  const logsPerPage = 10

  useEffect(() => {
    fetchLogs()
  }, [agentId, user])

  const fetchLogs = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('agent_logs')
      .select('id, created_at, run_output, full_output, status')
      .eq('agent_id', agentId)
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Failed to fetch logs:', error.message)
    } else {
      setLogs(data || [])
    }
    setLoading(false)
  }

  const getStatusFromOutput = (output: any): { status: string; icon: any; color: string } => {
    if (!output) {
      return { status: 'unknown', icon: Clock, color: 'text-gray-600' }
    }

    if (typeof output === 'object' && output !== null) {
      if (output.error || output.status === 'error') {
        return { status: 'error', icon: XCircle, color: 'text-red-600' }
      }
      if (output.warning || output.status === 'warning') {
        return { status: 'warning', icon: AlertTriangle, color: 'text-yellow-600' }
      }
      if (output.success !== false && output.status !== 'failed') {
        return { status: 'success', icon: CheckCircle, color: 'text-green-600' }
      }
    }
    
    if (typeof output === 'string') {
      if (output.toLowerCase().includes('error') || output.toLowerCase().includes('failed')) {
        return { status: 'error', icon: XCircle, color: 'text-red-600' }
      }
      if (output.toLowerCase().includes('warning')) {
        return { status: 'warning', icon: AlertTriangle, color: 'text-yellow-600' }
      }
    }
    
    return { status: 'success', icon: CheckCircle, color: 'text-green-600' }
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

  const formatSummaryText = (runOutput: string) => {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(runOutput)

      // Check if it's AgentKit output - show execution summary instead of message
      if (parsed.agentkit === true) {
        const parts = []

        // Success/failure
        if (parsed.success !== undefined) {
          parts.push(parsed.success ? 'Completed successfully' : 'Failed')
        }

        // Actions performed
        if (parsed.toolCallsCount) {
          parts.push(`${parsed.toolCallsCount} action${parsed.toolCallsCount !== 1 ? 's' : ''}`)
        }

        // Iterations
        if (parsed.iterations) {
          parts.push(`${parsed.iterations} step${parsed.iterations !== 1 ? 's' : ''}`)
        }

        // Duration
        if (parsed.executionTimeMs) {
          parts.push(`${(parsed.executionTimeMs / 1000).toFixed(1)}s`)
        }

        return parts.join(' • ')
      }

      // Check if it has a summary field
      if (parsed.summary) {
        return parsed.summary
      }

      // Check if it has a message field
      if (parsed.message) {
        return parsed.message
      }

      // Return truncated JSON
      return runOutput.substring(0, 100) + (runOutput.length > 100 ? '...' : '')
    } catch {
      // Not JSON, return as-is
      return runOutput || 'No output summary'
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const formatText = (text: string) => {
    // Split into paragraphs and clean up
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim())
    
    return paragraphs.map(paragraph => {
      // Format headers
      if (paragraph.startsWith('###')) {
        return `<h3 class="text-lg font-semibold text-gray-900 mt-4 mb-2 border-b border-gray-200 pb-1">${paragraph.replace(/^###\s*/, '')}</h3>`
      }
      if (paragraph.startsWith('##')) {
        return `<h2 class="text-xl font-bold text-gray-900 mt-4 mb-2">${paragraph.replace(/^##\s*/, '')}</h2>`
      }
      if (paragraph.startsWith('#')) {
        return `<h1 class="text-2xl font-bold text-gray-900 mt-4 mb-3">${paragraph.replace(/^#\s*/, '')}</h1>`
      }
      
      // Format lists
      if (paragraph.includes('\n- ') || paragraph.includes('\n* ')) {
        const lines = paragraph.split('\n')
        let html = ''
        let inList = false
        
        lines.forEach(line => {
          const trimmed = line.trim()
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            if (!inList) {
              html += '<ul class="list-disc list-inside space-y-1 my-2">'
              inList = true
            }
            html += `<li class="text-gray-800">${trimmed.substring(2)}</li>`
          } else if (trimmed) {
            if (inList) {
              html += '</ul>'
              inList = false
            }
            html += `<p class="text-gray-800 mb-2">${trimmed}</p>`
          }
        })
        
        if (inList) html += '</ul>'
        return html
      }
      
      // Format numbered lists
      if (/^\d+\./.test(paragraph.trim())) {
        const lines = paragraph.split('\n')
        let html = '<ol class="list-decimal list-inside space-y-1 my-2">'
        
        lines.forEach(line => {
          const trimmed = line.trim()
          if (/^\d+\./.test(trimmed)) {
            html += `<li class="text-gray-800">${trimmed.replace(/^\d+\.\s*/, '')}</li>`
          } else if (trimmed) {
            html += `<p class="text-gray-800 ml-4">${trimmed}</p>`
          }
        })
        
        html += '</ol>'
        return html
      }
      
      // Regular paragraphs with basic formatting
      let formatted = paragraph
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em class="italic text-gray-700">$1</em>')
        .replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-gray-800">$1</code>')
      
      return `<p class="text-gray-800 mb-3 leading-relaxed">${formatted}</p>`
    }).join('')
  }

  const renderAgentKitOutput = (output: any) => {
    // Check if this is an AgentKit execution (check both full_output and run_output)
    const isAgentKit = output?.agentkit_metadata || (typeof output === 'object' && output?.agentkit === true);
    if (!isAgentKit) return null;

    // Extract data from either full_output or run_output format
    let message, iterations, toolCalls, tokensUsed, model, executionTimeMs, toolCallsCount, success;

    if (output?.agentkit_metadata) {
      // Full output format
      ({ message, agentkit_metadata: { model, iterations, toolCalls, tokensUsed } } = output);
    } else if (output?.agentkit === true) {
      // Run output format (simplified)
      ({ response: message, iterations, toolCallsCount, tokensUsed, executionTimeMs, success } = output);
      model = 'gpt-4o'; // Default model
      toolCalls = []; // Not available in run_output
    }

    return (
      <div className="space-y-3">
        {/* Main Result Message - Compact */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-blue-600" />
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Result</span>
            </div>
            {success !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {success ? '✓' : '✗'}
              </span>
            )}
          </div>
          <div className="p-2.5">
            <div
              className="prose prose-sm max-w-none text-gray-700 text-xs leading-relaxed"
              dangerouslySetInnerHTML={{ __html: formatText(message || 'No message available') }}
            />
          </div>
        </div>

        {/* Execution Summary - Compact */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {model && (
            <div className="bg-white border border-gray-200 rounded p-2">
              <div className="text-xs text-gray-500 mb-0.5">Model</div>
              <div className="text-xs font-semibold text-gray-900">{model}</div>
            </div>
          )}
          {iterations !== undefined && (
            <div className="bg-white border border-gray-200 rounded p-2">
              <div className="text-xs text-gray-500 mb-0.5">Steps</div>
              <div className="text-xs font-semibold text-gray-900">{iterations}</div>
            </div>
          )}
          {(toolCalls?.length !== undefined || toolCallsCount !== undefined) && (
            <div className="bg-white border border-gray-200 rounded p-2">
              <div className="text-xs text-gray-500 mb-0.5">Actions</div>
              <div className="text-xs font-semibold text-gray-900">
                {toolCallsCount || toolCalls?.length || 0}
              </div>
            </div>
          )}
          {tokensUsed !== undefined && (
            <div className="bg-white border border-gray-200 rounded p-2">
              <div className="text-xs text-gray-500 mb-0.5">Tokens</div>
              <div className="text-xs font-semibold text-gray-900">
                {typeof tokensUsed === 'number' ? tokensUsed.toLocaleString() : tokensUsed?.total?.toLocaleString() || 0}
              </div>
            </div>
          )}
          {executionTimeMs !== undefined && (
            <div className="bg-white border border-gray-200 rounded p-2">
              <div className="text-xs text-gray-500 mb-0.5">Duration</div>
              <div className="text-xs font-semibold text-gray-900">
                {(executionTimeMs / 1000).toFixed(1)}s
              </div>
            </div>
          )}
        </div>

        {/* Tool Calls Timeline - Compact Design with Full Details */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-3 py-2 border-b border-gray-200">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Execution Steps</span>
            </div>
            <div className="divide-y divide-gray-100">
              {toolCalls.map((call: any, idx: number) => {
                const isSuccess = call.success;
                const Icon = isSuccess ? CheckCircle : XCircle;
                const iconColor = isSuccess ? 'text-green-500' : 'text-red-500';
                const accentColor = isSuccess ? 'border-l-green-500' : 'border-l-red-500';

                return (
                  <div key={idx} className={`flex flex-col gap-2 p-3 hover:bg-gray-50 transition-colors border-l-2 ${accentColor}`}>
                    {/* Header Row */}
                    <div className="flex items-start gap-3">
                      {/* Step number */}
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <span className="text-xs font-medium text-gray-600">{idx + 1}</span>
                      </div>

                      {/* Status icon */}
                      <Icon className={`h-4 w-4 ${iconColor} flex-shrink-0 mt-0.5`} />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-gray-900 capitalize">
                            {call.plugin.replace(/-/g, ' ')}
                          </span>
                          <span className="text-xs text-gray-400">→</span>
                          <span className="text-xs text-gray-600">
                            {call.action.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className={`text-xs ${isSuccess ? 'text-gray-600' : 'text-red-600'}`}>
                          {isSuccess
                            ? (call.result?.message || 'Completed successfully')
                            : (call.result?.message || call.result?.error || 'Failed')}
                        </p>
                      </div>
                    </div>

                    {/* Parameters Section */}
                    {call.parameters && Object.keys(call.parameters).length > 0 && (
                      <div className="ml-11 bg-gray-50 border border-gray-200 rounded p-2">
                        <div className="text-xs font-semibold text-gray-600 mb-1">Parameters:</div>
                        <div className="space-y-1.5">
                          {Object.entries(call.parameters).map(([key, value]) => {
                            // Special handling for different value types
                            if (value === null || value === undefined || value === '') {
                              return (
                                <div key={key} className="flex gap-2 text-xs">
                                  <span className="font-medium text-gray-700">{key}:</span>
                                  <span className="text-gray-400 italic">(empty)</span>
                                </div>
                              )
                            }

                            // Handle objects
                            if (typeof value === 'object') {
                              return (
                                <div key={key} className="text-xs">
                                  <div className="font-medium text-gray-700 mb-1">{key}:</div>
                                  <div className="ml-3 space-y-0.5">
                                    {Object.entries(value).map(([subKey, subValue]) => {
                                      // Handle nested content (like email body)
                                      if (typeof subValue === 'string' && subValue.length > 100) {
                                        return (
                                          <div key={subKey} className="space-y-0.5">
                                            <div className="font-medium text-gray-600">{subKey}:</div>
                                            <div className="ml-2 text-gray-600 whitespace-pre-wrap bg-white border border-gray-200 rounded p-2 max-h-32 overflow-y-auto">
                                              {subValue}
                                            </div>
                                          </div>
                                        )
                                      }

                                      // Handle arrays
                                      if (Array.isArray(subValue)) {
                                        return (
                                          <div key={subKey}>
                                            <span className="font-medium text-gray-600">{subKey}: </span>
                                            <span className="text-gray-600">{subValue.join(', ')}</span>
                                          </div>
                                        )
                                      }

                                      // Handle nested objects
                                      if (typeof subValue === 'object') {
                                        return (
                                          <div key={subKey}>
                                            <span className="font-medium text-gray-600">{subKey}: </span>
                                            <span className="text-gray-600">{JSON.stringify(subValue)}</span>
                                          </div>
                                        )
                                      }

                                      // Simple values
                                      return (
                                        <div key={subKey}>
                                          <span className="font-medium text-gray-600">{subKey}: </span>
                                          <span className="text-gray-600">{String(subValue)}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            }

                            // Simple string/number values
                            return (
                              <div key={key} className="flex gap-2 text-xs">
                                <span className="font-medium text-gray-700">{key}:</span>
                                <span className="text-gray-600">{String(value)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Result Data Section */}
                    {call.result?.data && Object.keys(call.result.data).length > 0 && (
                      <div className="ml-11 bg-blue-50 border border-blue-200 rounded p-2">
                        <div className="text-xs font-semibold text-blue-700 mb-1">Response Data:</div>
                        <div className="space-y-1">
                          {Object.entries(call.result.data).map(([key, value]) => {
                            // Skip large arrays/objects for display
                            if (Array.isArray(value) && value.length > 0) {
                              return (
                                <div key={key} className="flex gap-2 text-xs">
                                  <span className="font-medium text-blue-700">{key}:</span>
                                  <span className="text-blue-600">
                                    {value.length} items (click to expand)
                                  </span>
                                </div>
                              )
                            }
                            if (typeof value === 'object' && value !== null) {
                              return (
                                <div key={key} className="flex gap-2 text-xs">
                                  <span className="font-medium text-blue-700">{key}:</span>
                                  <span className="text-blue-600">{JSON.stringify(value).substring(0, 50)}...</span>
                                </div>
                              )
                            }
                            return (
                              <div key={key} className="flex gap-2 text-xs">
                                <span className="font-medium text-blue-700">{key}:</span>
                                <span className="text-blue-600">{String(value)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderOutput = (output: any) => {
    if (!output) {
      return (
        <div className="bg-gray-100 p-4 rounded-lg text-sm text-gray-600 text-center">
          No output data available
        </div>
      )
    }

    // Check if this is AgentKit output
    const agentkitOutput = renderAgentKitOutput(output);
    if (agentkitOutput) {
      return agentkitOutput;
    }

    if (typeof output === 'string') {
      const isLongText = output.length > 200 || output.includes('\n')
      
      return (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Output</span>
              <span className="text-xs text-gray-500">({output.length} characters)</span>
            </div>
            <button
              onClick={() => copyToClipboard(output)}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors"
              title="Copy text"
            >
              <Copy className="h-4 w-4 text-gray-500" />
            </button>
          </div>
          <div className="p-4">
            {isLongText ? (
              <div 
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: formatText(output) }}
              />
            ) : (
              <p className="text-sm text-gray-800">{output}</p>
            )}
          </div>
        </div>
      )
    }

    if (typeof output === 'object') {
      // Check if it has a message field that's long text
      if (output.message && typeof output.message === 'string' && output.message.length > 200) {
        return (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-blue-50">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-800">Output</span>
                <span className="text-xs text-blue-600">({output.message.length} characters)</span>
              </div>
              <button
                onClick={() => copyToClipboard(output.message)}
                className="p-1.5 hover:bg-blue-100 rounded transition-colors"
                title="Copy message"
              >
                <Copy className="h-4 w-4 text-blue-600" />
              </button>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto">
              <div 
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: formatText(output.message) }}
              />
            </div>
          </div>
        )
      }

      // Regular structured object
      return (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Structured Output</span>
              <span className="text-xs text-gray-500">({Object.keys(output).length} fields)</span>
            </div>
            <button
              onClick={() => copyToClipboard(JSON.stringify(output, null, 2))}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors"
              title="Copy full object"
            >
              <Copy className="h-4 w-4 text-gray-500" />
            </button>
          </div>
          <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
            {Object.entries(output).map(([key, value]) => (
              <div key={key} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 capitalize">
                    {key.replace(/_/g, ' ')}
                  </label>
                  <button
                    onClick={() => copyToClipboard(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value))}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Copy value"
                  >
                    <Copy className="h-3 w-3 text-gray-500" />
                  </button>
                </div>
                <div className="text-sm">
                  {typeof value === 'object' ? (
                    <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs overflow-x-auto font-mono">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  ) : typeof value === 'string' && value.length > 200 ? (
                    <div className="bg-gray-50 border border-gray-200 rounded p-3 max-h-32 overflow-y-auto">
                      <div 
                        className="prose prose-xs max-w-none"
                        dangerouslySetInnerHTML={{ __html: formatText(value) }}
                      />
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <span className="text-gray-800 break-words">{String(value) || 'null'}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="bg-gray-100 p-3 rounded-lg text-sm text-gray-600">
        <code>{typeof output}: {String(output)}</code>
      </div>
    )
  }

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.run_output?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         log.id.toLowerCase().includes(searchQuery.toLowerCase())
    
    if (statusFilter === 'all') return matchesSearch
    
    const logStatus = getStatusFromOutput(log.full_output).status
    return matchesSearch && logStatus === statusFilter
  })

  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * logsPerPage,
    currentPage * logsPerPage
  )

  const totalPages = Math.ceil(filteredLogs.length / logsPerPage)

  const toggleDetails = (logId: string) => {
    setExpandedLogId(prev => prev === logId ? null : logId)
  }

  if (loading) {
    return (
      <div className="p-6 text-center">
        <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        <p className="text-gray-500 text-sm">Loading execution history...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" />
            Execution History
          </h2>
          <p className="text-gray-600 text-sm mt-1">
            Recent agent runs and their outputs ({filteredLogs.length} total)
          </p>
        </div>
        
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search executions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FilterType)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div>
        {filteredLogs.length === 0 ? (
          <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
            <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery || statusFilter !== 'all' ? 'No matching executions' : 'No executions yet'}
            </h3>
            <p className="text-gray-600">
              {searchQuery || statusFilter !== 'all' 
                ? 'Try adjusting your search or filter criteria.' 
                : 'This agent hasn\'t been executed yet. Run it to see the history here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedLogs.map((log, index) => {
              const statusInfo = getStatusFromOutput(log.full_output)
              const StatusIcon = statusInfo.icon
              const isExpanded = expandedLogId === log.id

              return (
                <div key={log.id} className="bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-all overflow-hidden">
                  {/* Compact Log Header */}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left side: Status, Number, Summary */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <StatusIcon className={`h-4 w-4 ${statusInfo.color} flex-shrink-0 mt-0.5`} />

                        <div className="flex-1 min-w-0">
                          {/* Main summary line */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-gray-500">
                              #{(currentPage - 1) * logsPerPage + index + 1}
                            </span>
                            <span className="text-sm font-medium text-gray-900">
                              {formatSummaryText(log.run_output)}
                            </span>
                          </div>

                          {/* Metadata line */}
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTimeAgo(log.created_at)}
                            </span>
                            <span>•</span>
                            <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right side: Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => copyToClipboard(log.id)}
                          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                          title="Copy ID"
                        >
                          <Copy className="h-3.5 w-3.5 text-gray-400" />
                        </button>

                        <button
                          onClick={() => toggleDetails(log.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronDown className="h-3.5 w-3.5" />
                              Hide
                            </>
                          ) : (
                            <>
                              <ChevronRight className="h-3.5 w-3.5" />
                              Details
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50">
                      <div className="p-4">
                        {renderOutput(log.full_output)}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-gray-200 bg-white rounded-lg px-4 py-3">
                <div className="text-sm text-gray-600">
                  Showing {(currentPage - 1) * logsPerPage + 1} to {Math.min(currentPage * logsPerPage, filteredLogs.length)} of {filteredLogs.length} results
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  
                  <span className="text-sm text-gray-600">
                    Page {currentPage} of {totalPages}
                  </span>
                  
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}