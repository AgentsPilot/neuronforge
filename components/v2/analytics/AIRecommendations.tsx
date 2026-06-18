'use client'

/**
 * AIRecommendations Component (AI Business Advisor)
 *
 * USER-TRIGGERED analysis with progressive disclosure:
 * - Shows prompt state until user clicks "Generate Insights"
 * - Displays cached reports if available
 * - Progressive disclosure based on data availability
 *
 * Displays AI-powered business analysis in 3 sections:
 * 1. AI Summary - The business story in plain language
 * 2. Key Metrics - Portfolio stats (automations, runs, time saved, success rate)
 * 3. Recommendations - Actionable suggestions with priority and impact
 *
 * Recommendation types: cost_savings, time_savings, growth, fix_issue, optimize
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Lightbulb, RefreshCw, DollarSign, Clock, TrendingUp, ChevronDown, ChevronUp, BarChart3, X } from 'lucide-react'

interface Recommendation {
  id?: string
  type: 'cost_savings' | 'time_savings' | 'growth' | 'fix_issue' | 'optimize'
  title: string
  description: string
  action?: string
  impact?: string | { unit?: string; value?: string | number; description?: string }
  priority: 'high' | 'medium' | 'low'
  estimated_value?: string
}

interface PortfolioSummary {
  total_workflows: number
  total_executions_30d: number
  total_time_saved_seconds: number
  overall_success_rate: number
  active_workflows: number
}

interface AdvisorReport {
  recommendations: Recommendation[]
  ai_summary: string
  portfolio: PortfolioSummary
  generated_at: string
  cached?: boolean
}

interface DataAvailability {
  has_automations: boolean
  has_executions: boolean
  automation_count: number
  execution_count: number
  ready_for_analysis: boolean
}

interface AIRecommendationsProps {
  className?: string
}

export function AIRecommendations({ className = '' }: AIRecommendationsProps) {
  const [report, setReport] = useState<AdvisorReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showRecommendations, setShowRecommendations] = useState(false)
  const [dataAvailability, setDataAvailability] = useState<DataAvailability | null>(null)
  const [hasCachedReport, setHasCachedReport] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')

  // Check for cached report and data availability on mount (no LLM call)
  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/v2/advisor/status')
      const data = await response.json()
      if (data.success) {
        setDataAvailability(data.data.data_availability)
        if (data.data.cached_report) {
          setReport(data.data.cached_report)
          setHasCachedReport(true)
        }
      }
    } catch (err) {
      console.error('Failed to check advisor status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Progress messages for each stage
  const progressStages = [
    { threshold: 10, message: 'Gathering automation data...' },
    { threshold: 25, message: 'Analyzing execution patterns...' },
    { threshold: 45, message: 'Identifying optimization opportunities...' },
    { threshold: 65, message: 'Generating recommendations...' },
    { threshold: 85, message: 'Finalizing your report...' },
    { threshold: 100, message: 'Complete!' },
  ]

  // Generate report (user-triggered, calls LLM)
  const generateReport = useCallback(async () => {
    try {
      setShowConfirmDialog(false)
      setGenerating(true)
      setProgress(0)
      setProgressMessage('Starting analysis...')

      // Start progress simulation
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          // Slow down as we approach 90% (wait for real completion)
          if (prev >= 90) return prev
          const increment = prev < 50 ? 8 : prev < 75 ? 4 : 2
          const newProgress = Math.min(prev + increment, 90)

          // Update message based on progress
          const stage = progressStages.find(s => newProgress <= s.threshold)
          if (stage) setProgressMessage(stage.message)

          return newProgress
        })
      }, 400)

      const response = await fetch('/api/v2/advisor?refresh=true')
      const data = await response.json()

      // Clear interval and complete progress
      clearInterval(progressInterval)
      setProgress(100)
      setProgressMessage('Complete!')

      // Small delay to show completion
      await new Promise(resolve => setTimeout(resolve, 500))

      if (data.success && data.data) {
        setReport(data.data)
        setHasCachedReport(true)
      }
    } catch (err) {
      console.error('Failed to generate advisor report:', err)
      setProgressMessage('Analysis failed. Please try again.')
    } finally {
      setGenerating(false)
      setProgress(0)
    }
  }, [])

  // Handle button click - show confirmation dialog
  const handleGenerateClick = useCallback(() => {
    setShowConfirmDialog(true)
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  // Format time for display
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.round((seconds % 3600) / 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }

  // Format impact - handles both string and object formats
  const formatImpact = (impact: Recommendation['impact']): string | null => {
    if (!impact) return null
    if (typeof impact === 'string') return impact
    // Handle object format: { unit, value, description }
    if (impact.description) return impact.description
    if (impact.value && impact.unit) return `${impact.value} ${impact.unit}`
    if (impact.value) return String(impact.value)
    return null
  }

  // Get recommendations from report
  const recommendations = report?.recommendations || []

  const getTypeConfig = (type: string) => {
    switch (type) {
      case 'cost_savings':
        return {
          badge: 'Save Money',
          icon: DollarSign,
          iconBg: 'bg-emerald-100 dark:bg-emerald-500/20',
          iconColor: 'text-emerald-600 dark:text-emerald-400',
          badgeColor: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
          borderColor: 'border-emerald-200 dark:border-emerald-500/30',
        }
      case 'time_savings':
        return {
          badge: 'Save Time',
          icon: Clock,
          iconBg: 'bg-indigo-100 dark:bg-indigo-500/20',
          iconColor: 'text-indigo-600 dark:text-indigo-400',
          badgeColor: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400',
          borderColor: 'border-indigo-200 dark:border-indigo-500/30',
        }
      case 'growth':
        return {
          badge: 'Growth',
          icon: TrendingUp,
          iconBg: 'bg-purple-100 dark:bg-purple-500/20',
          iconColor: 'text-purple-600 dark:text-purple-400',
          badgeColor: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400',
          borderColor: 'border-purple-200 dark:border-purple-500/30',
        }
      case 'fix_issue':
        return {
          badge: 'Fix Issue',
          icon: Lightbulb,
          iconBg: 'bg-amber-100 dark:bg-amber-500/20',
          iconColor: 'text-amber-600 dark:text-amber-400',
          badgeColor: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400',
          borderColor: 'border-amber-200 dark:border-amber-500/30',
        }
      case 'optimize':
      default:
        return {
          badge: 'Optimize',
          icon: TrendingUp,
          iconBg: 'bg-blue-100 dark:bg-blue-500/20',
          iconColor: 'text-blue-600 dark:text-blue-400',
          badgeColor: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400',
          borderColor: 'border-blue-200 dark:border-blue-500/30',
        }
    }
  }

  if (loading) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 animate-pulse shadow-[var(--v2-shadow-card)] ${className}`}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 bg-[var(--v2-surface-hover)] rounded-xl" />
          <div className="h-6 w-48 bg-[var(--v2-surface-hover)] rounded" />
        </div>
        <div className="h-24 bg-[var(--v2-surface-hover)] rounded-xl" />
      </div>
    )
  }

  // Confirmation Dialog Component
  const ConfirmDialog = () => {
    if (!showConfirmDialog) return null

    const isRegenerate = !!report

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setShowConfirmDialog(false)}
        />
        {/* Dialog */}
        <div className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-6 shadow-2xl max-w-md mx-4">
          <button
            onClick={() => setShowConfirmDialog(false)}
            className="absolute top-4 right-4 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[var(--v2-primary)]/10 rounded-lg">
              <Lightbulb className="w-5 h-5 text-[var(--v2-primary)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
              {isRegenerate ? 'Refresh Analysis?' : 'Run AI Analysis?'}
            </h3>
          </div>

          <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
            {isRegenerate
              ? 'This will analyze your latest automation data and generate fresh recommendations. This may take a few seconds.'
              : 'The AI Business Advisor will analyze your automation performance and provide personalized recommendations. This may take a few seconds.'}
          </p>

          {/* Credit Estimation */}
          <div className="flex items-center gap-2 p-3 bg-[var(--v2-surface-hover)] rounded-lg mb-6">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-[var(--v2-text-muted)]">Estimated cost:</span>
              <span className="font-semibold text-[var(--v2-primary)]">~400 Pilot Credits</span>
            </div>
            <span className="text-xs text-[var(--v2-text-muted)]">(≈ $0.19)</span>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setShowConfirmDialog(false)}
              className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition"
            >
              Cancel
            </button>
            <button
              onClick={generateReport}
              disabled={generating}
              className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {generating ? 'Analyzing...' : isRegenerate ? 'Refresh Analysis' : 'Run Analysis'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Progress Overlay Component
  const ProgressOverlay = () => {
    if (!generating) return null

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50" />
        {/* Progress Dialog */}
        <div className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-8 shadow-2xl max-w-md mx-4 w-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-[var(--v2-primary)]/10 rounded-lg">
              <Lightbulb className="w-5 h-5 text-[var(--v2-primary)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
              Analyzing Your Automations
            </h3>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--v2-text-secondary)]">
                {progressMessage}
              </span>
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                {progress}%
              </span>
            </div>
            <div className="w-full h-2 bg-[var(--v2-surface-hover)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--v2-primary)] rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-[var(--v2-text-muted)] text-center">
            Our AI is reviewing your automation data to generate personalized insights
          </p>
        </div>
      </div>
    )
  }

  // No report yet - show prompt state
  if (!report) {
    const hasData = dataAvailability?.ready_for_analysis
    const automationCount = dataAvailability?.automation_count || 0
    const executionCount = dataAvailability?.execution_count || 0

    return (
      <>
        <ConfirmDialog />
        <ProgressOverlay />
        <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 shadow-[var(--v2-shadow-card)] ${className}`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg">
                <Lightbulb className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">AI Business Advisor</h2>
                <p className="text-sm text-[var(--v2-text-muted)]">
                  Get personalized insights about your automations
                </p>
              </div>
            </div>
            {hasData && (
              <button
                onClick={handleGenerateClick}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  'Run Analysis'
                )}
              </button>
            )}
          </div>

          {/* Prompt State */}
          <div className="text-center py-6 px-4">
            {!hasData ? (
              // Not enough data yet
              <>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <BarChart3 className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">
                  Building Your Insights
                </h3>
                <p className="text-sm text-[var(--v2-text-secondary)] max-w-md mx-auto mb-4">
                  {automationCount === 0
                    ? "Create your first automation to start gathering data for AI-powered insights."
                    : executionCount < 3
                    ? `You have ${automationCount} automation${automationCount > 1 ? 's' : ''}, but we need a few more runs to generate meaningful insights.`
                    : "Run your automations a few more times to unlock personalized recommendations."}
                </p>
                <div className="flex items-center justify-center gap-4 text-sm text-[var(--v2-text-muted)]">
                  <span className="flex items-center gap-1">
                    <span className={automationCount > 0 ? 'text-emerald-500' : ''}>
                      {automationCount > 0 ? '✓' : '○'}
                    </span>
                    {automationCount} automation{automationCount !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={executionCount >= 3 ? 'text-emerald-500' : ''}>
                      {executionCount >= 3 ? '✓' : '○'}
                    </span>
                    {executionCount} run{executionCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </>
            ) : (
              // Has enough data - description only (button is in header)
              <>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">
                  Ready to Analyze
                </h3>
                <p className="text-sm text-[var(--v2-text-secondary)] max-w-md mx-auto">
                  Your automation data is ready. Click "Run Analysis" to get AI-powered insights about
                  performance trends, optimization opportunities, and personalized recommendations.
                </p>
                <p className="text-xs text-[var(--v2-text-muted)] mt-3">
                  Analysis includes {automationCount} automation{automationCount !== 1 ? 's' : ''} and {executionCount} recent run{executionCount !== 1 ? 's' : ''}
                </p>
              </>
            )}
          </div>
        </div>
      </>
    )
  }

  const portfolio = report?.portfolio

  return (
    <>
      <ConfirmDialog />
      <ProgressOverlay />
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 shadow-[var(--v2-shadow-card)] ${className}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg">
              <Lightbulb className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">AI Business Advisor</h2>
              <p className="text-sm text-[var(--v2-text-muted)]">
                Your automation portfolio at a glance
              </p>
            </div>
          </div>
          <button
            onClick={handleGenerateClick}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {generating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Refresh Analysis
              </>
            )}
          </button>
        </div>

      {/* 1. AI Summary - The Story */}
      {report?.ai_summary && (
        <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-500/10 dark:to-purple-500/10 rounded-xl border border-indigo-100 dark:border-indigo-500/20">
          <p className="text-[var(--v2-text-primary)] leading-relaxed">
            {report.ai_summary}
          </p>
        </div>
      )}

      {/* 2. Key Metrics */}
      {portfolio && portfolio.total_workflows > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 bg-[var(--v2-surface-hover)] rounded-lg">
            <div className="text-2xl font-bold text-[var(--v2-text-primary)]">{portfolio.total_workflows}</div>
            <div className="text-xs text-[var(--v2-text-muted)]">Automations</div>
          </div>
          <div className="text-center p-3 bg-[var(--v2-surface-hover)] rounded-lg">
            <div className="text-2xl font-bold text-[var(--v2-text-primary)]">{portfolio.total_executions_30d}</div>
            <div className="text-xs text-[var(--v2-text-muted)]">Runs (30d)</div>
          </div>
          <div className="text-center p-3 bg-[var(--v2-surface-hover)] rounded-lg">
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatTime(portfolio.total_time_saved_seconds)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">Time Saved</div>
          </div>
          <div className="text-center p-3 bg-[var(--v2-surface-hover)] rounded-lg">
            <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
              {Math.round(portfolio.overall_success_rate * 100)}%
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">Success Rate</div>
          </div>
        </div>
      )}

      {/* 3. Recommendations (Collapsible) */}
      {recommendations.length > 0 && (
        <div className="border-t border-[var(--v2-border)] pt-4">
          <button
            onClick={() => setShowRecommendations(!showRecommendations)}
            className="w-full flex items-center justify-between text-left hover:bg-[var(--v2-surface-hover)] rounded-lg p-2 -mx-2 transition"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                Recommendations
              </h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400">
                {recommendations.length}
              </span>
            </div>
            {showRecommendations ? (
              <ChevronUp className="w-4 h-4 text-[var(--v2-text-muted)]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--v2-text-muted)]" />
            )}
          </button>

          {showRecommendations && (
            <div className="space-y-3 mt-3">
              {recommendations.map((rec, index) => {
                const config = getTypeConfig(rec.type)
                return (
                  <div
                    key={rec.id || index}
                    className={`bg-[var(--v2-surface-hover)] rounded-xl p-4 hover:shadow-md transition cursor-pointer border-l-4 ${config.borderColor}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${config.iconBg} shrink-0`}>
                        <config.icon className={`w-4 h-4 ${config.iconColor}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.badgeColor}`}>
                            {config.badge}
                          </span>
                          {rec.priority === 'high' && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400">
                              High Priority
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">{rec.title}</h4>
                        <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed mb-2">
                          {rec.description}
                        </p>
                        {rec.action && (
                          <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                            → {rec.action}
                          </p>
                        )}
                        {formatImpact(rec.impact) && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                            Impact: {formatImpact(rec.impact)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      </div>
    </>
  )
}
