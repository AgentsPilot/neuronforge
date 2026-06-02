'use client'

import React, { useState, useEffect } from 'react'
import { X, AlertCircle, ExternalLink, Calendar, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import type { TimeRange } from '@/types/analytics'

interface FailedOperationsDialogProps {
  isOpen: boolean
  onClose: () => void
  timeRange: TimeRange
  failedCount: number
}

interface FailedExecution {
  id: string
  agent_id: string
  agent_name: string
  status: string
  started_at: string
  completed_at: string | null
  error_message: string | null
  logs: any
  run_mode: string
}

type RunModeTab = 'production' | 'calibration'

export function FailedOperationsDialog({
  isOpen,
  onClose,
  timeRange,
  failedCount
}: FailedOperationsDialogProps) {
  const [loading, setLoading] = useState(true)
  const [executions, setExecutions] = useState<FailedExecution[]>([])
  const [activeTab, setActiveTab] = useState<RunModeTab>('production')

  useEffect(() => {
    if (isOpen) {
      fetchFailedExecutions()
    }
  }, [isOpen, timeRange])

  const fetchFailedExecutions = async () => {
    setLoading(true)
    try {
      // Calculate date range
      const endDate = new Date()
      let startDate: Date

      switch (timeRange) {
        case '7d':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          break
        case '30d':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          break
        case '90d':
          startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          break
        case 'all':
          startDate = new Date(0) // Unix epoch
          break
      }

      const { data, error } = await supabase
        .from('agent_executions')
        .select(`
          id,
          agent_id,
          status,
          started_at,
          completed_at,
          error_message,
          logs,
          run_mode,
          agents!inner(agent_name)
        `)
        .in('status', ['failed', 'error'])
        .gte('started_at', startDate.toISOString())
        .lte('started_at', endDate.toISOString())
        .order('started_at', { ascending: false })
        .limit(100)

      if (error) throw error

      const formattedData: FailedExecution[] = data?.map((exec: any) => ({
        id: exec.id,
        agent_id: exec.agent_id,
        agent_name: exec.agents?.agent_name || 'Unknown Agent',
        status: exec.status,
        started_at: exec.started_at,
        completed_at: exec.completed_at,
        error_message: exec.error_message,
        logs: exec.logs,
        run_mode: exec.run_mode || 'production'
      })) || []

      setExecutions(formattedData)
    } catch (error) {
      console.error('Failed to fetch failed executions:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getErrorMessage = (execution: FailedExecution) => {
    if (execution.error_message) return execution.error_message
    if (execution.logs?.error) return execution.logs.error
    return 'No error message available'
  }

  if (!isOpen) return null

  const productionExecutions = executions.filter(e => e.run_mode !== 'calibration')
  const calibrationExecutions = executions.filter(e => e.run_mode === 'calibration')
  const displayedExecutions = activeTab === 'production' ? productionExecutions : calibrationExecutions

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        {/* Dialog */}
        <div
          className="bg-[var(--v2-surface)] rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] border border-[var(--v2-border)] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-[var(--v2-text-primary)] flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  Failed Operations
                </h2>
                <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                  {failedCount} failed {failedCount === 1 ? 'operation' : 'operations'} in selected period
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 border-b border-[var(--v2-border)]">
              <button
                onClick={() => setActiveTab('production')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'production'
                    ? 'border-red-500 text-red-600 dark:text-red-400'
                    : 'border-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                Production ({productionExecutions.length})
              </button>
              <button
                onClick={() => setActiveTab('calibration')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'calibration'
                    ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                    : 'border-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                Calibration ({calibrationExecutions.length})
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--v2-primary)]" />
              </div>
            ) : displayedExecutions.length === 0 ? (
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-[var(--v2-text-muted)] mx-auto mb-3 opacity-50" />
                <p className="text-[var(--v2-text-muted)]">
                  No failed {activeTab === 'production' ? 'production' : 'calibration'} runs found
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayedExecutions.map((execution) => (
                  <div
                    key={execution.id}
                    className={`border border-[var(--v2-border)] rounded-lg p-4 transition-all group ${
                      activeTab === 'production'
                        ? 'hover:border-red-500/50 hover:bg-red-500/5'
                        : 'hover:border-orange-500/50 hover:bg-orange-500/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-[var(--v2-text-primary)] truncate">
                            {execution.agent_name}
                          </span>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                            activeTab === 'production'
                              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                              : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                          }`}>
                            {execution.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[var(--v2-text-muted)]">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(execution.started_at)}
                          </div>
                          {execution.completed_at && (
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s
                            </div>
                          )}
                        </div>
                      </div>
                      <a
                        href={`/v2/agents/${execution.agent_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-primary)] transition-colors opacity-0 group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    <div className={`rounded p-3 mt-2 ${
                      activeTab === 'production'
                        ? 'bg-red-500/5 border border-red-500/20'
                        : 'bg-orange-500/5 border border-orange-500/20'
                    }`}>
                      <p className={`text-sm font-mono ${
                        activeTab === 'production'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-orange-600 dark:text-orange-400'
                      }`}>
                        {getErrorMessage(execution)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-all text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
