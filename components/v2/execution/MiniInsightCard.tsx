/**
 * MiniInsightCard Component
 *
 * Compact insight display for execution summary
 * Shows both business and technical insights with severity indicators
 * Supports view/dismiss actions
 */

'use client'

import React from 'react'
import { AlertCircle, AlertTriangle, Info, X, TrendingUp, Activity, AlertOctagon, Zap } from 'lucide-react'

export interface MiniInsight {
  id: string
  category: 'business_intelligence' | 'data_quality' | 'growth'
  insight_type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  business_impact?: string
  recommendation?: string
  confidence: string | number
}

interface MiniInsightCardProps {
  insight: MiniInsight
  onViewDetails?: () => void
  onDismiss?: () => void
}

export function MiniInsightCard({ insight, onViewDetails, onDismiss }: MiniInsightCardProps) {
  const severityConfig = {
    critical: {
      container: 'border-red-500 bg-red-50 dark:bg-red-950/30',
      icon: AlertOctagon,
      iconColor: 'text-red-600 dark:text-red-400',
    },
    high: {
      container: 'border-orange-500 bg-orange-50 dark:bg-orange-950/30',
      icon: AlertTriangle,
      iconColor: 'text-orange-600 dark:text-orange-400',
    },
    medium: {
      container: 'border-blue-500 bg-blue-50 dark:bg-blue-950/30',
      icon: Info,
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
    low: {
      container: 'border-gray-500 bg-gray-50 dark:bg-gray-950/30',
      icon: Info,
      iconColor: 'text-gray-600 dark:text-gray-400',
    },
  }

  const config = severityConfig[insight.severity]
  const Icon = config.icon

  // Determine category icon and label
  const getCategoryInfo = () => {
    if (insight.category === 'business_intelligence') {
      return { icon: '📊', label: 'Business' }
    } else if (insight.category === 'growth') {
      return { icon: '📈', label: 'Growth' }
    } else {
      return { icon: '⚙️', label: 'Technical' }
    }
  }

  const categoryInfo = getCategoryInfo()

  return (
    <div className={`mini-insight-card rounded-lg border-2 p-3 ${config.container}`}>
      <div className="flex items-start gap-3">
        {/* Severity Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header with category badge */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-semibold text-sm text-[var(--v2-text-primary)] leading-tight">
              {insight.title}
            </h4>
            <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded bg-white/50 dark:bg-black/20 text-[var(--v2-text-secondary)]">
              {categoryInfo.icon} {categoryInfo.label}
            </span>
          </div>

          {/* Description */}
          <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed mt-1">
            {insight.description}
          </p>

          {/* Recommendation (highlighted for business insights) */}
          {insight.recommendation && (
            <div className="mt-2 p-2 rounded bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50">
              <p className="text-xs text-green-800 dark:text-green-200">
                <span className="font-semibold">💡 Recommendation:</span> {insight.recommendation}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-2">
            {onViewDetails && (
              <button
                onClick={onViewDetails}
                className="text-xs px-2 py-1 rounded hover:bg-white/50 dark:hover:bg-black/20 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors"
              >
                View Details
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-xs px-2 py-1 rounded hover:bg-white/50 dark:hover:bg-black/20 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors flex items-center gap-1"
                title="Dismiss insight"
              >
                <X className="w-3 h-3" />
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Health Status Indicator Component
 * Shows overall health based on insight severity
 */
interface HealthStatusProps {
  status: 'healthy' | 'needs_attention' | 'critical'
  insightCount?: number
}

export function HealthStatus({ status, insightCount = 0 }: HealthStatusProps) {
  const statusConfig = {
    healthy: {
      color: 'text-green-600 dark:text-green-400',
      dotColor: 'bg-green-500',
      label: 'Healthy - No Issues',
    },
    needs_attention: {
      color: 'text-orange-600 dark:text-orange-400',
      dotColor: 'bg-orange-500',
      label: `Needs Attention - ${insightCount} insight${insightCount > 1 ? 's' : ''}`,
    },
    critical: {
      color: 'text-red-600 dark:text-red-400',
      dotColor: 'bg-red-500',
      label: 'Critical Issues - Action Required',
    },
  }

  const config = statusConfig[status]

  return (
    <div className={`health-status flex items-center gap-2 ${config.color}`}>
      <div className={`w-2 h-2 rounded-full ${config.dotColor}`} />
      <span className="text-sm font-medium">{config.label}</span>
    </div>
  )
}

/**
 * No Issues State Component
 */
export function NoIssuesState() {
  return (
    <div className="mt-3 flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
      <div className="flex-shrink-0">
        <div className="w-5 h-5 rounded-full bg-green-600 dark:bg-green-400 flex items-center justify-center">
          <span className="text-white text-xs">✓</span>
        </div>
      </div>
      <span className="text-sm text-green-800 dark:text-green-200">
        No issues detected. Your workflow is running smoothly.
      </span>
    </div>
  )
}
