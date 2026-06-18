'use client'

/**
 * CategoryDrilldownDrawer Component
 *
 * A slide-out drawer that displays detailed metrics and agent list for a workflow group.
 * Shows automations in the category with their individual performance metrics.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  X,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react'
import type { GroupMetrics } from './ByCategory'

interface AgentMetrics {
  agent_id: string
  agent_name: string
  status: string
  total_executions: number
  successful_executions: number
  failed_executions: number
  success_rate: number
  time_saved_seconds: number
  time_saved_change_pct: number | null
  last_execution_at: string | null
}

interface CategoryDetail {
  group: GroupMetrics
  agents: AgentMetrics[]
}

interface CategoryDrilldownDrawerProps {
  isOpen: boolean
  onClose: () => void
  group: GroupMetrics | null
}

// Default category colors
const DEFAULT_COLORS = ['#6366F1', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#EC4899']

export function CategoryDrilldownDrawer({
  isOpen,
  onClose,
  group
}: CategoryDrilldownDrawerProps) {
  const router = useRouter()
  const [detail, setDetail] = useState<CategoryDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen && group) {
      setLoading(true)
      fetch(`/api/v2/analytics/by-group/${group.group_id}`)
        .then(res => res.json())
        .then(response => {
          if (response.success) {
            setDetail(response.data)
          }
        })
        .catch(err => console.error('Failed to fetch category detail:', err))
        .finally(() => setLoading(false))
    }
  }, [isOpen, group])

  if (!isOpen || !group) return null

  const formatHours = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.round((seconds % 3600) / 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getTrendIcon = (pct: number | null) => {
    if (pct === null || pct === 0) return <Minus className="w-4 h-4 text-[var(--v2-text-muted)]" />
    if (pct > 0) return <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
    return <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
  }

  const getTrendColor = (pct: number | null): string => {
    if (pct === null || pct === 0) return 'text-[var(--v2-text-muted)]'
    return pct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  }

  const handleViewAgent = (agentId: string) => {
    router.push(`/v2/agents/${agentId}`)
    onClose()
  }

  const groupColor = group.group_color || DEFAULT_COLORS[0]

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="fixed top-0 right-0 h-screen w-full max-w-xl bg-[var(--v2-surface)] shadow-2xl z-50 flex flex-col border-l border-[var(--v2-border)]">
        {/* Header */}
        <div className="flex-shrink-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: groupColor }}
              />
              <div>
                <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {group.group_name}
                </h2>
                <p className="text-sm text-[var(--v2-text-muted)]">
                  {group.workflow_count} automation{group.workflow_count !== 1 ? 's' : ''} in this category
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="text-center p-3 bg-[var(--v2-surface-hover)] rounded-lg">
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatHours(group.total_time_saved_seconds)}
              </div>
              <div className="text-xs text-[var(--v2-text-muted)]">Time Saved</div>
            </div>
            <div className="text-center p-3 bg-[var(--v2-surface-hover)] rounded-lg">
              <div className="text-xl font-bold text-[var(--v2-text-primary)]">
                {group.workflow_count}
              </div>
              <div className="text-xs text-[var(--v2-text-muted)]">Automations</div>
            </div>
            <div className="text-center p-3 bg-[var(--v2-surface-hover)] rounded-lg">
              <div className={`text-xl font-bold ${getTrendColor(group.time_saved_change_pct)}`}>
                {group.time_saved_change_pct !== null
                  ? `${group.time_saved_change_pct > 0 ? '+' : ''}${group.time_saved_change_pct}%`
                  : '—'}
              </div>
              <div className="text-xs text-[var(--v2-text-muted)]">vs Last Month</div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse bg-[var(--v2-surface-hover)] rounded-xl h-32" />
              ))}
            </div>
          ) : !detail || detail.agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-[var(--v2-text-muted)]">
                No automations found in this category.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                Automations in this Category
              </h3>
              {detail.agents.map(agent => (
                <div
                  key={agent.agent_id}
                  className="bg-[var(--v2-surface-hover)] rounded-xl p-4 hover:shadow-md transition"
                >
                  {/* Agent Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-medium text-[var(--v2-text-primary)]">
                        {agent.agent_name}
                      </h4>
                      <p className="text-xs text-[var(--v2-text-muted)]">
                        Last run: {formatDate(agent.last_execution_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleViewAgent(agent.agent_id)}
                      className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-primary)] hover:bg-[var(--v2-surface)] transition"
                      title="View agent details"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Agent Metrics */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="text-center p-2 bg-[var(--v2-surface)] rounded-lg">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                          {formatHours(agent.time_saved_seconds)}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--v2-text-muted)]">Saved</div>
                    </div>

                    <div className="text-center p-2 bg-[var(--v2-surface)] rounded-lg">
                      <div className="text-sm font-semibold text-[var(--v2-text-primary)]">
                        {agent.total_executions}
                      </div>
                      <div className="text-xs text-[var(--v2-text-muted)]">Runs</div>
                    </div>

                    <div className="text-center p-2 bg-[var(--v2-surface)] rounded-lg">
                      <div className="flex items-center justify-center gap-1">
                        <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                          {agent.success_rate}%
                        </span>
                      </div>
                      <div className="text-xs text-[var(--v2-text-muted)]">Success</div>
                    </div>

                    <div className="text-center p-2 bg-[var(--v2-surface)] rounded-lg">
                      <div className="flex items-center justify-center gap-1">
                        {getTrendIcon(agent.time_saved_change_pct)}
                        <span className={`text-sm font-semibold ${getTrendColor(agent.time_saved_change_pct)}`}>
                          {agent.time_saved_change_pct !== null
                            ? `${agent.time_saved_change_pct > 0 ? '+' : ''}${agent.time_saved_change_pct}%`
                            : '—'}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--v2-text-muted)]">Trend</div>
                    </div>
                  </div>

                  {/* Failed executions warning */}
                  {agent.failed_executions > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                      <XCircle className="w-3 h-3" />
                      {agent.failed_executions} failed execution{agent.failed_executions !== 1 ? 's' : ''} this month
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
