'use client'

/**
 * ByCategory Component
 *
 * Displays metrics aggregated by user-defined workflow groups.
 * Shows hours saved, trend, and automation names per category.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export interface GroupMetrics {
  group_id: string
  group_name: string
  group_color: string | null
  workflow_count: number
  workflow_names: string[]
  total_time_saved_seconds: number
  time_saved_change_pct: number | null
}

interface ByCategoryProps {
  className?: string
  onManageClick?: () => void
  onCategoryClick?: (group: GroupMetrics) => void
}

// Default category colors
const DEFAULT_COLORS = ['#6366F1', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#EC4899']

export function ByCategory({ className = '', onManageClick, onCategoryClick }: ByCategoryProps) {
  const [groups, setGroups] = useState<GroupMetrics[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v2/analytics/by-group')
      .then(res => res.json())
      .then(response => {
        if (response.success) {
          setGroups(response.data || [])
        }
      })
      .catch(err => console.error('Failed to fetch group metrics:', err))
      .finally(() => setLoading(false))
  }, [])

  const formatHours = (seconds: number): string => {
    const hours = Math.round(seconds / 3600)
    return `${hours} hour${hours !== 1 ? 's' : ''} saved`
  }

  const formatTrend = (pct: number | null): string => {
    if (pct === null) return 'No change'
    if (pct === 0) return 'No change'
    return `${pct > 0 ? '+' : ''}${Math.round(pct)}% this month`
  }

  const getTrendColor = (pct: number | null): string => {
    if (pct === null || pct === 0) return 'text-[var(--v2-text-muted)]'
    return pct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  }

  if (loading) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 animate-pulse shadow-[var(--v2-shadow-card)] ${className}`}>
        <div className="h-6 w-32 bg-[var(--v2-surface-hover)] rounded mb-6" />
        <div className="space-y-4">
          <div className="h-24 bg-[var(--v2-surface-hover)] rounded-xl" />
          <div className="h-24 bg-[var(--v2-surface-hover)] rounded-xl" />
          <div className="h-24 bg-[var(--v2-surface-hover)] rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 shadow-[var(--v2-shadow-card)] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">By Category</h2>
        <button
          onClick={onManageClick}
          className="text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition"
        >
          Manage Categories →
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[var(--v2-text-muted)]">
            No categories defined yet. Create groups to organize your automations.
          </p>
          <button
            onClick={onManageClick}
            className="mt-4 px-4 py-2 bg-[var(--v2-surface-hover)] text-[var(--v2-text-secondary)] rounded-lg hover:text-[var(--v2-text-primary)] transition text-sm"
          >
            Create Category
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, index) => (
            <div
              key={group.group_id}
              onClick={() => onCategoryClick?.(group)}
              className="bg-[var(--v2-surface-hover)] rounded-xl p-4 hover:shadow-md transition cursor-pointer"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: group.group_color || DEFAULT_COLORS[index % DEFAULT_COLORS.length] }}
                  />
                  <span className="font-medium text-[var(--v2-text-primary)]">{group.group_name}</span>
                  <span className="text-xs text-[var(--v2-text-muted)]">
                    {group.workflow_count} automation{group.workflow_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[var(--v2-text-primary)]">
                      {formatHours(group.total_time_saved_seconds)}
                    </p>
                    <p className={`text-xs ${getTrendColor(group.time_saved_change_pct)}`}>
                      {formatTrend(group.time_saved_change_pct)}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)]" />
                </div>
              </div>

              {/* Workflow name chips */}
              <div className="flex gap-2 flex-wrap">
                {group.workflow_names.slice(0, 2).map((name, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded text-xs text-[var(--v2-text-secondary)]"
                  >
                    {name}
                  </span>
                ))}
                {group.workflow_names.length > 2 && (
                  <span className="px-2 py-1 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded text-xs text-[var(--v2-text-secondary)]">
                    +{group.workflow_names.length - 2} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
