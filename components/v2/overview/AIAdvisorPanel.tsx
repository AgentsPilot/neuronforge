'use client'

/**
 * AIAdvisorPanel - AI-powered strategic recommendations
 *
 * Displays AI-generated insights and recommendations for the user's
 * automation portfolio. Domain-agnostic - works for any business type.
 */

import * as React from 'react'
import {
  Sparkles,
  TrendingUp,
  Zap,
  AlertTriangle,
  Layers,
  Target,
  ChevronRight,
  RefreshCw,
  Lightbulb,
} from 'lucide-react'
import { cn } from '@/lib/design-system-v2'

export type RecommendationType =
  | 'consolidation'
  | 'optimization'
  | 'opportunity'
  | 'risk'
  | 'efficiency'

export interface Recommendation {
  type: RecommendationType
  title: string
  evidence: string
  recommendation: string
  impact: {
    value: number
    unit: 'seconds' | 'count' | 'percentage'
    description: string
  }
  workflows_involved: string[]
  confidence: number
  priority: 'high' | 'medium' | 'low'
}

export interface AIAdvisorPanelProps {
  recommendations: Recommendation[]
  summary?: string
  loading?: boolean
  onRefresh?: () => void
  onRecommendationClick?: (recommendation: Recommendation) => void
  className?: string
}

const typeConfig: Record<
  RecommendationType,
  { icon: React.FC<{ className?: string }>; color: string; label: string }
> = {
  consolidation: {
    icon: Layers,
    color: 'text-purple-500 bg-purple-100 dark:bg-purple-900/30',
    label: 'Consolidation',
  },
  optimization: {
    icon: TrendingUp,
    color: 'text-blue-500 bg-blue-100 dark:bg-blue-900/30',
    label: 'Optimization',
  },
  opportunity: {
    icon: Lightbulb,
    color: 'text-amber-500 bg-amber-100 dark:bg-amber-900/30',
    label: 'Opportunity',
  },
  risk: {
    icon: AlertTriangle,
    color: 'text-red-500 bg-red-100 dark:bg-red-900/30',
    label: 'Risk',
  },
  efficiency: {
    icon: Zap,
    color: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30',
    label: 'Efficiency',
  },
}

const priorityStyles: Record<string, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-amber-500',
  low: 'border-l-[var(--v2-border)]',
}

function formatImpact(impact: Recommendation['impact']): string {
  if (impact.unit === 'seconds') {
    const seconds = impact.value
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    const hours = Math.floor(seconds / 3600)
    return `${hours}h`
  }
  if (impact.unit === 'percentage') {
    return `${impact.value}%`
  }
  return impact.value.toLocaleString()
}

export function AIAdvisorPanel({
  recommendations,
  summary,
  loading = false,
  onRefresh,
  onRecommendationClick,
  className,
}: AIAdvisorPanelProps) {
  if (loading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
          <div className="flex-1">
            <div className="h-5 w-48 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mb-2" />
            <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
        </div>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="h-24 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse"
          />
        ))}
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
            <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
              AI Advisor
            </h3>
            {summary && (
              <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
                {summary}
              </p>
            )}
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)] transition-colors"
            title="Refresh recommendations"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Recommendations */}
      {recommendations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-xl">
          <Target className="h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            No recommendations yet
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Run more workflows to get AI-powered insights
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec, index) => {
            const config = typeConfig[rec.type]
            const IconComponent = config.icon

            return (
              <div
                key={index}
                className={cn(
                  'p-4 rounded-xl bg-white dark:bg-slate-800',
                  'border border-slate-100 dark:border-slate-700 border-l-4',
                  priorityStyles[rec.priority],
                  'transition-all duration-200',
                  onRecommendationClick &&
                    'cursor-pointer hover:shadow-md hover:-translate-y-0.5'
                )}
                onClick={() => onRecommendationClick?.(rec)}
              >
                <div className="flex items-start gap-3">
                  {/* Type icon */}
                  <div className={cn('p-2 rounded-lg flex-shrink-0', config.color)}>
                    <IconComponent className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          config.color
                        )}
                      >
                        {config.label}
                      </span>
                      {rec.priority === 'high' && (
                        <span className="text-xs font-medium text-red-600 dark:text-red-400">
                          High Priority
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
                      {rec.title}
                    </h4>

                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">
                      {rec.recommendation}
                    </p>

                    {/* Impact */}
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <TrendingUp className="h-3 w-3" />
                        <span className="font-medium">
                          {formatImpact(rec.impact)}
                        </span>
                        <span className="text-slate-500">impact</span>
                      </div>
                      <div className="text-slate-500">
                        {rec.workflows_involved.length} workflow
                        {rec.workflows_involved.length !== 1 ? 's' : ''}
                      </div>
                      <div className="text-slate-400">
                        {Math.round(rec.confidence * 100)}% confident
                      </div>
                    </div>
                  </div>

                  {/* Arrow */}
                  {onRecommendationClick && (
                    <ChevronRight className="h-5 w-5 text-slate-300 dark:text-slate-600 flex-shrink-0" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
