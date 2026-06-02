'use client'

import React, { useState, useEffect } from 'react'
import { X, TrendingUp, Lightbulb, ExternalLink, Calendar, Tag } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

interface ActiveInsightsDialogProps {
  isOpen: boolean
  onClose: () => void
  insightCount: number
}

interface Insight {
  id: string
  agent_id: string
  agent_name: string
  insight_type: string
  category: string
  title: string
  description: string
  priority: string
  created_at: string
  metadata: any
}

type InsightTab = 'business' | 'technical' | 'data'

export function ActiveInsightsDialog({
  isOpen,
  onClose,
  insightCount
}: ActiveInsightsDialogProps) {
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState<Insight[]>([])
  const [activeTab, setActiveTab] = useState<InsightTab>('business')

  useEffect(() => {
    if (isOpen) {
      fetchActiveInsights()
    }
  }, [isOpen])

  const fetchActiveInsights = async () => {
    setLoading(true)
    try {
      // First get insights
      const { data: insightsData, error: insightsError } = await supabase
        .from('execution_insights')
        .select('*')
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(50)

      if (insightsError) throw insightsError

      if (!insightsData || insightsData.length === 0) {
        setInsights([])
        return
      }

      // Get agent IDs
      const agentIds = [...new Set(insightsData.map((i: any) => i.agent_id).filter(Boolean))]

      // Fetch agent names
      const { data: agentsData } = await supabase
        .from('agents')
        .select('id, agent_name')
        .in('id', agentIds)

      const agentMap = new Map(agentsData?.map((a: any) => [a.id, a.agent_name]) || [])

      const formattedData: Insight[] = insightsData.map((insight: any) => ({
        id: insight.id,
        agent_id: insight.agent_id,
        agent_name: agentMap.get(insight.agent_id) || 'Unknown Agent',
        insight_type: insight.insight_type || 'general',
        category: insight.category || 'business_insight',
        title: insight.title || 'Untitled Insight',
        description: insight.description || 'No description available',
        priority: insight.severity || 'medium', // severity maps to priority
        created_at: insight.created_at,
        metadata: insight.metadata
      }))

      setInsights(formattedData)
    } catch (error) {
      console.error('Failed to fetch insights:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20'
      case 'low':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
      default:
        return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20'
    }
  }

  const getInsightIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'performance':
        return TrendingUp
      case 'optimization':
        return Lightbulb
      default:
        return Tag
    }
  }

  if (!isOpen) return null

  const businessInsights = insights.filter(i => i.category === 'business_insight')
  const technicalInsights = insights.filter(i => i.category === 'technical_insight')
  const dataInsights = insights.filter(i => i.category === 'data_insight')

  const displayedInsights =
    activeTab === 'business' ? businessInsights :
    activeTab === 'technical' ? technicalInsights :
    dataInsights

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        {/* Dialog */}
        <div
          className="bg-[var(--v2-surface)] rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] border border-[var(--v2-border)] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-[var(--v2-text-primary)] flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                  Active Insights
                </h2>
                <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                  {insightCount} optimization {insightCount === 1 ? 'opportunity' : 'opportunities'} available
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 border-b border-[var(--v2-border)]">
              <button
                onClick={() => setActiveTab('business')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'business'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                Business ({businessInsights.length})
              </button>
              <button
                onClick={() => setActiveTab('technical')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'technical'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                Technical ({technicalInsights.length})
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'data'
                    ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                    : 'border-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                Data ({dataInsights.length})
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--v2-primary)]" />
              </div>
            ) : displayedInsights.length === 0 ? (
              <div className="text-center py-12">
                <Lightbulb className="w-12 h-12 text-[var(--v2-text-muted)] mx-auto mb-3 opacity-50" />
                <p className="text-[var(--v2-text-muted)]">
                  No {activeTab} insights found
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayedInsights.map((insight) => {
                  const InsightIcon = getInsightIcon(insight.insight_type)
                  return (
                    <div
                      key={insight.id}
                      className="border border-[var(--v2-border)] rounded-lg p-4 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                            <InsightIcon className="w-5 h-5 text-blue-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold text-[var(--v2-text-primary)]">
                                {insight.title}
                              </span>
                              {insight.priority && (
                                <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(insight.priority)}`}>
                                  {insight.priority}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-[var(--v2-text-secondary)] mb-2">
                              {insight.description}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-[var(--v2-text-muted)]">
                              <span className="font-medium">{insight.agent_name}</span>
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatDate(insight.created_at)}
                              </div>
                            </div>
                          </div>
                        </div>
                        <a
                          href={`/v2/agents/${insight.agent_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-primary)] transition-colors opacity-0 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-all text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
