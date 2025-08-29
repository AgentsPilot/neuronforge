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
  Play,
  Filter,
  Search,
  Download,
  RefreshCw,
  Eye,
  Copy,
  MoreVertical,
  Activity,
  Zap,
  FileText,
  Hash,
  Globe
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (expandedLogId && expandedLogId.includes('-export') && !target.closest('.log-export-menu')) {
        setExpandedLogId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [expandedLogId])

  const fetchLogs = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('agent_logs')
      .select('id, created_at, run_output, full_output, status')
      .eq('agent_id', agentId)
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Failed to fetch logs:', error.message)
    } else {
      setLogs(data || [])
    }
    setLoading(false)
  }

  const getStatusFromOutput = (output: any): { status: string; icon: any; color: string } => {
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const isLongText = (text: string) => {
    return text.length > 500 || text.includes('\n') || text.includes('###') || text.includes('####')
  }

  const formatMarkdownText = (text: string) => {
    return text
      .replace(/### (.*$)/gim, '<h3 style="font-size: 18px; font-weight: 600; color: #1f2937; margin: 20px 0 10px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">$1</h3>')
      .replace(/#### (.*$)/gim, '<h4 style="font-size: 16px; font-weight: 500; color: #374151; margin: 15px 0 8px 0;">$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 600; color: #1f2937;">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em style="font-style: italic; color: #374151;">$1</em>')
      .replace(/\n\n/g, '</p><p style="margin-bottom: 12px;">')
      .replace(/\n/g, '<br>')
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

  const renderStructuredOutput = (output: any) => {
    if (!output) {
      return (
        <div className="bg-gray-100 p-4 rounded-lg text-sm text-gray-600 text-center">
          No output data available
        </div>
      )
    }

    if (typeof output === 'string') {
      try {
        const parsed = JSON.parse(output)
        return renderStructuredOutput(parsed)
      } catch {
        if (isLongText(output)) {
          const formattedText = formatMarkdownText(output)
          return (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">Research Report</span>
                  <span className="text-xs text-gray-500">({output.length} characters)</span>
                </div>
                <button
                  onClick={() => copyToClipboard(output)}
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                  title="Copy full text"
                >
                  <Copy className="h-3 w-3 text-gray-500" />
                </button>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                <div 
                  className="prose prose-sm max-w-none text-gray-800 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: `<p style="margin-bottom: 12px;">${formattedText}</p>` }}
                />
              </div>
            </div>
          )
        } else {
          return (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Text Output</span>
                <button
                  onClick={() => copyToClipboard(output)}
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                  title="Copy text"
                >
                  <Copy className="h-3 w-3 text-gray-500" />
                </button>
              </div>
              <p className="text-sm text-gray-800 break-words">{output}</p>
            </div>
          )
        }
      }
    }

    if (typeof output === 'object') {
      if (output.message && typeof output.message === 'string' && isLongText(output.message)) {
        return (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-blue-50 px-4 py-2 border-b border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">Research Output</span>
                  <span className="text-xs text-blue-600">({output.message.length} characters)</span>
                </div>
                <button
                  onClick={() => copyToClipboard(output.message)}
                  className="p-1 hover:bg-blue-100 rounded transition-colors"
                  title="Copy research content"
                >
                  <Copy className="h-3 w-3 text-blue-600" />
                </button>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                <div 
                  className="prose prose-sm max-w-none text-gray-800 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: `<p style="margin-bottom: 12px;">${formatMarkdownText(output.message)}</p>` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(output).filter(([key]) => key !== 'message').map(([key, value]) => (
                <div key={key} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600 capitalize">
                      {key.replace(/_/g, ' ')}
                    </label>
                    <button
                      onClick={() => copyToClipboard(typeof value === 'object' ? JSON.stringify(value) : String(value))}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                      title="Copy value"
                    >
                      <Copy className="h-2 w-2 text-gray-400" />
                    </button>
                  </div>
                  <div className="text-xs text-gray-800">
                    {typeof value === 'object' ? (
                      <code className="bg-gray-800 text-green-400 px-1 rounded">
                        {JSON.stringify(value)}
                      </code>
                    ) : (
                      <span className="break-words">{String(value)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }

      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Structured Output</span>
              <span className="text-xs text-gray-500">({Object.keys(output).length} fields)</span>
            </div>
            <button
              onClick={() => copyToClipboard(JSON.stringify(output, null, 2))}
              className="p-1 hover:bg-gray-200 rounded transition-colors"
              title="Copy full object"
            >
              <Copy className="h-3 w-3 text-gray-500" />
            </button>
          </div>
          <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
            {Object.entries(output).map(([key, value]) => (
              <div key={key} className="border-b border-gray-200 pb-3 last:border-0 last:pb-0">
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
                  ) : typeof value === 'string' && isLongText(String(value)) ? (
                    <div className="bg-white border border-gray-200 rounded p-3 max-h-48 overflow-y-auto">
                      <div 
                        className="prose prose-xs max-w-none text-gray-700 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: formatMarkdownText(String(value)) }}
                      />
                    </div>
                  ) : (
                    <div className="bg-white border border-gray-200 rounded p-2">
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
      <div className="bg-gray-100 p-4 rounded-lg text-sm text-gray-600">
        <code>{typeof output}: {String(output)}</code>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-500">Loading execution history...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" />
            Execution History
          </h2>
          <p className="text-gray-600 text-sm mt-1">
            Recent agent runs and their outputs ({filteredLogs.length} total)
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-center">
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
                <div key={log.id} className="bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors overflow-hidden">
                  {/* Log Header */}
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
                          <span className="text-sm font-medium text-gray-900">
                            #{(currentPage - 1) * logsPerPage + index + 1}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate" title={log.run_output}>
                            {log.run_output || 'No output summary'}
                          </p>
                          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatTimeAgo(log.created_at)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(log.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyToClipboard(log.id)}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Copy execution ID"
                        >
                          <Copy className="h-4 w-4 text-gray-500" />
                        </button>
                        
                        <button
                          onClick={() => toggleDetails(log.id)}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronDown className="h-4 w-4" />
                              Hide Details
                            </>
                          ) : (
                            <>
                              <ChevronRight className="h-4 w-4" />
                              View Details
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-gray-50">
                      <div className="p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <label className="font-medium text-gray-700">Execution ID</label>
                            <div className="mt-1 flex items-center gap-2">
                              <code className="text-xs bg-white px-2 py-1 rounded border font-mono">
                                {log.id}
                              </code>
                              <button
                                onClick={() => copyToClipboard(log.id)}
                                className="p-1 hover:bg-gray-200 rounded"
                              >
                                <Copy className="h-3 w-3 text-gray-500" />
                              </button>
                            </div>
                          </div>
                          
                          <div>
                            <label className="font-medium text-gray-700">Status</label>
                            <div className="mt-1 flex items-center gap-2">
                              <StatusIcon className={`h-4 w-4 ${statusInfo.color}`} />
                              <span className="capitalize">{statusInfo.status}</span>
                            </div>
                          </div>
                          
                          <div>
                            <label className="font-medium text-gray-700">Timestamp</label>
                            <p className="mt-1 text-gray-600">{new Date(log.created_at).toLocaleString()}</p>
                          </div>
                        </div>

                        <div>
                          <label className="font-medium text-gray-700 mb-3 block">Full Output</label>
                          {renderStructuredOutput(log.full_output)}
                        </div>
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