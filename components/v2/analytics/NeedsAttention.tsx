'use client'

/**
 * NeedsAttention Component
 *
 * Displays insights that need user attention.
 * Clicking on the card opens a drawer with full details.
 * Shows an "all good" state when no issues exist.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, Info, Check, ExternalLink, X, ChevronRight } from 'lucide-react'
import { NeedsAttentionDrawer } from './NeedsAttentionDrawer'

interface AttentionItem {
  id: string
  type: 'warning' | 'info'
  title: string
  description: string
  business_impact?: string
  recommendation?: string
  severity?: string
  insight_type?: string
  category?: string
  agent_id?: string
  agent_name?: string
  created_at?: string
}

interface NeedsAttentionProps {
  className?: string
}

export function NeedsAttention({ className = '' }: NeedsAttentionProps) {
  const [items, setItems] = useState<AttentionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds(prev => new Set([...prev, id]))
    // Optionally call API to dismiss the insight
    fetch(`/api/v6/insights/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' })
    }).catch(err => console.error('Failed to dismiss insight:', err))
  }, [])

  const handleDismissFromCard = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    handleDismiss(id)
  }

  const visibleItems = items.filter(item => !dismissedIds.has(item.id))

  useEffect(() => {
    // Fetch all active insights (no filter - show all types in drawer with tabs)
    fetch('/api/v6/insights?status=new,viewed&limit=50')
      .then(res => res.json())
      .then(response => {
        if (response.success && response.data) {
          // Transform insights to attention items (no filtering - show all)
          const attentionItems: AttentionItem[] = response.data
            .map((insight: any) => ({
              id: insight.id,
              type: insight.severity === 'critical' || insight.severity === 'high' ? 'warning' : 'info',
              title: insight.title || 'Issue detected',
              description: insight.description || 'An issue was detected that may need your attention.',
              business_impact: insight.business_impact,
              recommendation: insight.recommendation,
              severity: insight.severity,
              insight_type: insight.insight_type,
              category: insight.category,
              agent_id: insight.agent_id,
              agent_name: insight.agent_name,
              created_at: insight.created_at,
            }))
          setItems(attentionItems)
        }
      })
      .catch(err => console.error('Failed to fetch insights:', err))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 h-full animate-pulse shadow-[var(--v2-shadow-card)] ${className}`}>
        <div className="h-6 w-40 bg-[var(--v2-surface-hover)] rounded mb-4" />
        <div className="space-y-3">
          <div className="h-24 bg-[var(--v2-surface-hover)] rounded-xl" />
          <div className="h-24 bg-[var(--v2-surface-hover)] rounded-xl" />
        </div>
      </div>
    )
  }

  // Show only first 3 items in the card preview
  const previewItems = visibleItems.slice(0, 3)

  return (
    <>
      <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)] p-6 h-full shadow-[var(--v2-shadow-card)] ${className}`}>
        {/* Header - clickable to open drawer */}
        <div
          onClick={() => visibleItems.length > 0 && setDrawerOpen(true)}
          className={`flex items-center justify-between mb-4 ${visibleItems.length > 0 ? 'cursor-pointer group' : ''}`}
        >
          <h2 className="text-lg font-semibold text-[var(--v2-text-primary)] group-hover:text-[var(--v2-primary)] transition">
            Needs Attention
          </h2>
          <div className="flex items-center gap-2">
            {visibleItems.length > 0 && (
              <>
                <span className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-full text-xs font-medium">
                  <span className="w-2 h-2 bg-amber-500 dark:bg-amber-400 rounded-full animate-pulse" />
                  {visibleItems.length}
                </span>
                <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)] group-hover:text-[var(--v2-primary)] transition" />
              </>
            )}
          </div>
        </div>

        {visibleItems.length === 0 ? (
          /* All Good State */
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="p-3 bg-emerald-100 dark:bg-emerald-500/20 rounded-full mb-3">
              <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-[var(--v2-text-primary)]">Everything looks good!</p>
            <p className="text-xs text-[var(--v2-text-muted)] mt-1">No issues need your attention</p>
          </div>
        ) : (
          /* Issues List Preview */
          <div className="space-y-3">
            {previewItems.map(item => (
              <div
                key={item.id}
                onClick={() => setDrawerOpen(true)}
                className={`bg-[var(--v2-surface-hover)] rounded-xl p-3 border-l-4 cursor-pointer hover:bg-[var(--v2-border)] transition ${
                  item.type === 'warning' ? 'border-amber-500' : 'border-indigo-500'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`p-1.5 rounded-lg mt-0.5 flex-shrink-0 ${
                    item.type === 'warning'
                      ? 'bg-amber-100 dark:bg-amber-500/20'
                      : 'bg-indigo-100 dark:bg-indigo-500/20'
                  }`}>
                    {item.type === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--v2-text-primary)] line-clamp-1">{item.title}</p>
                      <button
                        onClick={(e) => handleDismissFromCard(e, item.id)}
                        className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] rounded transition flex-shrink-0"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1 line-clamp-2">{item.description}</p>
                    {item.agent_name && (
                      <p className="text-xs text-[var(--v2-text-secondary)] mt-1.5 flex items-center gap-1">
                        {item.agent_name}
                        <ExternalLink className="w-3 h-3" />
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* View All link if more items */}
            {visibleItems.length > 3 && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="w-full py-2 text-sm text-[var(--v2-primary)] hover:underline font-medium"
              >
                View all {visibleItems.length} items →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Drawer */}
      <NeedsAttentionDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={visibleItems}
        onDismiss={handleDismiss}
      />
    </>
  )
}
