// app/v2/agents/[id]/page.tsx
// V2 Individual Agent Detail Page - Redesigned layout with agent info, health, and executions

'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
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
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Shield,
  Bot,
  Copy,
  Check,
  Loader2,
  TrendingUp,
  XCircle,
  X,
  Zap,
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  FlaskConical,
  Rocket,
  Brain,
  PlayCircle
} from 'lucide-react'
import {
  SiNotion,
  SiGithub
} from 'react-icons/si'
import { Mail, Phone, Cloud, Database, Globe, Puzzle } from 'lucide-react'
import { PluginIcon } from '@/components/PluginIcon'
import { AgentIntensityCardV2 } from '@/components/v2/agents/AgentIntensityCardV2'
import { AgentHealthCardV2 } from '@/components/v2/agents/AgentHealthCardV2'
import { formatScheduleDisplay, formatNextRun } from '@/lib/utils/scheduleFormatter'
import { InlineLoading } from '@/components/v2/ui/loading'

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  mode?: string
  schedule_cron?: string | null
  timezone?: string | null
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
      adjusted?: number
      intensityMultiplier?: number
      intensityScore?: number
      _source?: string
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

// Helper function to get plugin-specific icon (using local SVG files via PluginIcon)
const getPluginIcon = (pluginName: string) => {
  const name = pluginName.toLowerCase()
  // Use PluginIcon component for plugins with local SVG files
  if (name.includes('gmail') || name.includes('google-mail')) return <PluginIcon pluginId="google-mail" className="w-4 h-4" alt="Gmail" />
  if (name.includes('calendar')) return <PluginIcon pluginId="google-calendar" className="w-4 h-4" alt="Google Calendar" />
  if (name.includes('drive')) return <PluginIcon pluginId="google-drive" className="w-4 h-4" alt="Google Drive" />
  if (name.includes('docs') || name.includes('document')) return <PluginIcon pluginId="google-docs" className="w-4 h-4" alt="Google Docs" />
  if (name.includes('sheets') || name.includes('excel')) return <PluginIcon pluginId="google-sheets" className="w-4 h-4" alt="Google Sheets" />
  if (name.includes('github')) return <SiGithub className="w-4 h-4 text-gray-900 dark:text-white" />
  if (name.includes('slack')) return <PluginIcon pluginId="slack" className="w-4 h-4" alt="Slack" />
  if (name.includes('hubspot') || name.includes('crm')) return <PluginIcon pluginId="hubspot" className="w-4 h-4" alt="HubSpot" />
  if (name.includes('notion')) return <SiNotion className="w-4 h-4 text-gray-900 dark:text-white" />
  if (name.includes('whatsapp')) return <PluginIcon pluginId="whatsapp" className="w-4 h-4" alt="WhatsApp" />
  if (name.includes('airtable')) return <PluginIcon pluginId="airtable" className="w-4 h-4" alt="Airtable" />
  if (name.includes('chatgpt') || name.includes('openai')) return <PluginIcon pluginId="chatgpt-research" className="w-4 h-4" alt="ChatGPT" />
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
  const [showShareConfirm, setShowShareConfirm] = useState(false)
  const [showShareSuccess, setShowShareSuccess] = useState(false)
  const [shareCreditsAwarded, setShareCreditsAwarded] = useState(0)
  const [shareQualityScore, setShareQualityScore] = useState(0)
  const [sharingRewardAmount, setSharingRewardAmount] = useState(500) // Default fallback
  const [sharingValidation, setSharingValidation] = useState<any>(null) // Validation result
  const [sharingStatus, setSharingStatus] = useState<any>(null) // User sharing limits
  const [sharingConfig, setSharingConfig] = useState<any>(null) // Validator config (requirements)
  const [shareRewardActive, setShareRewardActive] = useState(true) // Track if share_agent reward is active
  const [hasBeenShared, setHasBeenShared] = useState(false)
  const [memoryCount, setMemoryCount] = useState(0)
  const [tokensPerPilotCredit, setTokensPerPilotCredit] = useState<number>(10) // Default to 10
  const EXECUTIONS_PER_PAGE = 10

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [editedScheduleCron, setEditedScheduleCron] = useState('')
  const [editedMode, setEditedMode] = useState('')
  const [editedTimezone, setEditedTimezone] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Schedule editing state (matching agent creation page)
  const [scheduleMode, setScheduleMode] = useState<'manual' | 'scheduled'>('manual')
  const [scheduleType, setScheduleType] = useState<'hourly' | 'daily' | 'weekly' | 'monthly' | ''>('')
  const [scheduleTime, setScheduleTime] = useState<string>('09:00')
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedMonthDay, setSelectedMonthDay] = useState<string>('1')
  const [hourlyInterval, setHourlyInterval] = useState<string>('1')
  const [dailyOption, setDailyOption] = useState<'everyday' | 'weekdays' | 'weekends'>('everyday')

  useEffect(() => {
    if (user && agentId) {
      fetchAgentData()
      fetchTokensPerPilotCredit()
      fetchSharingRewardAmount()
      fetchShareRewardStatus()
    }
  }, [user, agentId])

  // Pre-fetch sharing eligibility when agent data is loaded (for instant modal)
  useEffect(() => {
    if (agentId && user && shareRewardActive && agent) {
      checkSharingEligibility()
    }
  }, [agentId, user?.id, shareRewardActive])

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

  const fetchTokensPerPilotCredit = async () => {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_value')
        .eq('config_key', 'tokens_per_pilot_credit')
        .single()

      if (!error && data) {
        const value = parseInt(data.config_value)
        if (value > 0 && value <= 1000) {
          setTokensPerPilotCredit(value)
          console.log(`[AGENT PAGE] Fetched tokens_per_pilot_credit: ${value}`)
        }
      }
    } catch (error) {
      console.error('Error fetching tokens_per_pilot_credit:', error)
      // Keep default value of 10
    }
  }

  const fetchSharingRewardAmount = async () => {
    try {
      const { data, error } = await supabase
        .from('reward_config')
        .select('credits_amount')
        .eq('reward_key', 'agent_sharing')
        .eq('is_active', true)
        .maybeSingle()

      if (!error && data) {
        setSharingRewardAmount(data.credits_amount)
      }
    } catch (error) {
      console.error('Error fetching sharing reward amount:', error)
    }
  }

  const fetchShareRewardStatus = async () => {
    try {
      const response = await fetch('/api/admin/reward-config')
      const result = await response.json()

      if (!result.success || !result.rewards) {
        setShareRewardActive(false)
        return
      }

      const shareReward = result.rewards.find((r: any) => r.reward_key === 'agent_sharing')

      if (!shareReward) {
        setShareRewardActive(false)
        return
      }

      const isActive = shareReward.is_active ?? false
      setShareRewardActive(isActive)
    } catch (error) {
      console.error('Error fetching share reward config:', error)
      setShareRewardActive(false)
    }
  }

  const checkSharingEligibility = async () => {
    if (!user?.id || !agent?.id) return

    console.log('[SHARE VALIDATION] Starting eligibility check')

    try {
      const { AgentSharingValidator } = await import('@/lib/credits/agentSharingValidation')
      const validator = new AgentSharingValidator(supabase)

      const validation = await validator.validateSharing(user.id, agent.id)
      console.log('[SHARE VALIDATION] Validation result:', validation)
      setSharingValidation(validation)

      const status = await validator.getSharingStatus(user.id)
      console.log('[SHARE VALIDATION] Status:', status)
      setSharingStatus(status)

      // Get validator config for displaying requirements
      const config = validator.getConfig()
      console.log('[SHARE VALIDATION] Config:', config)
      setSharingConfig(config)
    } catch (error) {
      console.error('[SHARE VALIDATION] Error checking sharing eligibility:', error)
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

        // Identify executions missing token data
        const executionsNeedingTokenData = allExecutionsData.filter(execution => {
          const hasCompleteTokenData =
            execution.logs?.tokensUsed?.total &&
            execution.logs?.tokensUsed?.prompt &&
            execution.logs?.tokensUsed?.completion;
          return !hasCompleteTokenData;
        });

        console.log(`[V2 Agent Page] ${executionsNeedingTokenData.length} executions need token data from token_usage table`);

        // Batch fetch ALL token data for executions missing data (single query!)
        let tokenDataByExecutionId = new Map();
        if (executionsNeedingTokenData.length > 0) {
          const executionIds = executionsNeedingTokenData.map(e => e.id);

          const { data: allTokenDataRecords, error: tokenError } = await supabase
            .from('token_usage')
            .select('execution_id, input_tokens, output_tokens, activity_type')
            .in('execution_id', executionIds);

          if (!tokenError && allTokenDataRecords) {
            console.log(`[V2 Agent Page] Fetched ${allTokenDataRecords.length} token records for ${executionIds.length} executions`);

            // Group token records by execution_id
            allTokenDataRecords.forEach(record => {
              if (!tokenDataByExecutionId.has(record.execution_id)) {
                tokenDataByExecutionId.set(record.execution_id, []);
              }
              tokenDataByExecutionId.get(record.execution_id).push(record);
            });
          } else if (tokenError) {
            console.error(`[V2 Agent Page] Error fetching batch token data:`, tokenError);
          }
        }

        // Enrich executions with token data
        const enrichedExecutions = allExecutionsData.map(execution => {
          const hasCompleteTokenData =
            execution.logs?.tokensUsed?.total &&
            execution.logs?.tokensUsed?.prompt &&
            execution.logs?.tokensUsed?.completion;

          if (hasCompleteTokenData) {
            return execution;
          }

          // Check if we have token data from batch query
          const tokenRecords = tokenDataByExecutionId.get(execution.id);
          if (tokenRecords && tokenRecords.length > 0) {
            // Sum ALL token records for this execution
            const inputTokens = tokenRecords.reduce((sum, record) => sum + (record.input_tokens || 0), 0);
            const outputTokens = tokenRecords.reduce((sum, record) => sum + (record.output_tokens || 0), 0);
            const totalTokens = inputTokens + outputTokens;

            return {
              ...execution,
              logs: {
                ...(execution.logs || {}),
                tokensUsed: {
                  // Preserve adjusted tokens if they exist (from new intensity system)
                  ...(execution.logs?.tokensUsed || {}),
                  // Only add prompt/completion/total if they don't already exist
                  prompt: execution.logs?.tokensUsed?.prompt || inputTokens,
                  completion: execution.logs?.tokensUsed?.completion || outputTokens,
                  total: execution.logs?.tokensUsed?.total || totalTokens,
                  _source: execution.logs?.tokensUsed?.adjusted ? 'agent_executions_with_fallback' : 'token_usage_table_batched'
                }
              }
            };
          }

          // No token data available
          return execution;
        });

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
          const firstExec = enrichedExecutions[0];
          console.log('[V2 Agent Page] Auto-selecting first execution:', {
            id: firstExec.id?.slice(0, 8),
            started_at: firstExec.started_at,
            tokensUsed: firstExec.logs?.tokensUsed,
            hasAdjusted: !!firstExec.logs?.tokensUsed?.adjusted,
            adjustedValue: firstExec.logs?.tokensUsed?.adjusted,
            totalValue: firstExec.logs?.tokensUsed?.total
          });
          setSelectedExecution(firstExec)
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

  // ==================== SCHEDULE HELPERS ====================

  const getDaySuffix = (day: number) => {
    if (day >= 11 && day <= 13) return 'th'
    switch (day % 10) {
      case 1: return 'st'
      case 2: return 'nd'
      case 3: return 'rd'
      default: return 'th'
    }
  }

  const getScheduleDescription = () => {
    if (!scheduleType) return 'No schedule set'

    if (scheduleType === 'hourly') {
      return hourlyInterval === '1' ? 'Every hour' : `Every ${hourlyInterval} hours`
    }

    if (scheduleType === 'daily') {
      if (dailyOption === 'everyday') return `Every day at ${scheduleTime}`
      if (dailyOption === 'weekdays') return `Weekdays at ${scheduleTime}`
      if (dailyOption === 'weekends') return `Weekends at ${scheduleTime}`
    }

    if (scheduleType === 'weekly') {
      if (selectedDays.length === 0) return 'Weekly - Select days'
      const dayNames = selectedDays.map(d => d.charAt(0).toUpperCase() + d.slice(0, 3))
      return `${dayNames.join(', ')} at ${scheduleTime}`
    }

    if (scheduleType === 'monthly') {
      return `${selectedMonthDay}${getDaySuffix(parseInt(selectedMonthDay))} of month at ${scheduleTime}`
    }

    return 'Configure schedule'
  }

  const buildCronExpression = (): string | null => {
    if (scheduleMode === 'manual') return null
    if (!scheduleType) return null

    // Parse time (HH:MM format)
    const [hour, minute] = scheduleTime.split(':').map(Number)

    // Hourly: "0 * * * *" or "0 */N * * *"
    if (scheduleType === 'hourly') {
      const interval = parseInt(hourlyInterval) || 1
      return interval === 1 ? '0 * * * *' : `0 */${interval} * * *`
    }

    // Daily
    if (scheduleType === 'daily') {
      if (dailyOption === 'everyday') {
        return `${minute} ${hour} * * *`
      }
      if (dailyOption === 'weekdays') {
        return `${minute} ${hour} * * 1-5` // Mon-Fri
      }
      if (dailyOption === 'weekends') {
        return `${minute} ${hour} * * 0,6` // Sun, Sat
      }
    }

    // Weekly: specific days
    if (scheduleType === 'weekly' && selectedDays.length > 0) {
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
      }
      const cronDays = selectedDays
        .map(d => dayMap[d.toLowerCase()])
        .sort((a, b) => a - b)
        .join(',')
      return `${minute} ${hour} * * ${cronDays}`
    }

    // Monthly: specific day of month
    if (scheduleType === 'monthly') {
      const day = parseInt(selectedMonthDay) || 1
      return `${minute} ${hour} ${day} * *`
    }

    return null
  }

  const handleDayToggle = (day: string) => {
    setSelectedDays(prev => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev
        return prev.filter(d => d !== day)
      } else {
        return [...prev, day]
      }
    })
  }

  const handleOnDemand = () => {
    setScheduleMode('manual')
    setScheduleType('')
  }

  // ==================== EDIT HANDLERS ====================

  const handleEditClick = () => {
    if (!agent) return

    // Initialize edit state with current values
    setEditedName(agent.agent_name)
    setEditedDescription(agent.description || '')
    setEditedScheduleCron(agent.schedule_cron || '')
    setEditedMode(agent.mode || 'on_demand')
    setEditedTimezone(agent.timezone || '')

    // Parse existing cron to initialize schedule UI state
    if (agent.mode === 'scheduled' && agent.schedule_cron) {
      setScheduleMode('scheduled')
      const parts = agent.schedule_cron.split(' ')
      if (parts.length === 5) {
        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

        // Hourly schedule
        if (hour.includes('*')) {
          setScheduleType('hourly')
          const match = hour.match(/\*\/(\d+)/)
          if (match) {
            setHourlyInterval(match[1])
          } else {
            setHourlyInterval('1')
          }
        }
        // Monthly schedule
        else if (dayOfMonth !== '*' && !dayOfMonth.includes('-') && !dayOfMonth.includes(',')) {
          setScheduleType('monthly')
          setSelectedMonthDay(dayOfMonth)
          setScheduleTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
        }
        // Weekly schedule
        else if (dayOfWeek !== '*' && dayOfWeek.includes(',')) {
          setScheduleType('weekly')
          const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          const days = dayOfWeek.split(',').map(d => dayMap[parseInt(d)])
          setSelectedDays(days)
          setScheduleTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
        }
        // Daily schedule
        else if (dayOfMonth === '*' && month === '*') {
          setScheduleType('daily')
          setScheduleTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
          // Determine daily option
          if (dayOfWeek === '*') {
            setDailyOption('everyday')
          } else if (dayOfWeek === '1-5') {
            setDailyOption('weekdays')
          } else if (dayOfWeek === '0,6') {
            setDailyOption('weekends')
          }
        }
      }
    } else {
      setScheduleMode('manual')
      setScheduleType('')
    }

    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditedName('')
    setEditedDescription('')
    setEditedScheduleCron('')
    setEditedMode('')
    setEditedTimezone('')
    // Reset schedule state
    setScheduleMode('manual')
    setScheduleType('')
    setScheduleTime('09:00')
    setSelectedDays([])
    setSelectedMonthDay('1')
    setHourlyInterval('1')
    setDailyOption('everyday')
  }

  const handleSaveEdit = async () => {
    if (!agent || !user) return

    setIsSaving(true)
    try {
      // Build cron from schedule UI state
      const cronExpression = buildCronExpression()
      const mode = scheduleMode === 'manual' ? 'on_demand' : 'scheduled'

      const { error } = await supabase
        .from('agents')
        .update({
          agent_name: editedName,
          description: editedDescription,
          schedule_cron: cronExpression,
          mode: mode,
          timezone: editedTimezone || null
        })
        .eq('id', agent.id)
        .eq('user_id', user.id)

      if (error) {
        console.error('Error updating agent:', error)
        return
      }

      // Update local state
      setAgent({
        ...agent,
        agent_name: editedName,
        description: editedDescription,
        schedule_cron: cronExpression,
        mode: mode,
        timezone: editedTimezone || null
      })

      setIsEditing(false)
    } catch (error) {
      console.error('Error saving agent:', error)
    } finally {
      setIsSaving(false)
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

  const handleShareAgentClick = () => {
    console.log('[SHARE] Click handler called', {
      hasAgent: !!agent,
      hasUser: !!user,
      status: agent?.status,
      showShareConfirm
    })

    if (!agent || !user || agent.status !== 'active') {
      console.log('[SHARE] Validation failed, not opening modal')
      return
    }

    // Validation is pre-fetched in useEffect, so modal opens instantly
    console.log('[SHARE] Opening modal')
    setShowShareConfirm(true)
  }

  const handleShareAgent = async () => {
    if (!agent || !user || agent.status !== 'active') {
      return
    }

    setShowShareConfirm(false)
    setActionLoading('share')
    try {
      // Import validation and reward services
      const { AgentSharingValidator } = await import('@/lib/credits/agentSharingValidation')
      const { RewardService } = await import('@/lib/credits/rewardService')
      const { AgentScoreService } = await import('@/lib/services/AgentScoreService')

      const validator = new AgentSharingValidator(supabase)
      const rewardService = new RewardService(supabase)
      const scoreService = new AgentScoreService(supabase)

      // Validate sharing requirements
      const validation = await validator.validateSharing(user.id, agent.id)
      if (!validation.valid) {
        alert(validation.reason || 'This agent does not meet sharing requirements')
        return
      }

      // Check if already shared
      const { data: existingShared } = await supabase
        .from('shared_agents')
        .select('id')
        .eq('original_agent_id', agent.id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existingShared) {
        alert('This agent has already been shared!')
        return
      }

      // Calculate quality score
      const qualityScore = await scoreService.calculateQualityScore(agent.id)

      // Get execution diversity penalty (anti-abuse)
      const diversityPenalty = await scoreService.getExecutionDiversityPenalty(agent.id)

      // Apply penalty if suspicious execution pattern detected
      const finalScore = {
        ...qualityScore,
        overall_score: qualityScore.overall_score * diversityPenalty
      }

      // Get base metrics for snapshot
      const { data: metrics } = await supabase
        .from('agent_intensity_metrics')
        .select('success_rate, total_executions')
        .eq('agent_id', agent.id)
        .maybeSingle()

      // Insert into shared_agents with calculated scores
      const { error: insertError } = await supabase.from('shared_agents').insert([{
        original_agent_id: agent.id,
        user_id: user.id,
        agent_name: agent.agent_name,
        description: agent.description,
        user_prompt: agent.user_prompt,
        input_schema: agent.input_schema,
        output_schema: agent.output_schema,
        connected_plugins: agent.connected_plugins,
        plugins_required: agent.plugins_required,
        workflow_steps: agent.workflow_steps,
        mode: agent.mode,
        shared_at: new Date().toISOString(),
        // Quality scores
        quality_score: finalScore.overall_score,
        reliability_score: finalScore.reliability_score,
        efficiency_score: finalScore.efficiency_score,
        adoption_score: finalScore.adoption_score,
        complexity_score: finalScore.complexity_score,
        score_calculated_at: new Date().toISOString(),
        // Base metrics snapshot
        base_executions: metrics?.total_executions || 0,
        base_success_rate: metrics?.success_rate || 0
      }])

      if (insertError) {
        console.error('Error sharing agent:', insertError)
        alert(`Failed to share agent: ${insertError.message}`)
        return
      }

      // Award credits
      const rewardResult = await rewardService.awardAgentSharingReward(
        user.id,
        agent.id,
        agent.agent_name
      )

      // Set success state and show notification
      if (rewardResult.success) {
        setShareCreditsAwarded(rewardResult.creditsAwarded || 0)
        setShareQualityScore(Math.round(finalScore.overall_score))
        setShowShareSuccess(true)
        setHasBeenShared(true)

        // Auto-hide notification after 5 seconds
        setTimeout(() => setShowShareSuccess(false), 5000)
      }

      // Refresh page to show updated state
      await fetchAgentData()
    } catch (error) {
      console.error('Error in handleShareAgent:', error)
      alert('Failed to share agent. Please try again.')
    } finally {
      setActionLoading(null)
      setShowShareConfirm(false)
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
    return <InlineLoading size="md" />
  }

  if (!agent) {
    return null
  }

  const health = calculateHealthScore()
  const safePluginsRequired = Array.isArray(agent.plugins_required) ? agent.plugins_required : []

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Logo - First Line */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Back Button + Controls */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/agent-list')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </button>
        <V2Controls />
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
                {isEditing ? (
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] dark:bg-slate-700"
                    placeholder="Agent name"
                  />
                ) : (
                  <h2 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                    {agent.agent_name}
                  </h2>
                )}
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
              {!isEditing && (
                <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 block">
                  Schedule
                </label>
              )}
              {isEditing ? (
                <div className="space-y-3">
                  {/* Schedule Mode Selection */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleOnDemand}
                      className={`p-2 border transition-all ${
                        scheduleMode === 'manual'
                          ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
                          : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <div className="flex items-center gap-2">
                        <PlayCircle className="h-4 w-4 text-[var(--v2-primary)] flex-shrink-0" />
                        <div className="text-left">
                          <p className="font-semibold text-[var(--v2-text-primary)] text-xs">On-demand</p>
                          <p className="text-[10px] text-[var(--v2-text-muted)] leading-tight">Manual</p>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => setScheduleMode('scheduled')}
                      className={`p-2 border transition-all ${
                        scheduleMode === 'scheduled'
                          ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
                          : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-[var(--v2-primary)] flex-shrink-0" />
                        <div className="text-left">
                          <p className="font-semibold text-[var(--v2-text-primary)] text-xs">Scheduled</p>
                          <p className="text-[10px] text-[var(--v2-text-muted)] leading-tight">Auto run</p>
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Schedule Configuration (shown when scheduled is selected) */}
                  {scheduleMode === 'scheduled' && (
                    <div className="space-y-2.5 pt-2 border-t border-[var(--v2-border)]">
                      {/* Frequency Selection */}
                      <div>
                        <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                          Frequency
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                          {(['hourly', 'daily', 'weekly', 'monthly'] as const).map((type) => (
                            <button
                              key={type}
                              onClick={() => setScheduleType(type)}
                              className={`px-2 py-1.5 text-xs font-medium transition-all ${
                                scheduleType === type
                                  ? 'bg-[var(--v2-primary)] text-white'
                                  : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                              }`}
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Hourly Interval */}
                      {scheduleType === 'hourly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Every N hours
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="24"
                            value={hourlyInterval}
                            onChange={(e) => setHourlyInterval(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        </div>
                      )}

                      {/* Time Selection (for daily/weekly/monthly) */}
                      {scheduleType && scheduleType !== 'hourly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Time
                          </label>
                          <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        </div>
                      )}

                      {/* Daily Options */}
                      {scheduleType === 'daily' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Days
                          </label>
                          <div className="flex gap-2">
                            {(['everyday', 'weekdays', 'weekends'] as const).map((option) => (
                              <button
                                key={option}
                                onClick={() => setDailyOption(option)}
                                className={`px-3 py-1.5 text-xs font-medium transition-all ${
                                  dailyOption === option
                                    ? 'bg-[var(--v2-primary)] text-white'
                                    : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                                }`}
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {option === 'everyday' ? 'Every day' : option.charAt(0).toUpperCase() + option.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Weekly Day Selection */}
                      {scheduleType === 'weekly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Days of week
                          </label>
                          <div className="grid grid-cols-7 gap-1">
                            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => (
                              <button
                                key={day}
                                onClick={() => handleDayToggle(day)}
                                className={`px-1 py-1.5 text-xs font-medium transition-all ${
                                  selectedDays.includes(day)
                                    ? 'bg-[var(--v2-primary)] text-white'
                                    : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                                }`}
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {day.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Monthly Day Selection */}
                      {scheduleType === 'monthly' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-2">
                            Day of month
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={selectedMonthDay}
                            onChange={(e) => setSelectedMonthDay(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          />
                        </div>
                      )}

                      {/* Schedule Preview */}
                      {scheduleType && (
                        <div className="p-2 bg-[var(--v2-surface-hover)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                          <p className="text-xs text-[var(--v2-text-secondary)]">
                            <span className="font-medium">Schedule: </span>
                            {getScheduleDescription()}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Schedule Mode Card */}
                  <div className={`p-3 border-2 transition-all ${
                    agent.mode === 'scheduled'
                      ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/5'
                      : 'border-[var(--v2-border)] bg-[var(--v2-surface)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-card)' }}>
                    <div className="flex items-center gap-3">
                      {agent.mode === 'scheduled' ? (
                        <Clock className="h-6 w-6 text-[var(--v2-primary)]" />
                      ) : (
                        <Play className="h-6 w-6 text-[var(--v2-primary)]" />
                      )}
                      <div className="flex-1">
                        <p className="font-semibold text-[var(--v2-text-primary)] text-sm">
                          {agent.mode === 'scheduled' ? 'Scheduled' : 'On-demand'}
                        </p>
                        <p className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                          {agent.mode === 'scheduled'
                            ? formatScheduleDisplay(agent.mode, agent.schedule_cron)
                            : 'Run manually when needed'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Next Run Badge (only for scheduled agents) */}
                  {agent.mode === 'scheduled' && agent.next_run && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                      <CheckCircle className="w-3 h-3" />
                      Next: {formatNextRun(agent.next_run, agent.timezone || undefined)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Description */}
            {(agent.description || isEditing) && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[var(--v2-text-muted)] mb-1 block">
                  Description
                </label>
                {isEditing ? (
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="text-sm text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] dark:bg-slate-700 min-h-[80px]"
                    placeholder="Agent description"
                  />
                ) : (
                  <p className="text-sm text-[var(--v2-text-primary)]">
                    {agent.description}
                  </p>
                )}
              </div>
            )}

            {/* Save/Cancel Buttons for Edit Mode */}
            {isEditing && (
              <div className="mb-4 flex items-center gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editedName.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:bg-[var(--v2-primary-dark)] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
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
                  onClick={handleEditClick}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 hover:scale-110 transition-all duration-200 shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Edit className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Edit Agent
                </div>
              </div>

              {/* Sandbox */}
              <div className="relative group">
                <button
                  onClick={() => router.push(`/v2/sandbox/${agent.id}`)}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-200 dark:hover:border-purple-800 hover:scale-110 transition-all duration-200 shadow-sm"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <FlaskConical className="w-4 h-4" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  Agent Sandbox
                </div>
              </div>

              {/* Export - Hidden for now */}
              {false && (
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
              )}

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
                  onClick={handleShareAgentClick}
                  disabled={agent.status !== 'active' || actionLoading === 'share'}
                  className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-800 hover:scale-110 transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {actionLoading === 'share' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {actionLoading === 'share' ? 'Sharing...' : (agent.status !== 'active' ? 'Activate to share' : 'Share to Templates')}
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
                          ? `${selectedExecution.logs.stepsCompleted || 0}/${
                              (selectedExecution.logs.stepsCompleted || 0) +
                              (selectedExecution.logs.stepsFailed || 0) +
                              (selectedExecution.logs.stepsSkipped || 0)
                            }`
                          : selectedExecution.logs?.agentkit
                          ? selectedExecution.logs.iterations || 'N/A'
                          : selectedExecution.status}
                      </div>
                    </div>
                  </div>

                  {/* Execution Progress (Pilot only) */}
                  {selectedExecution.logs?.pilot && (
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
                              width: `${(() => {
                                const completed = selectedExecution.logs.stepsCompleted || 0;
                                const failed = selectedExecution.logs.stepsFailed || 0;
                                const skipped = selectedExecution.logs.stepsSkipped || 0;
                                const total = completed + failed + skipped;
                                return total > 0 ? (completed / total) * 100 : 0;
                              })()}%`
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
                      {/* Pilot Tokens - Convert LLM tokens to Pilot Tokens */}
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--v2-text-muted)]">Pilot Tokens:</span>
                        <span className="text-base font-bold text-[var(--v2-primary)]">
                          {(() => {
                            // Get adjusted tokens (with intensity multiplier) or raw total
                            const adjusted = selectedExecution.logs?.tokensUsed?.adjusted;
                            const total = selectedExecution.logs?.tokensUsed?.total;
                            const llmTokens = adjusted || total || 0;

                            // Convert to Pilot Tokens (divide by tokens_per_pilot_credit from DB)
                            const pilotTokens = Math.ceil(llmTokens / tokensPerPilotCredit);

                            console.log('[AGENT PAGE] Token Display Debug:', {
                              executionId: selectedExecution.id?.slice(0, 8),
                              llmTokens,
                              tokensPerPilotCredit,
                              pilotTokens,
                              source: selectedExecution.logs?.tokensUsed?._source
                            });

                            return pilotTokens.toLocaleString();
                          })()}
                        </span>
                      </div>

                      {/* Pilot Tokens - Convert LLM tokens to Pilot Tokens */}
                      <div className="border rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--v2-bg)', borderColor: 'var(--v2-border)' }}>
                        <div className="text-[10px] mb-0.5" style={{ color: 'var(--v2-text-muted)' }}>Pilot Tokens</div>
                        <div className="text-sm font-bold" style={{ color: 'var(--v2-text-primary)' }}>
                          {(() => {
                            // Get adjusted tokens (with intensity multiplier) or raw total
                            const adjusted = selectedExecution.logs?.tokensUsed?.adjusted;
                            const total = selectedExecution.logs?.tokensUsed?.total;
                            const llmTokens = adjusted || total || 0;

                            // Convert to Pilot Tokens (divide by tokens_per_pilot_credit from DB)
                            const pilotTokens = Math.ceil(llmTokens / tokensPerPilotCredit);

                            return pilotTokens.toLocaleString();
                          })()}
                        </div>
                        <div className="text-[9px] mt-0.5" style={{ color: 'var(--v2-text-muted)' }}>Total</div>
                      </div>
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
          )}
        </Card>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--v2-border)]">
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

      {/* Share Confirmation Modal */}
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
                  The agent sharing feature is currently disabled by the administrator. Please check back later or contact support for more information.
                </p>
              </div>
            ) : hasBeenShared || (sharingValidation?.details?.alreadyShared) ? (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="font-semibold text-amber-800 dark:text-amber-200">Already Shared</span>
                </div>
                <p className="text-amber-700 dark:text-amber-300 text-sm">
                  This agent has already been shared with the community. Each agent can only be shared once.
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
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 rounded px-3 py-2">
                  <strong>Requirements to share:</strong>
                  <ul className="mt-1 space-y-1 ml-4 list-disc">
                    <li>Agent must be at least {sharingConfig?.minAgentAgeHours || 1} hour{(sharingConfig?.minAgentAgeHours || 1) !== 1 ? 's' : ''} old</li>
                    <li>Agent must have at least {sharingConfig?.minExecutions || 3} successful test runs</li>
                    <li>Agent must have ≥{sharingConfig?.minSuccessRate || 66}% success rate</li>
                    <li>Agent must have a description ({sharingConfig?.minDescriptionLength || 20}+ characters)</li>
                    <li>Daily limit: {sharingStatus?.limits.daily || 5} shares per day</li>
                    <li>Monthly limit: {sharingStatus?.limits.monthly || 20} shares per month</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-3 mb-4">
                {/* Quality Check Passed */}
                {sharingValidation && sharingValidation.valid && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-emerald-800 dark:text-emerald-200 text-sm">Quality Requirements Met ✓</span>
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-300 grid grid-cols-2 gap-2">
                      <div>✓ {sharingValidation.details?.agentQuality?.executions || 0} test runs</div>
                      <div>✓ {sharingValidation.details?.agentQuality?.successRate || 0}% success rate</div>
                      <div>✓ {sharingValidation.details?.agentQuality?.agentAgeHours || 0}h old</div>
                      <div>✓ Description included</div>
                    </div>
                    {sharingStatus && (
                      <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800 text-xs text-emerald-600 dark:text-emerald-400">
                        <strong>Your sharing limits:</strong> {sharingStatus.remaining.daily} today, {sharingStatus.remaining.monthly} this month
                      </div>
                    )}
                  </div>
                )}

                {/* Reward Info */}
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
                  className="flex-1 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:bg-[var(--v2-primary-dark)] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
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
    </div>
  )
}
