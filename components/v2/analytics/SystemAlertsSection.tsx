'use client'

import React, { useState } from 'react'
import { CheckCircle, AlertTriangle, AlertCircle, Lightbulb } from 'lucide-react'
import { Card } from '@/components/v2/ui/card'
import type { TimeRange } from '@/types/analytics'
import { FailedOperationsDialog } from './FailedOperationsDialog'
import { ActiveInsightsDialog } from './ActiveInsightsDialog'

interface SystemAlertsSectionProps {
  systemHealth: {
    status: 'healthy' | 'warning' | 'critical'
    message: string
    failedRuns24h: number
    activeInsights: number
  }
  timeRange: TimeRange
}

export function SystemAlertsSection({ systemHealth, timeRange }: SystemAlertsSectionProps) {
  const [failedOpsDialogOpen, setFailedOpsDialogOpen] = useState(false)
  const [insightsDialogOpen, setInsightsDialogOpen] = useState(false)

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case '7d': return 'Last 7 Days'
      case '30d': return 'Last 30 Days'
      case '90d': return 'Last 90 Days'
      case 'all': return 'All Time'
    }
  }

  const getStatusIcon = () => {
    switch (systemHealth.status) {
      case 'healthy':
        return CheckCircle
      case 'warning':
        return AlertTriangle
      case 'critical':
        return AlertCircle
    }
  }

  const getStatusColor = () => {
    switch (systemHealth.status) {
      case 'healthy':
        return {
          icon: 'text-green-500',
          bg: 'bg-green-500/10',
          border: 'border-green-200 dark:border-green-800',
          text: 'text-green-700 dark:text-green-300'
        }
      case 'warning':
        return {
          icon: 'text-yellow-500',
          bg: 'bg-yellow-500/10',
          border: 'border-yellow-200 dark:border-yellow-800',
          text: 'text-yellow-700 dark:text-yellow-300'
        }
      case 'critical':
        return {
          icon: 'text-red-500',
          bg: 'bg-red-500/10',
          border: 'border-red-200 dark:border-red-800',
          text: 'text-red-700 dark:text-red-300'
        }
    }
  }

  const StatusIcon = getStatusIcon()
  const colors = getStatusColor()

  // Calculate total issues
  const totalIssues = systemHealth.failedRuns24h + systemHealth.activeInsights

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* System Status Card */}
      <Card className={`!p-3 sm:!p-4 border ${colors.border} ${colors.bg}`}>
        <div className="flex items-start gap-2.5">
          <StatusIcon className={`w-5 h-5 sm:w-6 sm:h-6 ${colors.icon} flex-shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-[var(--v2-text-muted)] font-medium mb-0.5">
              System Status
            </div>
            <div className={`text-base sm:text-lg font-bold ${colors.text} mb-0.5 capitalize`}>
              {systemHealth.status}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {systemHealth.message}
            </div>
          </div>
        </div>
      </Card>

      {/* System Issues Card */}
      <Card className={`!p-3 sm:!p-4 border ${
        totalIssues === 0
          ? 'border-[var(--v2-border)] bg-[var(--v2-surface)]'
          : totalIssues < 5
          ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-500/10'
          : 'border-red-200 dark:border-red-800 bg-red-500/10'
      }`}>
        <div className="flex items-start gap-2.5">
          <AlertTriangle className={`w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 mt-0.5 ${
            totalIssues === 0
              ? 'text-green-500'
              : totalIssues < 5
              ? 'text-yellow-500'
              : 'text-red-500'
          }`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-[var(--v2-text-muted)] font-medium mb-0.5">
              System Issues
            </div>
            <div className={`text-xl sm:text-2xl font-bold tabular-nums ${
              totalIssues === 0
                ? 'text-green-600 dark:text-green-400'
                : totalIssues < 5
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {totalIssues}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {totalIssues === 0 ? 'No issues detected' : `${systemHealth.failedRuns24h} failed, ${systemHealth.activeInsights} insights`}
            </div>
          </div>
        </div>
      </Card>

      {/* Failed Runs Card */}
      <Card
        hoverable={systemHealth.failedRuns24h > 0}
        className={`!p-3 sm:!p-4 border border-[var(--v2-border)] ${
          systemHealth.failedRuns24h > 0
            ? 'cursor-pointer active:scale-[0.98]'
            : ''
        }`}
        onClick={() => systemHealth.failedRuns24h > 0 && setFailedOpsDialogOpen(true)}
      >
        <div className="flex items-start gap-2.5">
          <AlertCircle className={`w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 mt-0.5 ${
            systemHealth.failedRuns24h === 0
              ? 'text-green-500'
              : systemHealth.failedRuns24h < 5
              ? 'text-yellow-500'
              : 'text-red-500'
          }`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-[var(--v2-text-muted)] font-medium mb-0.5">
              Failed Runs
            </div>
            <div className={`text-xl sm:text-2xl font-bold tabular-nums ${
              systemHealth.failedRuns24h === 0
                ? 'text-green-600 dark:text-green-400'
                : systemHealth.failedRuns24h < 5
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {systemHealth.failedRuns24h}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {systemHealth.failedRuns24h === 0 ? 'All operational' : `Click for details`}
            </div>
          </div>
        </div>
      </Card>

      {/* Active Insights Card */}
      <Card
        hoverable={systemHealth.activeInsights > 0}
        className={`!p-3 sm:!p-4 border border-[var(--v2-border)] ${
          systemHealth.activeInsights > 0
            ? 'cursor-pointer active:scale-[0.98]'
            : ''
        }`}
        onClick={() => systemHealth.activeInsights > 0 && setInsightsDialogOpen(true)}
      >
        <div className="flex items-start gap-2.5">
          <Lightbulb className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-[var(--v2-text-muted)] font-medium mb-0.5">
              Active Insights
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
              {systemHealth.activeInsights}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {systemHealth.activeInsights === 0 ? 'No new insights' : 'Click for details'}
            </div>
          </div>
        </div>
      </Card>
    </div>

    {/* Dialogs */}
    <FailedOperationsDialog
      isOpen={failedOpsDialogOpen}
      onClose={() => setFailedOpsDialogOpen(false)}
      timeRange={timeRange}
      failedCount={systemHealth.failedRuns24h}
    />
    <ActiveInsightsDialog
      isOpen={insightsDialogOpen}
      onClose={() => setInsightsDialogOpen(false)}
      insightCount={systemHealth.activeInsights}
    />
    </>
  )
}
