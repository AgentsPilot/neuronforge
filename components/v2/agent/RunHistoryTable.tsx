'use client'

import React, { useState } from 'react'
import { CheckCircle2, XCircle, Clock, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Execution } from '@/lib/repositories/types'

interface RunHistoryTableProps {
  executions: Execution[]
  onSelectExecution: (execution: Execution) => void
  selectedExecutionId?: string
  className?: string
  hourlyRate?: number
}

export function RunHistoryTable({
  executions,
  onSelectExecution,
  selectedExecutionId,
  className = '',
  hourlyRate
}: RunHistoryTableProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5
  const totalPages = Math.ceil(executions.length / itemsPerPage)

  // Get current page executions
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentExecutions = executions.slice(startIndex, endIndex)

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1))
  }

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1))
  }
  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return 'N/A'
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
      case 'running':
        return <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
    }
  }

  if (executions.length === 0) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-sm overflow-hidden ${className}`}>
        <div className="p-6 border-b border-[var(--v2-border)] bg-gradient-to-br from-blue-500/5 to-purple-500/5">
          <h3 className="text-lg font-bold text-[var(--v2-text-primary)] flex items-center gap-2">
            <Clock className="w-5 h-5 text-[var(--v2-primary)]" />
            Run History
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--v2-hover)] flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-[var(--v2-text-muted)] opacity-50" />
          </div>
          <p className="text-[var(--v2-text-primary)] font-medium mb-1">No execution history yet</p>
          <p className="text-sm text-[var(--v2-text-muted)]">Runs will appear here after you execute the agent</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-sm overflow-hidden ${className}`}>
      <div className="p-6 border-b border-[var(--v2-border)] bg-gradient-to-br from-blue-500/5 to-purple-500/5">
        <h3 className="text-lg font-bold text-[var(--v2-text-primary)] flex items-center gap-2">
          <Clock className="w-5 h-5 text-[var(--v2-primary)]" />
          Run History
          <span className="text-sm font-semibold text-[var(--v2-text-muted)] ml-1">({executions.length})</span>
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--v2-hover)] border-b border-[var(--v2-border)]">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                Time
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                Duration
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                Run Mode
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                Steps
              </th>
              {hourlyRate && (
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  Value Saved
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--v2-border)]">
            {currentExecutions.map((execution) => {
              const isSelected = execution.id === selectedExecutionId
              const logs = execution.logs as any
              const metrics = logs?.metrics || {}
              const timeSavedSeconds = metrics?.time_saved_seconds || 0
              const valueSaved = hourlyRate && timeSavedSeconds > 0
                ? (timeSavedSeconds / 3600) * hourlyRate
                : null
              const stepsCompleted = logs?.stepsCompleted || 0
              const stepsFailed = logs?.stepsFailed || 0
              const stepsSkipped = logs?.stepsSkipped || 0
              const totalSteps = logs?.totalSteps || stepsCompleted + stepsFailed + stepsSkipped

              return (
                <tr
                  key={execution.id}
                  onClick={() => onSelectExecution(execution)}
                  className={`cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[var(--v2-primary)]/10 border-l-4 border-l-[var(--v2-primary)]'
                      : 'hover:bg-[var(--v2-hover)] border-l-4 border-l-transparent'
                  }`}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {getStatusIcon(execution.status)}
                      <span className="text-xs font-medium text-[var(--v2-text-primary)] capitalize">
                        {execution.status === 'completed' ? 'success' : execution.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-[var(--v2-text-muted)]">
                    {formatTime(execution.created_at)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-[var(--v2-text-primary)]">
                    {formatDuration(execution.execution_duration_ms)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      execution.run_mode === 'calibration'
                        ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                        : 'bg-green-500/10 text-green-600 dark:text-green-400'
                    }`}>
                      {execution.run_mode === 'calibration' ? 'Cal' : 'Prod'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-[var(--v2-text-primary)]">
                    {totalSteps > 0 ? (
                      <span className="flex items-center gap-1">
                        <span className="font-medium">{totalSteps}</span>
                        {stepsFailed > 0 && (
                          <span className="text-[10px] text-red-500">({stepsFailed}×)</span>
                        )}
                      </span>
                    ) : <span className="text-[var(--v2-text-muted)]">—</span>}
                  </td>
                  {hourlyRate && (
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {valueSaved !== null ? `$${valueSaved.toFixed(2)}` : <span className="text-[var(--v2-text-muted)]">—</span>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] flex items-center justify-between">
          <div className="text-sm text-[var(--v2-text-muted)]">
            Showing <span className="font-semibold text-[var(--v2-text-primary)]">{startIndex + 1}</span> to{' '}
            <span className="font-semibold text-[var(--v2-text-primary)]">{Math.min(endIndex, executions.length)}</span> of{' '}
            <span className="font-semibold text-[var(--v2-text-primary)]">{executions.length}</span> runs
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    currentPage === page
                      ? 'bg-[var(--v2-primary)] text-white shadow-md'
                      : 'text-[var(--v2-text-muted)] hover:bg-[var(--v2-hover)] hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>

            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
