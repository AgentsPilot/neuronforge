// app/v2/agents/new/page.tsx
// V2 Agent Creation Page - Complete Conversational Builder with Phases 1-7

'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useEffect, useRef } from 'react'
import { useAuth } from '@/components/UserProvider'
import { Card } from '@/components/v2/ui/card'
import { V2Header } from '@/components/v2/V2Header'
import { ArrowLeft, Bot, Sparkles, MessageSquare, Zap, CheckCircle2, Clock,
  Settings,
  Loader2,
  Brain,
  Calendar,
  Activity,
  ArrowRight,
  ChevronRight,
  Send,
  PlayCircle,
  ChevronDown,
  X,
  User,
  CheckCircle,
  Edit,
  ChevronUp,
  Plug,
  AlertCircle,
  HelpCircle,  // V10: For question message variant
  FileText     // V10: For plan summary message variant
} from 'lucide-react'
import { useAgentBuilderState } from '@/hooks/useAgentBuilderState'
import { useAgentBuilderMessages } from '@/hooks/useAgentBuilderMessages'
import { getPluginAPIClient } from '@/lib/client/plugin-api-client'
import type {
  GenerateAgentV2Response,
  CreateAgentData,
  CreateAgentConfig,
  CreateAgentConfigMetadata,
  CreateAgentAIContext
} from '@/components/agent-creation/types/generate-agent-v2'
import { isGenerateAgentV2Success } from '@/components/agent-creation/types/generate-agent-v2'
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter'

function V2AgentBuilderContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialPrompt = searchParams.get('prompt')
  const { user } = useAuth()

  // Builder state and messages
  const {
    state: builderState,
    setState: setBuilderState,
    setQuestionsSequence,
    answerQuestion,
    setEnhancement,
    startEditingEnhanced,
    resetForRefinement,  // V10: Reset state for mini-cycle/edit flow
    approvePlan
  } = useAgentBuilderState()

  const {
    messages,
    messagesEndRef,
    addUserMessage,
    addAIMessage,
    addAIQuestion,      // V10: Question variant
    addPlanSummary,     // V10: Plan summary variant
    addSystemMessage,
    addTypingIndicator,
    removeTypingIndicator,
    removeLastIfTemporary
  } = useAgentBuilderMessages()

  // Thread management state
  const [threadId, setThreadId] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(false)
  const initializingRef = useRef(false)

  // Generate proper UUID format for database compatibility (matches backend)
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  // ID tracking (for consistency with token tracking and database)
  const sessionId = useRef(generateUUID())
  const agentId = useRef(generateUUID())

  console.log('🆔 V2 Agent Builder initialized with IDs:', {
    agentId: agentId.current,
    sessionId: sessionId.current,
    threadId
  });

  // Enhanced prompt display state
  const [isStepsExpanded, setIsStepsExpanded] = useState(false)
  const [enhancedPromptData, setEnhancedPromptData] = useState<any>(null)

  // Service status tracking
  const [connectedPlugins, setConnectedPlugins] = useState<string[]>([])
  const [requiredServices, setRequiredServices] = useState<string[]>([])

  // Plugin OAuth state (for missing plugins flow)
  const [missingPlugins, setMissingPlugins] = useState<string[]>([])
  const [declinedPlugins, setDeclinedPlugins] = useState<string[]>([])
  const [connectingPlugin, setConnectingPlugin] = useState<string | null>(null)
  const [showPluginCards, setShowPluginCards] = useState(false)

  // V10: Mini-cycle state (for user_inputs_required refinement)
  const [isInMiniCycle, setIsInMiniCycle] = useState(false)
  const [pendingEnhancedPrompt, setPendingEnhancedPrompt] = useState<any>(null)

  // V10: Edit flow state (for "Need changes" button)
  const [isAwaitingFeedback, setIsAwaitingFeedback] = useState(false)

  // Scheduling flow state
  const [isAwaitingSchedule, setIsAwaitingSchedule] = useState(false)
  const [scheduleCompleted, setScheduleCompleted] = useState(false)
  const [pendingAgentData, setPendingAgentData] = useState<CreateAgentData | null>(null)

  // Input Parameters flow state
  const [requiredInputs, setRequiredInputs] = useState<any[]>([])
  const [currentInputIndex, setCurrentInputIndex] = useState(-1)
  const [inputParameterValues, setInputParameterValues] = useState<Record<string, any>>({})
  const [isAwaitingInputParameter, setIsAwaitingInputParameter] = useState(false)
  const [inputParametersComplete, setInputParametersComplete] = useState(false)
  const [inputValidationError, setInputValidationError] = useState<string | null>(null)

  // Final approval state
  const [isAwaitingFinalApproval, setIsAwaitingFinalApproval] = useState(false)
  const [agentCreated, setAgentCreated] = useState(false)

  // Input state
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)

  // Schedule state (keeping from original)
  const [scheduleMode, setScheduleMode] = useState<'manual' | 'scheduled'>('manual')
  const [scheduleType, setScheduleType] = useState<'hourly' | 'daily' | 'weekly' | 'monthly' | ''>('')
  const [scheduleTime, setScheduleTime] = useState<string>('09:00')
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedMonthDay, setSelectedMonthDay] = useState<string>('1')
  const [hourlyInterval, setHourlyInterval] = useState<string>('1')
  const [dailyOption, setDailyOption] = useState<'everyday' | 'weekdays' | 'weekends'>('everyday')
  const [showScheduleBuilder, setShowScheduleBuilder] = useState(false)
  const builderRef = useRef<HTMLDivElement>(null)

  // Final schedule configuration for draft review
  const [selectedScheduleMode, setSelectedScheduleMode] = useState<'on_demand' | 'scheduled'>('on_demand')
  const [scheduleCron, setScheduleCron] = useState<string | null>(null)
  const [scheduleTimezone, setScheduleTimezone] = useState<string>('UTC')

  // Auto-scroll to bottom when messages or UI state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, scheduleType, scheduleTime, selectedDays, selectedMonthDay, showScheduleBuilder, isAwaitingSchedule, isAwaitingFinalApproval])

  // Close schedule builder when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (builderRef.current && !builderRef.current.contains(event.target as Node)) {
        setShowScheduleBuilder(false)
      }
    }

    if (showScheduleBuilder) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showScheduleBuilder])

  // Initialize thread when user and prompt are ready
  useEffect(() => {
    if (user && initialPrompt && !threadId && !isInitializing && !initializingRef.current) {
      initializingRef.current = true
      initializeThread()
    }
  }, [user, initialPrompt, threadId, isInitializing])

  // Auto-trigger Phase 3 when all questions are answered
  useEffect(() => {
    const allQuestionsAnswered = builderState.questionsSequence.length > 0 &&
      builderState.questionsSequence.every(q => builderState.clarificationAnswers[q.id]?.trim())

    if (builderState.workflowPhase === 'enhancement' &&
        builderState.currentQuestionIndex === -1 &&
        allQuestionsAnswered &&
        !builderState.enhancementComplete) {

      // V10: Different messaging for mini-cycle vs initial Phase 3
      if (isInMiniCycle) {
        addTypingIndicator('Updating your agent plan with new details...')
      } else {
        addTypingIndicator('Creating your enhanced agent plan...')
      }

      setTimeout(() => {
        // V10: Pass pendingEnhancedPrompt for refinement in mini-cycle mode
        if (isInMiniCycle && pendingEnhancedPrompt) {
          processPhase3(undefined, undefined, { enhanced_prompt: pendingEnhancedPrompt })
        } else {
          processPhase3()
        }
      }, 1000)
    }
  }, [builderState.workflowPhase, builderState.currentQuestionIndex, builderState.questionsSequence, builderState.clarificationAnswers, builderState.enhancementComplete, isInMiniCycle, pendingEnhancedPrompt])

  // Display current question when index changes
  // V10: Use addAIQuestion for question variant styling (cyan HelpCircle icon)
  useEffect(() => {
    if (builderState.workflowPhase === 'questions' &&
        builderState.currentQuestionIndex >= 0 &&
        builderState.questionsSequence.length > 0) {

      const currentQ = builderState.questionsSequence[builderState.currentQuestionIndex]
      if (currentQ && !messages.find(m => m.content === currentQ.question)) {
        addAIQuestion(currentQ.question, currentQ.id)
      }
    }
  }, [builderState.currentQuestionIndex, builderState.workflowPhase])

  // ==================== API FUNCTIONS ====================

  // Initialize thread and start Phase 1
  const initializeThread = async () => {
    setIsInitializing(true)
    try {
      // 1. Add user's original prompt to chat
      addUserMessage(initialPrompt!)

      // 2. Add typing indicator
      addTypingIndicator('Analyzing your request...')

      // Create thread
      console.log('🔄 Creating thread with prompt:', initialPrompt)
      const createRes = await fetch('/api/agent-creation/init-thread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current
        },
        body: JSON.stringify({ initial_prompt: initialPrompt })
      })

      if (!createRes.ok) {
        throw new Error('Failed to create thread')
      }

      const createData = await createRes.json()
      console.log('✅ Thread created:', createData.thread_id)
      setThreadId(createData.thread_id)

      // Process Phase 1 directly
      await processPhase1(createData.thread_id)

    } catch (error) {
      console.error('❌ Thread initialization error:', error)
      removeTypingIndicator()
      addSystemMessage('Error initializing conversation. Please try again.')
    } finally {
      setIsInitializing(false)
    }
  }

  // Phase 1: Analysis
  const processPhase1 = async (tid: string) => {
    try {
      console.log('🔄 Phase 1: Analysis...')

      const res = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current
        },
        body: JSON.stringify({
          thread_id: tid,
          phase: 1,
          user_prompt: initialPrompt
        })
      })

      if (!res.ok) throw new Error('Phase 1 failed')

      const data = await res.json()
      console.log('✅ Phase 1 response:', data)

      // Remove typing indicator
      removeTypingIndicator()

      // Store connected plugins from Phase 1 for service status checking
      if (data.connectedPlugins) {
        setConnectedPlugins(data.connectedPlugins)
        console.log('✅ Phase 1 - Connected plugins stored:', data.connectedPlugins)
      }

      // Display conversational summary
      if (data.conversationalSummary) {
        addAIMessage(data.conversationalSummary)
      }

      // Update builder state
      setBuilderState(prev => ({
        ...prev,
        clarityScore: data.clarityScore || 0,
        workflowPhase: 'analysis'
      }))

      // Add typing indicator for Phase 2
      addTypingIndicator('Generating clarification questions...')

      // Move to Phase 2
      setTimeout(() => processPhase2(tid), 1000)

    } catch (error) {
      console.error('❌ Phase 1 error:', error)
      removeTypingIndicator()
      addSystemMessage('Error during analysis')
    }
  }

  // Phase 2: Questions (supports mini-cycle mode with enhanced_prompt)
  const processPhase2 = async (
    tid: string,
    options?: {
      enhanced_prompt?: any;  // V10: For mini-cycle refinement
      user_feedback?: string; // V10: For edit flow refinement
    }
  ) => {
    try {
      const isMiniCycle = !!options?.enhanced_prompt || !!options?.user_feedback
      console.log('🔄 Phase 2: Questions...', isMiniCycle ? '(mini-cycle mode)' : '')

      const res = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current
        },
        body: JSON.stringify({
          thread_id: tid,
          phase: 2,
          enhanced_prompt: options?.enhanced_prompt || null,  // V10: Pass for mini-cycle
          user_feedback: options?.user_feedback || null,      // V10: Pass for edit flow
          declined_services: declinedPlugins                  // V10: Maintain declined services
        })
      })

      if (!res.ok) throw new Error('Phase 2 failed')

      const data = await res.json()
      console.log('✅ Phase 2 response:', data)

      // Remove typing indicator
      removeTypingIndicator()

      // Display conversational summary
      if (data.conversationalSummary) {
        addAIMessage(data.conversationalSummary)
      }

      // Extract questions
      const questions = data.questionsSequence || []
      if (questions.length > 0) {
        // Store questions and trigger first question display
        setQuestionsSequence(questions)

        // V10: Track mini-cycle state - when these questions are answered, re-run Phase 3
        if (isMiniCycle) {
          setIsInMiniCycle(true)
          // Store the enhanced_prompt for Phase 3 refinement
          if (options?.enhanced_prompt) {
            setPendingEnhancedPrompt(options.enhanced_prompt)
          }
        }
        // First question will be displayed by useEffect
      } else {
        // No questions needed - proceed to Phase 3
        if (isMiniCycle) {
          // V10: Mini-cycle complete, no more questions - show the plan
          setIsInMiniCycle(false)
          addTypingIndicator('Finalizing your agent plan...')
        } else {
          addTypingIndicator('Creating your agent plan...')
        }
        setTimeout(() => processPhase3(tid), 1500)
      }

    } catch (error) {
      console.error('❌ Phase 2 error:', error)
      removeTypingIndicator()
      addSystemMessage('Error generating questions')
    }
  }

  // Phase 3: Enhancement (with OAuth gate support and V10 mini-cycle refinement)
  const processPhase3 = async (
    tid?: string,
    pluginsOverride?: string[],
    options?: {
      declined_services?: string[];
      enhanced_prompt?: any;  // V10: For mini-cycle refinement
    }
  ) => {
    const currentThreadId = tid || threadId
    if (!currentThreadId) return

    try {
      console.log('🔄 Phase 3: Enhancement...')

      // Use override plugins if provided (after OAuth), otherwise use current state
      const pluginsToSend = pluginsOverride || connectedPlugins
      console.log('🔌 Phase 3 - Sending connected_services:', pluginsToSend)

      if (options?.declined_services) {
        console.log('⏭️ Phase 3 - Sending declined_services:', options.declined_services)
      }

      if (options?.enhanced_prompt) {
        console.log('🔄 Phase 3 - Mini-cycle refinement with enhanced_prompt')
      }

      const res = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current
        },
        body: JSON.stringify({
          thread_id: currentThreadId,
          phase: 3,
          clarification_answers: builderState.clarificationAnswers,
          connected_services: pluginsToSend,
          declined_services: options?.declined_services || [],
          enhanced_prompt: options?.enhanced_prompt || null  // V10: For mini-cycle refinement
        })
      })

      if (!res.ok) {
        const errorData = await res.json()
        console.error('❌ Phase 3 HTTP error:', res.status, errorData)
        throw new Error(`Phase 3 failed: ${errorData.error || 'Unknown error'} - ${errorData.details || ''}`)
      }

      const data = await res.json()
      console.log('✅ Phase 3 response:', data)

      // Remove typing indicator
      removeTypingIndicator()

      // ⚠️ OAuth Gate Check: If missing plugins, show connection cards
      if (data.missingPlugins && data.missingPlugins.length > 0) {
        console.log('🔒 Phase 3 OAuth Gate: Missing plugins detected', data.missingPlugins)

        setMissingPlugins(data.missingPlugins)
        setShowPluginCards(true)

        // Show message asking user to connect plugins
        const oauthMessage = data.metadata?.oauth_message ||
          'To complete your automation, please connect the following services:'
        addAIMessage(oauthMessage)

        return // Stop here, wait for user to connect/skip plugins
      }

      // V10: Check for user_inputs_required - trigger mini-cycle if needed
      const userInputsRequired = data.enhanced_prompt?.specifics?.user_inputs_required || []
      if (userInputsRequired.length > 0 && !isInMiniCycle) {
        console.log('🔄 Phase 3: user_inputs_required detected, triggering mini-cycle:', userInputsRequired)

        // Store the enhanced_prompt for refinement
        setPendingEnhancedPrompt(data.enhanced_prompt)

        // V10: Reset enhancement state so Phase 3 can be re-triggered after mini-cycle questions
        resetForRefinement()

        // Show message about needing more information
        addAIMessage(`I need a few more details to complete your agent. Let me ask some quick questions about: ${userInputsRequired.join(', ')}`)

        // Trigger mini-cycle Phase 2 with the enhanced_prompt
        addTypingIndicator('Generating clarification questions...')
        setTimeout(() => {
          processPhase2(currentThreadId, { enhanced_prompt: data.enhanced_prompt })
        }, 1000)

        return // Stop here, wait for mini-cycle to complete
      }

      // V10: If we were in mini-cycle, clear the state
      if (isInMiniCycle) {
        console.log('✅ Mini-cycle complete, all inputs resolved')
        setIsInMiniCycle(false)
        setPendingEnhancedPrompt(null)
      }

      // ✅ No missing plugins and no pending inputs - proceed with enhanced prompt display
      console.log('✅ Phase 3: All plugins connected, showing enhanced prompt')

      // Store enhanced prompt data for rich display
      setEnhancedPromptData(data.enhanced_prompt)

      // Store required services from Phase 3 for service status checking
      if (data.enhanced_prompt?.specifics?.services_involved) {
        setRequiredServices(data.enhanced_prompt.specifics.services_involved)
        console.log('✅ Phase 3 - Required services stored:', data.enhanced_prompt.specifics.services_involved)
      }

      // Format enhanced prompt for state
      const enhancedPrompt = typeof data.enhanced_prompt === 'string'
        ? data.enhanced_prompt
        : JSON.stringify(data.enhanced_prompt, null, 2)

      setEnhancement(enhancedPrompt)

      // Add simple AI message (detailed plan will show below)
      addAIMessage("Perfect! I've created a detailed plan for your agent:")

    } catch (error: any) {
      console.error('❌ Phase 3 error:', error)
      removeTypingIndicator()

      // Show detailed error to help debugging
      const errorMessage = error.message || 'Unknown error'
      addSystemMessage(`Error creating agent plan: ${errorMessage}`)

      // Log full error for debugging
      console.error('Full error details:', {
        message: error.message,
        stack: error.stack,
        error
      })
    }
  }

  // ==================== PLUGIN OAUTH HANDLERS ====================

  /**
   * Handle connecting a plugin via OAuth
   * After successful connection, re-calls Phase 3 if all plugins connected
   */
  const handleConnectPlugin = async (pluginKey: string) => {
    if (!user?.id) {
      addSystemMessage('Error: User not authenticated')
      return
    }

    console.log('🔌 Starting OAuth flow for plugin:', pluginKey)
    setConnectingPlugin(pluginKey)

    try {
      // Use PluginAPIClient for real OAuth
      const pluginClient = getPluginAPIClient()
      const result = await pluginClient.connectPlugin(user.id, pluginKey)

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect plugin')
      }

      console.log('✅ OAuth successful for:', pluginKey)

      // Update connected plugins (merge with existing)
      const updatedPlugins = [...connectedPlugins, pluginKey]
      setConnectedPlugins(updatedPlugins)

      // Remove from missing plugins list
      const remainingMissing = missingPlugins.filter(p => p !== pluginKey)
      setMissingPlugins(remainingMissing)

      // Show success message
      addSystemMessage(`${pluginKey.replace(/-/g, ' ')} connected successfully!`)

      // If no more missing plugins, hide cards and re-call Phase 3
      if (remainingMissing.length === 0) {
        console.log('✅ All plugins connected! Re-running Phase 3...')
        setShowPluginCards(false)
        addTypingIndicator('All services connected! Creating your automation plan...')
        await processPhase3(threadId!, updatedPlugins)
      }

    } catch (error: any) {
      console.error('❌ OAuth failed for', pluginKey, ':', error)
      addSystemMessage(`Failed to connect ${pluginKey.replace(/-/g, ' ')}: ${error.message}`)
    } finally {
      setConnectingPlugin(null)
    }
  }

  /**
   * Handle skipping a plugin (user declines to connect)
   * Re-calls Phase 3 with declined_plugins metadata so LLM can adjust the plan
   */
  const handleSkipPlugin = async (pluginKey: string) => {
    console.log('⏭️ Plugin skipped:', pluginKey)

    // Add to declined plugins list
    const updatedDeclined = [...declinedPlugins, pluginKey]
    setDeclinedPlugins(updatedDeclined)

    // Remove from missing plugins list
    const remainingMissing = missingPlugins.filter(p => p !== pluginKey)
    setMissingPlugins(remainingMissing)

    // Show message that we're adjusting the plan
    addAIMessage(`I understand you can't connect ${pluginKey.replace(/-/g, ' ')} right now. Let me see if I can adjust the plan...`)

    // If no more missing plugins (all handled via connect or skip), re-call Phase 3
    if (remainingMissing.length === 0) {
      console.log('🔄 All plugins handled. Re-running Phase 3 with declined services:', updatedDeclined)
      setShowPluginCards(false)
      addTypingIndicator('Re-evaluating with alternative services...')
      await processPhase3(threadId!, connectedPlugins, { declined_services: updatedDeclined })
    }
  }

  // ==================== AGENT CREATION ====================

  /**
   * Create and save agent to database
   * @param useEnhanced - true for enhanced prompt, false for original
   */
  const createAgent = async (useEnhanced: boolean = true) => {
    if (!user?.id) {
      addSystemMessage('Error: User not authenticated')
      return
    }

    setIsCreatingAgent(true)

    try {
      console.log('🚀 Creating agent...', {
        useEnhanced,
        agentId: agentId.current,
        sessionId: sessionId.current,
        threadId
      })

      // Step 1: Build clarificationAnswers with IDs
      const clarificationAnswers = {
        ...builderState.clarificationAnswers,
        agentId: agentId.current,
        sessionId: sessionId.current,
        threadId: threadId,
        originalPrompt: initialPrompt,
        enhancedPrompt: builderState.enhancedPrompt
      }

      // Step 2: Call /api/generate-agent-v2
      console.log('📞 Calling /api/generate-agent-v2...')
      const generateRes = await fetch('/api/generate-agent-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current
        },
        body: JSON.stringify({
          prompt: useEnhanced ? builderState.enhancedPrompt : initialPrompt,
          promptType: useEnhanced ? 'enhanced' : 'original',
          clarificationAnswers,
          userId: user.id
        })
      })

      const generatedAgent: GenerateAgentV2Response = await generateRes.json()

      if (!isGenerateAgentV2Success(generatedAgent)) {
        throw new Error(generatedAgent.error || 'Failed to generate agent')
      }

      console.log('✅ Agent generated:', generatedAgent.agent.agent_name)

      // Step 3: Build agent_config metadata
      const agentConfig: CreateAgentConfig = {
        creation_metadata: {
          ai_generated_at: new Date().toISOString(),
          session_id: sessionId.current,
          agent_id: agentId.current,
          thread_id: threadId || '',
          prompt_type: useEnhanced ? 'enhanced' : 'original',
          clarification_answers: builderState.clarificationAnswers,
          version: '2.0',
          platform_version: 'v2.0',
          enhanced_prompt_data: enhancedPromptData // Structured v9 data
        },
        ai_context: {
          reasoning: generatedAgent.agent.ai_reasoning || '',
          confidence: generatedAgent.agent.ai_confidence || 0,
          original_prompt: initialPrompt || '',
          enhanced_prompt: builderState.enhancedPrompt || '',
          generated_plan: (generatedAgent.agent as any).generated_plan || ''
        }
      }

      // Step 4: Build initial agent data (schedule will be set later)
      const agentData: CreateAgentData = {
        ...generatedAgent.agent,
        agent_config: agentConfig,
        schedule_cron: null, // Will be set after scheduling step
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        mode: 'on_demand', // Will be updated if scheduled
        status: 'draft'
      }

      // Store agent data for later
      setPendingAgentData(agentData)

      // Remove typing indicator and show draft ready message
      removeTypingIndicator()
      addAIMessage("✨ Agent draft ready!")

      // Add resolved_user_inputs to inputParameterValues if available
      if (enhancedPromptData?.specifics?.resolved_user_inputs) {
        const resolvedInputs: Record<string, any> = {}
        enhancedPromptData.specifics.resolved_user_inputs.forEach((input: { key: string; value: string }) => {
          resolvedInputs[input.key] = input.value
        })
        setInputParameterValues(prev => ({ ...prev, ...resolvedInputs }))
      }

      // Check for required input parameters
      const requiredParams = generatedAgent.agent.input_schema?.filter(
        (input: any) => input.required === true
      ) || []

      if (requiredParams.length > 0) {
        // Start input parameters flow
        setRequiredInputs(requiredParams)
        setCurrentInputIndex(0)
        setIsAwaitingInputParameter(true)
        addAIMessage("Great! Now let's configure the agent's settings.")

        // Ask first parameter question
        const firstParam = requiredParams[0]
        addAIMessage(`What value should I use for **${firstParam.label || firstParam.name}**?\n\n${firstParam.description || ''}`)
      } else {
        // No required parameters, mark step complete and go to scheduling
        setInputParametersComplete(true)
        addAIMessage("Great! Now let's decide when the agent will run.")
        setIsAwaitingSchedule(true)
      }

      setIsCreatingAgent(false)
      return // Stop here - continue from input parameters or scheduling handlers

    } catch (error: any) {
      console.error('❌ Agent creation error:', error)
      removeTypingIndicator()
      addSystemMessage(`Error creating agent: ${error.message}`)
    } finally {
      setIsCreatingAgent(false)
    }
  }

  /**
   * Execute final agent creation - saves agent to database
   * Called after scheduling step is complete
   */
  const executeAgentCreation = async (agentData: CreateAgentData) => {
    if (!user?.id) {
      addSystemMessage('Error: User not authenticated')
      return
    }

    setIsCreatingAgent(true)

    try {
      // Call /api/create-agent
      console.log('📞 Calling /api/create-agent...')
      const createRes = await fetch('/api/create-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current
        },
        body: JSON.stringify({
          agent: agentData,
          sessionId: sessionId.current,
          agentId: agentId.current
        })
      })

      if (!createRes.ok) {
        const errorData = await createRes.json()
        throw new Error(errorData.error || 'Failed to create agent')
      }

      const result = await createRes.json()
      console.log('✅ Agent created successfully:', result.agent?.id)

      // Save input parameter values if any were collected
      if (Object.keys(inputParameterValues).length > 0 && result.agent?.id) {
        console.log('💾 Saving input parameter values...')
        try {
          const saveInputsRes = await fetch('/api/agent-configurations/save-inputs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agent_id: result.agent.id,
              input_values: inputParameterValues,
              input_schema: requiredInputs
            })
          })

          if (!saveInputsRes.ok) {
            console.error('Failed to save input values')
          } else {
            console.log('✅ Input values saved successfully')
          }
        } catch (err) {
          console.error('Error saving input values:', err)
        }
      }

      // Mark agent as created
      setAgentCreated(true)

      // Remove typing indicator and show success message
      removeTypingIndicator()
      addAIMessage('🎉 Your agent has been created successfully!')

      setTimeout(() => {
        router.push(`/v2/agents/${result.agent.id}`)
      }, 1500)

    } catch (error: any) {
      console.error('❌ Agent creation error:', error)
      addSystemMessage(`Error creating agent: ${error.message}`)
    } finally {
      setIsCreatingAgent(false)
    }
  }

  // ==================== HANDLERS ====================

  // Handle sending messages/answers
  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return

    const answer = inputValue.trim()
    setInputValue('')
    setIsSending(true)

    try {
      // V10: If we're awaiting feedback (user clicked "Need changes"), treat as user_feedback
      if (isAwaitingFeedback && threadId) {
        console.log('📝 Processing user feedback for plan refinement:', answer)

        // Add user's feedback message
        addUserMessage(answer)

        // Clear feedback mode
        setIsAwaitingFeedback(false)

        // V10: Reset enhancement state so Phase 3 can be re-triggered after edit questions
        resetForRefinement()

        // Show typing indicator
        addTypingIndicator('Updating your plan...')

        // Call Phase 2 with user_feedback and current enhanced_prompt
        await processPhase2(threadId, {
          user_feedback: answer,
          enhanced_prompt: pendingEnhancedPrompt || enhancedPromptData
        })

        return
      }

      // If we're in questions phase, treat as answer
      if (builderState.workflowPhase === 'questions' &&
          builderState.currentQuestionIndex >= 0 &&
          builderState.questionsSequence.length > 0) {

        const currentQ = builderState.questionsSequence[builderState.currentQuestionIndex]

        // Add user's answer
        addUserMessage(answer)

        // Record answer and proceed
        answerQuestion(currentQ.id, answer)

        // Show confirmation
        setTimeout(() => {
          addSystemMessage('Answer recorded')
        }, 300)
      } else if (isAwaitingInputParameter && currentInputIndex >= 0 && currentInputIndex < requiredInputs.length) {
        // Handle input parameter answer
        const currentParam = requiredInputs[currentInputIndex]

        // Add user's answer
        addUserMessage(answer)

        // Validate the input
        const validation = validateInputParameter(answer, currentParam)

        if (!validation.valid) {
          // Show error and ask again
          setInputValidationError(validation.error || 'Invalid input')
          addSystemMessage(`❌ ${validation.error}`)
          addAIMessage(`Please try again. What value should I use for **${currentParam.label || currentParam.name}**?`)
        } else {
          // Valid input, store it
          setInputValidationError(null)
          setInputParameterValues(prev => ({
            ...prev,
            [currentParam.name]: validation.parsedValue
          }))

          // Move to next parameter or finish
          if (currentInputIndex + 1 < requiredInputs.length) {
            // Ask next parameter
            setCurrentInputIndex(currentInputIndex + 1)
            const nextParam = requiredInputs[currentInputIndex + 1]
            addAIMessage(`Great! What value should I use for **${nextParam.label || nextParam.name}**?\n\n${nextParam.description || ''}`)
          } else {
            // All parameters collected
            setIsAwaitingInputParameter(false)
            const finalInputValues = {
              ...inputParameterValues,
              [currentParam.name]: validation.parsedValue
            }
            setInputParameterValues(finalInputValues)

            addAIMessage('Perfect! All settings configured.')

            // Input values will be saved after agent creation in executeAgentCreation

            setInputParametersComplete(true)

            // Proceed to scheduling
            addAIMessage("Now let's decide when the agent will run.")
            setIsAwaitingSchedule(true)
          }
        }
      } else {
        // General message (not during questions or input parameters)
        addUserMessage(answer)
        addAIMessage('I received your message. However, I can only help during the setup process.')
      }
    } catch (error) {
      console.error('❌ Send error:', error)
      addSystemMessage('Error sending message')
    } finally {
      setIsSending(false)
    }
  }

  // Handle approve plan
  const handleApprove = async () => {
    addUserMessage('Yes, perfect!')

    // Add minimized plan summary for context
    if (enhancedPromptData?.plan_description) {
      const planSummary = enhancedPromptData.plan_title
        ? `📋 ${enhancedPromptData.plan_title}\n\n${enhancedPromptData.plan_description}`
        : enhancedPromptData.plan_description
      addPlanSummary(planSummary)
    }

    // Show thinking indicator while generating agent
    addTypingIndicator('Drafting your agent based on the enhanced plan...')
    approvePlan()

    // Create agent with enhanced prompt (will show scheduling UI after)
    await createAgent(true)
  }

  // Handle edit plan
  // V10: Handle edit flow - user wants to make changes to the plan
  const handleEdit = () => {
    // V10: Add plan summary as a muted/disabled message for context
    if (enhancedPromptData?.plan_description) {
      addPlanSummary(enhancedPromptData.plan_description)
    }

    // Add user message and AI response
    addUserMessage('I need to make some changes')
    addAIMessage('Sure thing, what changes would you like to add to the plan?')

    // Store the current enhanced prompt for refinement
    if (enhancedPromptData) {
      setPendingEnhancedPrompt(enhancedPromptData)
    }

    // Enable feedback mode - next message from user will be treated as feedback
    setIsAwaitingFeedback(true)

    // Update state to allow input
    startEditingEnhanced()
  }

  // NOTE: Not currently wired to any UI element.
  // Kept in case we want to allow users to bypass the enhanced prompt
  // and send the original user prompt directly to generate-agent-v2.
  const handleUseOriginal = async () => {
    addUserMessage('Use the original prompt instead')
    addAIMessage('Perfect! Creating your agent with your original request...')
    approvePlan()

    // Create agent with original prompt
    await createAgent(false)
  }

  // ==================== SCHEDULE HELPERS ====================

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

  /**
   * Build cron expression from schedule state
   * Returns null for on-demand mode, cron string for scheduled mode
   */
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

  const getDaySuffix = (day: number) => {
    if (day >= 11 && day <= 13) return 'th'
    switch (day % 10) {
      case 1: return 'st'
      case 2: return 'nd'
      case 3: return 'rd'
      default: return 'th'
    }
  }

  /**
   * Handle on-demand schedule selection
   */
  const handleOnDemand = async () => {
    if (!pendingAgentData) return

    addUserMessage('Run on-demand')
    setScheduleMode('manual')
    setScheduleCompleted(true)
    setIsAwaitingSchedule(false)

    // Store schedule configuration
    setSelectedScheduleMode('on_demand')
    setScheduleCron(null)
    setScheduleTimezone('UTC')

    // Update agent data with on-demand schedule
    const finalAgentData: CreateAgentData = {
      ...pendingAgentData,
      schedule_cron: null,
      mode: 'on_demand'
    }
    setPendingAgentData(finalAgentData)

    // Show transition message and agent draft
    addAIMessage("Great! Let me prepare your agent draft for review...")
    setIsAwaitingFinalApproval(true)
  }

  /**
   * Handle scheduled mode confirmation
   */
  const handleScheduledConfirm = async () => {
    if (!pendingAgentData) return

    const cronExpression = buildCronExpression()
    if (!cronExpression) {
      addSystemMessage('Please configure a schedule first')
      return
    }

    const scheduleDescription = getScheduleDescription()
    addUserMessage(`Schedule: ${scheduleDescription}`)
    setScheduleCompleted(true)
    setIsAwaitingSchedule(false)

    // Store schedule configuration
    setSelectedScheduleMode('scheduled')
    setScheduleCron(cronExpression)
    // TODO: Get timezone from user's browser or allow selection
    setScheduleTimezone('UTC')

    // Update agent data with schedule
    const finalAgentData: CreateAgentData = {
      ...pendingAgentData,
      schedule_cron: cronExpression,
      mode: 'scheduled',
      timezone: 'UTC'
    }
    setPendingAgentData(finalAgentData)

    // Show transition message and agent draft
    addAIMessage("Great! Let me prepare your agent draft for review...")
    setIsAwaitingFinalApproval(true)
  }

  /**
   * Handle final approval of agent draft
   */
  const handleFinalApprove = async () => {
    if (!pendingAgentData) return

    addUserMessage('Approve')
    setIsAwaitingFinalApproval(false)

    // Show creating agent indicator
    addTypingIndicator('Creating agent...')
    setIsCreatingAgent(true)

    // Create the agent
    await executeAgentCreation(pendingAgentData)

    // Navigation after creation will be handled in executeAgentCreation
    // once the temp return is removed
  }

  /**
   * Handle cancellation - return to dashboard
   */
  const handleFinalCancel = () => {
    router.push('/v2/dashboard')
  }

  // ==================== INPUT PARAMETER HELPERS ====================

  /**
   * Validate input parameter value against expected type
   */
  const validateInputParameter = (value: string, param: any): { valid: boolean; error?: string; parsedValue?: any } => {
    const trimmedValue = value.trim()

    // Empty check for required fields
    if (!trimmedValue) {
      return { valid: false, error: 'This field is required' }
    }

    switch (param.type) {
      case 'string':
      case 'email':
      case 'time':
        return { valid: true, parsedValue: trimmedValue }

      case 'number':
        const num = Number(trimmedValue)
        if (isNaN(num)) {
          return { valid: false, error: 'Please enter a valid number' }
        }
        return { valid: true, parsedValue: num }

      case 'boolean':
        const lowerValue = trimmedValue.toLowerCase()
        if (!['true', 'false', 'yes', 'no', '1', '0'].includes(lowerValue)) {
          return { valid: false, error: 'Please enter true/false or yes/no' }
        }
        const boolValue = ['true', 'yes', '1'].includes(lowerValue)
        return { valid: true, parsedValue: boolValue }

      case 'date':
        const date = new Date(trimmedValue)
        if (isNaN(date.getTime())) {
          return { valid: false, error: 'Please enter a valid date (YYYY-MM-DD)' }
        }
        return { valid: true, parsedValue: trimmedValue }

      case 'enum':
      case 'select':
        if (param.enum && !param.enum.includes(trimmedValue)) {
          return { valid: false, error: `Please choose one of: ${param.enum.join(', ')}` }
        }
        if (param.options && !param.options.includes(trimmedValue)) {
          return { valid: false, error: `Please choose one of: ${param.options.join(', ')}` }
        }
        return { valid: true, parsedValue: trimmedValue }

      default:
        return { valid: true, parsedValue: trimmedValue }
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Top Bar: Back Button + User Menu */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-xs sm:text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" />
          <span className="hidden xs:inline">Back to Dashboard</span>
          <span className="xs:hidden">Back</span>
        </button>
        <V2Header />
      </div>

      {/* Main Grid Layout - Two Columns: Setup Progress → Chat (Extended) */}
      <div className="relative">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_3fr] gap-4 lg:gap-6 items-start">
          {/* Left Column - Setup Progress (hidden on mobile) */}
          <div className="hidden lg:block space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 h-[800px] max-h-[calc(100vh-120px)] flex flex-col overflow-hidden">
              <div className="flex items-center gap-3 mb-4">
                <Settings className="w-6 h-6 text-[#06B6D4]" />
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    Setup Progress
                  </h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Tracking conversation steps
                  </p>
                </div>
              </div>

              {/* Progress Steps */}
              <div className="flex-1 space-y-3">
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  builderState.workflowPhase !== 'initial'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  <CheckCircle2 className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                    builderState.workflowPhase !== 'initial' ? 'text-green-500' : 'text-gray-300 dark:text-gray-600'
                  }`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Initial Request
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      Received your agent request
                    </p>
                  </div>
                </div>

                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  builderState.workflowPhase === 'analysis'
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {builderState.workflowPhase === 'analysis' ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Analysis Complete
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {builderState.workflowPhase === 'analysis' ? 'Analyzing your request...' : 'Understanding requirements'}
                    </p>
                  </div>
                </div>

                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  builderState.workflowPhase === 'questions'
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {builderState.workflowPhase === 'questions' ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Clarification Questions
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {builderState.workflowPhase === 'questions'
                        ? `Answering questions (${Object.keys(builderState.clarificationAnswers).length}/${builderState.questionsSequence.length})`
                        : 'Answer clarifying questions'
                      }
                    </p>
                  </div>
                </div>

                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  builderState.workflowPhase === 'enhancement'
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : builderState.workflowPhase === 'approval' || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {builderState.workflowPhase === 'enhancement' ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : builderState.workflowPhase === 'approval' || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Plan Creation
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {builderState.workflowPhase === 'enhancement' ? 'Creating agent plan...' : 'Generate detailed plan'}
                    </p>
                  </div>
                </div>

                {/* Step 5: Input Parameters */}
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  isAwaitingInputParameter
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : inputParametersComplete
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {isAwaitingInputParameter ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : inputParametersComplete ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Input Parameters
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {isAwaitingInputParameter
                        ? `Configuring settings (${currentInputIndex + 1}/${requiredInputs.length})`
                        : 'Configure agent settings'
                      }
                    </p>
                  </div>
                </div>

                {/* Step 6: Scheduling */}
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  isAwaitingSchedule && !scheduleCompleted
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : scheduleCompleted
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {isAwaitingSchedule && !scheduleCompleted ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : scheduleCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Scheduling
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {isAwaitingSchedule && !scheduleCompleted ? 'Configuring schedule...' : 'Set when agent runs'}
                    </p>
                  </div>
                </div>

                {/* Step 7: Agent Ready */}
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  isAwaitingFinalApproval
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : agentCreated
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {isAwaitingFinalApproval ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : agentCreated ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Agent Ready
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {isAwaitingFinalApproval
                        ? 'Reviewing agent draft...'
                        : agentCreated
                        ? 'Agent created!'
                        : 'Deploy your agent'
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Info Section */}
              <div className="mt-auto pt-4 border-t border-[var(--v2-border)] space-y-3">
                <div className="flex items-center gap-3">
                  <Brain className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  <div>
                    <p className="text-xs text-[var(--v2-text-muted)]">Builder Type</p>
                    <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                      Conversational AI Builder
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  <div>
                    <p className="text-xs text-[var(--v2-text-muted)]">Status</p>
                    <p className="text-sm font-medium text-blue-500">
                      {builderState.workflowPhase === 'initial' && 'Initializing...'}
                      {builderState.workflowPhase === 'analysis' && 'Analyzing Requirements'}
                      {builderState.workflowPhase === 'questions' && 'Gathering Information'}
                      {builderState.workflowPhase === 'enhancement' && 'Creating Plan'}
                      {builderState.workflowPhase === 'approval' && 'Awaiting Approval'}
                      {builderState.planApproved && 'Complete'}
                    </p>
                  </div>
                </div>

                {threadId && (
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                    <div>
                      <p className="text-xs text-[var(--v2-text-muted)]">Thread ID</p>
                      <p className="text-xs font-mono text-[var(--v2-text-primary)]">
                        {threadId.slice(0, 8)}...
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Arrow between Setup Progress and Chat */}
          <div className="hidden lg:flex items-center justify-center">
            <ArrowRight className="w-6 h-6 text-[var(--v2-primary)]" />
          </div>

          {/* Right Column - Agent Builder Chat (Extended Width) */}
          <div className="space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 h-[800px] max-h-[calc(100vh-120px)] flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <MessageSquare className="w-6 h-6 text-[#8B5CF6]" />
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    Agent Builder Chat
                  </h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Answer questions to configure your agent
                  </p>
                </div>
              </div>

              {/* Chat Messages Area */}
              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                {messages.map((message, index) => (
                  <div key={index}>
                    {/* System messages (centered, no avatar) */}
                    {message.role === 'system' ? (
                      <div className="flex justify-center">
                        <div
                          className="bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] text-xs px-3 py-2"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          {message.content}
                        </div>
                      </div>
                    ) : message.role === 'typing' ? (
                      /* Typing indicator */
                      <div className="flex gap-3 justify-start">
                        {/* Avatar - AI */}
                        <div
                          className="w-8 h-8 flex items-center justify-center shadow-md flex-shrink-0"
                          style={{
                            background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))',
                            borderRadius: 'var(--v2-radius-button)'
                          }}
                        >
                          <Bot className="h-4 w-4 text-white" />
                        </div>

                        {/* Typing bubble with animated dots */}
                        <div
                          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] px-4 py-3 shadow-md backdrop-blur-sm"
                          style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-card)' }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex space-x-1">
                              <div
                                className="w-2 h-2 rounded-full animate-bounce"
                                style={{
                                  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))',
                                  animationDelay: '0ms'
                                }}
                              />
                              <div
                                className="w-2 h-2 rounded-full animate-bounce"
                                style={{
                                  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))',
                                  animationDelay: '150ms'
                                }}
                              />
                              <div
                                className="w-2 h-2 rounded-full animate-bounce"
                                style={{
                                  background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))',
                                  animationDelay: '300ms'
                                }}
                              />
                            </div>
                            <span className="text-sm text-[var(--v2-text-secondary)] font-medium">{message.content}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* User and AI messages with avatars */
                      <div className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'} ${
                        message.variant === 'plan-summary' ? 'opacity-60' : ''
                      }`}>
                        {/* Avatar - AI (left side) with variant styling */}
                        {message.role === 'assistant' && (
                          <div
                            className={`w-8 h-8 flex items-center justify-center shadow-md flex-shrink-0 ${
                              message.variant === 'plan-summary' ? 'opacity-70' : ''
                            }`}
                            style={{
                              background: message.variant === 'question'
                                ? 'linear-gradient(135deg, #06B6D4, #0891B2)' // Cyan for questions
                                : message.variant === 'plan-summary'
                                ? 'rgba(139, 92, 246, 0.2)' // Muted purple for plan summary
                                : 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))', // Default purple
                              borderRadius: 'var(--v2-radius-button)'
                            }}
                          >
                            {message.variant === 'question' ? (
                              <HelpCircle className="h-4 w-4 text-white" />
                            ) : message.variant === 'plan-summary' ? (
                              <FileText className="h-4 w-4 text-purple-500" />
                            ) : (
                              <Bot className="h-4 w-4 text-white" />
                            )}
                          </div>
                        )}

                        {/* Message bubble with variant styling */}
                        <div className="max-w-[80%]">
                          <div
                            className={`p-3 shadow-md backdrop-blur-sm ${
                              message.role === 'user'
                                ? 'text-white'
                                : message.variant === 'question'
                                ? 'bg-[var(--v2-surface)] border border-cyan-300 dark:border-cyan-700'
                                : message.variant === 'plan-summary'
                                ? 'bg-[var(--v2-surface)] border border-purple-200 dark:border-purple-800/50'
                                : 'bg-[var(--v2-surface)] border border-[var(--v2-border)]'
                            }`}
                            style={
                              message.role === 'user'
                                ? {
                                    background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))',
                                    borderRadius: 'var(--v2-radius-button)',
                                    boxShadow: 'var(--v2-shadow-card)'
                                  }
                                : {
                                    borderRadius: 'var(--v2-radius-button)',
                                    boxShadow: 'var(--v2-shadow-card)'
                                  }
                            }
                          >
                            <p className={`text-sm whitespace-pre-wrap leading-relaxed ${
                              message.role === 'user'
                                ? ''
                                : message.variant === 'plan-summary'
                                ? 'text-[var(--v2-text-muted)] italic'
                                : 'text-[var(--v2-text-primary)]'
                            }`}>
                              {message.content}
                            </p>
                          </div>

                          {/* Question Progress Indicator - shown for AI questions during Phase 2 */}
                          {message.role === 'assistant' &&
                           message.variant === 'question' &&
                           builderState.workflowPhase === 'questions' &&
                           builderState.questionsSequence.length > 0 &&
                           builderState.currentQuestionIndex >= 0 &&
                           builderState.questionsSequence[builderState.currentQuestionIndex]?.question === message.content && (
                            <div
                              className="mt-2 flex items-center gap-2 px-2 py-1 bg-cyan-500/10 border border-cyan-500/20 w-fit"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <HelpCircle className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                              <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                                Question {builderState.currentQuestionIndex + 1} of {builderState.questionsSequence.length}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Avatar - User (right side) */}
                        {message.role === 'user' && (
                          <div
                            className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-700 dark:from-gray-400 dark:to-gray-600 flex items-center justify-center shadow-md flex-shrink-0"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <User className="h-4 w-4 text-white" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Enhanced Prompt Accordion - Show after Phase 3 complete, hide during edit flow */}
                    {builderState.enhancementComplete &&
                     builderState.workflowPhase === 'approval' &&
                     index === messages.length - 1 &&
                     message.role === 'assistant' &&
                     !builderState.planApproved &&
                     !isAwaitingFeedback &&
                     enhancedPromptData && (
                      <div className="flex justify-start mt-4">
                        <div className="w-8 h-8 flex-shrink-0" /> {/* Spacer for alignment */}

                        <div className="flex-1 max-w-3xl space-y-4">
                          {/* Header - Outside card */}
                          <div className="flex items-center gap-2 mb-4">
                            <div
                              className="w-6 h-6 bg-purple-500 flex items-center justify-center"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <Sparkles className="h-4 w-4 text-white" />
                            </div>
                            <h4 className="font-semibold text-[var(--v2-text-primary)]">Your Agent Plan</h4>
                          </div>

                          {/* Enhanced Prompt Card - Accordion Style */}
                          <div
                            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-5 space-y-4"
                            style={{ borderRadius: 'var(--v2-radius-card)', boxShadow: 'var(--v2-shadow-card)' }}
                          >
                            {/* Plan Title */}
                            {enhancedPromptData.plan_title && (
                              <div className="pb-3 border-b border-[var(--v2-border)]">
                                <h3 className="text-lg font-bold text-[var(--v2-text-primary)]">
                                  📋 {enhancedPromptData.plan_title}
                                </h3>
                              </div>
                            )}

                            {/* Description */}
                            {enhancedPromptData.plan_description && (
                              <div>
                                <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2">
                                  📝 Description
                                </h4>
                                <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">
                                  {enhancedPromptData.plan_description}
                                </p>
                              </div>
                            )}

                            {/* How it works - Expandable Accordion */}
                            {enhancedPromptData.sections?.processing_steps && (
                              <div>
                                <button
                                  onClick={() => setIsStepsExpanded(!isStepsExpanded)}
                                  className="w-full flex items-center justify-between py-2 px-3 bg-[var(--v2-surface-hover)] hover:bg-[var(--v2-border)] transition-colors"
                                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                                >
                                  <span className="text-sm font-semibold text-[var(--v2-text-secondary)] flex items-center gap-2">
                                    {isStepsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    How it works ({enhancedPromptData.sections.processing_steps.length} steps)
                                  </span>
                                </button>

                                {isStepsExpanded && (
                                  <div
                                    className="mt-3 space-y-3 bg-[var(--v2-surface-hover)] p-4"
                                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                                  >
                                    {/* Numbered steps with circle badges */}
                                    {enhancedPromptData.sections.processing_steps.map((step: string, stepIndex: number) => (
                                      <div key={stepIndex} className="flex gap-3">
                                        <div
                                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                          style={{ background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))' }}
                                        >
                                          {stepIndex + 1}
                                        </div>
                                        <div className="flex-1">
                                          <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">{step}</p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Required Services */}
                            {requiredServices.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2 flex items-center gap-1">
                                  <Plug className="h-3 w-3" />
                                  Required Services
                                </h4>
                                <div className="grid grid-cols-2 gap-2">
                                  {requiredServices.map((service: string) => {
                                    const isConnected = connectedPlugins.includes(service)
                                    return (
                                      <div
                                        key={service}
                                        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium ${
                                          isConnected
                                            ? 'bg-[var(--v2-status-success-bg)] text-[var(--v2-status-success-text)] border border-[var(--v2-status-success-border)]'
                                            : 'bg-[var(--v2-status-warning-bg)] text-[var(--v2-status-warning-text)] border border-[var(--v2-status-warning-border)]'
                                        }`}
                                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                                      >
                                        {isConnected ? (
                                          <CheckCircle className="h-4 w-4" />
                                        ) : (
                                          <AlertCircle className="h-4 w-4" />
                                        )}
                                        <span className="capitalize">{service.replace(/-/g, ' ')}</span>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* V10: Resolved User Inputs - TEMP: Hidden, condition TBD */}
                            {false && enhancedPromptData.specifics?.resolved_user_inputs &&
                             enhancedPromptData.specifics.resolved_user_inputs.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2 flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3" />
                                  Resolved Inputs
                                </h4>
                                <div className="space-y-1">
                                  {enhancedPromptData.specifics.resolved_user_inputs.map((input: { key: string; value: string }, idx: number) => (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-2 px-3 py-2 text-sm bg-[var(--v2-surface-hover)]"
                                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                                    >
                                      <span className="text-[var(--v2-text-muted)] capitalize">
                                        {input.key.replace(/_/g, ' ')}:
                                      </span>
                                      <span className="text-[var(--v2-text-primary)] font-medium">
                                        {input.value}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Trigger Scope */}
                            {enhancedPromptData.specifics?.trigger_scope && (
                              <div className="pt-3 border-t border-[var(--v2-border)]">
                                <p className="text-xs text-[var(--v2-text-muted)]">
                                  <span className="font-semibold">⏰ Trigger:</span> {enhancedPromptData.specifics.trigger_scope}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Confirmation Text and Buttons - Hide during edit flow */}
                          {!isAwaitingFeedback && (
                            <>
                              <p className="text-sm text-[var(--v2-text-muted)]">Does this look right?</p>

                              {/* Improved Approval Buttons */}
                              <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={handleApprove}
                              disabled={isCreatingAgent}
                              className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold flex items-center justify-center gap-2 transition-all hover:from-emerald-600 hover:to-green-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-button)' }}
                            >
                              {isCreatingAgent ? (
                                <>
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                  Creating agent...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="h-5 w-5" />
                                  Yes, perfect!
                                </>
                              )}
                            </button>

                            <button
                              onClick={handleEdit}
                              disabled={isCreatingAgent}
                              className="px-6 py-3 bg-[var(--v2-surface)] border-2 border-[var(--v2-border)] text-[var(--v2-text-primary)] font-semibold flex items-center justify-center gap-2 transition-all hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <Edit className="h-5 w-5" />
                              Need changes
                            </button>
                          </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Scheduling Selection UI */}
                {isAwaitingSchedule && !scheduleCompleted && (
                  <div className="flex justify-start mt-4">
                    <div className="w-8 h-8 flex-shrink-0" /> {/* Spacer for avatar alignment */}

                    <Card className="flex-1 max-w-3xl !p-6">
                      <div className="space-y-6">
                        {/* Schedule Mode Selection */}
                        <div>
                          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-3">
                            When should this agent run?
                          </h3>
                          <div className="grid grid-cols-2 gap-4">
                            <button
                              onClick={handleOnDemand}
                              disabled={isCreatingAgent}
                              className="p-4 border-2 border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ borderRadius: 'var(--v2-radius-card)' }}
                            >
                              <div className="flex flex-col items-center text-center gap-2">
                                <PlayCircle className="h-8 w-8 text-[var(--v2-primary)]" />
                                <div>
                                  <p className="font-semibold text-[var(--v2-text-primary)]">On-demand</p>
                                  <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                                    Run manually when needed
                                  </p>
                                </div>
                              </div>
                            </button>

                            <button
                              onClick={() => setScheduleMode('scheduled')}
                              className={`p-4 border-2 transition-all ${
                                scheduleMode === 'scheduled'
                                  ? 'border-[var(--v2-primary)] bg-[var(--v2-surface-hover)]'
                                  : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)]'
                              }`}
                              style={{ borderRadius: 'var(--v2-radius-card)' }}
                            >
                              <div className="flex flex-col items-center text-center gap-2">
                                <Clock className="h-8 w-8 text-[var(--v2-primary)]" />
                                <div>
                                  <p className="font-semibold text-[var(--v2-text-primary)]">Scheduled</p>
                                  <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                                    Run automatically on schedule
                                  </p>
                                </div>
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* Schedule Configuration (shown when scheduled is selected) */}
                        {scheduleMode === 'scheduled' && (
                          <div className="space-y-4 pt-4 border-t border-[var(--v2-border)]">
                            {/* Schedule Type Selection */}
                            <div>
                              <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                Frequency
                              </label>
                              <div className="grid grid-cols-4 gap-2">
                                {(['hourly', 'daily', 'weekly', 'monthly'] as const).map((type) => (
                                  <button
                                    key={type}
                                    onClick={() => setScheduleType(type)}
                                    className={`px-3 py-2 text-sm font-medium transition-all ${
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

                            {/* Time Selection (for daily/weekly/monthly) */}
                            {scheduleType && scheduleType !== 'hourly' && (
                              <div>
                                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                  Time
                                </label>
                                <input
                                  type="time"
                                  value={scheduleTime}
                                  onChange={(e) => setScheduleTime(e.target.value)}
                                  className="px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                                />
                              </div>
                            )}

                            {/* Daily Options */}
                            {scheduleType === 'daily' && (
                              <div>
                                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                  Days
                                </label>
                                <div className="flex gap-2">
                                  {(['everyday', 'weekdays', 'weekends'] as const).map((option) => (
                                    <button
                                      key={option}
                                      onClick={() => setDailyOption(option)}
                                      className={`px-3 py-2 text-sm font-medium transition-all ${
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
                                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                  Days of week
                                </label>
                                <div className="grid grid-cols-7 gap-2">
                                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => (
                                    <button
                                      key={day}
                                      onClick={() => handleDayToggle(day)}
                                      className={`px-2 py-2 text-xs font-medium transition-all ${
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
                                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                  Day of month
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  max="31"
                                  value={selectedMonthDay}
                                  onChange={(e) => setSelectedMonthDay(e.target.value)}
                                  className="px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)]"
                                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                                />
                              </div>
                            )}

                            {/* Schedule Preview */}
                            {scheduleType && (
                              <div className="p-3 bg-[var(--v2-surface-hover)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                                <p className="text-sm text-[var(--v2-text-secondary)]">
                                  <span className="font-medium">Schedule: </span>
                                  {getScheduleDescription()}
                                </p>
                              </div>
                            )}

                            {/* Confirm Button */}
                            <button
                              onClick={handleScheduledConfirm}
                              disabled={!scheduleType || isCreatingAgent}
                              className="w-full px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold flex items-center justify-center gap-2 transition-all hover:from-emerald-600 hover:to-green-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-button)' }}
                            >
                              {isCreatingAgent ? (
                                <>
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                  Creating agent...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="h-5 w-5" />
                                  Confirm Schedule
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>
                )}

                {/* Agent Draft - Final Review before Creation */}
                {isAwaitingFinalApproval && enhancedPromptData && (
                  <div className="flex justify-start mt-4">
                    <div className="w-8 h-8 flex-shrink-0" /> {/* Spacer for alignment */}

                    <div className="flex-1 max-w-3xl space-y-4">
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-4">
                        <div
                          className="w-6 h-6 bg-gradient-to-r from-emerald-500 to-green-600 flex items-center justify-center"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <FileText className="h-4 w-4 text-white" />
                        </div>
                        <h4 className="font-semibold text-[var(--v2-text-primary)]">Agent Draft</h4>
                      </div>

                      {/* Agent Draft Card */}
                      <div
                        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-5 space-y-4"
                        style={{ borderRadius: 'var(--v2-radius-card)', boxShadow: 'var(--v2-shadow-card)' }}
                      >
                        {/* Plan Title */}
                        {enhancedPromptData.plan_title && (
                          <div className="pb-3 border-b border-[var(--v2-border)]">
                            <h3 className="text-lg font-bold text-[var(--v2-text-primary)]">
                              📋 {enhancedPromptData.plan_title}
                            </h3>
                          </div>
                        )}

                        {/* Description */}
                        {enhancedPromptData.plan_description && (
                          <div>
                            <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2">
                              📝 Description
                            </h4>
                            <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">
                              {enhancedPromptData.plan_description}
                            </p>
                          </div>
                        )}

                        {/* How it works - Steps */}
                        {enhancedPromptData.sections?.processing_steps && enhancedPromptData.sections.processing_steps.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-3">
                              ⚙️ How it works ({enhancedPromptData.sections.processing_steps.length} steps)
                            </h4>
                            <div className="space-y-3">
                              {enhancedPromptData.sections.processing_steps.map((step: string, stepIndex: number) => (
                                <div key={stepIndex} className="flex gap-3">
                                  <div
                                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                    style={{ background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))' }}
                                  >
                                    {stepIndex + 1}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">{step}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Required Services/Plugins */}
                        {requiredServices.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2 flex items-center gap-1">
                              <Plug className="h-3 w-3" />
                              Required Services
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                              {requiredServices.map((service: string) => {
                                const isConnected = connectedPlugins.includes(service)
                                return (
                                  <div
                                    key={service}
                                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium ${
                                      isConnected
                                        ? 'bg-[var(--v2-status-success-bg)] text-[var(--v2-status-success-text)] border border-[var(--v2-status-success-border)]'
                                        : 'bg-[var(--v2-status-warning-bg)] text-[var(--v2-status-warning-text)] border border-[var(--v2-status-warning-border)]'
                                    }`}
                                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                                  >
                                    {isConnected ? (
                                      <CheckCircle className="h-4 w-4" />
                                    ) : (
                                      <AlertCircle className="h-4 w-4" />
                                    )}
                                    <span className="capitalize">{service.replace(/-/g, ' ')}</span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Input Parameters */}
                        {Object.keys(inputParameterValues).length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2 flex items-center gap-1">
                              <Settings className="h-3 w-3" />
                              Configuration
                            </h4>
                            <div className="space-y-2">
                              {Object.entries(inputParameterValues).map(([key, value]) => {
                                // Find the input schema for this parameter to get the label
                                const paramSchema = requiredInputs.find((input: any) => input.name === key)
                                const label = paramSchema?.label || key.replace(/_/g, ' ')

                                return (
                                  <div
                                    key={key}
                                    className="flex items-start gap-2 px-3 py-2 bg-[var(--v2-surface-hover)]"
                                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                                  >
                                    <span className="text-sm text-[var(--v2-text-muted)] capitalize min-w-[120px]">
                                      {label}:
                                    </span>
                                    <span className="text-sm text-[var(--v2-text-primary)] font-medium">
                                      {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Scheduling */}
                        <div>
                          <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Schedule
                          </h4>
                          <div
                            className="px-3 py-2 bg-[var(--v2-surface-hover)]"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-[var(--v2-text-secondary)]">
                                {selectedScheduleMode === 'on_demand' ? (
                                  <>
                                    <span className="font-semibold">Mode:</span> Manual trigger only
                                  </>
                                ) : scheduleCron ? (
                                  <>
                                    <span className="font-semibold">Runs:</span> {formatScheduleDisplay('scheduled', scheduleCron)}
                                    {scheduleTimezone && scheduleTimezone !== 'UTC' && (
                                      <span className="text-xs text-[var(--v2-text-muted)] ml-2">
                                        ({scheduleTimezone})
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className="font-semibold">Mode:</span> Manual trigger only
                                  </>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Review Text and Buttons */}
                        <div className="pt-3 border-t border-[var(--v2-border)] space-y-4">
                          <p className="text-sm text-[var(--v2-text-muted)]">
                            Review your agent configuration. Click Approve to create your agent, or Cancel to go back.
                          </p>

                          {/* Action Buttons */}
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={handleFinalApprove}
                              disabled={isCreatingAgent}
                              className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold flex items-center justify-center gap-2 transition-all hover:from-emerald-600 hover:to-green-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-button)' }}
                            >
                              {isCreatingAgent ? (
                                <>
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                  Creating...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="h-5 w-5" />
                                  Approve
                                </>
                              )}
                            </button>

                            <button
                              onClick={handleFinalCancel}
                              disabled={isCreatingAgent}
                              className="px-6 py-3 bg-[var(--v2-surface)] border-2 border-[var(--v2-border)] text-[var(--v2-text-primary)] font-semibold flex items-center justify-center gap-2 transition-all hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <X className="h-5 w-5" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Plugin Connection Cards - OAuth Gate UI */}
                {showPluginCards && missingPlugins.length > 0 && (
                  <div className="flex justify-start mt-4">
                    <div className="w-8 h-8 flex-shrink-0" /> {/* Spacer for avatar alignment */}

                    <div className="flex-1 max-w-3xl space-y-3">
                      {missingPlugins.map((plugin) => (
                        <div
                          key={plugin}
                          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 flex items-center justify-between"
                          style={{ borderRadius: 'var(--v2-radius-card)', boxShadow: 'var(--v2-shadow-card)' }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="w-10 h-10 bg-[var(--v2-primary)]/10 flex items-center justify-center"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <Plug className="h-5 w-5 text-[var(--v2-primary)]" />
                            </div>
                            <div>
                              <p className="font-medium text-[var(--v2-text-primary)] capitalize">
                                {plugin.replace(/-/g, ' ')}
                              </p>
                              <p className="text-xs text-[var(--v2-text-muted)]">
                                Required for this automation
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => handleConnectPlugin(plugin)}
                              disabled={connectingPlugin !== null}
                              className="px-4 py-2 bg-[var(--v2-primary)] text-white font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {connectingPlugin === plugin ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Connecting...
                                </>
                              ) : (
                                'Connect'
                              )}
                            </button>

                            <button
                              onClick={() => handleSkipPlugin(plugin)}
                              disabled={connectingPlugin !== null}
                              className="px-4 py-2 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] font-medium hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              Skip
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <div className="mt-auto pt-4 border-t border-[var(--v2-border)]">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder={isAwaitingFeedback ? "Describe what you'd like to change..." : "Type your answer or question..."}
                    disabled={isSending || (builderState.planApproved && !isAwaitingInputParameter && !isAwaitingSchedule)}
                    className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleSend}
                    disabled={isSending || !inputValue.trim() || (builderState.planApproved && !isAwaitingInputParameter && !isAwaitingSchedule)}
                    className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function V2NewAgentPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    }>
      <V2AgentBuilderContent />
    </Suspense>
  )
}
