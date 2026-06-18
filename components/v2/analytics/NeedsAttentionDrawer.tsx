'use client'

/**
 * NeedsAttentionDrawer Component
 *
 * A slide-out drawer that displays all insights with tabs by insight type.
 * Includes links to agent pages and dismissal functionality.
 *
 * Uses V2 theme design system for colors, dark mode support, and fonts.
 */

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  X,
  AlertTriangle,
  Info,
  ExternalLink,
  Check,
  Lightbulb,
  TrendingUp,
  AlertCircle,
  Database,
  Zap
} from 'lucide-react'

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

interface NeedsAttentionDrawerProps {
  isOpen: boolean
  onClose: () => void
  items: AttentionItem[]
  onDismiss: (id: string) => void
}

// Tab configuration for insight types
const INSIGHT_TABS = [
  { id: 'all', label: 'All', icon: Lightbulb },
  { id: 'reliability_risk', label: 'Reliability', icon: AlertCircle },
  { id: 'automation_opportunity', label: 'Automation', icon: Zap },
  { id: 'data_quality', label: 'Data Quality', icon: Database },
  { id: 'cost_optimization', label: 'Cost', icon: TrendingUp },
] as const

export function NeedsAttentionDrawer({
  isOpen,
  onClose,
  items,
  onDismiss
}: NeedsAttentionDrawerProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>('all')

  // Group items by insight_type and count
  const itemsByType = useMemo(() => {
    const groups: Record<string, AttentionItem[]> = { all: items }

    items.forEach(item => {
      const type = item.insight_type || 'other'
      if (!groups[type]) groups[type] = []
      groups[type].push(item)
    })

    return groups
  }, [items])

  // Get filtered items based on active tab
  const filteredItems = useMemo(() => {
    if (activeTab === 'all') return items
    return itemsByType[activeTab] || []
  }, [activeTab, items, itemsByType])

  // Get available tabs (only show tabs that have items)
  const availableTabs = useMemo(() => {
    return INSIGHT_TABS.filter(tab => {
      if (tab.id === 'all') return true
      return (itemsByType[tab.id]?.length || 0) > 0
    })
  }, [itemsByType])

  if (!isOpen) return null

  const handleViewAgent = (agentId: string) => {
    router.push(`/v2/agents/${agentId}`)
    onClose()
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return ''
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getSeverityBadge = (severity?: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'
      case 'high':
        return 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
      case 'medium':
        return 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
      default:
        return 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400'
    }
  }

  const getInsightTypeLabel = (type?: string) => {
    switch (type) {
      case 'reliability_risk': return 'Reliability'
      case 'automation_opportunity': return 'Automation'
      case 'data_quality': return 'Data Quality'
      case 'cost_optimization': return 'Cost'
      default: return type || 'Other'
    }
  }

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
        <div className="flex-shrink-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">All Insights</h2>
              <p className="text-sm text-[var(--v2-text-muted)]">
                {items.length} insight{items.length !== 1 ? 's' : ''} across your automations
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

        {/* Tabs */}
        {items.length > 0 && (
          <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-6 py-2 overflow-x-auto">
            <div className="flex gap-1">
              {availableTabs.map(tab => {
                const count = tab.id === 'all' ? items.length : (itemsByType[tab.id]?.length || 0)
                const isActive = activeTab === tab.id
                const TabIcon = tab.icon

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition whitespace-nowrap ${
                      isActive
                        ? 'bg-[var(--v2-primary)] text-white'
                        : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)]'
                    }`}
                  >
                    <TabIcon className="w-4 h-4" />
                    {tab.label}
                    <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--v2-surface-hover)] text-[var(--v2-text-muted)]'
                    }`}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-4 bg-emerald-100 dark:bg-emerald-500/20 rounded-full mb-4">
                <Check className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-base font-medium text-[var(--v2-text-primary)]">Everything looks good!</p>
              <p className="text-sm text-[var(--v2-text-muted)] mt-1">No insights need your attention right now.</p>
            </div>
          ) : filteredItems.length === 0 ? (
            /* No items in this tab */
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-[var(--v2-text-muted)]">No insights in this category.</p>
            </div>
          ) : (
            /* Items List */
            <div className="space-y-4">
              {filteredItems.map(item => (
                <div
                  key={item.id}
                  className={`bg-[var(--v2-surface-hover)] rounded-xl p-5 border-l-4 ${
                    item.type === 'warning' ? 'border-amber-500' : 'border-indigo-500'
                  }`}
                >
                  {/* Header Row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${
                        item.type === 'warning'
                          ? 'bg-amber-100 dark:bg-amber-500/20'
                          : 'bg-indigo-100 dark:bg-indigo-500/20'
                      }`}>
                        {item.type === 'warning' ? (
                          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                          {item.title}
                        </h3>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {item.severity && (
                            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${getSeverityBadge(item.severity)}`}>
                              {item.severity.charAt(0).toUpperCase() + item.severity.slice(1)}
                            </span>
                          )}
                          {item.insight_type && activeTab === 'all' && (
                            <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-[var(--v2-surface)] text-[var(--v2-text-muted)]">
                              {getInsightTypeLabel(item.insight_type)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {item.created_at && (
                      <span className="text-xs text-[var(--v2-text-muted)] flex-shrink-0">
                        {formatDate(item.created_at)}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-sm text-[var(--v2-text-secondary)] mb-3 leading-relaxed">
                    {item.description}
                  </p>

                  {/* Business Impact */}
                  {item.business_impact && (
                    <div className="mb-3 p-3 bg-[var(--v2-surface)] rounded-lg">
                      <p className="text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">
                        Business Impact
                      </p>
                      <p className="text-sm text-[var(--v2-text-secondary)]">
                        {item.business_impact}
                      </p>
                    </div>
                  )}

                  {/* Recommendation */}
                  {item.recommendation && (
                    <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg border border-emerald-200 dark:border-emerald-500/20">
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1">
                        Recommendation
                      </p>
                      <p className="text-sm text-emerald-800 dark:text-emerald-300">
                        {item.recommendation}
                      </p>
                    </div>
                  )}

                  {/* Agent Link & Actions */}
                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--v2-border)]">
                    {item.agent_id ? (
                      <button
                        onClick={() => handleViewAgent(item.agent_id!)}
                        className="flex items-center gap-2 text-sm text-[var(--v2-primary)] hover:underline"
                      >
                        {item.agent_name || 'View Agent'}
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-sm text-[var(--v2-text-muted)]">No agent linked</span>
                    )}

                    <button
                      onClick={() => onDismiss(item.id)}
                      className="px-3 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] rounded-lg transition"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
