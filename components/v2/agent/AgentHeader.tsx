'use client'

import React from 'react'
import { Play, Settings, TrendingUp, Settings2, BarChart3, Target, Calendar, User } from 'lucide-react'
import type { Agent } from '@/lib/repositories/types'
import { formatScheduleDisplay, formatNextRun } from '@/lib/utils/scheduleFormatter'

interface AgentHeaderProps {
  agent: Agent
  stats: {
    runCount: number
    successRate: number
  }
  isExecuting: boolean
  advancedMode: boolean
  timePeriodLabel?: string
  onRun: () => void
  onSettingsClick: () => void
  onAnalyticsClick: () => void
  onAdvancedModeToggle: () => void
}

export function AgentHeader({
  agent,
  stats,
  isExecuting,
  advancedMode,
  timePeriodLabel,
  onRun,
  onSettingsClick,
  onAnalyticsClick,
  onAdvancedModeToggle
}: AgentHeaderProps) {
  const getStatusColor = () => {
    if (isExecuting) return 'text-blue-600 dark:text-blue-400'
    if (agent.status === 'active') return 'text-green-600 dark:text-green-400'
    if (agent.status === 'paused') return 'text-yellow-600 dark:text-yellow-400'
    return 'text-gray-600 dark:text-gray-400'
  }

  const getStatusText = () => {
    if (isExecuting) return 'Running...'
    if (agent.status === 'active') return 'Active'
    if (agent.status === 'paused') return 'Paused'
    return 'Draft'
  }

  const getRunModeText = () => {
    if (agent.schedule_cron) return 'Scheduled'
    return 'Manual'
  }

  const getRunModeIcon = () => {
    if (agent.schedule_cron) return <Calendar className="w-4 h-4 text-[var(--v2-text-muted)] opacity-50" />
    return <User className="w-4 h-4 text-[var(--v2-text-muted)] opacity-50" />
  }

  const formatSchedule = () => {
    if (!agent.schedule_cron) return null

    // Show human-readable schedule format (e.g., "Daily at 9:00 AM")
    const scheduleText = formatScheduleDisplay('scheduled', agent.schedule_cron)

    // Add next run time if available
    if (agent.next_run_at) {
      const nextRun = formatNextRun(agent.next_run_at, agent.timezone || 'UTC')
      return `${scheduleText} • Next: ${nextRun}`
    }

    return scheduleText
  }

  return (
    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-sm">
      {/* Header Row */}
      <div className="p-8 border-b border-[var(--v2-border)]">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-[var(--v2-text-primary)] mb-3">
              {agent.agent_name}
            </h1>
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-full ${getStatusColor()} bg-current/10`}>
                <span className="w-2 h-2 rounded-full bg-current animate-pulse shadow-lg" />
                {getStatusText()}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onSettingsClick}
              className="p-3 rounded-xl hover:bg-[var(--v2-hover)] transition-all text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] border border-transparent hover:border-[var(--v2-border)]"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>

            <button
              onClick={onAnalyticsClick}
              className="p-3 rounded-xl hover:bg-[var(--v2-hover)] transition-all text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] border border-transparent hover:border-[var(--v2-border)]"
              title="View Analytics"
            >
              <TrendingUp className="w-5 h-5" />
            </button>

            <button
              onClick={onRun}
              disabled={isExecuting}
              className={`p-3 rounded-xl transition-all border ${
                isExecuting
                  ? 'bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] border-[var(--v2-primary)]/30 cursor-not-allowed'
                  : 'bg-[var(--v2-primary)] text-white border-[var(--v2-primary)] hover:opacity-90 shadow-lg hover:shadow-xl'
              }`}
              title={isExecuting ? 'Running...' : 'Run Now'}
            >
              {isExecuting ? (
                <div className="w-5 h-5 border-2 border-[var(--v2-primary)]/30 border-t-[var(--v2-primary)] rounded-full animate-spin" />
              ) : (
                <Play className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Description */}
        {(agent.description || agent.user_prompt) && (
          <p className="text-sm text-[var(--v2-text-muted)] line-clamp-2 leading-relaxed">
            {agent.description || agent.user_prompt}
          </p>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-px bg-[var(--v2-border)]">
        <div className="bg-[var(--v2-surface)] p-6 hover:bg-[var(--v2-hover)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Total Runs</span>
            <BarChart3 className="w-4 h-4 text-[var(--v2-text-muted)] opacity-50" />
          </div>
          <div className="text-3xl font-bold text-[var(--v2-text-primary)] tabular-nums">{stats.runCount.toLocaleString()}</div>
          {timePeriodLabel && <div className="text-xs text-[var(--v2-text-muted)] mt-1">{timePeriodLabel}</div>}
        </div>
        <div className="bg-[var(--v2-surface)] p-6 hover:bg-[var(--v2-hover)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Success Rate</span>
            <Target className="w-4 h-4 text-[var(--v2-text-muted)] opacity-50" />
          </div>
          <div className="text-3xl font-bold text-[var(--v2-text-primary)] tabular-nums">{stats.successRate.toFixed(1)}%</div>
          {timePeriodLabel && <div className="text-xs text-[var(--v2-text-muted)] mt-1">{timePeriodLabel}</div>}
        </div>
        <div className="bg-[var(--v2-surface)] p-6 hover:bg-[var(--v2-hover)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Run Mode</span>
            {getRunModeIcon()}
          </div>
          <div className="text-xl font-bold text-[var(--v2-text-primary)]">{getRunModeText()}</div>
          {agent.schedule_cron && (
            <div className="text-xs text-[var(--v2-text-muted)] mt-1">{formatSchedule()}</div>
          )}
        </div>
        <div className="bg-[var(--v2-surface)] p-6 hover:bg-[var(--v2-hover)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">Advanced Mode</span>
            <Settings2 className="w-4 h-4 text-[var(--v2-text-muted)] opacity-50" />
          </div>
          <button
            onClick={onAdvancedModeToggle}
            className={`w-14 h-7 rounded-full relative transition-all ${
              advancedMode ? 'bg-[var(--v2-primary)] shadow-md' : 'bg-[var(--v2-border)]'
            }`}
          >
            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
              advancedMode ? 'translate-x-7' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      </div>
    </div>
  )
}
