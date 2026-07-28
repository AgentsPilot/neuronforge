'use client'

import React, { useState } from 'react'
import { Clock, CheckCircle2, XCircle, AlertCircle, Play, DollarSign, Calendar, User, Timer, Cpu, PlayCircle, StopCircle, Hash, Copy, Check } from 'lucide-react'
import type { Execution } from '@/lib/repositories/types'

interface LatestRunCardProps {
  execution: Execution | null
  isRunning: boolean
  advancedMode?: boolean
  hourlyRate?: number
  tokensPerPilotCredit?: number
}

export function LatestRunCard({ execution, isRunning, hourlyRate, tokensPerPilotCredit = 10 }: LatestRunCardProps) {
  const [copied, setCopied] = useState(false)

  const copyRunId = async () => {
    if (!execution?.id) return
    try {
      await navigator.clipboard.writeText(execution.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = execution.id
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

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
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] flex items-center gap-2">
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
        <div className="p-4 flex-1">
          {execution && (
            <div className="space-y-2">
              {/* Row 1: Run ID */}
              <div className="flex items-center justify-between py-2 border-b border-[var(--v2-border)]">
                <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-purple-500" />
                  Run ID
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-[var(--v2-text-primary)]" title={execution.id}>
                    {execution.id.slice(0, 8)}
                  </span>
                  <button
                    onClick={copyRunId}
                    className="p-1 rounded hover:bg-[var(--v2-hover)] transition-colors"
                    title="Copy full Run ID"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]" />
                    )}
                  </button>
                </div>
              </div>

              {/* Row 2: Time (From → To) */}
              <div className="flex items-center justify-between py-2 border-b border-[var(--v2-border)]">
                <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  Time
                </span>
                <span className="text-sm text-[var(--v2-text-primary)] tabular-nums">
                  {formatAbsoluteTime(execution.created_at)} → {getEndTime() ? formatAbsoluteTime(getEndTime()) : 'N/A'}
                </span>
              </div>

              {/* Row 3: Duration */}
              <div className="flex items-center justify-between py-2 border-b border-[var(--v2-border)]">
                <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-blue-500" />
                  Duration
                </span>
                <span className="text-sm font-semibold text-[var(--v2-text-primary)] tabular-nums">
                  {formatDuration(execution.execution_duration_ms)}
                </span>
              </div>

              {/* Row 4: Pilot Credits */}
              <div className="flex items-center justify-between py-2 border-b border-[var(--v2-border)]">
                <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-purple-500" />
                  Pilot Credits
                </span>
                <span className="text-sm font-semibold text-[var(--v2-text-primary)] tabular-nums">
                  {(() => {
                    const totalTokens = execution.logs?.tokensUsed?.total
                    if (!totalTokens) return 'N/A'
                    const credits = Math.ceil(totalTokens / tokensPerPilotCredit)
                    if (credits >= 1000) return `${(credits / 1000).toFixed(1)}k`
                    return credits.toLocaleString()
                  })()}
                </span>
              </div>

              {/* Row 5: Time Saved */}
              <div className="flex items-center justify-between py-2 border-b border-[var(--v2-border)]">
                <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-emerald-500" />
                  Time Saved
                </span>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {timeSavedSeconds > 0 ? formatTimeSaved(timeSavedSeconds) : 'N/A'}
                </span>
              </div>

              {/* Row 6: Value Saved */}
              <div className="flex items-center justify-between py-2 border-b border-[var(--v2-border)]">
                <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                  Value Saved
                </span>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {timeSavedValue > 0 ? `$${timeSavedValue.toFixed(2)}` : 'N/A'}
                </span>
              </div>

              {/* Row 7: Progress (if available) */}
              {hasStepsData && stepsData && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-[var(--v2-text-muted)]">Progress</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-[var(--v2-border)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                        style={{ width: `${(stepsData.completed / stepsData.total) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-[var(--v2-text-primary)] tabular-nums">
                      {stepsData.completed}/{stepsData.total}
                    </span>
                  </div>
                </div>
              )}
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
