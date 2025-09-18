'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
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
  Puzzle
} from 'lucide-react'

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
  // AI-generated agent fields
  generated_plan?: string
  ai_reasoning?: string
  ai_confidence?: number
  detected_categories?: string[]
  created_from_prompt?: string
  ai_generated_at?: string
  // Shared agent specific fields
  original_agent_id?: string
  shared_at?: string
  user_id?: string
}

// Helper function to validate UUID format
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

export default function AgentPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  
  // Enhanced parameter extraction with debugging
  const agentId = (() => {
    console.log('Raw params:', params)
    console.log('params.id type:', typeof params.id)
    console.log('params.id value:', params.id)
    
    if (Array.isArray(params.id)) {
      return params.id[0]
    }
    return params.id as string
  })()

  console.log('Final agentId:', agentId)

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showFullPrompt, setShowFullPrompt] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)
  const [showShareConfirm, setShowShareConfirm] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [userCredits, setUserCredits] = useState(0)
  const [isSharedAgent, setIsSharedAgent] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [showSuccessNotification, setShowSuccessNotification] = useState(false)
  const [showTechDetails, setShowTechDetails] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [showActivationWarning, setShowActivationWarning] = useState(false)
  const [currentFormIsComplete, setCurrentFormIsComplete] = useState(false)

  // Check if agent has required configuration
// Check if agent has required configuration
const checkAgentConfiguration = async (agentData: Agent) => {
  if (!user?.id || !agentData.input_schema) {
    setIsConfigured(true) // If no input schema, consider it configured
    return
  }

  const inputSchema = Array.isArray(agentData.input_schema) ? agentData.input_schema : []
  const hasRequiredFields = inputSchema.some((field: any) => field.required)

  if (!hasRequiredFields) {
    setIsConfigured(true) // If no required fields, consider it configured
    return
  }

  try {
    // UPDATED: Look for the most recent configured record
    const { data, error } = await supabase
      .from('agent_executions') // Fixed: use correct table name
      .select('input_values, status, created_at')
      .eq('agent_id', agentData.id)
      .eq('user_id', user.id)
      .eq('status', 'configured') // Look specifically for configured status
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() // Use maybeSingle to avoid errors when no records exist

    if (error) {
      console.error('Error checking configuration:', error)
      setIsConfigured(false)
      return
    }

    if (data && data.input_values) {
      // Check if all required fields have values in the saved configuration
      const requiredFields = inputSchema.filter((field: any) => field.required)
      const hasAllRequiredValues = requiredFields.every((field: any) => {
        const value = data.input_values[field.name]
        return value !== undefined && value !== null && value !== ''
      })
      
      console.log('Configuration check result:', {
        hasConfigRecord: !!data,
        requiredFields: requiredFields.map(f => f.name),
        hasAllRequiredValues
      })
      
      setIsConfigured(hasAllRequiredValues)
    } else {
      console.log('No configuration record found')
      setIsConfigured(false)
    }
  } catch (error) {
    console.error('Unexpected error checking configuration:', error)
    setIsConfigured(false)
  }
}
  const fetchAgent = async () => {
    // Enhanced validation for agentId
    console.log('fetchAgent called with agentId:', agentId)
    
    if (!agentId || agentId === 'undefined' || agentId === 'null' || agentId.trim() === '') {
      console.error('Invalid or missing agent ID:', agentId)
      setError('Invalid or missing agent ID. Please check the URL and try again.')
      setLoading(false)
      return
    }

    if (!isValidUUID(agentId)) {
      console.error('Invalid UUID format for agent ID:', agentId)
      setError('Invalid agent ID format. Please check the URL and try again.')
      setLoading(false)
      return
    }

    console.log('Fetching agent with validated ID:', agentId)
    
    try {
      // First try to fetch from regular agents table
      if (user?.id) {
        console.log('Checking regular agents table for user:', user.id)
        const { data: regularAgent, error: regularError } = await supabase
          .from('agents')
          .select('*, connected_plugins, plugins_required, workflow_steps')
          .eq('id', agentId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (regularError) {
          console.error('Error fetching regular agent:', regularError.message)
          // Don't return here, continue to check shared agents
        }

        if (regularAgent) {
          console.log('Found regular agent:', regularAgent.agent_name)
          setAgent(regularAgent)
          setIsSharedAgent(false)
          setIsOwner(true)
          setEditedName(regularAgent.agent_name || '')
          
          // Check configuration status
          await checkAgentConfiguration(regularAgent)
          
          setLoading(false)
          return
        }
      }

      // If not found in regular agents, try shared_agents table
      console.log('Checking shared_agents table')
      const { data: sharedAgent, error: sharedError } = await supabase
        .from('shared_agents')
        .select('*')
        .eq('id', agentId)
        .maybeSingle()

      if (sharedError) {
        console.error('Failed to fetch shared agent:', {
          message: sharedError.message,
          details: sharedError.details,
          hint: sharedError.hint,
          code: sharedError.code
        })
        setError(`Failed to fetch agent: ${sharedError.message}`)
        setLoading(false)
        return
      }

      if (sharedAgent) {
        console.log('Found shared agent:', sharedAgent.agent_name)
        setAgent({
          ...sharedAgent,
          // Shared agents don't have status, so we'll show as 'shared'
          status: 'shared'
        })
        setIsSharedAgent(true)
        setIsOwner(sharedAgent.user_id === user?.id)
        setEditedName(sharedAgent.agent_name || '')
        setIsConfigured(true) // Shared agents are always considered configured
        setLoading(false)
        return
      }

      // Agent not found in either table
      console.log('Agent not found in any table')
      setError('Agent not found')
      setLoading(false)

    } catch (error) {
      console.error('Unexpected error fetching agent:', error)
      setError('An unexpected error occurred while fetching the agent')
      setLoading(false)
    }
  }

  const fetchUserCredits = async () => {
    if (!user?.id) return

    try {
      const { data, error } = await supabase
        .from('user_credits')
        .select('credits')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') {
        console.error('Failed to fetch user credits:', error.message)
        return
      }

      setUserCredits(data?.credits || 0)
    } catch (error) {
      console.error('Unexpected error fetching user credits:', error)
    }
  }

  useEffect(() => {
    console.log('useEffect triggered:', { agentId, user: !!user })
    
    // Only fetch if we have a valid agentId
    if (agentId && agentId !== 'undefined' && agentId !== 'null' && isValidUUID(agentId)) {
      fetchAgent()
      if (user) {
        fetchUserCredits()
      }
    } else {
      console.log('Skipping fetch due to invalid agentId:', agentId)
      // Set error state if agentId is invalid
      if (agentId && (agentId === 'undefined' || agentId === 'null' || !isValidUUID(agentId))) {
        setError('Invalid agent ID in URL. Please check the link and try again.')
        setLoading(false)
      }
    }
  }, [user, agentId])

  const handleSaveAgentName = async () => {
    if (!editedName.trim() || editedName === agent?.agent_name || !isOwner || isSharedAgent) {
      setIsEditingName(false)
      setEditedName(agent?.agent_name || '')
      return
    }
    
    setActionLoading('saveName')
    try {
      const { error } = await supabase
        .from('agents')
        .update({ agent_name: editedName.trim() })
        .eq('id', agentId)
        .eq('user_id', user?.id)
      
      if (error) throw error
      
      setAgent(prev => prev ? { ...prev, agent_name: editedName.trim() } : null)
      setIsEditingName(false)
    } catch (error) {
      console.error('Error updating agent name:', error)
      setEditedName(agent?.agent_name || '')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancelNameEdit = () => {
    setIsEditingName(false)
    setEditedName(agent?.agent_name || '')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveAgentName()
    } else if (e.key === 'Escape') {
      handleCancelNameEdit()
    }
  }

  const handleDelete = async () => {
    if (!isOwner || isSharedAgent) return
    
    setActionLoading('delete')
    try {
      await supabase.from('agents').update({ is_archived: true }).eq('id', agentId)
      router.push('/agents')
    } catch (error) {
      console.error('Error deleting agent:', error)
    } finally {
      setActionLoading(null)
      setShowDeleteConfirm(false)
    }
  }

  const handleToggleStatus = async () => {
    if (!isOwner || isSharedAgent) return
    
    const newStatus = agent?.status === 'active' ? 'inactive' : 'active'
    
    // Check if trying to activate an unconfigured agent
    if (newStatus === 'active' && !isConfigured) {
      setShowActivationWarning(true)
      return
    }
    
    // Only show confirmation for deactivating active agents
    if (agent?.status === 'active' && !showDeactivateConfirm) {
      setShowDeactivateConfirm(true)
      return
    }
    
    setActionLoading('toggle')
    
    try {
      await supabase.from('agents').update({ status: newStatus }).eq('id', agentId)
      await fetchAgent()
    } catch (error) {
      console.error('Error toggling status:', error)
    } finally {
      setActionLoading(null)
      setShowDeactivateConfirm(false)
    }
  }

  const handleShareAgent = async () => {
    if (!agent || !user || isSharedAgent) return
    
    // Only allow sharing of active agents
    if (agent.status !== 'active') {
      alert('Only active agents can be shared with the community.')
      return
    }
    
    setActionLoading('share')
    
    try {
      // First, check if this agent was already shared (update existing or create new)
      const { data: existingShared } = await supabase
        .from('shared_agents')
        .select('id')
        .eq('original_agent_id', agent.id)
        .eq('user_id', user.id)
        .maybeSingle()

      const sharedTimestamp = new Date().toISOString()

      if (existingShared) {
        // Update existing shared agent with latest configuration
        const { error: updateError } = await supabase
          .from('shared_agents')
          .update({
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
            generated_plan: agent.generated_plan,
            ai_reasoning: agent.ai_reasoning,
            ai_confidence: agent.ai_confidence && agent.ai_confidence <= 1 ? agent.ai_confidence : null,
            detected_categories: agent.detected_categories,
            created_from_prompt: agent.created_from_prompt,
            ai_generated_at: agent.ai_generated_at,
            shared_at: sharedTimestamp,
            updated_at: sharedTimestamp
          })
          .eq('id', existingShared.id)

        if (updateError) throw updateError
      } else {
        // Create new shared agent
        const sharedAgentData = {
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
          generated_plan: agent.generated_plan,
          ai_reasoning: agent.ai_reasoning,
          ai_confidence: agent.ai_confidence && agent.ai_confidence <= 1 ? agent.ai_confidence : null,
          detected_categories: agent.detected_categories,
          created_from_prompt: agent.created_from_prompt,
          ai_generated_at: agent.ai_generated_at,
          shared_at: sharedTimestamp
        }

        const { error: insertError } = await supabase
          .from('shared_agents')
          .insert([sharedAgentData])

        if (insertError) throw insertError
      }

      // Add credits to user (500 tokens)
      const creditAmount = 500
      
      // First, ensure user has a credits record
      const { error: upsertError } = await supabase
        .from('user_credits')
        .upsert({
          user_id: user.id,
          credits: userCredits + creditAmount,
          total_earned: creditAmount
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false
        })

      if (upsertError) throw upsertError

      // Record the transaction
      const { error: transactionError } = await supabase
        .from('credit_transactions')
        .insert([{
          user_id: user.id,
          amount: creditAmount,
          transaction_type: 'share_agent',
          description: `Shared agent: ${agent.agent_name}`,
          related_agent_id: agent.id
        }])

      if (transactionError) throw transactionError

      // Update local credits
      setUserCredits(prev => prev + creditAmount)
      
      // Show success notification
      setShowSuccessNotification(true)
      setTimeout(() => setShowSuccessNotification(false), 5000) // Hide after 5 seconds
      
    } catch (error) {
      console.error('Error sharing agent:', error)
      alert('Failed to share agent. Please try again.')
    } finally {
      setActionLoading(null)
      setShowShareConfirm(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  const exportAgentSettings = async () => {
    if (!agent) return
    
    const exportData = {
      name: agent.agent_name,
      description: agent.description || '',
      system_prompt: agent.system_prompt || '',
      user_prompt: agent.user_prompt,
      input_schema: agent.input_schema || [],
      output_schema: agent.output_schema || [],
      plugins_required: agent.plugins_required || [],
      mode: agent.mode || 'on_demand',
      exported_at: new Date().toISOString(),
      version: '1.0'
    }
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `agent-${agent.agent_name.toLowerCase().replace(/\s+/g, '-')}-settings.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const duplicateAgent = async () => {
    if (!agent || !user) return
    
    setActionLoading('duplicate')
    try {
      const duplicatedAgent = {
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
        status: 'draft'
      }
      
      const { data, error } = await supabase
        .from('agents')
        .insert([duplicatedAgent])
        .select()
        .single()
      
      if (error) throw error
      
      // Navigate to the new agent
      router.push(`/agents/${data.id}`)
    } catch (error) {
      console.error('Error duplicating agent:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return {
          icon: CheckCircle,
          color: 'text-emerald-600',
          bg: 'bg-emerald-50',
          badge: 'bg-emerald-100 text-emerald-700',
          label: 'Active & Ready',
          dot: 'bg-emerald-400'
        }
      case 'inactive':
        return {
          icon: Pause,
          color: 'text-slate-500',
          bg: 'bg-slate-50',
          badge: 'bg-slate-100 text-slate-600',
          label: 'Paused',
          dot: 'bg-slate-400'
        }
      case 'draft':
        return {
          icon: FileText,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
          badge: 'bg-amber-100 text-amber-700',
          label: 'In Draft',
          dot: 'bg-amber-400'
        }
      case 'shared':
        return {
          icon: Users,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          badge: 'bg-blue-100 text-blue-700',
          label: 'Community',
          dot: 'bg-blue-400'
        }
      default:
        return {
          icon: Clock,
          color: 'text-gray-600',
          bg: 'bg-gray-50',
          badge: 'bg-gray-100 text-gray-600',
          label: status,
          dot: 'bg-gray-400'
        }
    }
  }

  const getModeConfig = (mode: string) => {
    switch (mode) {
      case 'on_demand': 
        return { 
          icon: Play, 
          label: 'On Demand', 
          desc: 'Runs when you trigger it',
          color: 'text-blue-600',
          bg: 'bg-blue-50'
        }
      case 'scheduled': 
        return { 
          icon: Calendar, 
          label: 'Scheduled', 
          desc: 'Runs automatically on schedule',
          color: 'text-purple-600',
          bg: 'bg-purple-50'
        }
      case 'triggered': 
        return { 
          icon: Zap, 
          label: 'Event Triggered', 
          desc: 'Runs when events happen',
          color: 'text-orange-600',
          bg: 'bg-orange-50'
        }
      default: 
        return { 
          icon: Activity, 
          label: 'Standard', 
          desc: 'Basic operation mode',
          color: 'text-gray-600',
          bg: 'bg-gray-50'
        }
    }
  }

  const hasRequiredFields = () => {
    if (!agent?.input_schema) return false
    const inputSchema = Array.isArray(agent.input_schema) ? agent.input_schema : []
    return inputSchema.some((field: any) => field.required)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <Bot className="h-8 w-8 text-blue-600" />
            </div>
            <div className="absolute inset-0 w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-2xl animate-spin mx-auto"></div>
          </div>
          <p className="text-slate-600 font-medium">Loading your agent...</p>
        </div>
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-6 mx-auto">
            <Bot className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">
            {error ? 'Something went wrong' : 'Agent not found'}
          </h2>
          <p className="text-slate-600 mb-8">
            {error 
              ? 'We had trouble loading this agent. Please check the link and try again.'
              : 'This agent doesn\'t exist or you don\'t have access to it.'
            }
          </p>
          <div className="space-y-3">
            {error && (
              <button
                onClick={() => {
                  setError(null)
                  setLoading(true)
                  fetchAgent()
                }}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
              >
                Try Again
              </button>
            )}
            <Link
              href="/agents"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Agents
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const statusConfig = getStatusConfig(agent.status || 'unknown')
  const modeConfig = getModeConfig(agent.mode || 'on_demand')
  const StatusIcon = statusConfig.icon
  const ModeIcon = modeConfig.icon
  
  // Check if activation is blocked - improved logic
  const canActivate = isConfigured || !hasRequiredFields() || currentFormIsComplete

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Success Notification */}
      {showSuccessNotification && (
        <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-white rounded-2xl shadow-xl border border-green-200 p-5 max-w-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Sparkles className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-slate-900 mb-1">Shared Successfully!</h4>
                <p className="text-sm text-slate-600 mb-3">
                  "{agent?.agent_name}" is now live in the community.
                </p>
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-1.5">
                  <Coins className="h-4 w-4" />
                  <span className="font-medium">+500 credits earned!</span>
                </div>
              </div>
              <button
                onClick={() => setShowSuccessNotification(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <Link
                href={isSharedAgent ? "/community" : "/agents"}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0 mt-1"
              >
                <ArrowLeft className="h-5 w-5 text-slate-600" />
              </Link>
              
              <div className="min-w-0 flex-1">
                {/* Agent Name */}
                {isEditingName && isOwner && !isSharedAgent ? (
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      type="text"
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      onKeyDown={handleKeyPress}
                      onBlur={handleSaveAgentName}
                      className="text-2xl font-bold text-slate-900 bg-white border-2 border-blue-300 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500 min-w-0"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveAgentName}
                      disabled={actionLoading === 'saveName'}
                      className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-xl flex-shrink-0"
                    >
                      {actionLoading === 'saveName' ? (
                        <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <CheckCircle className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      onClick={handleCancelNameEdit}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl flex-shrink-0"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 mb-3">
                    <h1 className="text-2xl font-bold text-slate-900 truncate">{agent.agent_name}</h1>
                    {isOwner && !isSharedAgent && (
                      <button
                        onClick={() => setIsEditingName(true)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl flex-shrink-0"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
                
                {/* Status and Mode Pills */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${statusConfig.badge}`}>
                    <div className={`w-2 h-2 rounded-full ${statusConfig.dot}`}></div>
                    <span className="text-sm font-medium">{statusConfig.label}</span>
                  </div>
                  
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-700`}>
                    <ModeIcon className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">{modeConfig.label}</span>
                  </div>

                  {/* Configuration Status Indicator */}
                  {!isSharedAgent && hasRequiredFields() && (
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${
                      isConfigured 
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      <Settings className="h-3.5 w-3.5" />
                      <span className="text-sm font-medium">
                        {isConfigured ? 'Configured' : 'Needs Configuration'}
                      </span>
                    </div>
                  )}

                  {isSharedAgent && agent.shared_at && (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-100 text-purple-700">
                      <Heart className="h-3.5 w-3.5" />
                      <span className="text-sm font-medium">
                        Shared {new Date(agent.shared_at).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Description */}
                {agent.description && (
                  <div className="bg-white/70 rounded-xl p-4 border border-slate-200">
                    <p className="text-slate-700">{agent.description}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-shrink-0 ml-6">
              {!isSharedAgent && isOwner && (
                <>
                  <button
                    onClick={() => setShowShareConfirm(true)}
                    disabled={actionLoading === 'share' || agent.status !== 'active'}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 rounded-xl hover:bg-blue-200 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === 'share' ? (
                      <div className="w-4 h-4 border-2 border-blue-700 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    Share
                  </button>

                  <button
                    onClick={() => agent?.status === 'active' ? setShowDeactivateConfirm(true) : handleToggleStatus()}
                    disabled={actionLoading === 'toggle' || (agent?.status !== 'active' && !canActivate)}
                    title={!canActivate ? 'Please configure required settings first' : ''}
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      agent.status === 'active'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : canActivate
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {actionLoading === 'toggle' ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    ) : agent.status === 'active' ? (
                      <PowerOff className="h-4 w-4" />
                    ) : canActivate ? (
                      <Power className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    {agent.status === 'active' ? 'Pause' : canActivate ? 'Activate' : 'Configure First'}
                  </button>

                  <Link
                    href={`/agents/${agent.id}/edit`}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </Link>

                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={actionLoading === 'delete'}
                    className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-3 space-y-8">
            {/* Configuration Warning for unconfigured agents */}
            {!isSharedAgent && hasRequiredFields() && !isConfigured && (
              <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Settings className="h-6 w-6 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-amber-900 mb-2">Configuration Required</h3>
                    <p className="text-amber-800 mb-4">
                      This agent has required settings that need to be configured before it can be activated. 
                      Use the "Configure" mode in the sandbox below to set up all required fields.
                    </p>
                    <div className="text-sm text-amber-700 bg-amber-100 px-3 py-2 rounded-lg">
                      💡 Switch to "Configure" mode in the sandbox and fill out all required fields to activate your agent.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Test Agent Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                    <Play className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">Try It Out</h2>
                    <p className="text-slate-600 text-sm">Test your agent with custom inputs or configure it for activation</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <AgentSandbox
                  agentId={agent.id}
                  inputSchema={agent.input_schema}
                  outputSchema={agent.output_schema}
                  userPrompt={agent.user_prompt}
                  pluginsRequired={agent.plugins_required}
                  workflowSteps={agent.workflow_steps}
                  connectedPlugins={agent.connected_plugins}
                  onFormCompletionChange={(isComplete) => {
                    setCurrentFormIsComplete(isComplete)
                  }}
                  onExecutionComplete={(executionId) => {
                    // Refresh configuration status after execution
                    if (hasRequiredFields()) {
                      // Small delay to ensure database write is complete
                      setTimeout(() => {
                        checkAgentConfiguration(agent)
                      }, 500)
                    }
                  }}
                />
              </div>
            </div>

            {/* Stats and History - Only for owned agents, not shared */}
            {!isSharedAgent && agent.status !== 'draft' ? (
              <>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-5 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                        <Activity className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-slate-900">Performance</h2>
                        <p className="text-slate-600 text-sm">How your agent is performing</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <AgentStatsBlock agentId={agent.id} />
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-5 bg-gradient-to-r from-purple-50 to-pink-50 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                        <Clock className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-slate-900">Recent Activity</h2>
                        <p className="text-slate-600 text-sm">Latest runs and results</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <AgentHistoryBlock agentId={agent.id} />
                  </div>
                </div>
              </>
            ) : !isSharedAgent && agent.status === 'draft' ? (
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-2xl p-8">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="h-6 w-6 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-amber-900 mb-2">Still in Draft Mode</h3>
                    <p className="text-amber-800 mb-4">
                      Your agent is ready but not active yet. 
                      {hasRequiredFields() && !isConfigured 
                        ? ' Please configure the required settings first, then you can activate it.'
                        : ' Once you activate it, you\'ll see performance stats and activity here.'
                      }
                    </p>
                    {isOwner && (
                      <button
                        onClick={handleToggleStatus}
                        disabled={actionLoading === 'toggle' || !canActivate}
                        title={!canActivate ? 'Please configure required settings first' : ''}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          canActivate 
                            ? 'bg-amber-600 text-white hover:bg-amber-700' 
                            : 'bg-amber-300 text-amber-700'
                        }`}
                      >
                        {actionLoading === 'toggle' ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : canActivate ? (
                          <Power className="h-4 w-4" />
                        ) : (
                          <AlertTriangle className="h-4 w-4" />
                        )}
                        {canActivate ? 'Activate Agent' : 'Configure Required Settings'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Info Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6">
                <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Info className="h-5 w-5 text-slate-600" />
                  Quick Info
                </h3>
                
                <div className="space-y-4">
                  {/* Mode Info */}
                  <div className={`p-4 rounded-xl ${modeConfig.bg}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <ModeIcon className={`h-5 w-5 ${modeConfig.color}`} />
                      <span className={`font-medium ${modeConfig.color}`}>{modeConfig.label}</span>
                    </div>
                    <p className="text-sm text-slate-600">{modeConfig.desc}</p>
                  </div>

                  {/* Plugins */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Connected Tools</label>
                    {agent.plugins_required && agent.plugins_required.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {agent.plugins_required.map((plugin) => (
                          <span
                            key={plugin}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg"
                          >
                            <Puzzle className="h-3.5 w-3.5" />
                            {plugin}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No tools connected</p>
                    )}
                  </div>

                  {/* Configuration Status */}
                  {!isSharedAgent && hasRequiredFields() && (
                    <div>
                      <label className="text-sm font-medium text-slate-700 mb-2 block">Configuration Status</label>
                      <div className={`p-3 rounded-lg border-2 ${
                        isConfigured 
                          ? 'bg-green-50 border-green-200'
                          : 'bg-amber-50 border-amber-200'
                      }`}>
                        <div className="flex items-center gap-2">
                          {isConfigured ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-green-600" />
                              <span className="text-sm font-medium text-green-800">All Set</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-4 w-4 text-amber-600" />
                              <span className="text-sm font-medium text-amber-800">Needs Setup</span>
                            </>
                          )}
                        </div>
                        <p className="text-xs mt-1 text-slate-600">
                          {isConfigured 
                            ? 'Required fields are configured'
                            : 'Use Configure mode to set required fields'
                          }
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="pt-2 space-y-3 text-sm">
                    {agent.created_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Created</span>
                        <span className="font-medium text-slate-900">
                          {new Date(agent.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    )}

                    {isSharedAgent && agent.shared_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Shared</span>
                        <span className="font-medium text-slate-900">
                          {new Date(agent.shared_at).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Tech Details Toggle */}
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      onClick={() => setShowTechDetails(!showTechDetails)}
                      className="flex items-center justify-between w-full p-3 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <Code2 className="h-4 w-4" />
                        Technical Details
                      </span>
                      {showTechDetails ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Collapsible Tech Details */}
              {showTechDetails && (
                <div className="px-6 pb-6 border-t border-slate-100">
                  <div className="pt-4 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-slate-700 mb-2 block">Agent ID</label>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-slate-100 px-3 py-2 rounded-lg font-mono text-slate-600 flex-1">
                          {agent.id.substring(0, 8)}...
                        </code>
                        <button 
                          onClick={() => copyToClipboard(agent.id)}
                          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <Copy className="h-4 w-4 text-slate-500" />
                        </button>
                      </div>
                    </div>

                    {/* User Prompt */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-slate-700">Instructions</label>
                        {agent.user_prompt && agent.user_prompt.length > 100 && (
                          <button
                            onClick={() => setShowFullPrompt(!showFullPrompt)}
                            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                          >
                            {showFullPrompt ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            {showFullPrompt ? 'Less' : 'More'}
                          </button>
                        )}
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-700 font-mono whitespace-pre-wrap">
                          {showFullPrompt || (agent.user_prompt && agent.user_prompt.length <= 100)
                            ? agent.user_prompt 
                            : `${agent.user_prompt?.substring(0, 100)}...`
                          }
                        </p>
                      </div>
                      <button
                        onClick={() => copyToClipboard(agent.user_prompt || '')}
                        className="mt-2 text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" />
                        Copy instructions
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6">
                <h3 className="font-semibold text-slate-900 mb-4">Actions</h3>
                <div className="space-y-2">
                  {!isSharedAgent && isOwner && (
                    <Link
                      href={`/agents/${agent.id}/edit`}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 rounded-xl transition-colors"
                    >
                      <Edit className="h-4 w-4" />
                      Edit Settings
                    </Link>
                  )}

                  <button 
                    onClick={exportAgentSettings}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 rounded-xl transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    Export Settings
                  </button>

                  <button 
                    onClick={duplicateAgent}
                    disabled={actionLoading === 'duplicate' || !user}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {actionLoading === 'duplicate' ? (
                      <div className="w-4 h-4 border-2 border-slate-600 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {isSharedAgent ? 'Clone Agent' : 'Make a Copy'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activation Warning Modal */}
      {showActivationWarning && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-slate-900 mb-2">Configuration Required</h3>
                <p className="text-slate-600 mb-6">
                  This agent has required fields that must be configured before activation. Please use the "Configure" mode in the sandbox to set up all required settings first.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowActivationWarning(false)}
                    className="flex-1 px-4 py-3 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                  >
                    Got It
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Agent Confirmation Modal - Only for owned agents */}
      {showShareConfirm && !isSharedAgent && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Share2 className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-slate-900 mb-2">Share with Community</h3>
                <div className="text-slate-600 mb-6 space-y-3">
                  <p>Share "{agent.agent_name}" with everyone and help others discover great agents.</p>
                  <div className="bg-blue-50 p-4 rounded-xl">
                    <div className="flex items-center gap-2 text-blue-800 font-medium mb-1">
                      <Coins className="h-4 w-4" />
                      You'll earn 500 credits!
                    </div>
                    <p className="text-blue-700 text-sm">
                      Credits can be used for premium features and advanced capabilities.
                    </p>
                  </div>
                  <p className="text-sm text-slate-500">
                    We'll share your agent's setup and instructions, but keep your personal data private.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowShareConfirm(false)}
                    className="flex-1 px-4 py-3 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleShareAgent}
                    disabled={actionLoading === 'share'}
                    className="flex-1 px-4 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    {actionLoading === 'share' ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Sharing...
                      </>
                    ) : (
                      <>
                        <Share2 className="h-4 w-4" />
                        Share & Earn
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal - Only for owned agents */}
      {showDeleteConfirm && !isSharedAgent && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-slate-900 mb-2">Delete Agent</h3>
                <p className="text-slate-600 mb-6">
                  Are you sure you want to delete "{agent.agent_name}"? This will permanently remove the agent and all its history. This can't be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 px-4 py-3 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={actionLoading === 'delete'}
                    className="flex-1 px-4 py-3 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    {actionLoading === 'delete' ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
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
        </div>
      )}

      {/* Deactivate Confirmation Modal - Only for owned agents */}
      {showDeactivateConfirm && !isSharedAgent && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <PowerOff className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-slate-900 mb-2">Pause Agent</h3>
                <p className="text-slate-600 mb-6">
                  Pausing "{agent.agent_name}" will stop it from running. You can reactivate it anytime.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeactivateConfirm(false)}
                    className="flex-1 px-4 py-3 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleToggleStatus}
                    disabled={actionLoading === 'toggle'}
                    className="flex-1 px-4 py-3 text-sm font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    {actionLoading === 'toggle' ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Pausing...
                      </>
                    ) : (
                      'Pause Agent'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}