/**
 * CalibrationQualityBadge - Display calibration quality score with visual indicator
 *
 * Shows quality score 0-100 with color-coded badge and key indicators
 */

'use client'

import React from 'react'
import { Card } from '@/components/v2/ui/card'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'

interface CalibrationQualityBadgeProps {
  score: number // 0-100
  issuesFound: number
  issuesRemaining: number
  stepsFailed: number
  autoFixesApplied?: number
}

type QualityLevel = {
  label: string
  color: {
    bg: string
    border: string
    text: string
    icon: string
  }
  icon: React.ComponentType<{ className?: string }>
}

function getQualityLevel(score: number): QualityLevel {
  if (score === 100) {
    return {
      label: 'Perfect Workflow',
      color: {
        bg: 'bg-green-50 dark:bg-green-950/20',
        border: 'border-green-200 dark:border-green-800',
        text: 'text-green-700 dark:text-green-400',
        icon: 'text-green-600 dark:text-green-500'
      },
      icon: CheckCircle2
    }
  } else if (score >= 95) {
    return {
      label: 'Excellent',
      color: {
        bg: 'bg-emerald-50 dark:bg-emerald-950/20',
        border: 'border-emerald-200 dark:border-emerald-800',
        text: 'text-emerald-700 dark:text-emerald-400',
        icon: 'text-emerald-600 dark:text-emerald-500'
      },
      icon: CheckCircle2
    }
  } else if (score >= 75) {
    return {
      label: 'Good',
      color: {
        bg: 'bg-blue-50 dark:bg-blue-950/20',
        border: 'border-blue-200 dark:border-blue-800',
        text: 'text-blue-700 dark:text-blue-400',
        icon: 'text-blue-600 dark:text-blue-500'
      },
      icon: Info
    }
  } else {
    return {
      label: 'Needs Review',
      color: {
        bg: 'bg-yellow-50 dark:bg-yellow-950/20',
        border: 'border-yellow-200 dark:border-yellow-800',
        text: 'text-yellow-700 dark:text-yellow-400',
        icon: 'text-yellow-600 dark:text-yellow-500'
      },
      icon: AlertCircle
    }
  }
}

export function CalibrationQualityBadge({
  score,
  issuesFound,
  issuesRemaining,
  stepsFailed,
  autoFixesApplied = 0
}: CalibrationQualityBadgeProps) {
  const quality = getQualityLevel(score)
  const Icon = quality.icon

  // Calculate progress percentage for visual bar
  const progressPercentage = Math.min(100, Math.max(0, score))

  return (
    <Card className={`border ${quality.color.border} ${quality.color.bg} !p-4 sm:!p-6`}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
            Workflow Quality
          </h3>
          <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${quality.color.bg} border ${quality.color.border}`}>
            <Icon className={`w-3.5 h-3.5 ${quality.color.icon}`} />
            <span className={`text-xs font-semibold ${quality.color.text}`}>
              {quality.label}
            </span>
          </div>
        </div>

        {/* Score Display */}
        <div className="flex items-center gap-4">
          <div className="text-4xl font-bold text-[var(--v2-text-primary)]">
            {score}
            <span className="text-2xl text-[var(--v2-text-secondary)]">/100</span>
          </div>

          {/* Progress Bar */}
          <div className="flex-1">
            <div className="h-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${quality.color.bg}`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Key Indicators */}
        <div className="space-y-2 pt-2 border-t border-[var(--v2-border)]">
          {score === 100 ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                <span className="text-[var(--v2-text-secondary)]">
                  Everything worked perfectly
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                <span className="text-[var(--v2-text-secondary)]">
                  Ready to use in production
                </span>
              </div>
            </>
          ) : (
            <>
              {autoFixesApplied > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    {autoFixesApplied} issue{autoFixesApplied !== 1 ? 's' : ''} auto-fixed
                  </span>
                </div>
              )}
              {issuesRemaining === 0 && issuesFound > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    All {issuesFound} issue{issuesFound !== 1 ? 's' : ''} resolved
                  </span>
                </div>
              )}
              {issuesRemaining > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-[var(--v2-warning)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    {issuesRemaining} issue{issuesRemaining !== 1 ? 's' : ''} remaining
                  </span>
                </div>
              )}
              {stepsFailed === 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    Workflow ran without errors
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
