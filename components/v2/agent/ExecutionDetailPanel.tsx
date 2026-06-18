'use client'

import React, { useState } from 'react'
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Zap,
  Timer,
  Layers,
  ChevronDown,
  ChevronRight,
  PlayCircle,
  StopCircle,
  Hash,
  AlertTriangle,
  Lightbulb,
  SkipForward,
  AlertCircle,
  Info,
  TrendingUp,
  TrendingDown,
  Brain,
  Target
} from 'lucide-react'
import type { Execution, ExecutionLogs } from '@/lib/repositories/types'
import type { ExecutionInsight } from '@/lib/pilot/insight/types'

// Insight run from execution_insight_runs table
interface InsightRun {
  id: string
  insight_id: string
  execution_id: string
  title: string
  description: string
  business_impact: string
  recommendation: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  confidence: string
  this_run_count: number
  last_run_count: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  model: string
  latency_ms: number
  llm_called: boolean
  cache_hit: boolean
  time_saved_hours_per_week: string
  cost_saved_usd_per_week: string
  pattern_data: any
  created_at: string
}

interface StepMetric {
  step_index: number
  step_name: string
  plugin: string
  action: string
  step_type: string
  status: 'success' | 'failed' | 'skipped'
  count: number
  duration_ms?: number
  fields?: string[]
  error?: string
  metadata?: any
}

interface ExecutionDetailsData {
  execution?: any
  insightRuns?: InsightRun[]
  executionInsights?: ExecutionInsight[]
  metrics?: {
    total_items: number
    duration_ms: number
    has_empty_results: boolean
    failed_step_count: number
    field_names: string[]
    items_by_field: Record<string, number>
    step_metrics: StepMetric[]
  } | null
  roi?: {
    items_processed: number
    time_saved_seconds: number
    time_saved_hours: number
    cost_saved_usd: number
    manual_time_per_item_seconds: number
  } | null
  agent?: {
    manual_time_per_item_seconds?: number | null
    workflow_purpose?: string | null
  } | null
}

interface ExecutionDetailPanelProps {
  execution: Execution | null
  isOpen: boolean
  onClose: () => void
  advancedMode: boolean
  executionDetails: ExecutionDetailsData | null
  hourlyRate?: number
  insights?: ExecutionInsight[]
  manualTimePerItemSeconds?: number | null
}

export function ExecutionDetailPanel({
  execution,
  isOpen,
  onClose,
  advancedMode,
  executionDetails,
  hourlyRate,
  insights = [],
  manualTimePerItemSeconds
}: ExecutionDetailPanelProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set())
  const [showAllSteps, setShowAllSteps] = useState(false)

  if (!isOpen || !execution) return null

  const logs = execution.logs as ExecutionLogs | null

  // Helper functions
  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return 'N/A'
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  const formatTime = (timestamp: string | undefined) => {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatTokens = (tokens: number | undefined) => {
    if (!tokens) return 'N/A'
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
    return tokens.toString()
  }

  const formatTimeSaved = (seconds: number | undefined) => {
    if (!seconds || seconds <= 0) return null
    if (seconds < 60) return `${Math.round(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }

  const getEndTime = () => {
    if (!execution.created_at || !execution.execution_duration_ms) return null
    const startDate = new Date(execution.created_at)
    const endDate = new Date(startDate.getTime() + execution.execution_duration_ms)
    return endDate.toISOString()
  }

  const toggleStep = (index: number) => {
    const newExpanded = new Set(expandedSteps)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedSteps(newExpanded)
  }

  const toggleInsight = (id: string) => {
    const newExpanded = new Set(expandedInsights)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedInsights(newExpanded)
  }

  // Calculate metrics from execution data
  const tokens = logs?.tokensUsed?.total
  const stepsCompleted = logs?.stepsCompleted ?? 0
  const stepsFailed = logs?.stepsFailed ?? 0
  const stepsSkipped = logs?.stepsSkipped ?? 0
  const totalSteps = logs?.totalSteps ?? (stepsCompleted + stepsFailed + stepsSkipped)

  // Calculate time saved
  const getTimeSaved = () => {
    if (executionDetails?.roi?.time_saved_seconds) {
      return executionDetails.roi.time_saved_seconds
    }
    const metricsLogs = logs as any
    const timeSaved = metricsLogs?.metrics?.time_saved_seconds
    if (timeSaved && timeSaved > 0) return timeSaved

    const effectiveManualTime = manualTimePerItemSeconds || executionDetails?.agent?.manual_time_per_item_seconds
    if (effectiveManualTime && effectiveManualTime > 0) {
      const itemsProcessed = executionDetails?.roi?.items_processed || metricsLogs?.metrics?.total_items || metricsLogs?.itemsProcessed || 0
      if (itemsProcessed > 0) return itemsProcessed * effectiveManualTime
    }
    return null
  }
  const timeSaved = getTimeSaved()
  const valueSaved = hourlyRate && timeSaved ? (timeSaved / 3600) * hourlyRate : null

  // Get insight runs from executionDetails (from execution_insight_runs table)
  const insightRuns = executionDetails?.insightRuns || []

  // Get execution insights from executionDetails (from execution_insights table)
  // Deduplicate by insight_type to avoid showing duplicates
  const rawExecutionInsights = executionDetails?.executionInsights || []
  const seenInsightTypes = new Set<string>()
  const executionInsights = rawExecutionInsights.filter((i: any) => {
    if (seenInsightTypes.has(i.insight_type)) return false
    seenInsightTypes.add(i.insight_type)
    return true
  })

  // Get step metrics from execution details
  const stepMetrics = executionDetails?.metrics?.step_metrics || []

  const isSuccess = execution.status === 'success' || execution.status === 'completed'

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-500'
      case 'high': return 'text-orange-500'
      case 'medium': return 'text-yellow-500'
      default: return 'text-blue-500'
    }
  }

  const getSeverityBg = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/10 border-red-500/30'
      case 'high': return 'bg-orange-500/10 border-orange-500/30'
      case 'medium': return 'bg-yellow-500/10 border-yellow-500/30'
      default: return 'bg-blue-500/10 border-blue-500/30'
    }
  }

  // Calculate change between this run and last run
  const getChangeIndicator = (thisRun: number, lastRun: number) => {
    if (lastRun === 0) return null
    const change = ((thisRun - lastRun) / lastRun) * 100
    if (Math.abs(change) < 1) return null
    return {
      direction: change > 0 ? 'up' : 'down',
      percentage: Math.abs(change).toFixed(0)
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-screen w-full max-w-2xl bg-[var(--v2-surface)] shadow-2xl z-50 overflow-y-auto border-l-2 border-[var(--v2-primary)]/20">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 border-b border-[var(--v2-border)] backdrop-blur-md px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold text-[var(--v2-text-primary)]">Execution Details</h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-[var(--v2-text-muted)]">
              <Hash className="w-3 h-3" />
              <span className="font-mono">{execution.id.slice(0, 8)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)] transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status Section */}
          <div className={`rounded-lg p-4 border ${isSuccess ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-red-500/5 border-red-500/30'}`}>
            <div className="flex items-center gap-3 mb-3">
              {isSuccess ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
              )}
              <span className={`text-sm font-semibold ${
                isSuccess
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {isSuccess ? 'Completed Successfully' : 'Failed'}
              </span>
            </div>

            {/* Timing Info */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="flex items-center gap-2">
                <PlayCircle className="w-4 h-4 text-[var(--v2-text-muted)]" />
                <span className="text-[var(--v2-text-muted)]">Started:</span>
                <span className="text-[var(--v2-text-primary)]">{formatTime(execution.created_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                <StopCircle className="w-4 h-4 text-[var(--v2-text-muted)]" />
                <span className="text-[var(--v2-text-muted)]">Ended:</span>
                <span className="text-[var(--v2-text-primary)]">{formatTime(getEndTime() || undefined)}</span>
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Duration */}
            <div className="bg-[var(--v2-hover)] rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)] mb-1">
                <Clock className="w-3.5 h-3.5" />
                Duration
              </div>
              <div className="text-lg font-bold text-[var(--v2-text-primary)]">
                {formatDuration(execution.execution_duration_ms)}
              </div>
            </div>

            {/* Tokens */}
            <div className="bg-[var(--v2-hover)] rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)] mb-1">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                Tokens
              </div>
              <div className="text-lg font-bold text-[var(--v2-text-primary)]">
                {formatTokens(tokens)}
              </div>
            </div>

            {/* Time Saved */}
            <div className="bg-[var(--v2-hover)] rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)] mb-1">
                <Timer className="w-3.5 h-3.5 text-emerald-500" />
                Time Saved
              </div>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {formatTimeSaved(timeSaved) || 'N/A'}
              </div>
            </div>

            {/* Value Saved */}
            {hourlyRate && (
              <div className="bg-[var(--v2-hover)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)] mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-purple-500" />
                  Value Saved
                </div>
                <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
                  {valueSaved && valueSaved > 0 ? `$${valueSaved.toFixed(2)}` : 'N/A'}
                </div>
              </div>
            )}

            {/* Steps */}
            {totalSteps > 0 && (
              <div className="bg-[var(--v2-hover)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)] mb-1">
                  <Layers className="w-3.5 h-3.5 text-blue-500" />
                  Steps
                </div>
                <div className="text-lg font-bold text-[var(--v2-text-primary)]">
                  {stepsCompleted}/{totalSteps}
                  {stepsFailed > 0 && (
                    <span className="text-xs text-red-500 ml-1">({stepsFailed}×)</span>
                  )}
                </div>
              </div>
            )}

            {/* Items Processed */}
            {executionDetails?.roi?.items_processed && executionDetails.roi.items_processed > 0 && (
              <div className="bg-[var(--v2-hover)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)] mb-1">
                  <Target className="w-3.5 h-3.5 text-indigo-500" />
                  Items Processed
                </div>
                <div className="text-lg font-bold text-[var(--v2-text-primary)]">
                  {executionDetails.roi.items_processed}
                </div>
              </div>
            )}
          </div>

          {/* Business Insights from execution_insights table (Advanced Mode only) */}
          {advancedMode && executionInsights.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                Business Insights ({executionInsights.length})
              </h3>
              <div className="space-y-3">
                {executionInsights.map((insight) => {
                  const isExpanded = expandedInsights.has(insight.id)

                  return (
                    <div
                      key={insight.id}
                      className={`rounded-lg border overflow-hidden ${getSeverityBg(insight.severity)}`}
                    >
                      <button
                        onClick={() => toggleInsight(insight.id)}
                        className="w-full p-4 text-left hover:bg-[var(--v2-hover)]/50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[var(--v2-text-muted)] mt-0.5 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)] mt-0.5 flex-shrink-0" />
                          )}
                          <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${getSeverityColor(insight.severity)}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                                {insight.title}
                              </span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getSeverityBg(insight.severity)} ${getSeverityColor(insight.severity)}`}>
                                {insight.severity}
                              </span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--v2-surface)] text-[var(--v2-text-muted)]">
                                {insight.category}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2">
                              {insight.description}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--v2-text-muted)]">
                              <span>
                                {insight.metrics.affected_executions} affected runs
                              </span>
                              <span>•</span>
                              <span>
                                {(insight.metrics.pattern_frequency * 100).toFixed(0)}% frequency
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-0 border-t border-[var(--v2-border)] space-y-4">
                          {/* Business Impact */}
                          <div className="mt-3">
                            <h5 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-1 flex items-center gap-1">
                              <Target className="w-3 h-3" /> Business Impact
                            </h5>
                            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
                              {insight.business_impact}
                            </p>
                          </div>

                          {/* Recommendation */}
                          <div className="p-3 bg-[var(--v2-surface)] border-l-4 border-l-emerald-500 rounded">
                            <h5 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-1">
                              Recommendation
                            </h5>
                            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
                              {insight.recommendation}
                            </p>
                          </div>

                          {/* Pattern Data */}
                          {insight.pattern_data && (
                            <div className="text-xs text-[var(--v2-text-muted)]">
                              <span className="font-medium">Pattern:</span>{' '}
                              {insight.pattern_data.occurrences} occurrences in {insight.pattern_data.affected_steps?.length || 0} steps
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step Drill-down with Flow Analysis (Advanced Mode only) */}
          {advancedMode && stepMetrics.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-500" />
                  Workflow Steps ({stepMetrics.length})
                </h3>
                {stepMetrics.length > 5 && (
                  <button
                    onClick={() => setShowAllSteps(!showAllSteps)}
                    className="text-xs text-[var(--v2-primary)] hover:underline"
                  >
                    {showAllSteps ? 'Show less' : 'Show all'}
                  </button>
                )}
              </div>

              {/* Steps Flow */}
              <div className="space-y-1">
                {(showAllSteps ? stepMetrics : stepMetrics.slice(0, 5)).map((step, index) => {
                  const isExpanded = expandedSteps.has(index)
                  const stepStatus = step.status || 'success'
                  const prevStep = index > 0 ? stepMetrics[index - 1] : null
                  const prevCount = prevStep?.count || 0
                  const currentCount = step.count || 0

                  // Calculate change from previous step
                  const getStepChange = () => {
                    if (index === 0 || prevCount === 0) return null
                    if (currentCount === prevCount) return { type: 'same', value: 0 }
                    const change = ((currentCount - prevCount) / prevCount) * 100
                    return {
                      type: change > 0 ? 'increase' : 'decrease',
                      value: Math.abs(change)
                    }
                  }
                  const stepChange = getStepChange()

                  return (
                    <div key={index}>
                      {/* Connection line with change indicator */}
                      {index > 0 && (
                        <div className="flex items-center gap-2 py-1 pl-6">
                          <div className="w-0.5 h-4 bg-[var(--v2-border)]" />
                          {stepChange && stepChange.type !== 'same' && (
                            <div className={`flex items-center gap-1 text-xs font-medium ${
                              stepChange.type === 'decrease' ? 'text-orange-500' : 'text-emerald-500'
                            }`}>
                              {stepChange.type === 'decrease' ? (
                                <TrendingDown className="w-3 h-3" />
                              ) : (
                                <TrendingUp className="w-3 h-3" />
                              )}
                              <span>{stepChange.value.toFixed(0)}%</span>
                              <span className="text-[var(--v2-text-muted)] font-normal">
                                ({prevCount} → {currentCount})
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Step Card */}
                      <div className="bg-[var(--v2-hover)] rounded-lg overflow-hidden border border-transparent hover:border-[var(--v2-border)] transition-colors">
                        <button
                          onClick={() => toggleStep(index)}
                          className="w-full px-4 py-3 flex items-center gap-3 text-left"
                        >
                          {/* Step number */}
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            stepStatus === 'success' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                            stepStatus === 'failed' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                            'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                          }`}>
                            {index + 1}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                                {step.step_name || `${step.plugin}.${step.action}`}
                              </span>
                              {step.step_type && step.step_type !== 'action' && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--v2-surface)] text-[var(--v2-text-muted)]">
                                  {step.step_type}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--v2-text-muted)]">
                              {step.plugin} • {step.action}
                            </div>
                          </div>

                          {/* Right side metrics */}
                          <div className="flex items-center gap-4">
                            {/* Item count with badge */}
                            <div className="flex items-center gap-1.5">
                              <span className={`text-sm font-bold ${
                                currentCount === 0 ? 'text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-primary)]'
                              }`}>
                                {currentCount}
                              </span>
                              <span className="text-xs text-[var(--v2-text-muted)]">items</span>
                            </div>

                            {/* Duration */}
                            {step.duration_ms && (
                              <span className="text-xs text-[var(--v2-text-muted)] tabular-nums">
                                {formatDuration(step.duration_ms)}
                              </span>
                            )}

                            {/* Expand icon */}
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-[var(--v2-text-muted)]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-3 pt-0 border-t border-[var(--v2-border)]">
                            <div className="mt-3 space-y-2 text-xs">
                              {step.error && (
                                <div className="p-2 rounded bg-red-500/10 border border-red-500/30">
                                  <div className="flex items-start gap-2">
                                    <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5" />
                                    <span className="text-red-600 dark:text-red-400">{step.error}</span>
                                  </div>
                                </div>
                              )}
                              {step.fields && step.fields.length > 0 && (
                                <div className="flex items-start gap-2">
                                  <Info className="w-3.5 h-3.5 text-[var(--v2-text-muted)] mt-0.5" />
                                  <div>
                                    <span className="text-[var(--v2-text-muted)]">Output fields: </span>
                                    <span className="text-[var(--v2-text-primary)]">{step.fields.join(', ')}</span>
                                  </div>
                                </div>
                              )}
                              {step.metadata?.filter_criteria && (
                                <div className="flex items-start gap-2">
                                  <Info className="w-3.5 h-3.5 text-[var(--v2-text-muted)] mt-0.5" />
                                  <div>
                                    <span className="text-[var(--v2-text-muted)]">Filter: </span>
                                    <span className="text-[var(--v2-text-primary)]">{step.metadata.filter_criteria}</span>
                                  </div>
                                </div>
                              )}
                              {step.metadata?.items_filtered_out != null && (
                                <div className="p-2 rounded bg-orange-500/10 border border-orange-500/30">
                                  <div className="flex items-center gap-2">
                                    <TrendingDown className="w-3.5 h-3.5 text-orange-500" />
                                    <span className="text-orange-600 dark:text-orange-400">
                                      Filtered out {step.metadata.items_filtered_out} items
                                      {step.metadata.percentage_kept != null && ` (${step.metadata.percentage_kept.toFixed(0)}% kept)`}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Summary Stats */}
              {stepMetrics.length > 1 && (
                <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-blue-500/5 to-purple-500/5 border border-[var(--v2-border)]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--v2-text-muted)]">Pipeline Summary</span>
                    <div className="flex items-center gap-4">
                      <span className="text-[var(--v2-text-primary)]">
                        <strong>{stepMetrics[0]?.count || 0}</strong> in → <strong>{stepMetrics[stepMetrics.length - 1]?.count || 0}</strong> out
                      </span>
                      {stepMetrics[0]?.count > 0 && (
                        <span className={`font-medium ${
                          stepMetrics[stepMetrics.length - 1]?.count < stepMetrics[0]?.count
                            ? 'text-orange-500'
                            : 'text-emerald-500'
                        }`}>
                          {(((stepMetrics[stepMetrics.length - 1]?.count || 0) / stepMetrics[0].count) * 100).toFixed(0)}% throughput
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {execution.error_message && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                Error Message
              </h3>
              <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-4">
                <pre className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap font-mono">
                  {execution.error_message}
                </pre>
              </div>
            </div>
          )}

          {/* Output */}
          {execution.output && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-2">Output</h3>
              <div className="bg-[var(--v2-hover)] rounded-lg p-4 max-h-96 overflow-y-auto">
                <pre className="text-sm text-[var(--v2-text-primary)] whitespace-pre-wrap">
                  {typeof execution.output === 'string'
                    ? execution.output
                    : JSON.stringify(execution.output, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
