// app/v2/agents/[id]/page.tsx
// V2 Individual Agent Detail Page - Redesigned layout with agent info, health, and executions

'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/v2/ui/card'
import { V2Header } from '@/components/v2/V2Header'
import {
  ArrowLeft,
  Play,
  Pause,
  Edit,
  Trash2,
  Calendar,
  Activity,
  Clock,
  CheckCircle,
  AlertCircle,
  Bot,
  Copy,
  Check,
  Loader2,
  TrendingUp,
  XCircle,
  Zap,
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  FlaskConical,
  Rocket,
  Brain
} from 'lucide-react'
import {
  SiGmail,
  SiSlack,
  SiNotion,
  SiGoogledrive,
  SiGooglecalendar,
  SiGoogledocs,
  SiGooglesheets,
  SiGithub,
  SiHubspot,
  SiWhatsapp
} from 'react-icons/si'
import { Mail, Phone, Cloud, Database, Globe, Puzzle } from 'lucide-react'
import { AgentIntensityCardV2 } from '@/components/v2/agents/AgentIntensityCardV2'
import { AgentHealthCardV2 } from '@/components/v2/agents/AgentHealthCardV2'
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter'

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  mode?: string
  schedule_cron?: string
  timezone?: string
  next_run?: string
  created_at?: string
  plugins_required?: string[]
  connected_plugins?: Record<string, any>
  input_schema?: any[]
  output_schema?: any[]
  user_prompt?: string
  workflow_steps?: any[]
}

type Execution = {
  id: string
  status: string
  started_at: string
  completed_at?: string
  execution_duration_ms?: number
  error_message?: string
  output?: any
  logs?: {
    tokensUsed?: {
      total: number
      prompt: number
      completion: number
    }
    pilot?: boolean
    agentkit?: boolean
    model?: string
    provider?: string
    iterations?: number
    toolCalls?: any[]
    executionId?: string
    stepsCompleted?: number
    stepsFailed?: number
    stepsSkipped?: number
    totalSteps?: number
    inputValuesUsed?: number
  }
}

// Helper function to get plugin-specific icon (using real brand logos with brand colors)
const getPluginIcon = (pluginName: string) => {
  const name = pluginName.toLowerCase()
  // Use brand colors for recognizable logos
  if (name.includes('gmail') || name.includes('google-mail')) return <SiGmail className="w-4 h-4 text-red-500" />
  if (name.includes('calendar')) return <SiGooglecalendar className="w-4 h-4 text-blue-500" />
  if (name.includes('drive')) return <SiGoogledrive className="w-4 h-4 text-green-500" />
  if (name.includes('docs') || name.includes('document')) return <SiGoogledocs className="w-4 h-4 text-blue-600" />
  if (name.includes('sheets') || name.includes('excel')) return <SiGooglesheets className="w-4 h-4 text-emerald-500" />
  if (name.includes('github')) return <SiGithub className="w-4 h-4 text-gray-900 dark:text-white" />
  if (name.includes('slack')) return <SiSlack className="w-4 h-4 text-[#4A154B]" />
  if (name.includes('hubspot') || name.includes('crm')) return <SiHubspot className="w-4 h-4 text-orange-500" />
  if (name.includes('notion')) return <SiNotion className="w-4 h-4 text-gray-900 dark:text-white" />
  if (name.includes('whatsapp')) return <SiWhatsapp className="w-4 h-4 text-green-500" />
  if (name.includes('outlook') || name.includes('microsoft')) return <Mail className="w-4 h-4 text-blue-600" />
  if (name.includes('twilio') || name.includes('phone')) return <Phone className="w-4 h-4 text-red-600" />
  if (name.includes('aws') || name.includes('cloud')) return <Cloud className="w-4 h-4 text-orange-500" />
  if (name.includes('azure')) return <Cloud className="w-4 h-4 text-blue-600" />
  if (name.includes('database') || name.includes('db')) return <Database className="w-4 h-4 text-indigo-500" />
  if (name.includes('web') || name.includes('http')) return <Globe className="w-4 h-4 text-teal-500" />
  return <Puzzle className="w-4 h-4 text-[var(--v2-primary)]" />
}

export default function V2AgentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user, connectedPlugins } = useAuth()
  const agentId = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [executions, setExecutions] = useState<Execution[]>([])
  const [allExecutions, setAllExecutions] = useState<Execution[]>([])
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [activeTab, setActiveTab] = useState<'results' | 'analytics'>('results')
  const [executionPage, setExecutionPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [memoryCount, setMemoryCount] = useState(0)
  const EXECUTIONS_PER_PAGE = 10

  useEffect(() => {
    if (user && agentId) {
      fetchAgentData()
    }
  }, [user, agentId])

  const fetchMemoryCount = async () => {
    if (!agentId) return

    try {
      const { count, error } = await supabase
        .from('run_memories')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId)

      if (!error && count !== null) {
        setMemoryCount(count)
      }
    } catch (error) {
      console.error('Error fetching memory count:', error)
    }
  }

  const fetchAgentData = async () => {
    if (!user || !agentId) return

    setLoading(true)
    try {
      // Fetch agent details
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('*, connected_plugins, plugins_required')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .single()

      if (agentError) throw agentError
      setAgent(agentData)

      // Fetch ALL executions for health score calculation
      const { data: allExecutionsData, error: allExecutionsError } = await supabase
        .from('agent_executions')
        .select('*')
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false })

      if (allExecutionsError) {
        console.error('Error fetching all executions:', allExecutionsError)
      }

      if (allExecutionsData) {
        console.log(`[V2 Agent Page] Fetched ${allExecutionsData.length} executions for agent ${agentId}`);

        // Enrich executions with token data from token_usage table when logs are missing
        const enrichedExecutions = await Promise.all(
          allExecutionsData.map(async (execution) => {
            // Check if logs have complete token data
            const hasCompleteTokenData =
              execution.logs?.tokensUsed?.total &&
              execution.logs?.tokensUsed?.prompt &&
              execution.logs?.tokensUsed?.completion;

            console.log(`[V2 Agent Page] Execution ${execution.id}:`, {
              hasCompleteTokenData,
              logsTokenData: execution.logs?.tokensUsed,
              status: execution.status,
              started_at: execution.started_at
            });

            if (!hasCompleteTokenData) {
              console.log(`[V2 Agent Page] Execution ${execution.id} missing token data in logs, fetching from token_usage table...`);

              // Fetch ALL token data records for this execution (classification, steps, memory, etc.)
              const { data: tokenDataRecords, error: tokenError } = await supabase
                .from('token_usage')
                .select('input_tokens, output_tokens, activity_type')
                .eq('execution_id', execution.id);

              console.log(`[V2 Agent Page] Token usage query result for execution ${execution.id}:`, {
                found: !!tokenDataRecords,
                count: tokenDataRecords?.length || 0,
                error: tokenError,
                records: tokenDataRecords
              });

              if (!tokenError && tokenDataRecords && tokenDataRecords.length > 0) {
                // Sum ALL token records for this execution (classification + steps + memory)
                const inputTokens = tokenDataRecords.reduce((sum, record) => sum + (record.input_tokens || 0), 0);
                const outputTokens = tokenDataRecords.reduce((sum, record) => sum + (record.output_tokens || 0), 0);
                const totalTokens = inputTokens + outputTokens;

                console.log(`[V2 Agent Page] ✅ Enriched execution ${execution.id} with token data (${tokenDataRecords.length} records):`, {
                  input: inputTokens,
                  output: outputTokens,
                  total: totalTokens,
                  source: 'token_usage_table_summed'
                });

                return {
                  ...execution,
                  logs: {
                    ...(execution.logs || {}),
                    tokensUsed: {
                      prompt: inputTokens,
                      completion: outputTokens,
                      total: totalTokens,
                      _source: 'token_usage_table_summed' // Debug flag
                    }
                  }
                };
              } else {
                console.warn(`[V2 Agent Page] ⚠️ No token data found for execution ${execution.id} in either logs or token_usage table`);
              }
            } else {
              console.log(`[V2 Agent Page] ✅ Execution ${execution.id} has complete token data in logs:`, execution.logs.tokensUsed);
            }

            return execution;
          })
        );

        console.log(`[V2 Agent Page] Enrichment complete. Summary:`, {
          totalExecutions: enrichedExecutions.length,
          withTokenData: enrichedExecutions.filter(e => e.logs?.tokensUsed?.total).length,
          withoutTokenData: enrichedExecutions.filter(e => !e.logs?.tokensUsed?.total).length
        });

        setAllExecutions(enrichedExecutions)

        // Set all executions for paginated display
        setExecutions(enrichedExecutions)

        // Set first execution as selected by default
        if (enrichedExecutions.length > 0) {
          setSelectedExecution(enrichedExecutions[0])
        }
      }

      // Fetch memory count (non-blocking)
      fetchMemoryCount()
    } catch (error) {
      console.error('Error fetching agent data:', error)
      router.push('/v2/agent-list')
    } finally {
      setLoading(false)
    }
  }

  const handleRunAgent = async () => {
    if (!agent) return

    setExecuting(true)
    try {
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id })
      })

      if (response.ok) {
        // Refresh executions after running
        await fetchAgentData()
      }
    } catch (error) {
      console.error('Error running agent:', error)
    } finally {
      setExecuting(false)
    }
  }

  const handleToggleStatus = async () => {
    if (!agent) return

    const newStatus = agent.status === 'active' ? 'inactive' : 'active'

    try {
      const { error } = await supabase
        .from('agents')
        .update({ status: newStatus })
        .eq('id', agent.id)

      if (!error) {
        setAgent({ ...agent, status: newStatus })
      }
    } catch (error) {
      console.error('Error toggling status:', error)
    }
  }

  const copyAgentId = () => {
    navigator.clipboard.writeText(agent?.id || '')
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const getPluginStatus = (plugin: string) => {
    if (!connectedPlugins) return false
    return !!connectedPlugins[plugin]
  }

  const calculateHealthScore = () => {
    if (allExecutions.length === 0) return { score: 0, maxScore: 0, percentage: 0, recentScore: 0, recentMaxScore: 0, failedCount: 0 }

    // Calculate overall success rate from ALL executions
    const totalSuccessCount = allExecutions.filter(e =>
      e.status === 'completed' || e.status === 'success'
    ).length
    const totalPercentage = (totalSuccessCount / allExecutions.length) * 100

    // Calculate failed count
    const failedCount = allExecutions.filter(e =>
      e.status === 'failed' || e.status === 'error'
    ).length

    // Calculate recent (last 5) success rate for context
    const recentExecutions = allExecutions.slice(0, 5)
    const recentSuccessCount = recentExecutions.filter(e =>
      e.status === 'completed' || e.status === 'success'
    ).length

    return {
      score: totalSuccessCount,
      maxScore: allExecutions.length,
      percentage: totalPercentage,
      recentScore: recentSuccessCount,
      recentMaxScore: recentExecutions.length,
      failedCount
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const handleExportConfiguration = () => {
    if (!agent) return

    const exportData = {
      agent_name: agent.agent_name,
      description: agent.description,
      plugins_required: agent.plugins_required,
      mode: agent.mode,
      schedule_cron: agent.schedule_cron,
      timezone: agent.timezone,
      created_at: agent.created_at,
      exported_at: new Date().toISOString(),
      export_version: "2.0"
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.agent_name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_config.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleDuplicateAgent = async () => {
    if (!agent || !user) return

    setActionLoading('duplicate')
    try {
      const { data: newAgent, error } = await supabase
        .from('agents')
        .insert([{
          user_id: user.id,
          agent_name: `${agent.agent_name} (Copy)`,
          description: agent.description,
          connected_plugins: agent.connected_plugins,
          plugins_required: agent.plugins_required,
          mode: agent.mode,
          schedule_cron: agent.schedule_cron,
          timezone: agent.timezone,
          status: 'draft'
        }])
        .select()
        .single()

      if (error) {
        console.error('Error duplicating agent:', error)
        return
      }

      if (newAgent) {
        router.push(`/v2/agents/${newAgent.id}`)
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteAgent = async () => {
    if (!agent || !user) return

    setActionLoading('delete')
    try {
      const { error } = await supabase
        .from('agents')
        .delete()
        .eq('id', agentId)
        .eq('user_id', user.id)

      if (error) {
        console.error('Error deleting agent:', error)
        return
      }

      router.push('/v2/agent-list')
    } finally {
      setActionLoading(null)
      setShowDeleteConfirm(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
      default:
        return <Clock className="w-4 h-4 text-[var(--v2-text-muted)]" />
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  if (!agent) {
    return null
  }

  const health = calculateHealthScore()
  const safePluginsRequired = Array.isArray(agent.plugins_required) ? agent.plugins_required : []

  return (
<<<<<<< Updated upstream
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Top Bar: Back Button + User Menu */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/agent-list')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </button>
        <V2Header />
=======
    <div className="min-h-screen" style={{ background: 'var(--v2-background)' }}>
      {/* PERFORMANCE: Lazy load tour component with Suspense */}
      <Suspense fallback={null}>
        <DraftAgentTour
          agentId={agent.id}
          agentName={agent.agent_name}
          agentStatus={agent.status}
          productionReady={agent.production_ready ?? false}
        />
      </Suspense>

      <div className="max-w-[1400px] mx-auto p-4">
        {/* Logo */}
        <div className="mb-3">
          <V2Logo />
        </div>

        {/* Back Button + Controls */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => router.push('/v2/agent-list')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agents
          </button>
          <V2Controls />
        </div>

        {/* Header Section with Health Bar */}
        <Card className="!p-5 mb-4">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
              <Bot className="w-9 h-9 text-[#10B981] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-semibold text-[var(--v2-text-primary)] mb-1">
                  {agent.agent_name}
                </h1>
                <p className="text-[var(--v2-text-secondary)] text-sm">
                  {agent.description || 'No description'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
              <div
                data-tour="status-badge"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm ${
                  agent.status === 'active'
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-700'
                    : agent.status === 'draft'
                    ? 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-200 dark:border-amber-700'
                    : 'bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-900/20 dark:to-slate-900/20 border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${
                  agent.status === 'active' ? 'bg-green-500' : agent.status === 'draft' ? 'bg-amber-500' : 'bg-gray-400'
                }`}></div>
                <span className={`font-semibold text-sm ${
                  agent.status === 'active'
                    ? 'text-green-700 dark:text-green-300'
                    : agent.status === 'draft'
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-gray-700 dark:text-gray-300'
                }`}>
                  {agent.status === 'active' ? 'Active' : agent.status === 'draft' ? 'Draft' : 'Inactive'}
                </span>
              </div>
              {memoryCount > 0 && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-700 shadow-sm">
                  <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <span className="font-semibold text-purple-700 dark:text-purple-300 text-sm">
                    Learning Active
                  </span>
                </div>
              )}
              {(totalExecutionCount > 0 || allExecutions.length > 0) && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 border border-blue-200 dark:border-blue-700 shadow-sm">
                  <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="font-semibold text-blue-700 dark:text-blue-300 text-sm">
                    {totalExecutionCount || allExecutions.length} {(totalExecutionCount || allExecutions.length) === 1 ? 'Run' : 'Runs'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Health Bar */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-medium text-[var(--v2-text-secondary)]">System Health</span>
              <span className={`text-xs font-semibold ${
                health.percentage >= 80 ? 'text-green-600 dark:text-green-400' :
                health.percentage >= 60 ? 'text-yellow-600 dark:text-yellow-400' :
                'text-red-600 dark:text-red-400'
              }`}>
                {health.percentage.toFixed(0)}% Healthy
              </span>
            </div>
            <div className="w-full h-1.5 bg-[var(--v2-border)] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${getHealthColor()}`}
                style={{ width: `${health.percentage}%` }}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => router.push(`/v2/agents/${agent.id}/run`)}
              disabled={agent.status !== 'active'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={agent.status !== 'active' ? 'Agent must be activated before running' : 'Run this agent'}
            >
              <Play className="w-4 h-4" />
              Run Now
            </button>
            <button
              data-tour="edit-button"
              onClick={() => setShowSettingsDrawer(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            {!agent.production_ready && (
              <button
                onClick={handleSandboxClick}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Gauge className="w-4 h-4" />
                Calibrate
              </button>
            )}
          </div>
        </Card>

        {/* Insights Banner - Shows when there are any insights */}
        {(() => {
          if (insights.length === 0) return null

          const highSeverityInsights = insights.filter((i: any) =>
            i.severity === 'high' || i.severity === 'critical'
          )
          const lowSeverityInsights = insights.filter((i: any) =>
            i.severity === 'low' || i.severity === 'medium'
          )

          const isCritical = highSeverityInsights.some((i: any) => i.severity === 'critical')
          const isHighSeverity = highSeverityInsights.length > 0

          // Determine banner style based on highest severity
          const bannerStyle = isCritical
            ? 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 border-red-500'
            : isHighSeverity
            ? 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-500'
            : 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-500'

          return (
            <div className={`rounded-lg p-3 mb-4 flex items-center justify-between shadow-sm border-l-4 ${bannerStyle}`}>
              <div className="flex items-center gap-3">
                {isCritical ? (
                  <AlertOctagon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                ) : isHighSeverity ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                ) : (
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <div>
                  <h3 className={`text-sm font-semibold mb-0.5 ${
                    isCritical
                      ? 'text-red-900 dark:text-red-200'
                      : isHighSeverity
                      ? 'text-amber-900 dark:text-amber-200'
                      : 'text-blue-900 dark:text-blue-200'
                  }`}>
                    {insights.length} {insights.length === 1 ? 'Insight Available' : 'Insights Available'}
                  </h3>
                  <p className={`text-xs ${
                    isCritical
                      ? 'text-red-800 dark:text-red-300'
                      : isHighSeverity
                      ? 'text-amber-800 dark:text-amber-300'
                      : 'text-blue-800 dark:text-blue-300'
                  }`}>
                    {isCritical
                      ? 'Critical issues detected that require immediate action'
                      : isHighSeverity
                      ? 'Issues detected that may need attention'
                      : 'Business insights and performance updates available'
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowInsightsModal(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity font-medium text-xs flex-shrink-0"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                View Insights
              </button>
            </div>
          )
        })()}

        {/* Main 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-3">
          {/* Left Column - Execution Timeline */}
          <Card className="!p-3 flex flex-col">
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <h2 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                  Recent Activity
                </h2>
                <div className="flex items-center gap-2">
                  {/* Time filter dropdown */}
                  <div className="relative time-filter-dropdown">
                    <button
                      onClick={() => setShowTimeFilterDropdown(!showTimeFilterDropdown)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {executionTimeFilter === '7days' && 'Last 7 days'}
                      {executionTimeFilter === '30days' && 'Last 30 days'}
                      {executionTimeFilter === 'all' && 'All time'}
                      <ChevronDown className="w-3 h-3" />
                    </button>

                    {/* Dropdown menu */}
                    {showTimeFilterDropdown && (
                      <div className="absolute top-full mt-1 right-0 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-10 min-w-[140px]"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <button
                          onClick={() => {
                            setExecutionTimeFilter('7days')
                            setExecutionPage(1)
                            setShowTimeFilterDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                            executionTimeFilter === '7days'
                              ? 'bg-[var(--v2-primary)] text-white'
                              : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                          }`}
                        >
                          Last 7 days
                        </button>
                        <button
                          onClick={() => {
                            setExecutionTimeFilter('30days')
                            setExecutionPage(1)
                            setShowTimeFilterDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                            executionTimeFilter === '30days'
                              ? 'bg-[var(--v2-primary)] text-white'
                              : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                          }`}
                        >
                          Last 30 days
                        </button>
                        <button
                          onClick={() => {
                            setExecutionTimeFilter('all')
                            setExecutionPage(1)
                            setShowTimeFilterDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors ${
                            executionTimeFilter === 'all'
                              ? 'bg-[var(--v2-primary)] text-white'
                              : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
                          }`}
                        >
                          All time
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="p-2 hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Refresh executions"
                  >
                    <RefreshCw className={`w-4 h-4 text-[var(--v2-text-muted)] ${loading ? 'animate-spin' : ''}`} />
                  </button>
                  <TrendingUp className="w-5 h-5 text-[var(--v2-text-muted)]" />
                </div>
              </div>
            </div>

            <div className="space-y-2 flex-1">
              {(() => {
                // Filter executions by time range
                const now = new Date()
                const filteredExecutions = executions.filter(exec => {
                  if (executionTimeFilter === 'all') return true

                  const executionDate = new Date(exec.started_at)
                  const daysDiff = Math.floor((now.getTime() - executionDate.getTime()) / (1000 * 60 * 60 * 24))

                  if (executionTimeFilter === '7days') return daysDiff <= 7
                  if (executionTimeFilter === '30days') return daysDiff <= 30
                  return true
                })

                const totalPages = Math.ceil(filteredExecutions.length / EXECUTIONS_PER_PAGE)
                const startIndex = (executionPage - 1) * EXECUTIONS_PER_PAGE
                const endIndex = startIndex + EXECUTIONS_PER_PAGE
                const paginatedExecutions = filteredExecutions.slice(startIndex, endIndex)

                return (
                  <>
                    {paginatedExecutions.map((exec) => (
                      <button
                        key={exec.id}
                        onClick={() => {
                          console.log('[onClick] Execution selected:', {
                            id: exec.id,
                            isPilot: exec.logs?.pilot,
                            hasLogs: !!exec.logs
                          })
                          setSelectedExecution(exec)
                          // Fetch execution_results for Pilot executions
                          if (exec.logs?.pilot) {
                            console.log('[onClick] This is a Pilot execution, fetching results...')
                            fetchExecutionResults(exec.id)
                          } else {
                            console.log('[onClick] Not a Pilot execution, clearing results')
                            setExecutionResults(null)
                          }
                        }}
                        className={`w-full p-2 transition-all text-left border-2 ${
                          selectedExecution?.id === exec.id
                            ? 'border-[var(--v2-primary)]'
                            : 'bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] border-transparent'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <span className="text-xs text-[var(--v2-text-muted)]">
                            {formatDate(exec.started_at)}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            exec.status === 'completed' || exec.status === 'success'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {exec.status === 'completed' || exec.status === 'success' ? '✓ Success' : '✗ Failed'}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[var(--v2-text-primary)] mb-0.5 line-clamp-1">
                          Run #{exec.id.slice(0, 8)}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)]">
                          <span>⏱ {formatDuration(exec.execution_duration_ms ?? undefined)}</span>
                        </div>
                      </button>
                    ))}

                    {filteredExecutions.length === 0 && (
                      <div className="text-center py-12 text-sm text-[var(--v2-text-muted)]">
                        No executions found for this time range
                      </div>
                    )}

                    {totalPages > 1 && (
                      <div className="pt-3 border-t border-[var(--v2-border)] space-y-2">
                        {/* Showing X-Y of Z text */}
                        <div className="text-xs text-[var(--v2-text-muted)] text-center">
                          Showing {startIndex + 1}-{Math.min(endIndex, filteredExecutions.length)} of {filteredExecutions.length} executions
                        </div>

                        {/* Pagination controls */}
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setExecutionPage(prev => Math.max(1, prev - 1))}
                            disabled={executionPage === 1}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-[var(--v2-surface)] border border-[var(--v2-border)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <ChevronLeft className="w-3 h-3" />
                            Previous
                          </button>

                          {/* Page number buttons */}
                          <div className="flex items-center gap-1">
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                              <button
                                key={page}
                                onClick={() => setExecutionPage(page)}
                                className={`px-2.5 py-1.5 text-xs font-medium transition-all ${
                                  executionPage === page
                                    ? 'bg-[var(--v2-primary)] text-white'
                                    : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)]'
                                }`}
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {page}
                              </button>
                            ))}
                          </div>

                          <button
                            onClick={() => setExecutionPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={executionPage === totalPages}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-[var(--v2-surface)] border border-[var(--v2-border)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            Next
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </Card>

          {/* Right Column - Execution Details */}
          <Card className="!p-3 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                Latest Execution
              </h2>
              {/* Smart Pilot Badge */}
              {selectedExecution && (selectedExecution.logs?.pilot || selectedExecution.logs?.agentkit) && (
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                  selectedExecution.logs.pilot
                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                }`}>
                  {selectedExecution.logs.pilot ? 'Smart Pilot' : 'AgentKit'}
                </span>
              )}
            </div>

            {selectedExecution ? (
              <div className="space-y-3">
                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Duration</div>
                    <div className="text-xl font-semibold text-[var(--v2-text-primary)]">
                      {formatDuration(selectedExecution.execution_duration_ms ?? undefined)}
                    </div>
                  </div>
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">
                      {selectedExecution.logs?.pilot ? 'Steps' : 'Status'}
                    </div>
                    <div className="text-xl font-semibold text-[var(--v2-text-primary)] capitalize">
                      {selectedExecution.logs?.pilot
                        ? (() => {
                            const completed = selectedExecution.logs.stepsCompleted || 0
                            const failed = selectedExecution.logs.stepsFailed || 0
                            const skipped = selectedExecution.logs.stepsSkipped || 0
                            const total = selectedExecution.logs.totalSteps || (completed + failed + skipped)
                            return `${completed}/${total}`
                          })()
                        : selectedExecution.status}
                    </div>
                  </div>
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-2">
                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wide mb-1">Pilot Credits</div>
                    <div className="text-xl font-semibold text-[var(--v2-text-primary)]">
                      {(() => {
                        const adjusted = selectedExecution.logs?.tokensUsed?.adjusted
                        const total = selectedExecution.logs?.tokensUsed?.total
                        const llmTokens = adjusted || total || 0
                        const pilotTokens = Math.ceil(llmTokens / tokensPerPilotCredit)
                        return pilotTokens.toLocaleString()
                      })()}
                    </div>
                  </div>
                </div>


                {/* Execution Details - Timeline Card */}
                <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-3">
                  {/* Timeline */}
                  <div>
                    <div className="text-xs font-medium text-[var(--v2-text-muted)] mb-2">Timeline</div>
                    <div className="relative">
                      {/* Timeline events */}
                      <div className="flex justify-between items-start relative">
                        {/* Horizontal line - positioned to connect the dots */}
                        {selectedExecution.completed_at && (
                          <div className="absolute left-[6.75px] right-[6.75px] top-[6.75px] h-0.5 bg-gradient-to-r from-blue-600 via-blue-400 to-green-600 dark:from-blue-400 dark:via-blue-300 dark:to-green-400"></div>
                        )}

                        {/* Started event */}
                        <div className="relative flex flex-col items-center gap-1 text-xs">
                          <div className="w-3.5 h-3.5 rounded-full bg-blue-600 dark:bg-blue-400 border-2 border-white dark:border-slate-900 z-10"></div>
                          <div className="text-center mt-1">
                            <div className="text-[var(--v2-text-muted)]">Started</div>
                            <div className="text-[var(--v2-text-primary)] font-medium">
                              {new Date(selectedExecution.started_at).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>

                        {/* Completed event */}
                        {selectedExecution.completed_at && (
                          <div className="relative flex flex-col items-center gap-1 text-xs">
                            <div className="w-3.5 h-3.5 rounded-full bg-green-600 dark:bg-green-400 border-2 border-white dark:border-slate-900 z-10"></div>
                            <div className="text-center mt-1">
                              <div className="text-[var(--v2-text-muted)]">Completed</div>
                              <div className="text-[var(--v2-text-primary)] font-medium">
                                {new Date(selectedExecution.completed_at).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Execution Summary - User-friendly metadata */}
                {((selectedExecution as any).output || (selectedExecution as any).final_output) && (
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-2">
                      📊 Execution Summary
                    </h4>
                    <div className="space-y-2">
                      {(() => {
                        const output = ((selectedExecution as any).output || (selectedExecution as any).final_output) as Record<string, any>
                        const summaryItems: Array<{ label: string; value: string | number; icon?: string }> = []

                        // Parse output by steps
                        Object.keys(output).forEach(stepKey => {
                          const stepData = output[stepKey]

                          if (stepData && typeof stepData === 'object') {
                            // Check each field in the step data
                            Object.keys(stepData).forEach(key => {
                              const value = stepData[key]

                              // Handle sanitized metadata format (new format after privacy fix)
                              if (value && typeof value === 'object' && 'count' in value && value.type === 'array') {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label: `${label} processed`,
                                  value: value.count,
                                  icon: '📝'
                                })
                              }
                              // Legacy format: actual arrays (for backward compatibility)
                              else if (Array.isArray(value)) {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label: `${label} processed`,
                                  value: value.length,
                                  icon: '📝'
                                })
                              }
                              // Numbers
                              else if (typeof value === 'number') {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label,
                                  value,
                                  icon: '🔢'
                                })
                              }
                              // Short strings
                              else if (typeof value === 'string' && value.length < 100) {
                                const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
                                summaryItems.push({
                                  label,
                                  value,
                                  icon: '📄'
                                })
                              }
                            })
                          }
                        })

                        if (summaryItems.length === 0) {
                          return (
                            <p className="text-xs text-[var(--v2-text-muted)]">
                              No summary data available
                            </p>
                          )
                        }

                        return summaryItems.slice(0, 5).map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs">
                            <span className="text-[var(--v2-text-muted)] flex items-center gap-1.5">
                              <span>{item.icon}</span>
                              {item.label}:
                            </span>
                            <span className="text-[var(--v2-text-primary)] font-semibold">
                              {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                            </span>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>
                )}

                {/* Execution Results - Enhanced with Business Context */}
                <div>
                  <h3 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-2">
                    What Happened
                  </h3>

                  {executionResults ? (
                    <div className="space-y-2">
                      {(() => {
                        // Get meaningful operations (non-system steps)
                        const meaningfulOps = executionResults.items.filter((item: any) =>
                          item.plugin !== 'system'
                        )

                        // If no meaningful operations, show generic success message
                        if (meaningfulOps.length === 0) {
                          return (
                            <div
                              className="p-2 border border-[var(--v2-border)]"
                              style={{
                                background: 'linear-gradient(135deg, var(--v2-surface) 0%, var(--v2-surface-hover) 100%)',
                                borderRadius: 'var(--v2-radius-card)'
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                <p className="text-xs text-[var(--v2-text-primary)]">
                                  Workflow completed successfully
                                </p>
                              </div>
                            </div>
                          )
                        }

                        // Get icon based on plugin type
                        const getIconComponent = (plugin: string) => {
                          if (plugin === 'google-mail') return Mail
                          if (plugin === 'google-sheets') return Database
                          if (plugin === 'google-drive') return Cloud
                          if (plugin === 'quickbooks') return Database
                          if (plugin === 'airtable') return Database
                          if (plugin === 'anthropic') return Brain
                          return Settings
                        }

                        // Enhanced description with business context
                        const getEnhancedDescription = (item: any) => {
                          // Use the friendlyMessage as base
                          const baseMessage = item.friendlyMessage ||
                            (item.itemCount > 0
                              ? `Processed ${item.itemCount} ${item.itemCount === 1 ? 'item' : 'items'}`
                              : 'Completed')

                          // Add field context if available (what kind of data)
                          if (item.sampleKeys && item.sampleKeys.length > 0) {
                            const keyHints = item.sampleKeys.slice(0, 3)
                            const hasUrgent = keyHints.some((k: string) =>
                              k.toLowerCase().includes('urgent') ||
                              k.toLowerCase().includes('priority')
                            )
                            const hasStatus = keyHints.some((k: string) =>
                              k.toLowerCase().includes('status')
                            )

                            // Add context badges
                            let context = ''
                            if (hasUrgent && item.itemCount > 0) {
                              context = ' (including priority items)'
                            } else if (hasStatus) {
                              context = ' with status tracking'
                            }

                            return baseMessage + context
                          }

                          return baseMessage
                        }

                        // Only show first (input) and last (output) operations if there are multiple
                        const opsToShow = meaningfulOps.length > 2
                          ? [meaningfulOps[0], meaningfulOps[meaningfulOps.length - 1]]
                          : meaningfulOps

                        // Calculate total items processed for context
                        const totalItems = executionResults.totalItems || 0

                        return (
                          <div className="space-y-2">
                            {/* Business Story - Step by Step Flow */}
                            {meaningfulOps.length > 0 && (
                              <div className="p-3 bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg">
                                <div className="space-y-2.5">
                                  {/* Show complete workflow story */}
                                  {meaningfulOps.map((op: any, idx: number) => {
                                    const IconComponent = getIconComponent(op.plugin)
                                    const isLast = idx === meaningfulOps.length - 1

                                    return (
                                      <div key={idx} className="flex items-center gap-3">
                                        {/* Step number badge */}
                                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center">
                                          <span className="text-[10px] font-semibold text-[var(--v2-text-muted)]">{idx + 1}</span>
                                        </div>

                                        {/* Plugin icon */}
                                        <div className="flex-shrink-0 w-6 h-6 rounded bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center">
                                          <IconComponent className="w-3 h-3 text-[var(--v2-text-muted)]" />
                                        </div>

                                        {/* Count and description */}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-baseline gap-2">
                                            <span className={`font-bold ${isLast ? 'text-[var(--v2-primary)]' : 'text-[var(--v2-text-primary)]'}`}>
                                              {op.itemCount}
                                            </span>
                                            <span className="text-xs text-[var(--v2-text-secondary)] truncate">
                                              {getEnhancedDescription(op)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}

                                  {/* Execution time footer */}
                                  {executionResults.metadata?.executionTime && (
                                    <div className="pt-2 mt-2 border-t border-[var(--v2-border)] flex items-center gap-2">
                                      <Clock className="w-3 h-3 text-[var(--v2-text-muted)]" />
                                      <p className="text-xs text-[var(--v2-text-muted)]">
                                        {(executionResults.metadata.executionTime / 1000).toFixed(1)}s total
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  ) : (
                    // Fallback to showing logs for non-Pilot or old executions
                    <div className="bg-slate-900 dark:bg-black rounded-lg p-3 max-h-96 overflow-y-auto font-mono text-xs">
                      {(() => {
                        const hasOutput = selectedExecution.output
                        const hasLogs = selectedExecution.logs
                        const hasError = selectedExecution.error_message

                        if (hasOutput) {
                          return (
                            <pre className="text-gray-300 whitespace-pre-wrap break-words">
                              {JSON.stringify(selectedExecution.output, null, 2)}
                            </pre>
                          )
                        }

                        if (hasLogs) {
                          return (
                            <pre className="text-gray-300 whitespace-pre-wrap break-words">
                              {JSON.stringify(selectedExecution.logs, null, 2)}
                            </pre>
                          )
                        }

                        if (hasError) {
                          return (
                            <div className="text-red-400">
                              Error: {String(selectedExecution.error_message)}
                            </div>
                          )
                        }

                        return <div className="text-gray-500">No execution results available</div>
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Clock className="w-16 h-16 text-[var(--v2-text-muted)] opacity-20 mb-4" />
                <p className="text-[var(--v2-text-muted)]">
                  Select an execution to view details
                </p>
              </div>
            )}
          </Card>
        </div>
>>>>>>> Stashed changes
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6 lg:grid-rows-[auto_auto]">
        {/* Left Column */}
        <div className="space-y-4 sm:space-y-5 lg:col-span-1 lg:row-span-2">
          {/* Agent Info Card */}
          <Card className="!p-4 sm:!p-6">
            <div className="flex items-center gap-3 mb-4">
              <Bot className="w-7 h-7 sm:w-8 sm:h-8 text-[#10B981]" />
              <div className="flex-1">
                <h2 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  {agent.agent_name}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)]">
                  {agent.mode === 'scheduled' ? 'Scheduled Agent' : 'On-Demand Agent'}
                </p>
                {memoryCount > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-700 shadow-sm mt-2">
                    <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    <span className="font-semibold text-purple-700 dark:text-purple-300 text-xs">
                      Learning Active
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Agent ID with Copy */}
            <div className="mb-4">
              <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-1 block">
                Agent ID
              </label>
              <div className="flex items-center gap-2 p-2 bg-[var(--v2-surface)] rounded-lg" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <code className="text-xs text-[var(--v2-text-primary)] flex-1 truncate">
                  {agent.id}
                </code>
                <button
                  onClick={copyAgentId}
                  className="p-1.5 hover:bg-[var(--v2-surface-hover)] transition-colors"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {copiedId ? (
                    <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  )}
                </button>
              </div>
            </div>

            {/* Created Date */}
            {agent.created_at && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-1 block">
                  Created
                </label>
                <p className="text-sm text-[var(--v2-text-primary)]">
                  {new Date(agent.created_at).toLocaleString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
            )}

            {/* Schedule */}
            <div className="mb-4">
              <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-1 block">
                Schedule
              </label>
              <p className="text-sm text-[var(--v2-text-primary)]">
                {formatScheduleDisplay(agent.mode || 'on_demand', agent.schedule_cron)}
              </p>
            </div>

            {/* Description */}
            {agent.description && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-1 block">
                  Description
                </label>
                <p className="text-sm text-[var(--v2-text-primary)]">
                  {agent.description}
                </p>
              </div>
            )}

            {/* Plugins */}
            <div>
              <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                Integrations ({safePluginsRequired.length})
              </label>
              {safePluginsRequired.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {safePluginsRequired.map(plugin => {
                    const isConnected = getPluginStatus(plugin)

                    return (
                      <div
                        key={plugin}
                        className="relative group"
                      >
                        {/* Plugin Icon with Status Badge */}
                        <div className="w-10 h-10 rounded-xl bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center shadow-sm transition-all duration-300 hover:scale-110 cursor-pointer">
                          {getPluginIcon(plugin)}
                        </div>
                        {/* Status Badge Overlay */}
                        <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-[var(--v2-surface)] shadow-md flex items-center justify-center transition-all duration-300 ${
                          isConnected ? 'bg-green-600 dark:bg-green-500' : 'bg-red-600 dark:bg-red-500'
                        }`}>
                          {isConnected && (
                            <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--v2-text-muted)]">No integrations configured</p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-6 pt-6 border-t border-[var(--v2-border)] flex items-center gap-2 flex-wrap">
              {/* Launch/Pause */}
              <div className="relative group">
                <button
                  onClick={handleToggleStatus}
                  className={`flex items-center justify-center w-10 h-10 hover:scale-110 transition-all duration-200 border shadow-sm ${
                    agent.status === 'active'
                      ? 'bg-[var(--v2-surface)] border-[var(--v2-border)] text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 hover:border-orange-200 dark:hover:border-orange-800'
                      : 'bg-[var(--v2-surface)] border-[var(--v2-border)] text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-200 dark:hover:border-green-800'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {agent.status === 'active' ? <Pause className="w-4 h-4" /> : <Rocket className="w-4 h-4" />}
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {agent.status === 'active' ? 'Pause Agent' : 'Launch Agent'}
                </div>
              </div>

              {/* Run Agent */}
              <div className="relative group">
                <button
                  onClick={() => router.push(`/v2/agents/${agent.id}/run`)}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-200 dark:hover:border-purple-800 hover:scale-110 transition-all duration-200 shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Play className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Run Agent
                </div>
              </div>

              {/* Edit */}
              <div className="relative group">
                <button
                  onClick={() => router.push(`/agents/${agent.id}/edit`)}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 hover:scale-110 transition-all duration-200 shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Edit className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Edit Agent
                </div>
              </div>

              {/* Export */}
              <div className="relative group">
                <button
                  onClick={handleExportConfiguration}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-200 dark:hover:border-emerald-800 hover:scale-110 transition-all duration-200 shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Download className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Export Config
                </div>
              </div>

              {/* Duplicate */}
              <div className="relative group">
                <button
                  onClick={handleDuplicateAgent}
                  disabled={actionLoading === 'duplicate'}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/20 hover:border-slate-200 dark:hover:border-slate-800 hover:scale-110 transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {actionLoading === 'duplicate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {actionLoading === 'duplicate' ? 'Duplicating...' : 'Duplicate Agent'}
                </div>
              </div>

              {/* Share */}
              <div className="relative group">
                <button
                  disabled={agent.status !== 'active'}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-800 hover:scale-110 transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {agent.status !== 'active' ? 'Activate to share' : 'Share Agent'}
                </div>
              </div>

              {/* Delete */}
              <div className="relative group">
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 hover:scale-110 transition-all duration-200 shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Delete Agent
                </div>
              </div>
            </div>
          </Card>

          {/* AIS Complexity Card */}
          <Card className="!p-4 sm:!p-6">
            <AgentIntensityCardV2 agentId={agentId} />
          </Card>
        </div>

        {/* Middle Column - Execution History */}
        <Card className="!p-4 sm:!p-6 flex flex-col lg:row-span-2" data-section="execution-history">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
              Execution History
            </h3>
            <TrendingUp className="w-5 h-5 text-[var(--v2-text-muted)]" />
          </div>

          {/* Agent Health Display */}
          <div className="mb-6">
            <AgentHealthCardV2
              score={health.score}
              maxScore={health.maxScore}
              percentage={health.percentage}
              totalRuns={allExecutions.length}
              status={agent.status}
              recentScore={health.recentScore}
              recentMaxScore={health.recentMaxScore}
              failedCount={health.failedCount}
            />
          </div>

          {/* Execution List */}
          <div className="space-y-2">
            {(() => {
              const totalPages = Math.ceil(executions.length / EXECUTIONS_PER_PAGE)
              const startIndex = (executionPage - 1) * EXECUTIONS_PER_PAGE
              const endIndex = startIndex + EXECUTIONS_PER_PAGE
              const paginatedExecutions = executions.slice(startIndex, endIndex)

              return (
                <>
                  {paginatedExecutions.map((exec) => (
                    <button
                      key={exec.id}
                      onClick={() => setSelectedExecution(exec)}
                      className={`w-full flex items-center justify-between p-3 transition-all text-left ${
                        selectedExecution?.id === exec.id
                          ? 'bg-[var(--v2-surface-hover)] border border-[var(--v2-border)]'
                          : 'bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {getStatusIcon(exec.status)}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-[var(--v2-text-primary)] truncate">
                            Run #{exec.id.slice(0, 8)}
                          </div>
                          <div className="text-xs text-[var(--v2-text-muted)]">
                            {formatDate(exec.started_at)}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs font-medium text-[var(--v2-text-muted)]">
                        {formatDuration(exec.execution_duration_ms)}
                      </div>
                    </button>
                  ))}

                  {executions.length === 0 && (
                    <div className="text-center py-8 text-sm text-[var(--v2-text-muted)]">
                      No executions yet
                    </div>
                  )}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-4 border-t border-[var(--v2-border)]">
                      <button
                        onClick={() => setExecutionPage(prev => Math.max(1, prev - 1))}
                        disabled={executionPage === 1}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Previous
                      </button>
                      <span className="text-xs text-[var(--v2-text-muted)]">
                        Page {executionPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setExecutionPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={executionPage === totalPages}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        Next
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </Card>

        {/* Right Column - Execution Details */}
        <Card className="!p-4 sm:!p-6 flex flex-col lg:row-span-2">
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-4">
            Execution Details
          </h3>

          {/* Tabs */}
          <div className="mb-6">
            <div className="flex gap-4 border-b border-[var(--v2-border)] w-fit">
              <button
                onClick={() => setActiveTab('results')}
                className={`pb-2 px-1 text-sm font-medium transition-colors ${
                  activeTab === 'results'
                    ? 'text-[var(--v2-primary)] font-semibold border-b-2 border-[var(--v2-primary)]'
                    : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                Results
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`pb-2 px-1 text-sm font-medium transition-colors ${
                  activeTab === 'analytics'
                    ? 'text-[var(--v2-primary)] font-semibold border-b-2 border-[var(--v2-primary)]'
                    : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                }`}
              >
                Analytics
              </button>
            </div>
          </div>

<<<<<<< Updated upstream
          {selectedExecution ? (
            <>
              {/* Results Tab */}
              {activeTab === 'results' && (
                <div className="space-y-4">
                  {/* Execution Summary - No Card Wrapper */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(selectedExecution.status)}
                        <span className="text-sm font-semibold capitalize text-[var(--v2-text-primary)]">
                          {selectedExecution.status}
                        </span>
=======
          {/* Created Date */}
          {agent.created_at && (
            <div>
              <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                Created
              </label>
              <p className="text-sm text-[var(--v2-text-primary)] p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                {new Date(agent.created_at).toLocaleString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
          )}

          {/* Agent Name & Description */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Agent Details
            </h3>
            {!isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Agent Name
                  </label>
                  <p className="text-sm text-[var(--v2-text-primary)] p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    {agent.agent_name}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Description
                  </label>
                  <p className="text-sm text-[var(--v2-text-primary)] p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    {agent.description || 'No description'}
                  </p>
                </div>
                <button
                  onClick={handleEditClick}
                  className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors border border-[var(--v2-border)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit Details
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="w-full text-sm text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
                    placeholder="Agent name"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                    Description
                  </label>
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="w-full text-sm text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] resize-none"
                    placeholder="Agent description"
                    rows={3}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSaving || !editedName.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Save Changes
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-[var(--v2-border)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Integrations */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Integrations ({safePluginsRequired.length})
            </h3>
            {safePluginsRequired.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {safePluginsRequired.map(plugin => {
                  const isConnected = getPluginStatus(plugin)

                  return (
                    <div
                      key={plugin}
                      className="relative group"
                    >
                      {/* Plugin Icon with Status Badge */}
                      <div className="w-10 h-10 rounded-xl bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center shadow-sm transition-all duration-300 hover:scale-110 cursor-pointer">
                        {getPluginIcon(plugin)}
>>>>>>> Stashed changes
                      </div>
                      <div className="text-xs text-[var(--v2-text-muted)]">
                        {new Date(selectedExecution.started_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>

                    {selectedExecution.execution_duration_ms && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--v2-text-muted)]">Duration:</span>
                        <span className="font-semibold text-[var(--v2-text-primary)]">
                          {formatDuration(selectedExecution.execution_duration_ms)}
                        </span>
                      </div>
                    )}

                    {selectedExecution.completed_at && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--v2-text-muted)]">Completed:</span>
                        <span className="font-medium text-[var(--v2-text-primary)]">
                          {new Date(selectedExecution.completed_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Error Message */}
                  {selectedExecution.error_message && (
                    <div>
                      <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-1 block">
                        Error Message
                      </label>
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-xs text-red-700 dark:text-red-400 font-mono break-words overflow-wrap-anywhere">
                          {selectedExecution.error_message}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Execution Summary for Smart Executions */}
                  {selectedExecution.logs?.pilot && (
                    <div className="border rounded-lg p-4" style={{ backgroundColor: 'var(--v2-status-executing-bg)', borderColor: 'var(--v2-status-executing-border)' }}>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--v2-status-executing-text)' }}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Smart Execution Summary
                      </h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex justify-between">
                          <span className="text-[var(--v2-text-secondary)]">Steps Completed:</span>
                          <span className="font-bold text-[var(--v2-text-primary)]">{selectedExecution.logs.stepsCompleted || 0}</span>
                        </div>
                        {(selectedExecution.logs.stepsFailed || 0) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[var(--v2-text-secondary)]">Steps Failed:</span>
                            <span className="font-bold text-red-600 dark:text-red-400">{selectedExecution.logs.stepsFailed}</span>
                          </div>
                        )}
                        {(selectedExecution.logs.stepsSkipped || 0) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[var(--v2-text-secondary)]">Steps Skipped:</span>
                            <span className="font-bold text-yellow-600 dark:text-yellow-400">{selectedExecution.logs.stepsSkipped}</span>
                          </div>
                        )}
                        {selectedExecution.execution_duration_ms && (
                          <div className="flex justify-between">
                            <span className="text-[var(--v2-text-secondary)]">Duration:</span>
                            <span className="font-bold text-[var(--v2-text-primary)]">{formatDuration(selectedExecution.execution_duration_ms)}</span>
                          </div>
                        )}
                        {selectedExecution.logs.executionId && (
                          <div className="col-span-2 pt-2 mt-2 border-t" style={{ borderColor: 'var(--v2-status-executing-border)' }}>
                            <span className="text-[var(--v2-text-secondary)]">Execution ID:</span>
                            <p className="font-mono text-[10px] text-[var(--v2-text-primary)] mt-1 break-all">
                              {selectedExecution.logs.executionId}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Output */}
                  {selectedExecution.output && (
                    <div>
                      <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-1 block">
                        Output
                      </label>
                      <div className="p-3 bg-[var(--v2-surface)] max-h-64 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                        <pre className="text-xs text-[var(--v2-text-primary)] whitespace-pre-wrap break-words">
                          {JSON.stringify(selectedExecution.output, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Analytics Tab */}
              {activeTab === 'analytics' && (
                <div className="space-y-4">
                  {/* Execution Type Badge */}
                  {(selectedExecution.logs?.pilot || selectedExecution.logs?.agentkit) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--v2-text-muted)]">Execution Type:</span>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                        selectedExecution.logs.pilot
                          ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {selectedExecution.logs.pilot ? 'Smart Pilot' : 'AgentKit'}
                      </span>
                    </div>
                  )}

                  {/* Execution Metrics */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-3">
                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">Duration</div>
                      <div className="text-lg font-bold text-[var(--v2-text-primary)]">
                        {selectedExecution.execution_duration_ms
                          ? formatDuration(selectedExecution.execution_duration_ms)
                          : 'N/A'}
                      </div>
                    </div>
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-3">
                      <div className="text-xs text-[var(--v2-text-muted)] mb-1">
                        {selectedExecution.logs?.pilot ? 'Steps' : selectedExecution.logs?.agentkit ? 'Iterations' : 'Status'}
                      </div>
                      <div className="text-lg font-bold capitalize text-[var(--v2-text-primary)]">
                        {selectedExecution.logs?.pilot
                          ? `${selectedExecution.logs.stepsCompleted || 0}/${selectedExecution.logs.totalSteps || 0}`
                          : selectedExecution.logs?.agentkit
                          ? selectedExecution.logs.iterations || 'N/A'
                          : selectedExecution.status}
                      </div>
                    </div>
                  </div>

                  {/* Execution Progress (Pilot only) */}
                  {selectedExecution.logs?.pilot && selectedExecution.logs.totalSteps && (
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                        Execution Progress
                      </h4>
                      <div className="space-y-3">
                        {/* Progress Bar */}
                        <div className="relative h-2 bg-[var(--v2-border)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] transition-all"
                            style={{
                              width: `${((selectedExecution.logs.stepsCompleted || 0) / selectedExecution.logs.totalSteps) * 100}%`
                            }}
                          />
                        </div>

                        {/* Step Breakdown */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="text-center">
                            <div className="text-lg font-bold text-green-600 dark:text-green-400">
                              {selectedExecution.logs.stepsCompleted || 0}
                            </div>
                            <div className="text-[10px] text-[var(--v2-text-muted)]">Completed</div>
                          </div>
                          {(selectedExecution.logs.stepsFailed || 0) > 0 && (
                            <div className="text-center">
                              <div className="text-lg font-bold text-red-600 dark:text-red-400">
                                {selectedExecution.logs.stepsFailed}
                              </div>
                              <div className="text-[10px] text-[var(--v2-text-muted)]">Failed</div>
                            </div>
                          )}
                          {(selectedExecution.logs.stepsSkipped || 0) > 0 && (
                            <div className="text-center">
                              <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                                {selectedExecution.logs.stepsSkipped}
                              </div>
                              <div className="text-[10px] text-[var(--v2-text-muted)]">Skipped</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AI Model Info */}
                  {(selectedExecution.logs?.model || selectedExecution.logs?.provider) && (
                    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                        {selectedExecution.logs.pilot ? 'Execution Type' : 'AI Model Information'}
                      </h4>
                      <div className="space-y-2 text-xs">
                        {selectedExecution.logs.pilot ? (
                          <>
                            <div className="flex justify-between">
                              <span className="text-[var(--v2-text-muted)]">Type:</span>
                              <span className="text-[var(--v2-text-primary)] font-medium">
                                Smart Orchestrator
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--v2-text-muted)]">Steps Completed:</span>
                              <span className="text-[var(--v2-text-primary)] font-medium">
                                {selectedExecution.logs.stepsCompleted || 0}
                              </span>
                            </div>
                            {(selectedExecution.logs.stepsFailed || 0) > 0 && (
                              <div className="flex justify-between">
                                <span className="text-[var(--v2-text-muted)]">Steps Failed:</span>
                                <span className="text-red-600 dark:text-red-400 font-medium">
                                  {selectedExecution.logs.stepsFailed}
                                </span>
                              </div>
                            )}
                            {(selectedExecution.logs.stepsSkipped || 0) > 0 && (
                              <div className="flex justify-between">
                                <span className="text-[var(--v2-text-muted)]">Steps Skipped:</span>
                                <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                                  {selectedExecution.logs.stepsSkipped}
                                </span>
                              </div>
                            )}
                            <div className="pt-2 mt-2 border-t border-[var(--v2-border)]">
                              <p className="text-[10px] text-[var(--v2-text-muted)] italic">
                                Uses dynamic model routing per step for optimal performance
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            {selectedExecution.logs.model && (
                              <div className="flex justify-between">
                                <span className="text-[var(--v2-text-muted)]">Model:</span>
                                <span className="text-[var(--v2-text-primary)] font-medium">
                                  {selectedExecution.logs.model}
                                </span>
                              </div>
                            )}
                            {selectedExecution.logs.provider && (
                              <div className="flex justify-between">
                                <span className="text-[var(--v2-text-muted)]">Provider:</span>
                                <span className="text-[var(--v2-text-primary)] font-medium capitalize">
                                  {selectedExecution.logs.provider}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pilot Credits Usage */}
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      Pilot Credits Usage
                    </h4>
                    <div className="space-y-3">
                      {/* Total Pilot Credits */}
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--v2-text-muted)]">Total Credits:</span>
                        <span className="text-base font-bold text-[var(--v2-primary)]">
                          {selectedExecution.logs?.tokensUsed?.total
                            ? Math.ceil(selectedExecution.logs.tokensUsed.total / 10).toLocaleString()
                            : '0'}
                        </span>
                      </div>

                      {/* Credit Breakdown - Show breakdown only if we have real data */}
                      {selectedExecution.logs?.tokensUsed?.prompt && selectedExecution.logs?.tokensUsed?.completion ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg p-2">
                            <div className="text-[10px] text-blue-600 dark:text-blue-400 mb-0.5">Input</div>
                            <div className="text-sm font-bold text-blue-700 dark:text-blue-300">
                              {Math.ceil(selectedExecution.logs.tokensUsed.prompt / 10).toLocaleString()}
                            </div>
                          </div>
                          <div className="bg-purple-50 dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded-lg p-2">
                            <div className="text-[10px] text-purple-600 dark:text-purple-400 mb-0.5">Output</div>
                            <div className="text-sm font-bold text-purple-700 dark:text-purple-300">
                              {Math.ceil(selectedExecution.logs.tokensUsed.completion / 10).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="border rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--v2-bg)', borderColor: 'var(--v2-border)' }}>
                          <div className="text-[10px] mb-0.5" style={{ color: 'var(--v2-text-muted)' }}>Tokens Used</div>
                          <div className="text-sm font-bold" style={{ color: 'var(--v2-text-primary)' }}>
                            {selectedExecution.logs?.tokensUsed?.total
                              ? Math.ceil(selectedExecution.logs.tokensUsed.total / 10).toLocaleString()
                              : '0'}
                          </div>
                          <div className="text-[9px] mt-0.5" style={{ color: 'var(--v2-text-muted)' }}>Total</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timeline */}
                  <div>
                    <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                      Execution Timeline
                    </label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <div className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></div>
                        <span className="text-[var(--v2-text-muted)]">Started:</span>
                        <span className="text-[var(--v2-text-primary)] font-medium">
                          {new Date(selectedExecution.started_at).toLocaleTimeString()}
                        </span>
                      </div>
                      {selectedExecution.completed_at && (
                        <div className="flex items-center gap-2 text-xs">
                          <div className="w-2 h-2 rounded-full bg-green-600 dark:bg-green-400"></div>
                          <span className="text-[var(--v2-text-muted)]">Completed:</span>
                          <span className="text-[var(--v2-text-primary)] font-medium">
                            {new Date(selectedExecution.completed_at).toLocaleTimeString()}
                          </span>
                        </div>
                      )}
<<<<<<< Updated upstream
                    </div>
                  </div>

                  {/* Performance Insights */}
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                      Performance Insights
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-[var(--v2-text-muted)]">Execution Speed:</span>
                        <span className="text-[var(--v2-text-primary)] font-medium">
                          {selectedExecution.execution_duration_ms && selectedExecution.execution_duration_ms < 5000 ? 'Fast' :
                           selectedExecution.execution_duration_ms && selectedExecution.execution_duration_ms < 15000 ? 'Normal' : 'Slow'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--v2-text-muted)]">Success Rate:</span>
                        <span className="text-[var(--v2-text-primary)] font-medium">
                          {selectedExecution.status === 'completed' || selectedExecution.status === 'success' ? '100%' : '0%'}
                        </span>
                      </div>
                    </div>
=======
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
>>>>>>> Stashed changes
                  </div>
                </div>
              )}

            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="w-12 h-12 text-[var(--v2-text-muted)] opacity-20 mb-3" />
              <p className="text-sm text-[var(--v2-text-muted)]">
                Select an execution to view details
              </p>
            </div>
<<<<<<< Updated upstream
          )}
        </Card>
=======
          </div>

          {/* Intelligence Features */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Intelligence Features
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-[var(--v2-surface-hover)] rounded-lg">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">Business Insights</h4>
                  <p className="text-xs text-[var(--v2-text-muted)]">AI-powered recommendations to improve reliability and efficiency</p>
                </div>
                <button
                  onClick={handleToggleInsights}
                  className={`w-12 h-6 rounded-full relative transition-colors ${
                    (agent.insights_enabled ?? false) ? 'bg-[var(--v2-primary)]' : 'bg-[var(--v2-border)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${
                      (agent.insights_enabled ?? false) ? 'translate-x-7' : 'translate-x-1'
                    }`}
                    style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Agent Actions */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-4">
              Agent Actions
            </h3>
            <div className="space-y-2">
              <button
                onClick={handleDuplicateAgent}
                disabled={actionLoading === 'duplicate'}
                className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
              >
                {actionLoading === 'duplicate' ? <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-secondary)]" /> : <Copy className="w-5 h-5 text-[var(--v2-text-secondary)]" />}
                <div className="text-left flex-1">
                  <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Duplicate Agent</h5>
                  <p className="text-xs text-[var(--v2-text-muted)]">Create a copy of this agent</p>
                </div>
              </button>

              <button
                onClick={handleShareAgentClick}
                disabled={agent.status !== 'active' || actionLoading === 'share'}
                className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
              >
                {actionLoading === 'share' ? <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-secondary)]" /> : <Share2 className="w-5 h-5 text-[var(--v2-text-secondary)]" />}
                <div className="text-left flex-1">
                  <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Share to Templates</h5>
                  <p className="text-xs text-[var(--v2-text-muted)]">Share with community and earn credits</p>
                </div>
              </button>

              <button
                onClick={handleExportConfiguration}
                className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface-hover)] transition-all"
              >
                <Download className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                <div className="text-left flex-1">
                  <h5 className="text-sm font-semibold text-[var(--v2-text-primary)]">Export Configuration</h5>
                  <p className="text-xs text-[var(--v2-text-muted)]">Download agent setup as JSON</p>
                </div>
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="pt-6 border-t-2 border-red-200 dark:border-red-900/50">
            <h3 className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Danger Zone
            </h3>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center gap-3 p-4 bg-[var(--v2-surface)] border border-red-200 dark:border-red-900 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-red-600 dark:text-red-400"
            >
              <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              <div className="text-left flex-1">
                <h5 className="text-sm font-semibold">Delete Agent</h5>
                <p className="text-xs">Permanently remove this agent</p>
              </div>
            </button>
          </div>
        </div>
>>>>>>> Stashed changes
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--v2-border)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Delete Agent?</h3>
                <p className="text-sm text-[var(--v2-text-muted)]">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-sm text-[var(--v2-text-secondary)] mb-6">
              Are you sure you want to delete <span className="font-semibold text-[var(--v2-text-primary)]">{agent.agent_name}</span>? All execution history and data will be permanently removed.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAgent}
                disabled={actionLoading === 'delete'}
                className="flex-1 px-4 py-2.5 bg-red-600 dark:bg-red-500 text-white hover:bg-red-700 dark:hover:bg-red-600 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {actionLoading === 'delete' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</>
                ) : (
                  'Delete Agent'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
<<<<<<< Updated upstream
=======

      {/* Share Confirmation Modal - Keep existing implementation */}
      {showShareConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--v2-border)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-[var(--v2-primary)]/10 rounded-full flex items-center justify-center">
                <Share2 className="w-6 h-6 text-[var(--v2-primary)]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Share Agent</h3>
                <p className="text-sm text-[var(--v2-text-muted)]">Share with the community</p>
              </div>
            </div>

            {!shareRewardActive ? (
              <div className="bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-5 w-5 text-[var(--v2-text-secondary)]" />
                  <span className="font-semibold text-[var(--v2-text-primary)]">Sharing Temporarily Unavailable</span>
                </div>
                <p className="text-[var(--v2-text-secondary)] text-sm">
                  The agent sharing feature is currently disabled by the administrator.
                </p>
              </div>
            ) : hasBeenShared || (sharingValidation?.details?.alreadyShared) ? (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="font-semibold text-amber-800 dark:text-amber-200">Already Shared</span>
                </div>
                <p className="text-amber-700 dark:text-amber-300 text-sm">
                  This agent has already been shared with the community.
                </p>
              </div>
            ) : sharingValidation && !sharingValidation.valid ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <span className="font-semibold text-red-800 dark:text-red-200">Cannot Share Yet</span>
                </div>
                <p className="text-red-700 dark:text-red-300 text-sm mb-3">
                  {sharingValidation.reason}
                </p>
              </div>
            ) : (
              <div className="space-y-3 mb-4">
                {sharingValidation && sharingValidation.valid && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-emerald-800 dark:text-emerald-200 text-sm">Quality Requirements Met ✓</span>
                    </div>
                  </div>
                )}
                <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[var(--v2-primary)]/10 rounded-full flex items-center justify-center">
                        <Zap className="w-5 h-5 text-[var(--v2-primary)]" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[var(--v2-text-primary)]">Share Reward</div>
                        <div className="text-xs text-[var(--v2-text-muted)]">Help the community grow</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-[var(--v2-primary)]">{sharingRewardAmount}</div>
                      <div className="text-xs text-[var(--v2-text-muted)]">credits</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowShareConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {(hasBeenShared || sharingValidation?.details?.alreadyShared) ? 'Close' : 'Cancel'}
              </button>
              {!hasBeenShared && !sharingValidation?.details?.alreadyShared && (sharingValidation && !sharingValidation.valid ? null : (
                <button
                  onClick={handleShareAgent}
                  disabled={actionLoading === 'share' || (sharingValidation && !sharingValidation.valid) || !shareRewardActive}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:opacity-90 transition-opacity font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {actionLoading === 'share' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sharing...</>
                  ) : (
                    'Share & Earn Credits'
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Share Success Notification */}
      {showShareSuccess && (
        <div className="fixed top-4 right-4 z-50 max-w-md animate-in slide-in-from-top-5">
          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[var(--v2-text-primary)] text-lg mb-1">Agent Shared Successfully!</h3>
                <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
                  Your agent is now available in the community templates.
                </p>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <Zap className="w-4 h-4" />
                    <span className="font-semibold">{shareCreditsAwarded} credits earned</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--v2-primary)]">
                    <Brain className="w-4 h-4" />
                    <span className="font-semibold">Score: {shareQualityScore}/100</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowShareSuccess(false)}
                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insights Modal */}
      {showInsightsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[var(--v2-border)]">
              <div>
                <h2 className="text-xl font-semibold text-[var(--v2-text-primary)]">Recommendations</h2>
                <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                  Business insights and optimization opportunities
                </p>
              </div>
              <button
                onClick={() => setShowInsightsModal(false)}
                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors p-2 rounded-lg hover:bg-[var(--v2-surface-hover)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto max-h-[calc(90vh-120px)] p-6">
              <InsightsList
                insights={insights}
                onDismiss={async (id) => {
                  try {
                    await fetch(`/api/v6/insights/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'dismissed' })
                    })
                    // Refresh insights
                    const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                    const data = await result.json()
                    if (data.success) {
                      setInsights(data.data)
                    }
                  } catch (error) {
                    clientLogger.error('Error dismissing insight', error as Error)
                  }
                }}
                onApply={async (id) => {
                  try {
                    await fetch(`/api/v6/insights/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'applied' })
                    })
                    // Refresh insights
                    const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                    const data = await result.json()
                    if (data.success) {
                      setInsights(data.data)
                    }
                  } catch (error) {
                    clientLogger.error('Error applying insight', error as Error)
                  }
                }}
                onSnooze={async (id, days) => {
                  try {
                    const snoozedUntil = new Date()
                    snoozedUntil.setDate(snoozedUntil.getDate() + days)

                    await fetch(`/api/v6/insights/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        status: 'snoozed',
                        snoozed_until: snoozedUntil.toISOString()
                      })
                    })
                    // Refresh insights
                    const result = await fetch(`/api/v6/insights?agentId=${agentId}&status=new,viewed`)
                    const data = await result.json()
                    if (data.success) {
                      setInsights(data.data)
                    }
                  } catch (error) {
                    clientLogger.error('Error snoozing insight', error as Error)
                  }
                }}
              />

              {insights.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-[var(--v2-surface-hover)] rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">No Recommendations</h3>
                  <p className="text-sm text-[var(--v2-text-secondary)]">
                    Your workflow is running smoothly with no issues detected.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

>>>>>>> Stashed changes
    </div>
  )
}
