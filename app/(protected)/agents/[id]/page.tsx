'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter'
import AgentStatsBlock from '@/components/dashboard/AgentStatsTable'
import AgentHistoryBlock from '@/components/dashboard/AgentHistoryBlock'
import AgentSandbox from '@/components/dashboard/AgentSandBox/AgentSandbox'
import {
  Bot,
  Edit,
  Trash2,
  Power,
  PowerOff,
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
  Link2,
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
  Heart,
  ChevronDown,
  ChevronUp,
  Code2,
  Info,
  Sparkles,
  Timer,
  Puzzle,
  Star,
  Mail,
  Globe,
  Database,
  Workflow,
  Target,
  TrendingUp,
  Shield,
  Layers,
  Cpu,
  BarChart3,
  Command,
  Wand2,
  CircuitBoard,
  Beaker,
  Rocket,
  Send,
  CheckCircle2,
  Lightbulb,
  Loader2
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
        className="absolute inset-0 bg-black/20 backdrop-blur-md"
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
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        pulse: 'animate-pulse'
      }
    case 'inactive':
      return {
        icon: Pause,
        label: 'Paused',
        color: 'text-slate-500',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        pulse: ''
      }
    case 'draft':
      return {
        icon: Wand2,
        label: 'Draft',
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        pulse: ''
      }
    case 'shared':
      return {
        icon: Users,
        label: 'Community',
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        pulse: ''
      }
    default:
      return {
        icon: Clock,
        label: 'Unknown',
        color: 'text-slate-500',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        pulse: ''
      }
  }
}

const getModeIcon = (mode: string) => {
  switch (mode) {
    case 'on_demand': return Command
    case 'scheduled': return Calendar
    case 'triggered': return Zap
    default: return Activity
  }
}

export default function AgentPage() {
  const { user, connectedPlugins } = useAuth() // Get connectedPlugins from UserProvider
  const router = useRouter()
  const params = useParams()
  
  const agentId = (() => {
    if (Array.isArray(params.id)) {
      return params.id[0]
    }
    return params.id as string
  })()

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)
  const [showShareConfirm, setShowShareConfirm] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [userCredits, setUserCredits] = useState(0)
  const [isSharedAgent, setIsSharedAgent] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [showSuccessNotification, setShowSuccessNotification] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [showActivationWarning, setShowActivationWarning] = useState(false)
  const [currentFormIsComplete, setCurrentFormIsComplete] = useState(false)
  const [currentView, setCurrentView] = useState<'overview' | 'configuration' | 'test' | 'performance' | 'settings'>('overview')
  const [expandedPrompt, setExpandedPrompt] = useState(false)
  const [hasBeenShared, setHasBeenShared] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    plugins: true,
    outputs: true,
    // Overview sections
    description: true,
    schedule: true,
    instructions: true,
    setupStatus: true,
    // Settings sections
    basicInfo: true,
    quickActions: true,
    // Analytics sections
    performanceStats: true,
    recentActivity: true
  })

  // Helper function to check plugin status - using connected plugins from UserProvider
  const getPluginStatus = (plugin: string) => {
    if (!connectedPlugins) return false
    
    const pluginData = connectedPlugins[plugin]
    
    // Debug: Let's see what the actual data looks like
    console.log(`Plugin ${plugin}:`, pluginData, typeof pluginData)
    
    // Check if plugin exists and has any truthy value
    if (pluginData === undefined || pluginData === null) return false
    if (pluginData === false || pluginData === 'false') return false
    if (pluginData === 'disconnected' || pluginData === 'inactive') return false
    if (pluginData === '' || pluginData === 0) return false
    
    // If it exists and is not explicitly false/disconnected, consider it connected
    return true
  }

  // Toggle section function for configuration tab
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  // Configuration check
  const checkAgentConfiguration = async (agentData: Agent) => {
    if (!user?.id || !agentData.input_schema) {
      setIsConfigured(true)
      return
    }

    const inputSchema = Array.isArray(agentData.input_schema) ? agentData.input_schema : []
    const hasRequiredFields = inputSchema.some((field: any) => field.required)

    if (!hasRequiredFields) {
      setIsConfigured(true)
      return
    }

    try {
      const { data } = await supabase
        .from('agent_executions')
        .select('input_values')
        .eq('agent_id', agentData.id)
        .eq('user_id', user.id)
        .eq('status', 'configured')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data?.input_values) {
        const requiredFields = inputSchema.filter((field: any) => field.required)
        const hasAllRequiredValues = requiredFields.every((field: any) => {
          const value = data.input_values[field.name]
          return value !== undefined && value !== null && value !== ''
        })
        setIsConfigured(hasAllRequiredValues)
      } else {
        setIsConfigured(false)
      }
    } catch (error) {
      setIsConfigured(false)
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
          .select('*, connected_plugins, plugins_required, workflow_steps, schedule_cron')
          .eq('id', agentId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (regularAgent) {
          setAgent(regularAgent)
          setIsSharedAgent(false)
          setIsOwner(true)
          setEditedName(regularAgent.agent_name || '')
          await checkAgentConfiguration(regularAgent)
          
          // More robust check for shared status with debugging
          const { data: sharedCheck, error: sharedError } = await supabase
            .from('shared_agents')
            .select('id, shared_at')
            .eq('original_agent_id', regularAgent.id)
            .eq('user_id', user.id)
          
          console.log('Shared check result:', { sharedCheck, sharedError, agentId: regularAgent.id, userId: user.id })
          
          // Check if any records exist (array length > 0)
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
        setEditedName(sharedAgent.agent_name || '')
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

  useEffect(() => {
    if (agentId && isValidUUID(agentId)) {
      fetchAgent()
      if (user) fetchUserCredits()
    } else if (agentId) {
      setError('Invalid assistant ID')
      setLoading(false)
    }
  }, [user, agentId])

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
      console.log('Share blocked by initial checks:', { hasAgent: !!agent, hasUser: !!user, isSharedAgent, status: agent?.status, hasBeenShared })
      return
    }
    
    setActionLoading('share')
    try {
      // Double-check if already shared right before attempting
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
        console.log('Agent already shared, blocking share attempt')
        setHasBeenShared(true)
        return
      }

      // Proceed with sharing
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
        console.error('Error sharing agent:', insertError)
        return
      }

      const creditAmount = 500
      
      // Try to get existing credits first
      const { data: existingCredits, error: fetchCreditError } = await supabase
        .from('user_credits')
        .select('credits, total_earned')
        .eq('user_id', user.id)
        .maybeSingle()

      if (fetchCreditError) {
        console.error('Error fetching existing credits:', fetchCreditError)
        // Continue without credit update if table doesn't exist or other issues
      } else {
        // Update or insert credits
        const newCredits = (existingCredits?.credits || 0) + creditAmount
        const newTotalEarned = (existingCredits?.total_earned || 0) + creditAmount
        
        const { error: creditError } = await supabase
          .from('user_credits')
          .upsert({
            user_id: user.id,
            credits: newCredits,
            total_earned: newTotalEarned
          }, {
            onConflict: 'user_id'
          })

        if (creditError) {
          console.error('Error updating credits:', creditError)
          // Don't fail the whole operation if credits fail
        } else {
          setUserCredits(newCredits)
          console.log('Successfully updated credits:', { newCredits, creditAmount })
        }
      }
      setHasBeenShared(true) // Update local state
      setShowSuccessNotification(true)
      setTimeout(() => setShowSuccessNotification(false), 4000)
      
      console.log('Successfully shared agent and awarded credits')
    } catch (error) {
      console.error('Error sharing agent:', error)
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
          status: 'draft' // Always start duplicates as draft
        }])
        .select()
        .single()

      if (error) {
        console.error('Error duplicating agent:', error)
        return
      }

      // Navigate to the new agent
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
          <p className="text-slate-600 font-medium text-lg">Loading your assistant...</p>
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
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Assistant Not Found</h2>
          <p className="text-slate-600 mb-8">This assistant doesn't exist or you don't have access to it.</p>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-200 shadow-lg shadow-blue-600/25"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Assistants
          </Link>
        </div>
      </div>
    )
  }

  const statusConfig = getStatusConfig(agent.status || 'unknown')
  const StatusIcon = statusConfig.icon
  const ModeIcon = getModeIcon(agent.mode || 'on_demand')
  const canActivate = isConfigured || !hasRequiredFields() || currentFormIsComplete

  // Safe schema processing
  const safePluginsRequired = Array.isArray(agent.plugins_required) ? agent.plugins_required : []
  const safeOutputSchema = Array.isArray(agent.output_schema) ? agent.output_schema : []
  const missingPlugins = safePluginsRequired.filter(plugin => !getPluginStatus(plugin))

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      
      {/* Success Notification */}
      {showSuccessNotification && (
        <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6 max-w-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-500 rounded-xl flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-slate-900 text-sm">Shared Successfully!</h4>
                <p className="text-xs text-slate-600 mt-1">+500 credits earned</p>
              </div>
              <button
                onClick={() => setShowSuccessNotification(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Modern Header */}
      <div className="bg-white/90 backdrop-blur-xl border-b border-slate-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            {/* Left Side - Enhanced Layout */}
            <div className="flex items-center gap-6">
              <Link
                href={isSharedAgent ? "/community" : "/agents"}
                className="group p-2.5 hover:bg-slate-100 rounded-xl transition-all duration-200 hover:shadow-md"
              >
                <ArrowLeft className="h-4 w-4 text-slate-600 group-hover:text-slate-900 transition-colors" />
              </Link>
              
              <div className="flex items-center gap-4">
                {/* Clean Avatar without Status Badge */}
                <div className="relative">
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 ring-2 ring-white">
                    <Bot className="h-7 w-7 text-white" />
                  </div>
                </div>
                
                {/* Enhanced Title Section */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-slate-900 leading-tight">{agent.agent_name}</h1>
                    {agent.status === 'shared' && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">
                        <Users className="h-3 w-3" />
                        Community
                      </div>
                    )}
                  </div>
                  
                  {/* Meta Information with Status Badge First */}
                  <div className="flex items-center gap-6 text-sm text-slate-600">
                    {/* Status Badge */}
                    <div className={`flex items-center gap-1.5 ${statusConfig.bg} px-3 py-1 rounded-lg border ${statusConfig.border}`}>
                      <div className={`w-2 h-2 ${statusConfig.color === 'text-emerald-600' ? 'bg-emerald-500' : statusConfig.color === 'text-amber-600' ? 'bg-amber-500' : 'bg-slate-400'} rounded-full ${statusConfig.pulse}`}></div>
                      <span className={`font-medium ${statusConfig.color}`}>{statusConfig.label}</span>
                    </div>
                    
                    {/* Execution Mode */}
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1 rounded-lg">
                      <ModeIcon className="h-4 w-4 text-slate-500" />
                      <span className="font-medium">
                        {agent.mode === 'on_demand' ? 'On Demand' : 
                         agent.mode === 'scheduled' ? 'Scheduled' : 
                         agent.mode === 'triggered' ? 'Event Triggered' : 'Standard'}
                      </span>
                    </div>
                    
                    {/* Created Date */}
                    <div className="flex items-center gap-2 text-slate-500">
                      <Calendar className="h-4 w-4" />
                      <span>Created {agent.created_at ? new Date(agent.created_at).toLocaleDateString() : 'Unknown'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Compact Action Buttons - Removed menu button */}
            <div className="flex items-center gap-2">
              {!isSharedAgent && isOwner && (
                <>
                  {agent.status === 'active' ? (
                    <button
                      onClick={() => setShowDeactivateConfirm(true)}
                      className="group flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition-all duration-200 shadow-md shadow-orange-500/25 font-medium transform hover:-translate-y-0.5 hover:shadow-lg text-sm"
                    >
                      <Pause className="h-4 w-4 group-hover:scale-110 transition-transform" />
                      Pause
                    </button>
                  ) : (
                    <button
                      onClick={handleToggleStatus}
                      disabled={!canActivate}
                      className={`group flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all duration-200 font-medium transform hover:-translate-y-0.5 text-sm ${
                        canActivate 
                          ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 shadow-md shadow-green-500/25 hover:shadow-lg' 
                          : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white opacity-75 shadow-md shadow-amber-500/25'
                      }`}
                    >
                      <Rocket className={`h-4 w-4 ${canActivate ? 'group-hover:scale-110' : ''} transition-transform`} />
                      {canActivate ? 'Launch' : 'Setup Required'}
                    </button>
                  )}
                  
                  <button
                    onClick={() => setShowShareConfirm(true)}
                    disabled={agent.status !== 'active'}
                    className="group flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all duration-200 shadow-md shadow-blue-500/25 font-medium disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 hover:shadow-lg disabled:hover:transform-none text-sm"
                  >
                    <Share2 className="h-4 w-4 group-hover:scale-110 transition-transform" />
                    {hasBeenShared ? 'View Sharing' : 'Share'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modern Tab Navigation - More Compact */}
      <div className="bg-white/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-8 pt-4 pb-2">
          <div className="flex gap-1">
            {[
              { id: 'overview', label: 'Overview', icon: Target },
              { id: 'configuration', label: 'Configuration', icon: Settings },
              { id: 'test', label: 'Test Run', icon: Beaker },
              { id: 'performance', label: 'Analytics', icon: BarChart3 },
              { id: 'settings', label: 'Settings', icon: Command }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentView(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200 font-medium text-sm ${
                  currentView === tab.id
                    ? 'bg-white shadow-lg shadow-black/10 text-slate-900 border border-white/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content with Reduced Spacing */}
      <div className="max-w-7xl mx-auto px-8 py-6">
        
        {/* Overview Tab - More Compact */}
        {currentView === 'overview' && (
          <div className="space-y-4">
            
            {/* Description */}
            {agent.description && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-blue-50 to-purple-50 p-3 cursor-pointer hover:from-blue-100 hover:to-purple-100 transition-colors"
                  onClick={() => toggleSection('description')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <MessageSquare className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 text-sm">What This Assistant Does</h3>
                        <p className="text-slate-600 text-xs">Purpose and capabilities overview</p>
                      </div>
                    </div>
                    {expandedSections.description ? 
                      <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                      <ChevronDown className="h-4 w-4 text-slate-600" />
                    }
                  </div>
                </div>
                {expandedSections.description && (
                  <div className="p-4">
                    <p className="text-slate-700 leading-relaxed text-sm">{agent.description}</p>
                  </div>
                )}
              </div>
            )}

            {/* Schedule Information */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div 
                className="bg-gradient-to-r from-purple-50 to-pink-50 p-3 cursor-pointer hover:from-purple-100 hover:to-pink-100 transition-colors"
                onClick={() => toggleSection('schedule')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">Execution Schedule</h3>
                      <p className="text-slate-600 text-xs">How and when your assistant runs</p>
                    </div>
                  </div>
                  {expandedSections.schedule ? 
                    <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  }
                </div>
              </div>
              {expandedSections.schedule && (
                <div className="p-4">
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-4 border border-purple-100">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-blue-500 rounded-lg flex items-center justify-center">
                        <ModeIcon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-2 text-sm">
                          {agent.mode === 'on_demand' ? 'Manual Execution' : 
                           agent.mode === 'scheduled' ? 'Scheduled Execution' : 
                           agent.mode === 'triggered' ? 'Event-Driven Execution' : 'Standard Mode'}
                        </h3>
                        <div className="space-y-2">
                          <p className="text-slate-700 text-sm">
                            <span className="font-medium">Mode:</span> {agent.mode || 'on_demand'}
                          </p>
                          {agent.mode === 'scheduled' && agent.schedule_cron && (
                            <p className="text-slate-700 text-sm">
                              <span className="font-medium">Schedule:</span> {formatScheduleDisplay(agent.mode, agent.schedule_cron)}
                            </p>
                          )}
                          {agent.mode === 'scheduled' && !agent.schedule_cron && (
                            <p className="text-amber-700 text-sm">
                              <span className="font-medium">Status:</span> Schedule not configured
                            </p>
                          )}
                          {agent.mode === 'on_demand' && (
                            <p className="text-slate-700 text-sm">
                              <span className="font-medium">Execution:</span> Manual trigger only
                            </p>
                          )}
                          {agent.mode === 'triggered' && (
                            <p className="text-slate-700 text-sm">
                              <span className="font-medium">Execution:</span> Event-based triggers
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Assistant Instructions/Prompt */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div 
                className="bg-gradient-to-r from-indigo-50 to-blue-50 p-3 cursor-pointer hover:from-indigo-100 hover:to-blue-100 transition-colors"
                onClick={() => toggleSection('instructions')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center">
                      <Wand2 className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">Assistant Instructions</h3>
                      <p className="text-slate-600 text-xs">The core prompt and behavior guide</p>
                    </div>
                  </div>
                  {expandedSections.instructions ? 
                    <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  }
                </div>
              </div>
              {expandedSections.instructions && (
                <div className="p-4">
                  <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                    <div className="relative">
                      <p className="text-slate-700 leading-relaxed whitespace-pre-wrap font-mono text-sm">
                        {expandedPrompt || (agent.user_prompt && agent.user_prompt.length <= 300)
                          ? agent.user_prompt 
                          : `${agent.user_prompt?.substring(0, 300)}...`
                        }
                      </p>
                      {agent.user_prompt && agent.user_prompt.length > 300 && (
                        <button
                          onClick={() => setExpandedPrompt(!expandedPrompt)}
                          className="mt-3 flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium text-sm"
                        >
                          {expandedPrompt ? (
                            <>
                              <EyeOff className="h-4 w-4" />
                              Show Less
                            </>
                          ) : (
                            <>
                              <Eye className="h-4 w-4" />
                              Show Full Instructions
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Setup Status */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div 
                className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 cursor-pointer hover:from-green-100 hover:to-emerald-100 transition-colors"
                onClick={() => toggleSection('setupStatus')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                      <Shield className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">Setup Status</h3>
                      <p className="text-slate-600 text-xs">Current configuration and readiness</p>
                    </div>
                  </div>
                  {expandedSections.setupStatus ? 
                    <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  }
                </div>
              </div>
              {expandedSections.setupStatus && (
                <div className="p-4">
                  {agent.status === 'draft' ? (
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center">
                          <Wand2 className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-amber-900 mb-2 text-sm">Assistant in Draft Mode</h3>
                          <p className="text-amber-800 mb-3 text-sm">
                            Your assistant is ready but needs to be launched to start working. 
                            {hasRequiredFields() && !isConfigured 
                              ? ' Complete the configuration first, then launch it to make it live.'
                              : ' Once you launch it, it will be active and ready to help you.'
                            }
                          </p>
                          <div className="flex items-center gap-2">
                            <div className={`px-3 py-1 rounded-lg text-xs font-medium ${
                              isConfigured 
                                ? 'bg-green-100 text-green-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {isConfigured ? '✓ Configuration Complete' : '⚠ Configuration Required'}
                            </div>
                            {canActivate && (
                              <button
                                onClick={handleToggleStatus}
                                className="px-4 py-2 bg-gradient-to-r from-green-400 to-emerald-500 text-white rounded-lg hover:from-green-500 hover:to-emerald-600 transition-all duration-200 shadow-lg shadow-green-500/25 font-medium text-sm"
                              >
                                <Rocket className="h-3 w-3 mr-1" />
                                Launch Assistant
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={`rounded-xl p-4 border ${
                      agent.status === 'active' 
                        ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
                        : 'bg-gradient-to-r from-slate-50 to-gray-50 border-slate-200'
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          agent.status === 'active' 
                            ? 'bg-gradient-to-br from-green-400 to-emerald-500'
                            : 'bg-gradient-to-br from-slate-400 to-gray-500'
                        }`}>
                          <StatusIcon className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h3 className={`font-semibold mb-2 text-sm ${
                            agent.status === 'active' ? 'text-green-900' : 'text-slate-900'
                          }`}>
                            Assistant is {statusConfig.label}
                          </h3>
                          <p className={`text-sm ${agent.status === 'active' ? 'text-green-800' : 'text-slate-700'}`}>
                            {agent.status === 'active' 
                              ? 'Your assistant is live and ready to work. It will respond to requests and run on schedule if configured.'
                              : 'Your assistant is currently paused and not responding to requests.'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Configuration Tab - More Compact */}
        {currentView === 'configuration' && (
          <div className="space-y-4">
            
            {/* Plugin Requirements */}
            {safePluginsRequired.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-indigo-50 to-blue-50 p-3 cursor-pointer hover:from-indigo-100 hover:to-blue-100 transition-colors"
                  onClick={() => toggleSection('plugins')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center">
                        <Puzzle className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 text-sm">Connected Tools</h3>
                        <p className="text-slate-600 text-xs">Your agent needs these to work properly</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-slate-600">
                        {safePluginsRequired.filter(p => getPluginStatus(p)).length}/{safePluginsRequired.length} ready
                      </div>
                      {expandedSections.plugins ? 
                        <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                        <ChevronDown className="h-4 w-4 text-slate-600" />
                      }
                    </div>
                  </div>
                </div>
                
                {expandedSections.plugins && (
                  <div className="p-3 space-y-2">
                    {safePluginsRequired.map(plugin => {
                      const isConnected = getPluginStatus(plugin)
                      return (
                        <div
                          key={plugin}
                          className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                            isConnected 
                              ? 'bg-green-50 border-green-200' 
                              : 'bg-red-50 border-red-200'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                              isConnected ? 'bg-green-100' : 'bg-red-100'
                            }`}>
                              {isConnected ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-red-600" />
                              )}
                            </div>
                            <div>
                              <span className={`font-medium text-sm ${
                                isConnected ? 'text-green-800' : 'text-red-800'
                              }`}>
                                {plugin}
                              </span>
                              <p className={`text-xs ${
                                isConnected ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {isConnected ? 'Ready to use' : 'Needs to be connected'}
                              </p>
                            </div>
                          </div>
                          <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                            isConnected 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {isConnected ? 'Connected' : 'Missing'}
                          </div>
                        </div>
                      )
                    })}
                    
                    {missingPlugins.length > 0 && (
                      <div className="mt-3 p-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center gap-2 text-amber-800">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="font-medium text-sm">Please connect the missing tools before testing or configuring your agent.</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Expected Output */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div 
                className="bg-gradient-to-r from-emerald-50 to-green-50 p-3 cursor-pointer hover:from-emerald-100 hover:to-green-100 transition-colors"
                onClick={() => toggleSection('outputs')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center">
                      <Target className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">What you'll get</h3>
                      <p className="text-slate-600 text-xs">The magic your agent will create</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-slate-600">
                      {safeOutputSchema.length} field{safeOutputSchema.length !== 1 ? 's' : ''}
                    </div>
                    {expandedSections.outputs ? 
                      <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                      <ChevronDown className="h-4 w-4 text-slate-600" />
                    }
                  </div>
                </div>
              </div>

              {expandedSections.outputs && (
                <div className="p-3">
                  {safeOutputSchema.length === 0 ? (
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-dashed border-emerald-300 rounded-lg p-4 text-center">
                      <Sparkles className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
                      <h4 className="font-semibold text-emerald-900 mb-1 text-sm">Surprise Output!</h4>
                      <p className="text-emerald-700 text-xs">
                        Your agent will decide the best format for your results
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {safeOutputSchema.map((field, index) => (
                        <div key={index} className="flex items-center justify-between p-2 rounded-lg border bg-emerald-50 border-emerald-200 transition-all">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-100">
                              <Clock className="h-4 w-4 text-emerald-600" />
                            </div>
                            <div>
                              <span className="font-medium text-emerald-800 text-sm">
                                {field.name}
                              </span>
                              <p className="text-xs text-emerald-600">
                                {field.description || 'Output field'}
                              </p>
                            </div>
                          </div>
                          <div className="px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            {field.type}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Test Tab - More Compact */}
        {currentView === 'test' && (
          <div className="space-y-4">
            {!isConfigured && hasRequiredFields() && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-3 border border-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-amber-800 mb-1 text-sm">Configuration Required</h3>
                    <p className="text-amber-700 text-xs">
                      This assistant needs some information before it can run. Please fill out all required fields below.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white/80 backdrop-blur-xl rounded-xl border border-white/20 shadow-lg shadow-black/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/20 bg-gradient-to-r from-blue-50 to-purple-50">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Beaker className="h-4 w-4 text-blue-600" />
                  Test Your Assistant
                </h2>
                <p className="text-slate-600 mt-1 text-xs">Configure and run your assistant with custom inputs</p>
              </div>
              <div className="p-4">
                <AgentSandbox
                  agentId={agent.id}
                  inputSchema={agent.input_schema}
                  outputSchema={agent.output_schema}
                  userPrompt={agent.user_prompt}
                  pluginsRequired={agent.plugins_required}
                  workflowSteps={agent.workflow_steps}
                  connectedPlugins={agent.connected_plugins}
                  onFormCompletionChange={setCurrentFormIsComplete}
                  onExecutionComplete={() => {
                    if (hasRequiredFields()) {
                      setTimeout(() => checkAgentConfiguration(agent), 500)
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Performance Tab - More Compact */}
        {currentView === 'performance' && (
          <div className="space-y-4">
            {!isSharedAgent && agent.status !== 'draft' ? (
              <>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 cursor-pointer hover:from-green-100 hover:to-emerald-100 transition-colors"
                    onClick={() => toggleSection('performanceStats')}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                          <BarChart3 className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900 text-sm">Performance Statistics</h3>
                          <p className="text-slate-600 text-xs">Key metrics and success rates</p>
                        </div>
                      </div>
                      {expandedSections.performanceStats ? 
                        <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                        <ChevronDown className="h-4 w-4 text-slate-600" />
                      }
                    </div>
                  </div>
                  {expandedSections.performanceStats && (
                    <div className="p-4">
                      <AgentStatsBlock agentId={agent.id} />
                    </div>
                  )}
                </div>
                
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-purple-50 to-blue-50 p-3 cursor-pointer hover:from-purple-100 hover:to-blue-100 transition-colors"
                    onClick={() => toggleSection('recentActivity')}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                          <Activity className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900 text-sm">Recent Activity</h3>
                          <p className="text-slate-600 text-xs">Latest executions and history</p>
                        </div>
                      </div>
                      {expandedSections.recentActivity ? 
                        <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                        <ChevronDown className="h-4 w-4 text-slate-600" />
                      }
                    </div>
                  </div>
                  {expandedSections.recentActivity && (
                    <div className="p-4">
                      <AgentHistoryBlock agentId={agent.id} />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-slate-50 to-gray-50 p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-slate-400 to-gray-500 rounded-lg flex items-center justify-center">
                      <TrendingUp className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">No Analytics Yet</h3>
                      <p className="text-slate-600 text-xs">Launch your assistant to start collecting data</p>
                    </div>
                  </div>
                </div>
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-slate-200 to-gray-300 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <TrendingUp className="h-8 w-8 text-slate-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No Analytics Yet</h3>
                  <p className="text-slate-600 max-w-md mx-auto text-sm">
                    Launch your assistant to start collecting performance data and activity metrics.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab - More Compact */}
        {currentView === 'settings' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div 
                className="bg-gradient-to-r from-slate-50 to-gray-50 p-3 cursor-pointer hover:from-slate-100 hover:to-gray-100 transition-colors"
                onClick={() => toggleSection('basicInfo')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-slate-600 to-gray-700 rounded-lg flex items-center justify-center">
                      <Info className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">Basic Information</h3>
                      <p className="text-slate-600 text-xs">Core details about your assistant</p>
                    </div>
                  </div>
                  {expandedSections.basicInfo ? 
                    <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  }
                </div>
              </div>
              {expandedSections.basicInfo && (
                <div className="p-4">
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Assistant Name</label>
                      <div className="text-slate-900 mt-1 text-sm">{agent.agent_name}</div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Created</label>
                      <div className="text-slate-900 mt-1 text-sm">
                        {agent.created_at ? new Date(agent.created_at).toLocaleDateString() : 'Unknown'}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Current Status</label>
                      <div className="text-slate-900 mt-1 text-sm">{statusConfig.label}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div 
                className="bg-gradient-to-r from-blue-50 to-purple-50 p-3 cursor-pointer hover:from-blue-100 hover:to-purple-100 transition-colors"
                onClick={() => toggleSection('quickActions')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                      <Command className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">Quick Actions</h3>
                      <p className="text-slate-600 text-xs">Manage and control your assistant</p>
                    </div>
                  </div>
                  {expandedSections.quickActions ? 
                    <ChevronUp className="h-4 w-4 text-slate-600" /> : 
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  }
                </div>
              </div>
              {expandedSections.quickActions && (
                <div className="p-4">
                  <div className="space-y-3">
                    {!isSharedAgent && isOwner && (
                      <Link
                        href={`/agents/${agent.id}/edit`}
                        className="flex items-center gap-3 w-full px-4 py-3 bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 rounded-lg transition-all duration-200 text-slate-700 border border-blue-100"
                      >
                        <Edit className="h-4 w-4" />
                        <span className="font-medium text-sm">Edit Settings</span>
                      </Link>
                    )}
                    
                    <button 
                      onClick={handleExportConfiguration}
                      disabled={actionLoading === 'export'}
                      className="flex items-center gap-3 w-full px-4 py-3 bg-gradient-to-r from-green-50 to-emerald-50 hover:from-green-100 hover:to-emerald-100 rounded-lg transition-all duration-200 text-slate-700 border border-green-100 disabled:opacity-50"
                    >
                      {actionLoading === 'export' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      <span className="font-medium text-sm">
                        {actionLoading === 'export' ? 'Exporting...' : 'Export Configuration'}
                      </span>
                    </button>
                    
                    <button 
                      onClick={handleDuplicateAgent}
                      disabled={actionLoading === 'duplicate'}
                      className="flex items-center gap-3 w-full px-4 py-3 bg-gradient-to-r from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 rounded-lg transition-all duration-200 text-slate-700 border border-purple-100 disabled:opacity-50"
                    >
                      {actionLoading === 'duplicate' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      <span className="font-medium text-sm">
                        {actionLoading === 'duplicate' ? 'Creating Copy...' : 'Duplicate Assistant'}
                      </span>
                    </button>
                    
                    {!isSharedAgent && isOwner && (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center gap-3 w-full px-4 py-3 bg-gradient-to-r from-red-50 to-pink-50 hover:from-red-100 hover:to-pink-100 rounded-lg transition-all duration-200 text-red-600 border border-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="font-medium text-sm">Delete Assistant</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modern Modals */}
      <Modal isOpen={showActivationWarning} onClose={() => setShowActivationWarning(false)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-2">Configuration Required</h3>
              <p className="text-slate-600 mb-4 text-sm">
                Complete the configuration in the Test Run section first.
              </p>
              <button
                onClick={() => setShowActivationWarning(false)}
                className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 font-medium"
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
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center">
              <Share2 className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg">Share "{agent.agent_name}" with Community</h3>
              
              {hasBeenShared ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-5 w-5 text-amber-600" />
                    <span className="font-medium text-amber-800">Already Shared</span>
                  </div>
                  <p className="text-amber-700 text-sm">
                    This assistant has already been shared with the community. Each assistant can only be shared once to prevent abuse and ensure fair credit distribution.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 mb-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Coins className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-green-800">Earn 500 Credits (One-time)</span>
                    </div>
                    <p className="text-green-700 text-sm">You'll receive credits when you share this assistant. Each assistant can only be shared once.</p>
                  </div>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <span className="font-medium text-blue-800">What gets shared:</span>
                    </div>
                    <ul className="text-blue-700 text-sm space-y-1">
                      <li>• Assistant name and description</li>
                      <li>• Instructions and configuration</li>
                      <li>• Required tools and settings</li>
                      <li>• Input/output schema</li>
                    </ul>
                  </div>
                  
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="h-4 w-4 text-slate-600" />
                      <span className="font-medium text-slate-800">Your privacy is protected:</span>
                    </div>
                    <ul className="text-slate-700 text-sm space-y-1">
                      <li>• Your personal data stays private</li>
                      <li>• Execution history not included</li>
                      <li>• Only the template is shared</li>
                      <li>• You remain the original creator</li>
                    </ul>
                  </div>
                </div>
              )}
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowShareConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium text-sm"
                >
                  {hasBeenShared ? 'Close' : 'Cancel'}
                </button>
                {!hasBeenShared && (
                  <button
                    onClick={handleShareAgent}
                    disabled={actionLoading === 'share'}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 font-medium text-sm disabled:opacity-50"
                  >
                    {actionLoading === 'share' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Sharing...
                      </>
                    ) : (
                      'Share & Earn Credits'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-red-400 to-pink-500 rounded-xl flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg">Delete "{agent.agent_name}"</h3>
              
              <div className="space-y-3 mb-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="font-medium text-red-800">This action cannot be undone</span>
                  </div>
                  <p className="text-red-700 text-sm">Once deleted, you cannot recover this assistant or its configuration. All data will be permanently removed.</p>
                </div>
                
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="h-4 w-4 text-amber-600" />
                    <span className="font-medium text-amber-800">What will be permanently deleted:</span>
                  </div>
                  <ul className="text-amber-700 text-sm space-y-1">
                    <li>• All assistant configurations and settings</li>
                    <li>• Complete execution history and logs</li>
                    <li>• Scheduled tasks and automations</li>
                    <li>• Any saved input templates and forms</li>
                    <li>• Performance metrics and analytics</li>
                    {hasBeenShared && <li>• Shared community version (if applicable)</li>}
                  </ul>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-800">Consider alternatives:</span>
                  </div>
                  <ul className="text-blue-700 text-sm space-y-1">
                    <li>• <strong>Pause</strong> the assistant to stop it temporarily</li>
                    <li>• <strong>Archive</strong> it for potential future use</li>
                    <li>• <strong>Export</strong> the configuration before deleting</li>
                  </ul>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={actionLoading === 'delete'}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-lg hover:from-red-600 hover:to-pink-700 transition-all duration-200 font-medium text-sm disabled:opacity-50"
                >
                  {actionLoading === 'delete' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Deleting...
                    </>
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
            <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center">
              <Pause className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg">Pause "{agent.agent_name}"</h3>
              
              <div className="space-y-3 mb-4">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Pause className="h-4 w-4 text-orange-600" />
                    <span className="font-medium text-orange-800">What happens when paused:</span>
                  </div>
                  <ul className="text-orange-700 text-sm space-y-1">
                    <li>• All automated executions will stop</li>
                    <li>• Scheduled tasks will be disabled</li>
                    <li>• Manual testing will be unavailable</li>
                    <li>• No new execution history will be created</li>
                  </ul>
                </div>
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-800">What stays safe:</span>
                  </div>
                  <ul className="text-green-700 text-sm space-y-1">
                    <li>• All configurations and settings preserved</li>
                    <li>• Execution history and logs remain intact</li>
                    <li>• You can reactivate anytime</li>
                    <li>• No data or setup will be lost</li>
                  </ul>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-800">Good for:</span>
                  </div>
                  <p className="text-blue-700 text-sm">
                    Temporary breaks, maintenance periods, or when you want to stop automation without losing your setup.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeactivateConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium text-sm"
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
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-lg hover:from-orange-600 hover:to-red-700 transition-all duration-200 font-medium text-sm disabled:opacity-50"
                >
                  {actionLoading === 'toggle' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Pausing...
                    </>
                  ) : (
                    'Pause Assistant'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}