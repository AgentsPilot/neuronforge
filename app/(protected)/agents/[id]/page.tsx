'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter'
import AgentHistoryBlock from '@/components/dashboard/AgentHistoryBlock'
import AgentSandbox from '@/components/dashboard/AgentSandBox/AgentSandbox'
import { AgentIntensityCard } from '@/components/agents/AgentIntensityCard'
import AgentPreview from '@/components/agent-creation/SmartAgentBuilder/components/AgentPreview'
import SimpleDynamicWorkflow from '@/components/agent-creation/SmartAgentBuilder/components/VisualAgentFlow'
import { SiNotion, SiGithub } from 'react-icons/si'
import { PluginIcon } from '@/components/PluginIcon'
import {
  Bot,
  Edit,
  Trash2,
  ArrowLeft,
  Calendar,
  Activity,
  Settings,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Zap,
  MoreVertical,
  Copy,
  Download,
  Eye,
  EyeOff,
  MessageSquare,
  X,
  Share2,
  Coins,
  Users,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
  Puzzle,
  Brain,
  Mail,
  Globe,
  Database,
  Target,
  TrendingUp,
  Shield,
  Loader2,
  Bell,
  List,
  FileBarChart,
  Wand2,
  Rocket,
  CheckCircle2,
  Check,
  User,
  FlaskConical,
  Phone,
  Cloud
} from 'lucide-react'

// Ultra-Modern Modal with Dynamic Sizing
const Modal = ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted || !isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 max-w-lg w-full mx-auto max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>,
    document.body
  )
}

type Agent = {
  id: string
  agent_name: string
  description?: string
  system_prompt?: string
  user_prompt: string
  status?: string
  input_schema?: any
  output_schema?: any
  connected_plugins?: Record<string, any>
  plugins_required?: string[]
  workflow_steps?: any[]
  created_at?: string
  updated_at?: string
  mode?: string
  schedule_cron?: string
  timezone?: string
  generated_plan?: string
  ai_reasoning?: string
  ai_confidence?: number
  detected_categories?: string[]
  created_from_prompt?: string
  ai_generated_at?: string
  original_agent_id?: string
  shared_at?: string
  user_id?: string
}

const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

const getStatusConfig = (status: string) => {
  switch (status) {
    case 'active':
      return {
        icon: CheckCircle,
        label: 'Live',
        color: 'text-emerald-600',
        bg: 'bg-gradient-to-r from-green-50 to-emerald-50',
        border: 'border-emerald-200',
        pulse: 'animate-pulse'
      }
    case 'inactive':
      return {
        icon: Pause,
        label: 'Paused',
        color: 'text-slate-500',
        bg: 'bg-gradient-to-r from-slate-50 to-gray-50',
        border: 'border-slate-200',
        pulse: ''
      }
    case 'draft':
      return {
        icon: Wand2,
        label: 'Draft',
        color: 'text-amber-600',
        bg: 'bg-gradient-to-r from-amber-50 to-orange-50',
        border: 'border-amber-200',
        pulse: ''
      }
    case 'shared':
      return {
        icon: Users,
        label: 'Community',
        color: 'text-blue-600',
        bg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
        border: 'border-blue-200',
        pulse: ''
      }
    default:
      return {
        icon: Clock,
        label: 'Unknown',
        color: 'text-slate-500',
        bg: 'bg-gradient-to-r from-slate-50 to-gray-50',
        border: 'border-slate-200',
        pulse: ''
      }
  }
}

const getModeIcon = (mode: string) => {
  switch (mode) {
    case 'on_demand': return Play
    case 'scheduled': return Calendar
    case 'triggered': return Zap
    default: return Activity
  }
}

const getTimezoneDisplayName = (timezone: string) => {
  const timezoneMap = {
    'America/New_York': 'Eastern Time (EST/EDT)',
    'America/Chicago': 'Central Time (CST/CDT)',
    'America/Denver': 'Mountain Time (MST/MDT)',
    'America/Los_Angeles': 'Pacific Time (PST/PDT)',
    'Europe/London': 'London Time (GMT/BST)',
    'Europe/Paris': 'Central European Time (CET/CEST)',
    'Asia/Tokyo': 'Japan Time (JST)',
    'Asia/Shanghai': 'China Time (CST)',
    'Australia/Sydney': 'Australia Eastern Time (AEST/AEDT)',
    'UTC': 'UTC (Coordinated Universal Time)'
  }

  return timezoneMap[timezone] || timezone.replace('_', ' ').split('/').pop() || 'Local Time'
}

// Helper function to get plugin-specific icon (using local SVG files via PluginIcon)
const getPluginIcon = (pluginName: string) => {
  const name = pluginName.toLowerCase()
  // Use PluginIcon component for plugins with local SVG files
  if (name.includes('gmail') || name.includes('google-mail')) return <PluginIcon pluginId="google-mail" className="h-8 w-8" alt="Gmail" />
  if (name.includes('calendar')) return <PluginIcon pluginId="google-calendar" className="h-8 w-8" alt="Google Calendar" />
  if (name.includes('drive')) return <PluginIcon pluginId="google-drive" className="h-8 w-8" alt="Google Drive" />
  if (name.includes('docs') || name.includes('document')) return <PluginIcon pluginId="google-docs" className="h-8 w-8" alt="Google Docs" />
  if (name.includes('sheets') || name.includes('excel')) return <PluginIcon pluginId="google-sheets" className="h-8 w-8" alt="Google Sheets" />
  if (name.includes('github')) return <SiGithub className="h-8 w-8 text-gray-900" />
  if (name.includes('slack')) return <PluginIcon pluginId="slack" className="h-8 w-8" alt="Slack" />
  if (name.includes('hubspot') || name.includes('crm')) return <PluginIcon pluginId="hubspot" className="h-8 w-8" alt="HubSpot" />
  if (name.includes('notion')) return <SiNotion className="h-8 w-8 text-gray-900" />
  if (name.includes('whatsapp')) return <PluginIcon pluginId="whatsapp" className="h-8 w-8" alt="WhatsApp" />
  if (name.includes('airtable')) return <PluginIcon pluginId="airtable" className="h-8 w-8" alt="Airtable" />
  if (name.includes('chatgpt') || name.includes('openai')) return <PluginIcon pluginId="chatgpt-research" className="h-8 w-8" alt="ChatGPT" />
  if (name.includes('outlook') || name.includes('microsoft')) return <Mail className="h-8 w-8 text-blue-600" />
  if (name.includes('twilio') || name.includes('phone')) return <Phone className="h-8 w-8 text-red-600" />
  if (name.includes('aws') || name.includes('cloud')) return <Cloud className="h-8 w-8 text-orange-500" />
  if (name.includes('azure')) return <Cloud className="h-8 w-8 text-blue-600" />
  if (name.includes('database') || name.includes('db')) return <Database className="h-8 w-8 text-indigo-500" />
  if (name.includes('web') || name.includes('http')) return <Globe className="h-8 w-8 text-teal-500" />
  return <Puzzle className="h-8 w-8 text-rose-500" />
}

// Helper function to get plugin-specific background (now white for all to show brand colors)
const getPluginColor = (pluginName: string) => {
  // Use white background to show brand colors properly
  return 'from-white to-gray-50'
}

const formatScheduleWithTimezone = (mode: string, scheduleCron: string, timezone?: string, userTimezone?: string) => {
  const baseSchedule = formatScheduleDisplay(mode, scheduleCron)

  if (mode === 'scheduled' && timezone) {
    const timezoneDisplay = getTimezoneDisplayName(timezone)
    return `${baseSchedule} (${timezoneDisplay})`
  }

  return baseSchedule
}

export default function AgentPage() {
  const { user, connectedPlugins } = useAuth()
  const router = useRouter()
  const params = useParams()

  const agentId = (() => {
    if (Array.isArray(params.id)) {
      return params.id[0]
    }
    return params.id as string
  })()

  const [agent, setAgent] = useState<Agent | null>(null)
  const [userProfile, setUserProfile] = useState<{ timezone?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)
  const [showShareConfirm, setShowShareConfirm] = useState(false)
  const [showSetupRequired, setShowSetupRequired] = useState(false)
  const [showQuickActionsMenu, setShowQuickActionsMenu] = useState(false)
  const [memoryCount, setMemoryCount] = useState(0)
  const [userCredits, setUserCredits] = useState(0)
  const [isSharedAgent, setIsSharedAgent] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [showSuccessNotification, setShowSuccessNotification] = useState(false)
  const [creditsAwarded, setCreditsAwarded] = useState(0)
  const [sharingRewardAmount, setSharingRewardAmount] = useState(500)
  const [sharingValidation, setSharingValidation] = useState<any>(null)
  const [sharingStatus, setSharingStatus] = useState<any>(null)
  const [isConfigured, setIsConfigured] = useState(false)
  const [showActivationWarning, setShowActivationWarning] = useState(false)
  const [currentView, setCurrentView] = useState<'overview' | 'test' | 'history' | 'settings'>('overview')
  const [expandedPrompt, setExpandedPrompt] = useState(false)
  const [hasBeenShared, setHasBeenShared] = useState(false)
  const [shareRewardActive, setShareRewardActive] = useState(true)
  const [expandedSetup, setExpandedSetup] = useState(false)
  const [expandedTestPlayground, setExpandedTestPlayground] = useState(false)
  const [expandedActivity, setExpandedActivity] = useState(false)
  const [expandedOutputs, setExpandedOutputs] = useState(true) // Default expanded to show outputs
  const [expandedExecutionPreview, setExpandedExecutionPreview] = useState(false)
  const currentFormIsCompleteRef = useRef(false)

  // Performance stats state
  const [performanceStats, setPerformanceStats] = useState<{
    totalRuns: number
    successRate: number
    avgDuration: number
    totalCost: number
    recentExecutions: Array<{ status: string; duration: number }>
  }>({
    totalRuns: 0,
    successRate: 0,
    avgDuration: 0,
    totalCost: 0,
    recentExecutions: []
  })

  // Helper function to check plugin status
  const getPluginStatus = (plugin: string) => {
    if (!connectedPlugins) return false

    const pluginData = connectedPlugins[plugin]

    if (pluginData === undefined || pluginData === null) return false
    if (pluginData === false || pluginData === 'false') return false
    if (pluginData === 'disconnected' || pluginData === 'inactive') return false
    if (pluginData === '' || pluginData === 0) return false

    return true
  }

  const fetchUserProfile = async () => {
    if (!user?.id) return

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', user.id)
        .single()

      if (error) {
        console.warn('Could not fetch user profile timezone:', error)
      } else {
        setUserProfile(profile)
      }
    } catch (error) {
      console.warn('Error fetching user profile:', error)
    }
  }

  const getUserDetectedTimezone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch (error) {
      console.warn('Could not detect user timezone:', error)
      return 'UTC'
    }
  }

  const getEffectiveUserTimezone = () => {
    return userProfile?.timezone || getUserDetectedTimezone()
  }

  const checkAgentConfiguration = async (agentData: Agent) => {
    if (!user?.id) {
      setIsConfigured(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('agent_configurations')
        .select('input_values, input_schema')
        .eq('agent_id', agentData.id)
        .eq('user_id', user.id)
        .eq('status', 'configured')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('Error fetching configuration:', error)
        setIsConfigured(false)
        return
      }

      if (!data) {
        setIsConfigured(false)
        return
      }

      if (!data.input_schema || !Array.isArray(data.input_schema)) {
        setIsConfigured(true)
        return
      }

      const requiredFields = data.input_schema.filter((field: any) => field.required)

      if (requiredFields.length === 0) {
        setIsConfigured(true)
        return
      }

      const hasAllRequiredValues = requiredFields.every((field: any) => {
        const value = data.input_values?.[field.name]
        return value !== undefined && value !== null && value !== ''
      })

      setIsConfigured(hasAllRequiredValues)
    } catch (error) {
      console.error('Error in checkAgentConfiguration:', error)
      setIsConfigured(false)
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

  const fetchPerformanceStats = async () => {
    if (!agentId || !isValidUUID(agentId)) return

    try {
      // Fetch from agent_stats table
      const { data: stats } = await supabase
        .from('agent_stats')
        .select('run_count, success_count')
        .eq('agent_id', agentId)
        .maybeSingle()

      // Fetch execution details for duration and graph data
      const { data: executions, error: execError} = await supabase
        .from('agent_executions')
        .select('execution_duration_ms, started_at, completed_at, status')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(100)

      if (execError) {
        console.error('Error fetching executions:', execError)
      }

      const totalRuns = stats?.run_count || 0
      const successCount = stats?.success_count || 0
      const successRate = totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0

      // Calculate average duration from all executions with valid duration
      let avgDuration = 0
      if (executions && executions.length > 0) {
        const executionsWithDuration = executions.map(e => {
          // Use execution_duration_ms if available, otherwise calculate from timestamps
          let duration = e.execution_duration_ms
          if (!duration && e.started_at && e.completed_at) {
            duration = new Date(e.completed_at).getTime() - new Date(e.started_at).getTime()
          }
          return { ...e, duration }
        })

        const validExecutions = executionsWithDuration.filter(e => e.duration && e.duration > 0)
        if (validExecutions.length > 0) {
          const totalDuration = validExecutions.reduce((sum, e) => sum + (e.duration || 0), 0)
          avgDuration = totalDuration / validExecutions.length / 1000 // Convert to seconds
        }
      }

      // Fetch intensity data for total credits (creation + execution)
      let totalCost = 0
      try {
        console.log('[PerformanceStats] Fetching intensity data from:', `/api/agents/${agentId}/intensity`)
        const intensityResponse = await fetch(`/api/agents/${agentId}/intensity`, {
          headers: {
            'x-user-id': user.id,
          },
        })
        console.log('[PerformanceStats] Response status:', intensityResponse.status)

        if (intensityResponse.ok) {
          const intensityData = await intensityResponse.json()
          console.log('[PerformanceStats] Intensity data:', intensityData)
          const creationCredits = intensityData.details.creation_stats?.creation_tokens_used
            ? Math.ceil(intensityData.details.creation_stats.creation_tokens_used / 10)
            : 0
          const executionCredits = intensityData.details.token_stats?.total_tokens
            ? Math.ceil(intensityData.details.token_stats.total_tokens / 10)
            : 0
          totalCost = creationCredits + executionCredits
          console.log('[PerformanceStats] Calculated total cost:', totalCost, 'creation:', creationCredits, 'execution:', executionCredits)
        } else {
          const errorData = await intensityResponse.json()
          console.error('[PerformanceStats] Response not OK:', intensityResponse.status, errorData)
        }
      } catch (intensityError) {
        console.error('[PerformanceStats] Error fetching intensity data:', intensityError)
      }

      // Get last 10 executions for graph with calculated duration
      const recentExecutions = (executions?.slice(0, 10) || []).map(e => {
        let duration = e.execution_duration_ms
        if (!duration && e.started_at && e.completed_at) {
          duration = new Date(e.completed_at).getTime() - new Date(e.started_at).getTime()
        }
        return { status: e.status, duration: duration || 0 }
      })

      setPerformanceStats({
        totalRuns,
        successRate,
        avgDuration,
        totalCost,
        recentExecutions
      })
    } catch (error) {
      console.error('Error fetching performance stats:', error)
    }
  }

  const fetchAgent = async () => {
    if (!agentId || !isValidUUID(agentId)) {
      setError('Invalid assistant ID')
      setLoading(false)
      return
    }

    try {
      if (user?.id) {
        const { data: regularAgent } = await supabase
          .from('agents')
          .select('*, connected_plugins, plugins_required, workflow_steps, schedule_cron, timezone')
          .eq('id', agentId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (regularAgent) {
          setAgent(regularAgent)
          setIsSharedAgent(false)
          setIsOwner(true)
          await checkAgentConfiguration(regularAgent)

          const { data: sharedCheck } = await supabase
            .from('shared_agents')
            .select('id, shared_at')
            .eq('original_agent_id', regularAgent.id)
            .eq('user_id', user.id)

          const alreadyShared = sharedCheck && sharedCheck.length > 0
          setHasBeenShared(alreadyShared)

          setLoading(false)
          return
        }
      }

      const { data: sharedAgent } = await supabase
        .from('shared_agents')
        .select('*')
        .eq('id', agentId)
        .maybeSingle()

      if (sharedAgent) {
        setAgent({ ...sharedAgent, status: 'shared' })
        setIsSharedAgent(true)
        setIsOwner(sharedAgent.user_id === user?.id)
        setIsConfigured(true)
        setHasBeenShared(true)
      } else {
        setError('Assistant not found')
      }
      setLoading(false)
    } catch (error) {
      setError('Failed to load assistant')
      setLoading(false)
    }
  }

  const fetchUserCredits = async () => {
    if (!user?.id) return
    try {
      const { data } = await supabase
        .from('user_credits')
        .select('credits')
        .eq('user_id', user.id)
        .maybeSingle()
      setUserCredits(data?.credits || 0)
    } catch (error) {
      console.error('Error fetching credits:', error)
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

  const fetchMemoryCount = async () => {
    if (!agentId || !isValidUUID(agentId)) return

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

  const checkSharingEligibility = async () => {
    if (!user?.id || !agent?.id) return

    try {
      const { AgentSharingValidator } = await import('@/lib/credits/agentSharingValidation')
      const validator = new AgentSharingValidator(supabase)

      const validation = await validator.validateSharing(user.id, agent.id)
      setSharingValidation(validation)

      const status = await validator.getSharingStatus(user.id)
      setSharingStatus(status)
    } catch (error) {
      console.error('Error checking sharing eligibility:', error)
    }
  }

  useEffect(() => {
    if (agentId && isValidUUID(agentId)) {
      // Critical data: Load agent first (blocking)
      fetchAgent()

      // Non-critical data: Load in parallel (non-blocking)
      Promise.all([
        fetchMemoryCount(),
        fetchPerformanceStats(),
        fetchSharingRewardAmount(),
        fetchShareRewardStatus(),
        user ? fetchUserCredits() : Promise.resolve(),
        user ? fetchUserProfile() : Promise.resolve()
      ]).catch(err => console.error('Error loading secondary data:', err))
    } else if (agentId) {
      setError('Invalid assistant ID')
      setLoading(false)
    }
  }, [user, agentId])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showQuickActionsMenu && !(event.target as Element).closest('.relative')) {
        setShowQuickActionsMenu(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showQuickActionsMenu])

  const handleToggleStatus = async () => {
    if (!isOwner || isSharedAgent) return

    const newStatus = agent?.status === 'active' ? 'inactive' : 'active'

    if (newStatus === 'active' && !isConfigured && hasRequiredFields()) {
      setShowActivationWarning(true)
      return
    }

    if (agent?.status === 'active') {
      setShowDeactivateConfirm(true)
      return
    }

    setActionLoading('toggle')
    try {
      await supabase.from('agents').update({ status: newStatus }).eq('id', agentId)
      await fetchAgent()
    } finally {
      setActionLoading(null)
      setShowDeactivateConfirm(false)
    }
  }

  const handleShareAgent = async () => {
    if (!agent || !user || isSharedAgent || agent.status !== 'active' || hasBeenShared) {
      return
    }

    setActionLoading('share')
    try {
      const { RewardService } = await import('@/lib/credits/rewardService')
      const { AgentSharingValidator } = await import('@/lib/credits/agentSharingValidation')
      const rewardService = new RewardService(supabase)
      const validator = new AgentSharingValidator(supabase)

      const validation = await validator.validateSharing(user.id, agent.id)
      if (!validation.valid) {
        alert(validation.reason || 'This agent does not meet sharing requirements')
        return
      }

      const alreadyShared = await rewardService.hasSharedAgent(user.id, agent.id)
      if (alreadyShared) {
        setHasBeenShared(true)
        return
      }

      const { data: existingShared, error: checkError } = await supabase
        .from('shared_agents')
        .select('id')
        .eq('original_agent_id', agent.id)
        .eq('user_id', user.id)
        .limit(1)

      if (checkError) {
        console.error('Error checking existing shared agents:', checkError)
        return
      }

      if (existingShared && existingShared.length > 0) {
        setHasBeenShared(true)
        return
      }

      const { error: insertError } = await supabase.from('shared_agents').insert([{
        original_agent_id: agent.id,
        user_id: user.id,
        agent_name: agent.agent_name,
        description: agent.description,
        system_prompt: agent.system_prompt,
        user_prompt: agent.user_prompt,
        input_schema: agent.input_schema,
        output_schema: agent.output_schema,
        connected_plugins: agent.connected_plugins,
        plugins_required: agent.plugins_required,
        workflow_steps: agent.workflow_steps,
        mode: agent.mode,
        shared_at: new Date().toISOString()
      }])

      if (insertError) {
        console.error('Error sharing agent to shared_agents table:', insertError)
        return
      }

      const rewardResult = await rewardService.awardAgentSharingReward(
        user.id,
        agent.id,
        agent.agent_name
      )

      if (rewardResult.success) {
        setCreditsAwarded(rewardResult.creditsAwarded)
        await fetchUserCredits()
        setShowSuccessNotification(true)
        setTimeout(() => setShowSuccessNotification(false), 4000)
      } else {
        setCreditsAwarded(0)
        setShowSuccessNotification(true)
        setTimeout(() => setShowSuccessNotification(false), 4000)
      }

      setHasBeenShared(true)
    } catch (error) {
      console.error('Error in handleShareAgent:', error)
    } finally {
      setActionLoading(null)
      setShowShareConfirm(false)
    }
  }

  const handleDelete = async () => {
    if (!isOwner || isSharedAgent) return
    setActionLoading('delete')
    try {
      await supabase.from('agents').update({ is_archived: true }).eq('id', agentId)
      router.push('/agents')
    } finally {
      setActionLoading(null)
      setShowDeleteConfirm(false)
    }
  }

  const hasRequiredFields = () => {
    if (!agent?.input_schema) return false
    const inputSchema = Array.isArray(agent.input_schema) ? agent.input_schema : []
    return inputSchema.some((field: any) => field.required)
  }

  const handleExportConfiguration = () => {
    if (!agent) return

    const exportData = {
      agent_name: agent.agent_name,
      description: agent.description,
      system_prompt: agent.system_prompt,
      user_prompt: agent.user_prompt,
      input_schema: agent.input_schema,
      output_schema: agent.output_schema,
      plugins_required: agent.plugins_required,
      workflow_steps: agent.workflow_steps,
      mode: agent.mode,
      schedule_cron: agent.schedule_cron,
      timezone: agent.timezone,
      exported_at: new Date().toISOString(),
      export_version: "1.0"
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
          system_prompt: agent.system_prompt,
          user_prompt: agent.user_prompt,
          input_schema: agent.input_schema,
          output_schema: agent.output_schema,
          connected_plugins: agent.connected_plugins,
          plugins_required: agent.plugins_required,
          workflow_steps: agent.workflow_steps,
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

      router.push(`/agents/${newAgent.id}`)
    } catch (error) {
      console.error('Error duplicating agent:', error)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-xl shadow-blue-500/25">
            <Bot className="h-8 w-8 text-white animate-pulse" />
          </div>
          <p className="text-slate-600 font-semibold text-lg tracking-tight">Loading your assistant...</p>
        </div>
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-6 mx-auto">
            <Bot className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-4 tracking-tight">Assistant Not Found</h2>
          <p className="text-slate-600 mb-8">This assistant doesn't exist or you don't have access to it.</p>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Assistants
          </Link>
        </div>
      </div>
    )
  }

  const statusConfig = getStatusConfig(agent.status || 'unknown')
  const StatusIcon = statusConfig.icon
  const ModeIcon = getModeIcon(agent.mode || 'on_demand')
  const canActivate = isConfigured || !hasRequiredFields() || currentFormIsCompleteRef.current

  const safePluginsRequired = Array.isArray(agent.plugins_required) ? agent.plugins_required : []
  const humanOutputs = Array.isArray(agent.output_schema) ? agent.output_schema.filter(o => !o.category || o.category === 'human-facing') : []
  const systemOutputs = Array.isArray(agent.output_schema) ? agent.output_schema.filter(o => o.category === 'system' || o.category === 'machine-facing') : []
  const missingPlugins = safePluginsRequired.filter(plugin => !getPluginStatus(plugin))

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">

      {/* Success Notification */}
      {showSuccessNotification && (
        <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6 max-w-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-slate-900 text-sm tracking-tight">Shared Successfully!</h4>
                <p className="text-xs text-slate-600 mt-1">
                  {creditsAwarded > 0 ? `+${creditsAwarded} credits earned` : 'Agent shared with community'}
                </p>
              </div>
              <button
                onClick={() => setShowSuccessNotification(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-all duration-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-lg">
        <div className="max-w-7xl mx-auto px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link
                href={isSharedAgent ? "/community" : "/agents"}
                className="group p-2.5 hover:bg-slate-100 rounded-xl transition-all duration-200 hover:shadow-md hover:scale-105"
              >
                <ArrowLeft className="h-5 w-5 text-slate-600 group-hover:text-slate-900 transition-colors" />
              </Link>

              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 ring-2 ring-white">
                    <Bot className="h-7 w-7 text-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-slate-900 leading-tight tracking-tight">{agent.agent_name}</h1>
                    {agent.status === 'shared' && (
                      <div className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200">
                        <Users className="h-3 w-3" />
                        Community
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-sm text-slate-600">
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ${statusConfig.bg} border ${statusConfig.border} ${statusConfig.pulse} shadow-sm`}>
                      <div className={`w-1.5 h-1.5 ${statusConfig.color === 'text-emerald-600' ? 'bg-emerald-500' : statusConfig.color === 'text-amber-600' ? 'bg-amber-500' : 'bg-slate-400'} rounded-full ${statusConfig.pulse}`}></div>
                      <span className={`font-semibold text-xs ${statusConfig.color}`}>{statusConfig.label}</span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-gradient-to-r from-slate-50 to-gray-50 px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">
                      <ModeIcon className="h-3.5 w-3.5 text-slate-500" />
                      <span className="font-semibold text-xs">
                        {agent.mode === 'on_demand' ? 'On Demand' :
                         agent.mode === 'scheduled' ? 'Scheduled' :
                         agent.mode === 'triggered' ? 'Event Triggered' : 'Standard'}
                      </span>
                    </div>

                    {memoryCount > 0 && (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 shadow-sm">
                        <Brain className="h-4 w-4 text-purple-600" />
                        <span className="font-semibold text-purple-700 text-xs">
                          Learning Active
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions Icons - Right Side */}
            {!isSharedAgent && isOwner && (
              <div className="flex items-center gap-2">
                      {/* Launch/Pause Button */}
                      {agent.status === 'active' ? (
                        <button
                          onClick={() => setShowDeactivateConfirm(true)}
                          className="group relative w-10 h-10 bg-white border-2 border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50 hover:border-orange-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center"
                          title="Pause Agent"
                        >
                          <Pause className="h-5 w-5" />
                          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                            Pause
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (canActivate) {
                              handleToggleStatus()
                            } else {
                              // Show setup required modal
                              setShowSetupRequired(true)
                            }
                          }}
                          className="group relative w-10 h-10 bg-white border-2 border-green-200 text-green-600 rounded-lg hover:bg-green-50 hover:border-green-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center"
                          title="Launch Agent"
                        >
                          <Rocket className="h-5 w-5" />
                          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                            Launch
                          </span>
                        </button>
                      )}

                      {/* Share Button */}
                      {shareRewardActive && (
                        <button
                          onClick={async () => {
                            await checkSharingEligibility()
                            setShowShareConfirm(true)
                          }}
                          disabled={agent.status !== 'active'}
                          className="group relative w-10 h-10 bg-white border-2 border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                          title="Share Agent"
                        >
                          <Share2 className="h-5 w-5" />
                          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                            Share
                          </span>
                        </button>
                      )}

                      {/* Test Button */}
                      <button
                        onClick={() => {
                          setExpandedTestPlayground(true)
                          setTimeout(() => {
                            const element = document.querySelector('[data-card="test-playground"]')
                            element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }, 100)
                        }}
                        className="group relative w-10 h-10 bg-white border-2 border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center"
                        title="Test Agent"
                      >
                        <FlaskConical className="h-5 w-5" />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                          Test
                        </span>
                      </button>

                      {/* Edit Button */}
                      <Link
                        href={`/agents/${agent.id}/edit`}
                        className="group relative w-10 h-10 bg-white border-2 border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center"
                        title="Edit Agent"
                      >
                        <Edit className="h-5 w-5" />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                          Edit
                        </span>
                      </Link>

                      {/* Activity Button */}
                      <button
                        onClick={() => {
                          setExpandedActivity(true)
                          setTimeout(() => {
                            const element = document.querySelector('[data-card="recent-activity"]')
                            element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }, 100)
                        }}
                        className="group relative w-10 h-10 bg-white border-2 border-amber-200 text-amber-600 rounded-lg hover:bg-amber-50 hover:border-amber-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center"
                        title="View Activity"
                      >
                        <Activity className="h-5 w-5" />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                          Activity
                        </span>
                      </button>

                      {/* Export Button */}
                      <button
                        onClick={handleExportConfiguration}
                        className="group relative w-10 h-10 bg-white border-2 border-green-200 text-green-600 rounded-lg hover:bg-green-50 hover:border-green-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center"
                        title="Export Configuration"
                      >
                        <Download className="h-5 w-5" />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                          Export
                        </span>
                      </button>

                      {/* Duplicate Button */}
                      <button
                        onClick={handleDuplicateAgent}
                        disabled={actionLoading === 'duplicate'}
                        className="group relative w-10 h-10 bg-white border-2 border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                        title="Duplicate Agent"
                      >
                        <Copy className="h-5 w-5" />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                          Duplicate
                        </span>
                      </button>

                      {/* Delete Button */}
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="group relative w-10 h-10 bg-white border-2 border-red-200 text-red-600 rounded-lg hover:bg-red-50 hover:border-red-300 transition-all duration-200 hover:scale-110 shadow-sm hover:shadow-md flex items-center justify-center"
                        title="Delete Agent"
                      >
                        <Trash2 className="h-5 w-5" />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                          Delete
                        </span>
                      </button>
                    </div>
                  )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="space-y-6">

          {/* Row 1: What This Agent Does + Plugins + Current Status */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Combined Description + Outputs Card - 3 columns (wider) */}
            <div className="lg:col-span-3 bg-gradient-to-br from-indigo-50 via-white to-blue-50 rounded-2xl border border-gray-200 shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                    <FileText className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">What This Agent Does</h3>
                    <p className="text-[10px] text-gray-500">Description & outputs</p>
                  </div>
                </div>
                <button
                  onClick={() => setExpandedPrompt(!expandedPrompt)}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-semibold text-[10px] transition-all duration-200"
                >
                  {expandedPrompt ? (
                    <>
                      <EyeOff className="h-3 w-3" />
                      Hide Prompt
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" />
                      View Prompt
                    </>
                  )}
                </button>
              </div>

              {/* Description */}
              {agent.description ? (
                <p className="text-sm text-gray-700 leading-relaxed mb-4">{agent.description}</p>
              ) : (
                <p className="text-sm text-gray-500 italic mb-4">No description provided</p>
              )}

              {/* Outputs Section */}
              {(humanOutputs.length > 0 || systemOutputs.length > 0) && (
                <div className="pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-semibold text-gray-700">
                      What you'll get ({humanOutputs.length + systemOutputs.length} output{(humanOutputs.length + systemOutputs.length) !== 1 ? 's' : ''})
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* Human Outputs */}
                    {humanOutputs.length > 0 && (
                      <div className="space-y-2">
                        {humanOutputs.map((field: any, index: number) => {
                          const getUserFriendlyType = (type: string) => {
                            const typeMap: Record<string, { label: string; Icon: any; iconColor: string; bgColor: string }> = {
                              'EmailDraft': { label: 'Email', Icon: Mail, iconColor: 'text-blue-600', bgColor: 'bg-blue-100' },
                              'PluginAction': { label: 'Action', Icon: Zap, iconColor: 'text-purple-600', bgColor: 'bg-purple-100' },
                              'SummaryBlock': { label: 'Report', Icon: FileBarChart, iconColor: 'text-green-600', bgColor: 'bg-green-100' },
                              'Alert': { label: 'Notification', Icon: Bell, iconColor: 'text-orange-600', bgColor: 'bg-orange-100' },
                              'string': { label: 'Text', Icon: MessageSquare, iconColor: 'text-cyan-600', bgColor: 'bg-cyan-100' },
                              'object': { label: 'Data', Icon: Database, iconColor: 'text-indigo-600', bgColor: 'bg-indigo-100' },
                              'array': { label: 'List', Icon: List, iconColor: 'text-teal-600', bgColor: 'bg-teal-100' }
                            };
                            return typeMap[type] || { label: 'Result', Icon: Sparkles, iconColor: 'text-amber-600', bgColor: 'bg-amber-100' };
                          };

                          const typeInfo = getUserFriendlyType(field.type);
                          const IconComponent = typeInfo.Icon;

                          return (
                            <div key={index} className="flex items-center gap-3 p-3 bg-white/80 backdrop-blur rounded-xl border border-gray-200/50 hover:border-blue-300 hover:shadow-md transition-all duration-200">
                              <div className={`w-8 h-8 ${typeInfo.bgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                                <IconComponent className={`h-4 w-4 ${typeInfo.iconColor}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900">{field.name}</div>
                                {field.description && (
                                  <div className="text-xs text-gray-500 mt-0.5">{field.description}</div>
                                )}
                              </div>
                              <div className={`px-2 py-1 rounded-md text-xs font-medium ${typeInfo.bgColor} ${typeInfo.iconColor}`}>
                                {typeInfo.label}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Full Instructions (expandable) */}
              {expandedPrompt && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-[10px] text-gray-600 mb-2 uppercase tracking-wide font-semibold">Full Instructions</p>
                  <div className="text-xs text-gray-700 bg-white p-3 rounded-lg border border-gray-200 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                    {agent.user_prompt}
                  </div>
                </div>
              )}
            </div>

            {/* Plugin Requirements Card - 1 column */}
            <div className="lg:col-span-1 bg-gradient-to-br from-rose-50 via-white to-pink-50 rounded-2xl border border-gray-200 shadow-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                  <Puzzle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Plugins</h3>
                  <p className="text-[10px] text-gray-500">{safePluginsRequired.length} {safePluginsRequired.length === 1 ? 'integration' : 'integrations'}</p>
                </div>
              </div>

              {safePluginsRequired.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {safePluginsRequired.map(plugin => {
                    const isConnected = getPluginStatus(plugin)
                    return (
                      <div
                        key={plugin}
                        className="group relative"
                        title={`${plugin} - ${isConnected ? 'Connected' : 'Not connected'}`}
                      >
                        {/* Plugin Icon with Status Badge */}
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getPluginColor(plugin)} flex items-center justify-center shadow-md transition-all duration-300 hover:scale-110 cursor-pointer`}>
                          {getPluginIcon(plugin)}
                        </div>
                        {/* Status Badge Overlay */}
                        <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full border-2 border-white shadow-md flex items-center justify-center transition-all duration-300 ${
                          isConnected ? 'bg-green-500' : 'bg-red-500'
                        }`}>
                          {isConnected && (
                            <Check className="h-3 w-3 text-white" strokeWidth={3} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 px-4">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                    <Puzzle className="h-6 w-6 text-gray-400" />
                  </div>
                  <p className="text-gray-500 text-xs text-center">No plugins required</p>
                  <p className="text-gray-400 text-[10px] text-center mt-1">This agent works standalone</p>
                </div>
              )}
            </div>

            {/* Current Status Card - 1 column (narrower) */}
            <div className="lg:col-span-1 bg-gradient-to-br from-blue-50 via-white to-purple-50 rounded-2xl border border-gray-200 shadow-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                  <StatusIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Current Status</h3>
                  <p className={`text-xs font-bold ${statusConfig.color}`}>{statusConfig.label}</p>
                </div>
              </div>

              {/* Agent ID - Copyable */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1.5">
                    <Target className="h-3 w-3" />
                    <span className="uppercase tracking-wide font-semibold">Agent ID</span>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(agent.id)}
                    className="flex items-center gap-2 text-[10px] text-gray-600 font-mono hover:text-gray-900 hover:bg-gray-50 px-2 py-1.5 rounded transition-all duration-200 group w-full"
                  >
                    <span className="truncate flex-1 text-left">{agent.id}</span>
                    <Copy className="h-3 w-3 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
                  </button>
                </div>

                {/* Schedule */}
                <div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1.5">
                    <ModeIcon className="h-3 w-3" />
                    <span className="uppercase tracking-wide font-semibold">Schedule</span>
                  </div>
                  <p className="text-xs text-gray-700 font-medium px-2">{formatScheduleDisplay(agent.mode, agent.schedule_cron)}</p>
                </div>

                {/* Created */}
                <div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1.5">
                    <Clock className="h-3 w-3" />
                    <span className="uppercase tracking-wide font-semibold">Created</span>
                  </div>
                  <p className="text-xs text-gray-700 font-medium px-2">
                    {agent.created_at ? new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Performance and AIS */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Performance Metrics Card - 2 columns */}
            <div className="lg:col-span-2 bg-gradient-to-br from-green-50 via-white to-emerald-50 rounded-2xl border border-gray-200 shadow-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Performance</h3>
                  <p className="text-[10px] text-gray-500">Execution metrics & trends</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200/50 shadow-sm">
                    <div className="text-2xl font-bold text-blue-600">{performanceStats.totalRuns}</div>
                    <div className="text-xs font-medium text-blue-700 uppercase tracking-wide mt-1">Runs</div>
                  </div>

                  <div className="text-center p-3 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg border border-green-200/50 shadow-sm">
                    <div className="text-2xl font-bold text-green-600">{performanceStats.successRate}%</div>
                    <div className="text-xs font-medium text-green-700 uppercase tracking-wide mt-1">Success</div>
                  </div>

                  <div className="text-center p-3 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border border-purple-200/50 shadow-sm">
                    <div className="text-2xl font-bold text-purple-600">{performanceStats.avgDuration.toFixed(1)}s</div>
                    <div className="text-xs font-medium text-purple-700 uppercase tracking-wide mt-1">Speed</div>
                  </div>

                  <div className="text-center p-3 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg border border-amber-200/50 shadow-sm">
                    <div className="text-2xl font-bold text-amber-600">{Number(performanceStats.totalCost.toFixed(0)).toLocaleString()}</div>
                    <div className="text-xs font-medium text-amber-700 uppercase tracking-wide mt-1">Total Pilot Credits</div>
                  </div>
                </div>

                {/* Performance Trend Graph */}
                <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-lg border border-slate-200/50 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-medium text-slate-600">
                      Execution Duration Trend {performanceStats.recentExecutions.length > 0 && `(Last ${performanceStats.recentExecutions.length})`}
                    </div>
                    {performanceStats.recentExecutions.length > 0 && (
                      <div className="text-[10px] text-slate-500">
                        {(() => {
                          const durations = performanceStats.recentExecutions.map(e => e.duration / 1000)
                          const min = Math.min(...durations)
                          const max = Math.max(...durations)
                          const range = max - min
                          const trend = durations.length >= 2
                            ? durations[durations.length - 1] - durations[0]
                            : 0
                          return (
                            <span className={trend > 1 ? 'text-orange-600' : trend < -1 ? 'text-green-600' : 'text-slate-500'}>
                              {trend > 1 ? '↗ Slowing' : trend < -1 ? '↘ Improving' : '→ Stable'}
                            </span>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                  {performanceStats.recentExecutions.length > 0 ? (
                    <>
                      <div className="relative">
                        {/* Y-axis labels */}
                        <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[9px] text-slate-400 pr-1">
                          <span>{Math.max(...performanceStats.recentExecutions.map(e => e.duration / 1000)).toFixed(1)}s</span>
                          <span>{(Math.max(...performanceStats.recentExecutions.map(e => e.duration / 1000)) / 2).toFixed(1)}s</span>
                          <span>0s</span>
                        </div>
                        <div className="ml-8 flex items-end justify-between h-24 gap-1 bg-white/50 rounded-lg p-2 border-l-2 border-b-2 border-slate-300">
                          {performanceStats.recentExecutions.map((execution, i) => {
                            const durations = performanceStats.recentExecutions.map(e => e.duration || 0)
                            const minDuration = Math.min(...durations)
                            const maxDuration = Math.max(...durations)
                            const range = maxDuration - minDuration

                            // Use relative scaling for better visualization
                            const heightPercent = range > 0
                              ? ((execution.duration - minDuration) / range) * 80 + 20
                              : 50

                            const isSuccess = execution.status === 'success' || execution.status === 'completed'
                            const durationSec = execution.duration / 1000

                            return (
                              <div key={i} className="flex-1 flex flex-col justify-end group relative min-w-[6px]">
                                <div
                                  className={`w-full rounded-t transition-all duration-300 min-h-[12px] shadow-sm ${
                                    isSuccess ? 'bg-gradient-to-t from-green-500 to-emerald-400' : 'bg-gradient-to-t from-red-500 to-orange-400'
                                  }`}
                                  style={{ height: `${heightPercent}%` }}
                                />
                                {/* Enhanced Tooltip */}
                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2.5 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 shadow-lg">
                                  <div className="font-semibold mb-0.5">{isSuccess ? '✓ Success' : '✗ Failed'}</div>
                                  <div>Duration: {durationSec.toFixed(2)}s</div>
                                  <div className="text-[9px] text-gray-300 mt-0.5">Run #{performanceStats.recentExecutions.length - i}</div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[9px] text-slate-500 ml-8">
                        <span>← Oldest</span>
                        <span>
                          Range: {(Math.max(...performanceStats.recentExecutions.map(e => e.duration / 1000)) -
                                  Math.min(...performanceStats.recentExecutions.map(e => e.duration / 1000))).toFixed(1)}s
                        </span>
                        <span>Recent →</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-16 text-slate-400">
                      <TrendingUp className="h-6 w-6 mb-1 opacity-30" />
                      <p className="text-[10px]">No execution data yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* AIS Complexity Card - 3 columns */}
            <div className="lg:col-span-3">
              <AgentIntensityCard agentId={agent.id} />
            </div>
          </div>

          {/* Setup/Configuration Card - Collapsible */}
          {hasRequiredFields() && (
            <div data-card="setup-card" className="bg-gradient-to-br from-blue-50 via-white to-cyan-50 rounded-2xl border border-gray-200 shadow-lg overflow-hidden" style={{ contentVisibility: 'auto' }}>
              <button
                onClick={() => setExpandedSetup(!expandedSetup)}
                type="button"
                className="w-full p-6 flex items-center justify-between hover:bg-blue-100/50 group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                    <Settings className="h-5 w-5 text-white" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-semibold text-gray-700">Agent Setup</h3>
                    <p className="text-[10px] text-gray-500">Configure agent inputs</p>
                  </div>
                </div>
                <div className="text-gray-400 group-hover:text-gray-600">
                  {expandedSetup ? (
                    <ChevronUp className="h-5 w-5" />
                  ) : (
                    <ChevronDown className="h-5 w-5" />
                  )}
                </div>
              </button>

              {expandedSetup && (
                <div className="px-6 pb-6 pt-4 border-t border-blue-200">
                  <AgentSandbox
                    agentId={agent.id}
                    inputSchema={agent.input_schema}
                    outputSchema={agent.output_schema}
                    userPrompt={agent.user_prompt}
                    pluginsRequired={agent.plugins_required}
                    workflowSteps={agent.workflow_steps}
                    connectedPlugins={agent.connected_plugins}
                    initialContext="configure"
                    onFormCompletionChange={(isComplete) => {
                      currentFormIsCompleteRef.current = isComplete
                    }}
                    onExecutionComplete={() => {
                      // Do nothing - avoid triggering state updates that cause flicker
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Test Playground Card - Collapsible */}
          <div data-card="test-playground" className="bg-gradient-to-br from-purple-50 via-white to-pink-50 rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
            <button
              onClick={() => setExpandedTestPlayground(!expandedTestPlayground)}
              className="w-full p-6 flex items-center justify-between hover:bg-purple-100/50 transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                  <Play className="h-5 w-5 text-white" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-gray-700">Test Playground</h3>
                  <p className="text-[10px] text-gray-500">
                    {expandedTestPlayground ? 'Click to collapse' : 'Click to expand and test your agent'}
                  </p>
                </div>
              </div>
              <div className="text-gray-400 group-hover:text-gray-600 transition-colors">
                {expandedTestPlayground ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </div>
            </button>

            {expandedTestPlayground && (
              <div className="px-6 pb-6 pt-4 border-t border-purple-200">
                <AgentSandbox
                  agentId={agent.id}
                  inputSchema={agent.input_schema}
                  outputSchema={agent.output_schema}
                  userPrompt={agent.user_prompt}
                  pluginsRequired={agent.plugins_required}
                  workflowSteps={agent.workflow_steps}
                  connectedPlugins={agent.connected_plugins}
                  initialContext="test"
                  onFormCompletionChange={(isComplete) => {
                    currentFormIsCompleteRef.current = isComplete
                  }}
                  onExecutionComplete={() => {
                    if (hasRequiredFields()) {
                      setTimeout(() => checkAgentConfiguration(agent), 500)
                    }
                    fetchPerformanceStats()
                  }}
                />
              </div>
            )}
          </div>

          {/* Recent Activity Card - Collapsible */}
          <div data-card="recent-activity" className="bg-gradient-to-br from-amber-50 via-white to-orange-50 rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
            <button
              onClick={() => setExpandedActivity(!expandedActivity)}
              className="w-full p-6 flex items-center justify-between hover:bg-amber-100/50 transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                  <Activity className="h-5 w-5 text-white" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-gray-700">Recent Activity</h3>
                  <p className="text-[10px] text-gray-500">
                    {expandedActivity
                      ? 'Click to collapse'
                      : performanceStats.totalRuns > 0
                        ? `${performanceStats.totalRuns} execution${performanceStats.totalRuns === 1 ? '' : 's'} - Click to view`
                        : 'No executions yet'}
                  </p>
                </div>
              </div>
              <div className="text-gray-400 group-hover:text-gray-600 transition-colors">
                {expandedActivity ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </div>
            </button>

            {expandedActivity && performanceStats.totalRuns > 0 && (
              <div className="px-6 pb-6 pt-4 border-t border-amber-200">
                <AgentHistoryBlock agentId={agent.id} />
              </div>
            )}

            {expandedActivity && performanceStats.totalRuns === 0 && (
              <div className="px-6 pb-6 pt-4 border-t border-amber-200">
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Activity className="h-8 w-8 text-amber-600" />
                  </div>
                  <p className="text-sm text-gray-600 mb-2">No activity yet</p>
                  <p className="text-xs text-gray-500">Test your agent to see execution history</p>
                </div>
              </div>
            )}
          </div>

          {/* Workflow Preview Card - Collapsible */}
          <div data-card="workflow-preview" className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
            <button
              onClick={() => setExpandedExecutionPreview(!expandedExecutionPreview)}
              className="w-full p-6 flex items-center justify-between hover:bg-indigo-100/50 transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                  <Play className="h-5 w-5 text-white" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-gray-700">Workflow Visualization</h3>
                  <p className="text-[10px] text-gray-500">
                    {expandedExecutionPreview ? 'Click to collapse' : `${agent?.workflow_steps?.length || 0} steps - Click to view`}
                  </p>
                </div>
              </div>
              <div className="text-gray-400 group-hover:text-gray-600 transition-colors">
                {expandedExecutionPreview ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </div>
            </button>

            {expandedExecutionPreview && agent && agent.workflow_steps && agent.workflow_steps.length > 0 && (
              <div className="px-6 pb-6 pt-4 border-t border-indigo-200">
                {/* Animated Workflow Visualization */}
                <div className="mb-8">
                  <SimpleDynamicWorkflow
                    agent={{
                      agent_name: agent.agent_name,
                      description: agent.description || '',
                      workflow_steps: agent.workflow_steps || [],
                      plugins_required: agent.plugins_required || [],
                      connected_plugins: connectedPlugins ? Object.keys(connectedPlugins) : []
                    }}
                  />
                </div>

                {/* Workflow Steps Visualization */}
                <div className="relative">
                  {/* Vertical Flow Line */}
                  <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-orange-200 via-pink-200 to-purple-200" />

                  <div className="space-y-3">
                    {agent.workflow_steps.map((step: any, idx: number) => (
                      <div key={idx} className="relative flex items-start gap-4 group">
                        {/* Step Number Badge */}
                        <div className="relative flex-shrink-0 z-10">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white text-sm font-bold shadow-lg ring-4 ring-white">
                            {idx + 1}
                          </div>
                          {step.validated && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow-sm border-2 border-white">
                              <CheckCircle className="h-3 w-3 text-white fill-current" />
                            </div>
                          )}
                        </div>

                        {/* Flow Card */}
                        <div className="flex-1 min-w-0">
                          <div className="relative p-4 bg-white/90 backdrop-blur rounded-xl border border-gray-200/50 shadow-sm group-hover:shadow-md group-hover:border-orange-300 transition-all duration-200">
                            <div className="absolute left-0 top-5 -ml-2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-white/90" />

                            <div className="space-y-3">
                              <div>
                                <div className="text-xs font-medium text-orange-600 mb-1">Step {idx + 1}</div>
                                <div className="text-sm font-semibold text-gray-900 leading-snug">
                                  {step.action || step.operation}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                {step.plugin && step.plugin_action ? (
                                  <>
                                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-50 to-pink-50 rounded-lg border border-orange-200/50 shadow-sm">
                                      <Settings className="h-3.5 w-3.5" />
                                      <span className="text-xs font-medium text-gray-700">{step.plugin}</span>
                                    </div>
                                    <div className="flex items-center gap-1 text-gray-400">
                                      <div className="w-6 h-[1px] bg-gray-300" />
                                      <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-gray-300" />
                                    </div>
                                    <div className="px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                                      <span className="text-xs text-gray-700 font-medium">{step.plugin_action}</span>
                                    </div>
                                  </>
                                ) : (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg border border-purple-200/50 shadow-sm">
                                    <Bot className="h-3.5 w-3.5 text-purple-600" />
                                    <span className="text-xs font-medium text-purple-700">
                                      {step.operation && (step.operation.toLowerCase().includes('determine') || step.operation.toLowerCase().includes('decide') || step.operation.toLowerCase().includes('check if'))
                                        ? 'Condition'
                                        : 'AI Processing'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {expandedExecutionPreview && agent && (!agent.workflow_steps || agent.workflow_steps.length === 0) && (
              <div className="px-6 pb-6 pt-4 border-t border-indigo-200">
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Play className="h-8 w-8 text-indigo-600" />
                  </div>
                  <p className="text-sm text-gray-600 mb-2">No workflow steps</p>
                  <p className="text-xs text-gray-500">This agent doesn't have a defined workflow</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* All Modals */}
      <Modal isOpen={showActivationWarning} onClose={() => setShowActivationWarning(false)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-2 text-lg tracking-tight">Configuration Required</h3>
              <p className="text-slate-600 mb-4">
                Complete the configuration in the Test section first.
              </p>
              <button
                onClick={() => setShowActivationWarning(false)}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl hover:from-blue-600 hover:to-purple-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl hover:scale-105"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showShareConfirm} onClose={() => setShowShareConfirm(false)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg tracking-tight">Share "{agent.agent_name}" with Community</h3>

              {hasBeenShared || (sharingValidation?.details?.alreadyShared) ? (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-4 shadow-md">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-5 w-5 text-amber-600" />
                    <span className="font-semibold text-amber-800">Already Shared</span>
                  </div>
                  <p className="text-amber-700 text-sm">
                    This assistant has already been shared with the community.
                  </p>
                </div>
              ) : sharingValidation && !sharingValidation.valid ? (
                <div className="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-xl p-4 mb-4 shadow-md">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                    <span className="font-semibold text-red-800">Cannot Share Yet</span>
                  </div>
                  <p className="text-red-700 text-sm mb-3">
                    {sharingValidation.reason}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 mb-4">
                  {sharingValidation && sharingValidation.valid && (
                    <div className="bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-3 shadow-md">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        <span className="font-semibold text-emerald-800">Quality Requirements Met</span>
                      </div>
                    </div>
                  )}

                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-3 shadow-md">
                    <div className="flex items-center gap-2 mb-2">
                      <Coins className="h-5 w-5 text-green-600" />
                      <span className="font-semibold text-green-800">Earn {sharingRewardAmount} Credits</span>
                    </div>
                    <p className="text-green-700 text-sm">You'll receive credits when you share this assistant.</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowShareConfirm(false)}
                  className="flex-1 px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all duration-200 font-semibold shadow-md hover:shadow-lg hover:scale-105"
                >
                  {(hasBeenShared || sharingValidation?.details?.alreadyShared) ? 'Close' : 'Cancel'}
                </button>
                {!hasBeenShared && !sharingValidation?.details?.alreadyShared && (sharingValidation && !sharingValidation.valid ? null : (
                  <button
                    onClick={handleShareAgent}
                    disabled={actionLoading === 'share' || (sharingValidation && !sharingValidation.valid)}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl hover:from-blue-600 hover:to-purple-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    {actionLoading === 'share' ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Sharing...
                      </div>
                    ) : (
                      'Share & Earn Credits'
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-red-400 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg tracking-tight">Delete "{agent.agent_name}"</h3>

              <div className="space-y-3 mb-4">
                <div className="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-xl p-3 shadow-md">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                    <span className="font-semibold text-red-800">This action cannot be undone</span>
                  </div>
                  <p className="text-red-700 text-sm">Once deleted, you cannot recover this assistant or its configuration.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all duration-200 font-semibold shadow-md hover:shadow-lg hover:scale-105"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={actionLoading === 'delete'}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-xl hover:from-red-600 hover:to-pink-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                >
                  {actionLoading === 'delete' ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Deleting...
                    </div>
                  ) : (
                    'Delete Forever'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showDeactivateConfirm} onClose={() => setShowDeactivateConfirm(false)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center shadow-lg">
              <Pause className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg tracking-tight">Pause "{agent.agent_name}"</h3>

              <div className="space-y-3 mb-4">
                <div className="bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 rounded-xl p-3 shadow-md">
                  <div className="flex items-center gap-2 mb-2">
                    <Pause className="h-5 w-5 text-orange-600" />
                    <span className="font-semibold text-orange-800">What happens when paused:</span>
                  </div>
                  <ul className="text-orange-700 text-sm space-y-1">
                    <li>All automated executions will stop</li>
                    <li>You can reactivate anytime</li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeactivateConfirm(false)}
                  className="flex-1 px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all duration-200 font-semibold shadow-md hover:shadow-lg hover:scale-105"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setActionLoading('toggle')
                    try {
                      await supabase.from('agents').update({ status: 'inactive' }).eq('id', agentId)
                      await fetchAgent()
                    } finally {
                      setActionLoading(null)
                      setShowDeactivateConfirm(false)
                    }
                  }}
                  disabled={actionLoading === 'toggle'}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-xl hover:from-orange-600 hover:to-red-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                >
                  {actionLoading === 'toggle' ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Pausing...
                    </div>
                  ) : (
                    'Pause Agent'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Setup Required Modal */}
      <Modal isOpen={showSetupRequired} onClose={() => setShowSetupRequired(false)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
              <Settings className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg tracking-tight">Configuration Required</h3>

              <div className="space-y-3 mb-4">
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3 shadow-md">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="h-5 w-5 text-amber-600" />
                    <span className="font-semibold text-amber-800">Setup needed to launch</span>
                  </div>
                  <p className="text-amber-700 text-sm">Please fill in the required inputs in the Agent Setup section to activate this agent.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowSetupRequired(false)}
                  className="flex-1 px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all duration-200 font-semibold shadow-md hover:shadow-lg hover:scale-105"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowSetupRequired(false)
                    setExpandedSetup(true)
                    setTimeout(() => {
                      const element = document.querySelector('[data-card="setup-card"]')
                      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, 100)
                  }}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl hover:from-amber-600 hover:to-orange-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl hover:scale-105"
                >
                  Go to Setup
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

    </div>
  )
}
