'use client'

/**
 * RecentActivity Component
 *
 * Displays a live feed of recent automation activity.
 * Shows success, warning, and error states with relative timestamps.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState } from 'react'
import { Check, AlertTriangle, XCircle } from 'lucide-react'

interface ActivityItem {
  id: string
  type: string
  workflow_name: string
  workflow_id: string
  description: string
  timestamp: string
}

interface RecentActivityProps {
  className?: string
  onViewAllClick?: () => void
}

export function RecentActivity({ className = '', onViewAllClick }: RecentActivityProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v2/analytics/activity?limit=5')
      .then(res => res.json())
      .then(response => {
        if (response.success) {
          setActivities(response.data || [])
        }
      })
      .catch(err => console.error('Failed to fetch activity:', err))
      .finally(() => setLoading(false))
  }, [])

  const formatRelativeTime = (timestamp: string | null | undefined): string => {
    if (!timestamp) return 'Unknown'

    const date = new Date(timestamp)
    // Check if date is valid
    if (isNaN(date.getTime())) return 'Unknown'

    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  }

  // Map API type to status for icon display
  const getStatusFromType = (type: string): 'success' | 'warning' | 'error' => {
    if (type.includes('success') || type.includes('completed')) return 'success'
    if (type.includes('failed') || type.includes('error')) return 'error'
    return 'warning'
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <div className="p-1.5 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg">
            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        )
      case 'warning':
        return (
          <div className="p-1.5 bg-amber-100 dark:bg-amber-500/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
        )
      case 'error':
        return (
          <div className="p-1.5 bg-red-100 dark:bg-red-500/20 rounded-lg">
            <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
          </div>
        )
      default:
        return (
          <div className="p-1.5 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg">
            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        )
    }
  }

  if (loading) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 h-full animate-pulse shadow-[var(--v2-shadow-card)] ${className}`}>
        <div className="h-6 w-36 bg-[var(--v2-surface-hover)] rounded mb-6" />
        <div className="space-y-4">
          <div className="h-12 bg-[var(--v2-surface-hover)] rounded" />
          <div className="h-12 bg-[var(--v2-surface-hover)] rounded" />
          <div className="h-12 bg-[var(--v2-surface-hover)] rounded" />
          <div className="h-12 bg-[var(--v2-surface-hover)] rounded" />
          <div className="h-12 bg-[var(--v2-surface-hover)] rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 h-full shadow-[var(--v2-shadow-card)] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">Recent Activity</h2>
        <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <span className="w-2 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full animate-pulse" />
          Live
        </span>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[var(--v2-text-muted)]">
            No recent activity. Your automation activity will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {activities.map(activity => (
            <div key={activity.id} className="flex items-start gap-3">
              {getStatusIcon(getStatusFromType(activity.type))}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--v2-text-primary)]">
                  <span className="font-medium">{activity.workflow_name}</span>{' '}
                  {activity.description}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  {formatRelativeTime(activity.timestamp)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activities.length > 0 && (
        <button
          onClick={onViewAllClick}
          className="w-full mt-4 py-2 text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition"
        >
          View All Activity →
        </button>
      )}
    </div>
  )
}
