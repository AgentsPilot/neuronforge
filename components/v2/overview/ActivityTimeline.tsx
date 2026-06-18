'use client'

/**
 * ActivityTimeline - Recent events across all workflows
 *
 * Shows a chronological list of recent automation events.
 * Domain-agnostic - displays universal event types.
 */

import * as React from 'react'
import {
  CheckCircle2,
  XCircle,
  PlayCircle,
  AlertTriangle,
  Clock,
  Sparkles,
  Settings,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/design-system-v2'

export type ActivityType =
  | 'execution_success'
  | 'execution_failed'
  | 'execution_started'
  | 'insight_detected'
  | 'workflow_updated'
  | 'schedule_triggered'

export interface ActivityEvent {
  id: string
  type: ActivityType
  workflow_name: string
  workflow_id?: string
  description: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface ActivityTimelineProps {
  events: ActivityEvent[]
  onEventClick?: (event: ActivityEvent) => void
  maxEvents?: number
  loading?: boolean
  className?: string
}

const typeConfig: Record<
  ActivityType,
  { icon: React.FC<{ className?: string }>; color: string }
> = {
  execution_success: {
    icon: CheckCircle2,
    color: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30',
  },
  execution_failed: {
    icon: XCircle,
    color: 'text-red-500 bg-red-100 dark:bg-red-900/30',
  },
  execution_started: {
    icon: PlayCircle,
    color: 'text-blue-500 bg-blue-100 dark:bg-blue-900/30',
  },
  insight_detected: {
    icon: Sparkles,
    color: 'text-purple-500 bg-purple-100 dark:bg-purple-900/30',
  },
  workflow_updated: {
    icon: Settings,
    color: 'text-slate-500 bg-slate-100 dark:bg-slate-800',
  },
  schedule_triggered: {
    icon: Clock,
    color: 'text-amber-500 bg-amber-100 dark:bg-amber-900/30',
  },
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function ActivityTimeline({
  events,
  onEventClick,
  maxEvents = 10,
  loading = false,
  className,
}: ActivityTimelineProps) {
  const displayEvents = events.slice(0, maxEvents)

  if (loading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse flex-shrink-0" />
            <div className="flex-1">
              <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mb-2" />
              <div className="h-3 w-1/2 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (displayEvents.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-8 text-center',
          'bg-slate-50 dark:bg-slate-800/50 rounded-xl',
          className
        )}
      >
        <RefreshCw className="h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
          No recent activity
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Run a workflow to see activity here
        </p>
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      {/* Timeline line */}
      <div className="absolute left-4 top-4 bottom-4 w-px bg-slate-200 dark:bg-slate-700" />

      {/* Events */}
      <div className="space-y-4">
        {displayEvents.map((event, index) => {
          const config = typeConfig[event.type]
          const IconComponent = config.icon

          return (
            <div
              key={event.id}
              className={cn(
                'relative flex items-start gap-3 pl-0',
                onEventClick && 'cursor-pointer group'
              )}
              onClick={() => onEventClick?.(event)}
            >
              {/* Icon */}
              <div
                className={cn(
                  'relative z-10 p-1.5 rounded-lg flex-shrink-0',
                  config.color,
                  onEventClick && 'group-hover:ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ring-indigo-500'
                )}
              >
                <IconComponent className="h-4 w-4" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {event.workflow_name}
                  </span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-1">
                  {event.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
