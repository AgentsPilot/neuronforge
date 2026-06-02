'use client'

import React from 'react'
import { Clock, CheckCircle2, XCircle, AlertCircle, Play, DollarSign, Calendar, User, Timer, Cpu, PlayCircle, StopCircle, Hash } from 'lucide-react'
import type { Execution } from '@/lib/repositories/types'

interface LatestRunCardProps {
  execution: Execution | null
  isRunning: boolean
  advancedMode: boolean
  hourlyRate?: number
}

export function LatestRunCard({ execution, isRunning, advancedMode, hourlyRate }: LatestRunCardProps) {
  const getStatusIcon = () => {
    if (isRunning) return <Play className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
    if (!execution) return <AlertCircle className="w-5 h-5 text-gray-400" />
    if (execution.status === 'success' || execution.status === 'completed') return <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
    if (execution.status === 'failed' || execution.status === 'error') return <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
    return <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
  }

  const getStatusText = () => {
    if (isRunning) return 'Running'
    if (!execution) return 'No runs yet'
    if (execution.status === 'success' || execution.status === 'completed') return 'Success'
    if (execution.status === 'failed' || execution.status === 'error') return 'Failed'
    return execution.status.charAt(0).toUpperCase() + execution.status.slice(1)
  }

  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return 'N/A'
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  const formatTime = (timestamp: string | null | undefined) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return `${Math.floor(diffMins / 1440)}d ago`
  }

  const getExecutionTypeIcon = () => {
    if (!execution?.execution_type) return null
    return execution.execution_type === 'scheduled'
      ? <Calendar className="w-4 h-4 text-purple-500" />
      : <User className="w-4 h-4 text-blue-500" />
  }

  const getExecutionTypeText = () => {
    if (!execution?.execution_type) return null
    return execution.execution_type === 'scheduled' ? 'Scheduled' : 'Manual'
  }

  const getExecutionTypeColor = () => {
    if (!execution?.execution_type) return ''
    return execution.execution_type === 'scheduled'
      ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800/50'
      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/50'
  }

  // Calculate steps data for progress visualization
  const stepsData = execution?.logs ? {
    completed: execution.logs.stepsCompleted || 0,
    failed: execution.logs.stepsFailed || 0,
    skipped: execution.logs.stepsSkipped || 0,
    total: execution.logs.totalSteps || (
      (execution.logs.stepsCompleted || 0) +
      (execution.logs.stepsFailed || 0) +
      (execution.logs.stepsSkipped || 0)
    )
  } : null

  const hasStepsData = stepsData && stepsData.total > 0

  // Extract advanced metrics from logs
  const logs = execution?.logs as any
  const metrics = logs?.metrics || {}
  const timeSavedSeconds = metrics?.time_saved_seconds || 0
  const timeSavedValue = hourlyRate && timeSavedSeconds > 0 ? (timeSavedSeconds / 3600) * hourlyRate : 0

  // Format time saved as human readable
  const formatTimeSaved = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    return `${(seconds / 3600).toFixed(1)}h`
  }

  // Format absolute timestamp for start/end times
  const formatAbsoluteTime = (timestamp: string | null | undefined) => {
    if (!timestamp) return 'N/A'
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  // Format date for the header
  const formatDate = (timestamp: string | null | undefined) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return 'Today'
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  // Calculate end time from start + duration
  const getEndTime = () => {
    if (!execution?.created_at || !execution?.execution_duration_ms) return null
    const startDate = new Date(execution.created_at)
    const endDate = new Date(startDate.getTime() + execution.execution_duration_ms)
    return endDate.toISOString()
  }

  return (
    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-sm overflow-hidden h-full flex flex-col">
      <div className="p-6 border-b border-[var(--v2-border)] bg-gradient-to-br from-blue-500/5 to-purple-500/5 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-[var(--v2-text-primary)] flex items-center gap-2">
            {getStatusIcon()}
            Latest Run
          </h3>
          <div className="flex items-center gap-2">
            {execution?.execution_type && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full border flex items-center gap-1.5 ${getExecutionTypeColor()}`}>
                {getExecutionTypeIcon()}
                {getExecutionTypeText()}
              </span>
            )}
            {execution && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                (execution.status === 'success' || execution.status === 'completed')
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}>
                {getStatusText()}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--v2-text-muted)]">
          {execution?.created_at ? (
            <>
              {formatDate(execution.created_at)} • {formatTime(execution.created_at)}
            </>
          ) : (
            'Never'
          )}
        </p>
      </div>

      {!execution && !isRunning ? (
        <div className="flex flex-col items-center justify-center py-16 text-center flex-1">
          <div className="w-16 h-16 rounded-full bg-[var(--v2-hover)] flex items-center justify-center mb-4">
            <Play className="w-8 h-8 text-[var(--v2-text-muted)] opacity-50" />
          </div>
          <p className="text-[var(--v2-text-primary)] font-medium mb-1">No executions yet</p>
          <p className="text-sm text-[var(--v2-text-muted)]">Click "Run Now" to test this agent</p>
        </div>
      ) : (
        <div className="p-6 flex-1">
          {/* Run Info - Start, End, ID */}
          {execution && (
            <div className="mb-4 p-4 rounded-xl bg-[var(--v2-hover)] border border-[var(--v2-border)]">
              <div className="grid grid-cols-3 gap-4">
                {/* Started */}
                <div className="flex items-center gap-2">
                  <PlayCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider">Started</div>
                    <div className="text-sm font-semibold text-[var(--v2-text-primary)] tabular-nums truncate">
                      {formatAbsoluteTime(execution.created_at)}
                    </div>
                  </div>
                </div>

                {/* Ended */}
                <div className="flex items-center gap-2">
                  <StopCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider">Ended</div>
                    <div className="text-sm font-semibold text-[var(--v2-text-primary)] tabular-nums truncate">
                      {getEndTime() ? formatAbsoluteTime(getEndTime()) : 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Run ID */}
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-purple-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider">Run ID</div>
                    <div className="text-sm font-semibold text-[var(--v2-text-primary)] font-mono truncate" title={execution.id}>
                      {execution.id.slice(0, 8)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Cost Saved for this run - shown prominently if available */}
              {timeSavedValue > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--v2-border)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider">Value Saved This Run</span>
                  </div>
                  <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    ${timeSavedValue.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Metrics - single row */}
          {execution && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              {/* Duration */}
              <div className="p-3 rounded-xl bg-[var(--v2-hover)] border border-[var(--v2-border)]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Duration</span>
                </div>
                <div className="text-xl font-bold text-[var(--v2-text-primary)] tabular-nums">
                  {formatDuration(execution.execution_duration_ms)}
                </div>
              </div>

              {/* Time Saved */}
              <div className="p-3 rounded-xl bg-[var(--v2-hover)] border border-[var(--v2-border)]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Timer className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Time Saved</span>
                </div>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {timeSavedSeconds > 0 ? formatTimeSaved(timeSavedSeconds) : 'N/A'}
                </div>
              </div>

              {/* Tokens */}
              <div className="p-3 rounded-xl bg-[var(--v2-hover)] border border-[var(--v2-border)]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Cpu className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Tokens</span>
                </div>
                <div className="text-xl font-bold text-[var(--v2-text-primary)] tabular-nums">
                  {execution.logs?.tokensUsed?.total ? `${(execution.logs.tokensUsed.total / 1000).toFixed(1)}k` : 'N/A'}
                </div>
              </div>
            </div>
          )}

          {/* Steps Progress Graph - shown if available */}
          {hasStepsData && stepsData && (
            <div className="mb-4 p-3 rounded-lg bg-gradient-to-br from-emerald-500/5 to-blue-500/5 border border-emerald-200/50 dark:border-emerald-800/30">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Workflow Progress</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold text-[var(--v2-text-primary)] tabular-nums">
                    {Math.round((stepsData.completed / stepsData.total) * 100)}%
                  </span>
                  <span className="text-xs text-[var(--v2-text-muted)]">
                    {stepsData.completed}/{stepsData.total}
                  </span>
                </div>
              </div>

              {/* Dots Progress Line */}
              <div className="relative py-1">
                <div className="flex items-center justify-between relative">
                  {/* Build array of step states */}
                  {Array.from({ length: stepsData.total }, (_, i) => {
                    let status: 'completed' | 'failed' | 'skipped' = 'completed'
                    if (i < stepsData.completed) {
                      status = 'completed'
                    } else if (i < stepsData.completed + stepsData.failed) {
                      status = 'failed'
                    } else {
                      status = 'skipped'
                    }

                    const isLast = i === stepsData.total - 1

                    return (
                      <div key={i} className="flex items-center flex-1 last:flex-none">
                        {/* Dot */}
                        <div className="relative z-10">
                          <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                            status === 'completed'
                              ? 'bg-emerald-500 dark:bg-emerald-400 shadow-md shadow-emerald-500/50'
                              : status === 'failed'
                              ? 'bg-red-500 dark:bg-red-400 shadow-md shadow-red-500/50'
                              : 'bg-yellow-500 dark:bg-yellow-400 shadow-md shadow-yellow-500/50'
                          }`} />
                        </div>

                        {/* Line */}
                        {!isLast && (
                          <div className={`flex-1 h-0.5 transition-all duration-300 ${
                            status === 'completed'
                              ? 'bg-emerald-500 dark:bg-emerald-400'
                              : status === 'failed'
                              ? 'bg-red-500 dark:bg-red-400'
                              : 'bg-yellow-500 dark:bg-yellow-400'
                          }`} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {execution?.error_message && (
            <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 rounded-xl">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wider mb-1">Error</div>
                  <p className="text-sm text-red-600 dark:text-red-400 font-mono">
                    {execution.error_message}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
