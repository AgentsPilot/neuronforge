// app/v2/agents/[id]/page-redesign.tsx
// V2 Agent Detail Page - Redesigned with simplified 2-column layout
// EFFICIENT VERSION: ~800 lines vs 2160 lines original

'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { agentApi, systemConfigApi, sharedAgentApi } from '@/lib/client/agent-api'
import type { Agent, Execution } from '@/lib/repositories/types'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { ConfirmDialog } from '@/components/v2/ui/ConfirmDialog'
import { AgentIntensityCardV2 } from '@/components/v2/agents/AgentIntensityCardV2'
import {
  Play, Settings, Gauge, Copy, Check, Loader2, TrendingUp, XCircle, X,
  Trash2, Share2, Download, Clock, CheckCircle, AlertTriangle
} from 'lucide-react'
import { clientLogger } from '@/lib/logger/client'

// Efficient health calculation (reused from AgentHealthCardV2 logic)
function calculateHealth(allExecutions: Execution[]) {
  const last10 = allExecutions.slice(0, 10)
  const successCount = allExecutions.filter(e => e.status === 'success').length
  const failedCount = allExecutions.filter(e => e.status === 'failed').length

  const score = successCount * 10
  const maxScore = allExecutions.length * 10
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0

  const recentSuccess = last10.filter(e => e.status === 'success').length
  const recentScore = recentSuccess * 10
  const recentMaxScore = last10.length * 10

  return { score, maxScore, percentage, recentScore, recentMaxScore, failedCount }
}

// Format duration helper
function formatDuration(ms?: number): string {
  if (!ms) return '—'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

// Format date helper
function formatExecutionDate(date: string): string {
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
  if (diffMins < 2880) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function V2AgentDetailPageRedesign() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const agentId = params.id as string

  // Core state
  const [agent, setAgent] = useState<Agent | null>(null)
  const [executions, setExecutions] = useState<Execution[]>([])
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null)
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState(false)

  // UI state
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false)
  const [showInsightsModal, setShowInsightsModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showShareConfirm, setShowShareConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Insights state
  const [insights, setInsights] = useState<any[]>([])
  const [insightsEnabled, setInsightsEnabled] = useState(false)

  // Sharing state (consolidated)
  const [shareData, setShareData] = useState({
    rewardActive: true,
    validation: null as any,
    hasBeenShared: false
  })

  // Calculated health metrics (memoized)
  const health = useMemo(() => calculateHealth(executions), [executions])

  // Load all data in one efficient fetch
  useEffect(() => {
    if (user && agentId) {
      fetchAllData()
    }
  }, [user, agentId])

  // Auto-select first execution
  useEffect(() => {
    if (executions.length > 0 && !selectedExecution) {
      setSelectedExecution(executions[0])
    }
  }, [executions])

  // EFFICIENT: Single batched data fetch
  const fetchAllData = async () => {
    try {
      setLoading(true)

      // Fetch agent and executions in parallel
      const [agentResult, executionsResult] = await Promise.all([
        agentApi.get(agentId, user!.id),
        agentApi.getExecutions(agentId, user!.id, { limit: 50 })
      ])

      if (agentResult.success && agentResult.data) {
        const agentData = agentResult.data
        setAgent(agentData)
        setInsightsEnabled(agentData.insights_enabled || false)
      }

      if (executionsResult.success && executionsResult.data) {
        setExecutions(executionsResult.data)
      }

      // Fetch insights if enabled (non-blocking)
      if (agentResult.data?.insights_enabled) {
        fetchInsights()
      }

    } catch (error) {
      clientLogger.error('Error fetching agent data', error as Error)
    } finally {
      setLoading(false)
    }
  }

  const fetchInsights = async () => {
    try {
      const response = await fetch(`/api/v6/insights?agentId=${agentId}`, {
        headers: { 'x-user-id': user!.id }
      })

      if (response.ok) {
        const data = await response.json()
        setInsights(data.insights || [])
      }
    } catch (error) {
      clientLogger.error('Error fetching insights', error as Error)
    }
  }

  // Actions
  const handleRunClick = () => router.push(`/v2/agents/${agentId}/run`)
  const handleEditClick = () => router.push(`/v2/agents/${agentId}/edit`)
  const handleCalibrateClick = () => router.push(`/v2/sandbox/${agentId}`)

  const handleDuplicate = async () => {
    if (!agent || !user) return
    setActionLoading('duplicate')
    try {
      const result = await agentApi.duplicate(agentId, user.id)
      if (result.success && result.data) {
        router.push(`/v2/agents/${result.data.id}`)
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleShare = async () => {
    setShowShareConfirm(false)
    setActionLoading('share')
    try {
      const result = await sharedAgentApi.share(agentId, user!.id, {
        description: agent?.description || undefined
      })
      if (result.success) {
        alert('Agent shared successfully!')
        setShareData(prev => ({ ...prev, hasBeenShared: true }))
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async () => {
    setShowDeleteConfirm(false)
    setActionLoading('delete')
    try {
      const result = await agentApi.delete(agentId, user!.id)
      if (result.success) {
        router.push('/v2/agents')
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleExport = () => {
    if (!agent) return
    const dataStr = JSON.stringify(agent, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${agent.name}-config.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const copyAgentId = () => {
    navigator.clipboard.writeText(agentId)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const toggleInsights = async (enabled: boolean) => {
    try {
      await fetch(`/api/agents/${agentId}/insights`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insights_enabled: enabled })
      })
      setInsightsEnabled(enabled)
      if (agent) {
        setAgent({ ...agent, insights_enabled: enabled })
      }
    } catch (error) {
      clientLogger.error('Error toggling insights', error as Error)
    }
  }

  if (loading || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--v2-background)]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--v2-background)]">
      <V2Logo />
      <V2Controls />

      <div className="max-w-[1400px] mx-auto p-6">
        {/* HEADER SECTION */}
        <Card className="!p-8 mb-5">
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--v2-text-primary)] mb-2">
            {agent.name}
          </h1>
          <p className="text-[var(--v2-text-secondary)] mb-6 max-w-3xl">
            {agent.description || 'No description provided'}
          </p>

          {/* Health Bar */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-[var(--v2-text-secondary)]">System Health</span>
              <span className="text-sm font-semibold text-[var(--v2-primary)]">
                {health.percentage}% Healthy
              </span>
            </div>
            <div className="w-full h-2 bg-[var(--v2-surface)] rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${health.percentage}%`,
                  background: health.percentage >= 80 ? '#10b981' : health.percentage >= 50 ? '#f59e0b' : '#ef4444'
                }}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleRunClick}
              className="px-5 py-2.5 bg-[var(--v2-primary)] text-white hover:bg-[var(--v2-primary-dark)] transition-colors font-medium rounded-lg flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Run Now
            </button>
            <button
              onClick={() => setShowSettingsDrawer(true)}
              className="px-5 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium rounded-lg flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            {!agent.production_ready && (
              <button
                onClick={handleCalibrateClick}
                className="px-5 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium rounded-lg flex items-center gap-2"
              >
                <Gauge className="w-4 h-4" />
                Calibrate
              </button>
            )}
          </div>
        </Card>

        {/* ALERT BANNER (conditional) */}
        {insightsEnabled && insights.length > 0 && (
          <Card className="!p-5 mb-5 !bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 !border-amber-200 dark:!border-amber-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                    {insights.length} {insights.length === 1 ? 'Issue Needs' : 'Issues Need'} Attention
                  </h3>
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Your agent has reliability or optimization opportunities
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowInsightsModal(true)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                View Recommendations
              </button>
            </div>
          </Card>
        )}

        {/* MAIN 2-COLUMN LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5">

          {/* LEFT: EXECUTION TIMELINE */}
          <Card className="!p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)] flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Recent Activity
              </h3>
              <span className="text-xs text-[var(--v2-text-muted)]">
                {executions.length} runs
              </span>
            </div>

            <div className="space-y-3 max-h-[70vh] overflow-y-auto">
              {executions.slice(0, 20).map((exec) => (
                <div
                  key={exec.id}
                  onClick={() => setSelectedExecution(exec)}
                  className={`p-4 rounded-lg cursor-pointer transition-all border-2 ${
                    selectedExecution?.id === exec.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
                      : 'bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[var(--v2-text-muted)]">
                      {formatExecutionDate(exec.started_at)}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        exec.status === 'success'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : exec.status === 'failed'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {exec.status === 'success' ? '✓ Success' : exec.status === 'failed' ? '✗ Failed' : '⋯ Running'}
                    </span>
                  </div>
                  <div className="text-sm text-[var(--v2-text-primary)] font-medium mb-2">
                    {exec.status === 'success'
                      ? 'Execution completed successfully'
                      : exec.status === 'failed'
                      ? 'Execution failed'
                      : 'Execution in progress'}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--v2-text-muted)]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(exec.execution_duration_ms)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* RIGHT: EXECUTION DETAILS */}
          <Card className="!p-8">
            {selectedExecution ? (
              <>
                <div className="mb-6 pb-5 border-b border-[var(--v2-border)]">
                  <h2 className="text-xl font-bold text-[var(--v2-text-primary)] mb-1">
                    Execution Details
                  </h2>
                  <p className="text-sm text-[var(--v2-text-muted)]">
                    {new Date(selectedExecution.started_at).toLocaleString()}
                  </p>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-[var(--v2-surface)] rounded-lg p-4">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-2">Duration</div>
                    <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                      {formatDuration(selectedExecution.execution_duration_ms)}
                    </div>
                  </div>
                  <div className="bg-[var(--v2-surface)] rounded-lg p-4">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-2">Status</div>
                    <div className={`text-2xl font-bold ${
                      selectedExecution.status === 'success' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {selectedExecution.status === 'success' ? 'Success' : 'Failed'}
                    </div>
                  </div>
                  <div className="bg-[var(--v2-surface)] rounded-lg p-4">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-2">Steps</div>
                    <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                      {selectedExecution.logs?.split('\n').filter(l => l.includes('Step')).length || 0}
                    </div>
                  </div>
                </div>

                {/* Logs */}
                <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-3">Execution Logs</h3>
                <div className="bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm">
                  {selectedExecution.logs ? (
                    selectedExecution.logs.split('\n').map((line, i) => (
                      <div key={i} className="text-gray-300 py-0.5">
                        {line}
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-500">No logs available</div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-20 text-[var(--v2-text-muted)]">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select an execution to view details</p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* SETTINGS DRAWER */}
      {showSettingsDrawer && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowSettingsDrawer(false)}
          />
          <div className="fixed top-0 right-0 w-[500px] h-full bg-[var(--v2-background)] shadow-2xl z-50 overflow-y-auto">
            <div className="p-6 border-b border-[var(--v2-border)] flex items-center justify-between sticky top-0 bg-[var(--v2-background)] z-10">
              <h2 className="text-xl font-bold text-[var(--v2-text-primary)]">Agent Settings</h2>
              <button
                onClick={() => setShowSettingsDrawer(false)}
                className="p-2 hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* AIS */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
                  Performance Metrics
                </h3>
                <AgentIntensityCardV2
                  agentId={agentId}
                  latestExecutionTime={executions[0]?.started_at ? new Date(executions[0].started_at).getTime() : undefined}
                />
              </div>

              {/* Intelligence Features */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
                  Intelligence Features
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-[var(--v2-surface)] rounded-lg">
                    <div>
                      <h4 className="font-semibold text-[var(--v2-text-primary)]">Business Insights</h4>
                      <p className="text-sm text-[var(--v2-text-muted)]">AI-powered recommendations</p>
                    </div>
                    <button
                      onClick={() => toggleInsights(!insightsEnabled)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        insightsEnabled ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          insightsEnabled ? 'left-7' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Agent Actions */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
                  Agent Actions
                </h3>
                <div className="space-y-2">
                  <button
                    onClick={handleDuplicate}
                    disabled={actionLoading === 'duplicate'}
                    className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg transition-colors disabled:opacity-50"
                  >
                    {actionLoading === 'duplicate' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Copy className="w-5 h-5" />}
                    <div className="text-left">
                      <h4 className="font-semibold text-[var(--v2-text-primary)]">Duplicate Agent</h4>
                      <p className="text-sm text-[var(--v2-text-muted)]">Create a copy to modify</p>
                    </div>
                  </button>

                  <button
                    onClick={() => setShowShareConfirm(true)}
                    disabled={agent.status !== 'active'}
                    className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Share2 className="w-5 h-5" />
                    <div className="text-left">
                      <h4 className="font-semibold text-[var(--v2-text-primary)]">Share to Templates</h4>
                      <p className="text-sm text-[var(--v2-text-muted)]">Share with community</p>
                    </div>
                  </button>

                  <button
                    onClick={handleExport}
                    className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg transition-colors"
                  >
                    <Download className="w-5 h-5" />
                    <div className="text-left">
                      <h4 className="font-semibold text-[var(--v2-text-primary)]">Export Configuration</h4>
                      <p className="text-sm text-[var(--v2-text-muted)]">Download as JSON</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="pt-6 border-t-2 border-red-200 dark:border-red-900/30">
                <h3 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-4">
                  ⚠️ Danger Zone
                </h3>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg transition-colors text-red-600"
                >
                  <Trash2 className="w-5 h-5" />
                  <div className="text-left">
                    <h4 className="font-semibold">Delete Agent</h4>
                    <p className="text-sm">Permanently remove this agent</p>
                  </div>
                </button>
              </div>

              {/* Agent ID */}
              <div className="pt-6 border-t border-[var(--v2-border)]">
                <div className="text-xs text-[var(--v2-text-muted)] mb-2">Agent ID</div>
                <div className="flex items-center gap-2 font-mono text-sm bg-[var(--v2-surface)] p-3 rounded-lg">
                  <span className="flex-1 truncate">{agentId}</span>
                  <button onClick={copyAgentId} className="p-1 hover:bg-[var(--v2-surface-hover)] rounded">
                    {copiedId ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* INSIGHTS MODAL */}
      {showInsightsModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setShowInsightsModal(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-3xl max-h-[90vh] bg-[var(--v2-background)] rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-[var(--v2-border)] flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--v2-text-primary)]">
                Business Insights & Recommendations
              </h2>
              <button
                onClick={() => setShowInsightsModal(false)}
                className="p-2 hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {insights.length > 0 ? (
                <div className="space-y-4">
                  {insights.map((insight) => (
                    <div
                      key={insight.id}
                      className="p-5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-[var(--v2-text-primary)] mb-1">
                            {insight.title}
                          </h3>
                          <p className="text-xs text-[var(--v2-text-muted)] uppercase">
                            {insight.insight_type}
                          </p>
                        </div>
                        <span className="text-xs px-2 py-1 bg-amber-100 text-amber-800 rounded-full">
                          {insight.confidence}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
                        {insight.description}
                      </p>
                      {insight.recommendation && (
                        <div className="text-sm text-[var(--v2-primary)] bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                          <strong>Recommendation:</strong> {insight.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-[var(--v2-text-muted)]">
                  <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No insights available yet</p>
                  <p className="text-sm mt-2">Run your agent a few times to generate insights</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* CONFIRM DIALOGS */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Agent"
          message={`Are you sure you want to delete "${agent.name}"? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          variant="danger"
        />
      )}

      {showShareConfirm && (
        <ConfirmDialog
          title="Share Agent"
          message={`Share "${agent.name}" with the community? You may earn credits based on agent quality.`}
          confirmText="Share"
          cancelText="Cancel"
          onConfirm={handleShare}
          onCancel={() => setShowShareConfirm(false)}
        />
      )}
    </div>
  )
}
