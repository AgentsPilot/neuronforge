'use client'

import React from 'react'
import { Lightbulb, ArrowRight } from 'lucide-react'

interface Insight {
  id: string
  title: string
  description?: string
  severity?: 'low' | 'medium' | 'high'
  type?: string
  category?: string
}

interface InsightPreviewProps {
  insights: Insight[]
  onViewAll: (insight?: Insight) => void
  className?: string
}

export function InsightPreview({ insights, onViewAll, className = '' }: InsightPreviewProps) {
  // Show 1 latest from each category (business_insight, technical_insight, data_insight)
  // Deduplicate by insight type to avoid showing duplicates
  const seenTypes = new Set<string>()

  const latestBusiness = insights.find((i) => {
    if (i.category !== 'business_insight') return false
    if (seenTypes.has(i.type || '')) return false
    seenTypes.add(i.type || '')
    return true
  })

  const latestTechnical = insights.find((i) => {
    if (i.category !== 'technical_insight') return false
    if (seenTypes.has(i.type || '')) return false
    seenTypes.add(i.type || '')
    return true
  })

  const latestData = insights.find((i) => {
    if (i.category !== 'data_insight') return false
    if (seenTypes.has(i.type || '')) return false
    seenTypes.add(i.type || '')
    return true
  })

  const topInsights: Insight[] = []
  if (latestBusiness) topInsights.push(latestBusiness)
  if (latestTechnical) topInsights.push(latestTechnical)
  if (latestData) topInsights.push(latestData)

  // Count total unique insights for the badge
  const totalCount = topInsights.length

  const getCategoryColor = (category?: string) => {
    switch (category) {
      case 'business_insight':
        return 'bg-[var(--v2-hover)] border-l-4 border-l-emerald-500 border-y border-r border-y-[var(--v2-border)] border-r-[var(--v2-border)]'
      case 'technical_insight':
        return 'bg-[var(--v2-hover)] border-l-4 border-l-blue-500 border-y border-r border-y-[var(--v2-border)] border-r-[var(--v2-border)]'
      case 'data_insight':
        return 'bg-[var(--v2-hover)] border-l-4 border-l-purple-500 border-y border-r border-y-[var(--v2-border)] border-r-[var(--v2-border)]'
      default:
        return 'bg-[var(--v2-hover)] border-l-4 border-l-gray-500 border-y border-r border-y-[var(--v2-border)] border-r-[var(--v2-border)]'
    }
  }

  return (
    <div className={`bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-sm overflow-hidden ${className}`}>
      <div className="p-6 border-b border-[var(--v2-border)] bg-gradient-to-br from-yellow-500/5 to-orange-500/5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--v2-text-primary)] flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" />
            Insights
            <span className="text-sm font-semibold text-[var(--v2-text-muted)] ml-1">({totalCount})</span>
          </h3>
          <button
            onClick={() => onViewAll()}
            className="flex items-center gap-1 text-sm font-semibold text-[var(--v2-primary)] hover:gap-2 transition-all"
          >
            View All
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-3">
        {topInsights.map((insight) => (
          <div
            key={insight.id}
            className={`p-4 rounded-lg ${getCategoryColor(insight.category)} hover:scale-[1.01] transition-transform cursor-pointer`}
            onClick={() => onViewAll(insight)}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm text-[var(--v2-text-primary)]">{insight.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                insight.category === 'business_insight'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : insight.category === 'technical_insight'
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
              }`}>
                {insight.category === 'business_insight' ? 'Business' : insight.category === 'technical_insight' ? 'Technical' : 'Data'}
              </span>
            </div>
            {insight.description && (
              <div className="text-xs line-clamp-2 text-[var(--v2-text-muted)]">{insight.description}</div>
            )}
          </div>
        ))}

      </div>
    </div>
  )
}
