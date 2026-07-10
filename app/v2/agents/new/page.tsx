// app/v2/agents/new/page.tsx
// V2 Agent Creation Page - Complete Conversational Builder with Phases 1-7

'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useEffect, useRef } from 'react'
import { useAuth } from '@/components/UserProvider'
import { Card } from '@/components/v2/ui/card'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { ArrowLeft, Bot, Sparkles, MessageSquare, Zap, CheckCircle2, Clock,
  Settings,
  Loader2,
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
  FileText,    // V10: For plan summary message variant
  Check,       // V14: For multi-select checkboxes
  FlaskConical // Post-creation calibration prompt
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
import { buildV6AiContext } from './buildV6AiContext'
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter'
import { useV6AgentGeneration, useMoveToCalibrationAfterCreation } from '@/lib/utils/featureFlags'
import { createTimedThinkingWordCycler, getWordsForCategories } from '@/lib/ui/thinking-words'
import { motion } from 'framer-motion'

// ============================================================================
// V6 Agent Generation Types and Helpers
// ============================================================================

/**
 * V6 API Response structure from /api/v6/generate-ir-intent-contract.
 * (Same shape was previously returned by the now-retired Pipeline B endpoint
 * /api/v6/generate-ir-semantic — both endpoints share the response contract.)
 */
interface V6GenerateResponse {
  success: boolean
  workflow: {
    workflow_steps: any[]
    suggested_plugins: string[]
  }
  validation?: {
    valid: boolean
    issues: string[]
  }
  metadata: {
    architecture: string
    total_time_ms: number
    phase_times_ms: {
      understanding: number
      grounding: number
      formalization: number
      compilation: number
      normalization: number
    }
    steps_generated: number
    plugins_used: string[]
    grounding_confidence?: number
    formalization_confidence?: number
  }
  intermediate_results?: {
    semantic_plan?: {
      goal?: string
      understanding?: {
        data_sources?: any[]
      }
    }
    grounded_plan?: any
    ir?: any
  }
  // WP-55: Phase 1 + Phase 2 artifacts forwarded for persistence on
  // agents.agent_config.ai_context so post-hoc diagnosis of LLM emission
  // variance doesn't require a non-deterministic LLM re-run.
  intent_contract?: any
  data_schema?: any
}

/**
 * Input schema item structure (V4-compatible)
 */
interface InputSchemaItem {
  name: string
  type: string
  label: string
  required: boolean
  description: string
  placeholder: string
  hidden: boolean
}

/**
 * Extract input schema from workflow steps by parsing {{input.variable_name}} patterns
 *
 * @param workflowSteps - Array of PILOT DSL workflow steps
 * @returns Array of input schema items
 */
function extractInputSchema(workflowSteps: any[], enhancedPromptData?: any): InputSchemaItem[] {
  const inputs: InputSchemaItem[] = []
  const seenNames = new Set<string>()

  // Source 1: Scan workflow steps for {{input.variable_name}} patterns
  for (const step of workflowSteps) {
    const stepStr = JSON.stringify(step)
    const matches = stepStr.match(/\{\{input\.(\w+)\}\}/g) || []

    for (const match of matches) {
      const name = match.replace('{{input.', '').replace('}}', '')
      if (!seenNames.has(name)) {
        seenNames.add(name)
        inputs.push({
          name,
          type: 'string',
          label: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          required: true,
          description: '',
          placeholder: '',
          hidden: false
        })
      }
    }
  }

  // Source 2: Include resolved_user_inputs from enhanced prompt data
  // V6 compiler hardcodes resolved values into steps, so {{input.*}} patterns won't exist
  if (enhancedPromptData?.specifics?.resolved_user_inputs) {
    for (const input of enhancedPromptData.specifics.resolved_user_inputs) {
      if (input.key && !seenNames.has(input.key)) {
        seenNames.add(input.key)
        inputs.push({
          name: input.key,
          type: 'string',
          label: input.key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          required: true,
          description: '',
          placeholder: input.value || '',
          hidden: false
        })
      }
    }
  }

  // Source 3: Include user_inputs_required (inputs that still need values)
  if (enhancedPromptData?.specifics?.user_inputs_required) {
    for (const input of enhancedPromptData.specifics.user_inputs_required) {
      const key = input.key || input.name
      if (key && !seenNames.has(key)) {
        seenNames.add(key)
        inputs.push({
          name: key,
          type: 'string',
          label: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          required: true,
          description: input.description || '',
          placeholder: '',
          hidden: false
        })
      }
    }
  }

  return inputs
}

/**
 * Map V6 API response to V4-compatible agent object
 *
 * @param v6Response - Response from /api/v6/generate-ir-intent-contract
 * @param context - Additional context for agent creation
 * @returns Agent data compatible with /api/create-agent
 */
function mapV6ResponseToAgent(
  v6Response: V6GenerateResponse,
  context: {
    agentId: string
    userId: string
    sessionId: string
    initialPrompt: string
    enhancedPromptData: any
    connectedPlugins: string[]
    latencyMs: number
  }
): Partial<CreateAgentData> {
  const { workflow, metadata, intermediate_results } = v6Response
  const semanticPlan = intermediate_results?.semantic_plan

  return {
    user_id: context.userId,
    agent_name: context.enhancedPromptData?.plan_title ||
                semanticPlan?.goal ||
                'New Agent',
    user_prompt: context.enhancedPromptData
      ? JSON.stringify(context.enhancedPromptData)
      : context.initialPrompt || '',
    system_prompt: `You are an automation agent. ${context.enhancedPromptData?.plan_description || semanticPlan?.goal || ''}`,
    description: context.enhancedPromptData?.plan_description ||
                 semanticPlan?.goal ||
                 '',
    plugins_required: workflow.suggested_plugins || metadata.plugins_used || [],
    connected_plugins: context.connectedPlugins,
    input_schema: extractInputSchema(workflow.workflow_steps, context.enhancedPromptData),
    output_schema: [],
    status: 'draft' as const,
    mode: 'on_demand' as const,
    schedule_cron: null,
    created_from_prompt: context.initialPrompt || '',
    ai_reasoning: `Generated via V6 5-phase semantic pipeline. ` +
                  `${metadata.steps_generated} steps created in ${metadata.total_time_ms}ms.`,
    ai_confidence: metadata.grounding_confidence || 0.8,
    ai_generated_at: new Date().toISOString(),
    workflow_steps: workflow.workflow_steps,
    pilot_steps: workflow.workflow_steps,
    trigger_conditions: {
      error_handling: {
        on_failure: 'stop',
        retry_on_fail: false
      }
    },
    detected_categories: (workflow.suggested_plugins || []).map((p: string) => ({
      plugin: p,
      detected: true
    }))
    // NOTE: `agent_config` is intentionally NOT built here. The save handler
    // (`createAgent`) constructs the authoritative agent_config — richer
    // creation_metadata (real thread_id / clarification_answers) plus ai_context
    // via buildV6AiContext — and overrides whatever this mapper returns. Building
    // a second copy here previously diverged from the save handler and clobbered
    // the WP-55 intent_contract/data_schema fields. Single source of truth = the
    // save handler. See docs/investigations/
    // AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md (Addendum).
  }
}

// ============================================================================
// Left-rail decision summaries (UI #1)
// ============================================================================

/**
 * Turn a stored clarification answer into a short, human-readable string for the
 * left-rail "decision map". Single-question mode stores plain-string labels
 * (see `submitPhase2Answer`); the legacy batch path may store structured
 * `{ mode, selected, custom }` answers, so handle both shapes.
 */
function answerToText(answer: unknown): string {
  if (!answer) return ''
  if (typeof answer === 'string') return answer.trim()
  if (typeof answer === 'object') {
    const a = answer as { mode?: string; selected?: unknown; custom?: string }
    if (a.mode === 'custom') return (a.custom || '').trim()
    if (a.mode === 'selected') {
      return Array.isArray(a.selected) ? a.selected.join(', ') : String(a.selected ?? '').trim()
    }
  }
  return ''
}

// ============================================================================
// Main Component
// ============================================================================

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
    answerSelectOption,       // V14: single-select option click
    toggleMultiSelectOption,  // V14: multi-select checkbox toggle
    submitMultiSelectAnswer,  // V14: submit multi-select selections
    openCustomInput,          // V14: show "Other" textarea
    updateCustomInput,        // V14: update custom input value
    submitCustomAnswer,       // V14: submit custom text answer
    setEnhancement,
    startEditingEnhanced,
    resetForRefinement,  // V10: Reset state for mini-cycle/edit flow
    approvePlan
  } = useAgentBuilderState()

  const {
    messages,
    setMessages,
    messagesEndRef,
    addUserMessage,
    addAIMessage,
    addAIQuestion,      // V10: Question variant
    addPlanSummary,     // V10: Plan summary variant
    addSuccessMessage,  // Animated "Agent created!" inline success card
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

  // B.6: Thinking Words - rotating status messages during V6 generation
  const THINKING_INTERVAL_MS = 4000
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  console.log('🆔 V2 Agent Builder initialized with IDs:', {
    agentId: agentId.current,
    sessionId: sessionId.current,
    threadId
  });

  // Enhanced prompt display state
  const [isStepsExpanded, setIsStepsExpanded] = useState(false)
  // E8 (2026-05-30): the Agent Draft "Configuration" block can grow long when
  // the agent has many input parameters. Default to COLLAPSED so the card stays
  // compact; user can expand to inspect (mirrors the "How it works" accordion).
  const [isConfigurationExpanded, setIsConfigurationExpanded] = useState(false)
  // E8 (2026-05-30): same treatment for the Agent Draft "How it works" steps —
  // separate state from `isStepsExpanded` (chat-side card) so the two cards
  // toggle independently. Default COLLAPSED.
  const [isAgentDraftStepsExpanded, setIsAgentDraftStepsExpanded] = useState(false)
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

  // Phase 2 single-question mode (2026-05-28): the backend now asks ONE question
  // per turn ({ question, phase2_done }) instead of returning a batch
  // `questionsSequence`. `phase2AwaitingAnswer` is true while we are waiting for
  // the user's free-text reply to the current single question; `handleSend`
  // uses it to route the reply back as `phase2_user_answer`. `phase2TurnRef`
  // keys each answer into `clarificationAnswers` (e.g. `phase2_turn_1`) so
  // Phase 3 still receives the collected answers.
  const [phase2AwaitingAnswer, setPhase2AwaitingAnswer] = useState(false)
  const phase2TurnRef = useRef(0)

  // Staleness-proof mirror of the Phase 2 single-question answers (2026-05-29).
  // `builderState.clarificationAnswers` is updated via setState (async), so the
  // LAST answer submitted on the turn the backend returns `phase2_done` has not
  // flushed into builderState by the time the Phase 3 transition fires (it runs
  // in the same call chain via `setTimeout(processPhase3, …)`, whose closure
  // captured the pre-answer builderState). That dropped the last answer (e.g. the
  // marketing-manager email) from the Phase 3 `clarification_answers` payload, so
  // Phase 3 saw the input as unresolved and re-asked it (mini-cycle + phase
  // entrenchment). This ref is written synchronously in `submitPhase2Answer`, so
  // Phase 3 always sees every answer including the just-submitted one.
  const clarificationAnswersRef = useRef<Record<string, string>>({})

  // E3 (2026-05-29): client-side Phase 2 inter-question hints. The hint copy now
  // lives in the `clarification_hints` category of thinking-words-dictionary.json
  // (no longer server-sent as `inline_hint`). Per Phase 2 SESSION we take a
  // SHUFFLED copy of those phrases and walk it sequentially, so the user never
  // sees the same hint twice in a session (10 phrases > 9 max questions) and the
  // order varies across sessions. `phase2QuestionsRenderedRef` counts questions
  // rendered this session: question #1 gets the opening message (no hint),
  // questions #2+ get a cycled hint.
  const clarificationHintsRef = useRef<string[]>([])
  const hintIndexRef = useRef(0)
  const phase2QuestionsRenderedRef = useRef(0)

  // E4 (2026-05-29): running "Question N" ordinal shown to the user. Unlike the
  // per-session counters above (and the server-side cap counter), this is a
  // THREAD-WIDE running total — it increments on every rendered Phase 2 question
  // and is NEVER reset per session, so a mini-cycle's first question continues
  // the count (prior total + 1) rather than restarting at 1. Numerator only —
  // no total/denominator is shown (single-question mode has no known total).
  const runningQuestionNumberRef = useRef(0)

  // Re-shuffle the hint deck and reset counters at the start of each Phase 2
  // session (initial entry OR mini-cycle start).
  const resetClarificationHints = () => {
    const phrases = getWordsForCategories(['clarification_hints'])
    for (let i = phrases.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[phrases[i], phrases[j]] = [phrases[j], phrases[i]]
    }
    clarificationHintsRef.current = phrases
    hintIndexRef.current = 0
    phase2QuestionsRenderedRef.current = 0
  }

  // Next hint from the shuffled deck (null if the category is empty).
  const nextClarificationHint = (): string | null => {
    const deck = clarificationHintsRef.current
    if (deck.length === 0) return null
    const hint = deck[hintIndexRef.current % deck.length]
    hintIndexRef.current += 1
    return hint
  }

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

  // Post-creation calibration prompt (gated by NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION)
  const [showCalibrationPrompt, setShowCalibrationPrompt] = useState(false)
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null)
  // Tracks the user's calibration choice for the Setup Progress "Calibration Test Run"
  // box (null = not yet decided; set briefly before navigating away).
  const [calibrationChoice, setCalibrationChoice] = useState<null | 'accepted' | 'declined'>(null)

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

  // AI Provider/Model configuration (fetched from system settings)
  const [aiConfig, setAiConfig] = useState<{ provider: string; model: string }>({
    provider: 'openai',
    model: 'gpt-4o'
  })
  const [aiConfigLoaded, setAiConfigLoaded] = useState(false)

  // Auto-scroll to bottom when messages or UI state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, scheduleType, scheduleTime, selectedDays, selectedMonthDay, showScheduleBuilder, isAwaitingSchedule, isAwaitingFinalApproval, builderState.showingCustomInput])

  // B.6: Cleanup thinking words interval on unmount
  useEffect(() => {
    return () => {
      if (thinkingIntervalRef.current) clearInterval(thinkingIntervalRef.current)
    }
  }, [])

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

  // Fetch AI provider/model configuration on mount
  useEffect(() => {
    const fetchAiConfig = async () => {
      try {
        const res = await fetch('/api/system-config?category=agent_creation')
        if (res.ok) {
          const config = await res.json()
          setAiConfig({
            provider: config.agent_creation_ai_provider || 'openai',
            model: config.agent_creation_ai_model || 'gpt-4o'
          })
          console.log('🤖 AI Config loaded:', config)
        }
      } catch (err) {
        console.warn('Failed to fetch AI config, using defaults:', err)
      } finally {
        setAiConfigLoaded(true)
      }
    }
    fetchAiConfig()
  }, [])

  // Initialize thread when user and prompt are ready (and AI config loaded)
  useEffect(() => {
    if (user && initialPrompt && !threadId && !isInitializing && !initializingRef.current && aiConfigLoaded) {
      initializingRef.current = true
      initializeThread()
    }
  }, [user, initialPrompt, threadId, isInitializing, aiConfigLoaded])

  // Auto-trigger Phase 3 when all questions are answered
  useEffect(() => {
    // V14: Helper to check if answer is valid (works with string or structured)
    const isAnswerValid = (answer: unknown): boolean => {
      if (!answer) return false;
      if (typeof answer === 'string') return answer.trim().length > 0;
      // Structured answer (select/multi_select)
      if (typeof answer === 'object' && answer !== null) {
        const a = answer as { mode?: string; selected?: unknown; custom?: string };
        if (a.mode === 'selected') return !!a.selected;
        if (a.mode === 'custom') return !!a.custom?.trim();
      }
      return false;
    };

    // NOTE (2026-05-28): legacy batch auto-advance. Single-question mode DOES
    // now populate `questionsSequence` (with exactly one live question per
    // turn), BUT this effect stays inert for it because it additionally
    // requires `workflowPhase === 'enhancement'` AND `currentQuestionIndex === -1`
    // — neither of which the single-question path ever sets (the answer
    // round-trip never reaches `proceedToNextQuestion`, the only code that sets
    // those). The single-question advance to Phase 3 happens explicitly in
    // `processPhase2` on `phase2_done === true`. Kept untouched so any residual
    // batch flow keeps working.
    const allQuestionsAnswered = builderState.questionsSequence.length > 0 &&
      builderState.questionsSequence.every(q => isAnswerValid(builderState.clarificationAnswers[q.id]))

    if (builderState.workflowPhase === 'enhancement' &&
        builderState.currentQuestionIndex === -1 &&
        allQuestionsAnswered &&
        !builderState.enhancementComplete) {

      // V10: Different messaging for mini-cycle vs initial Phase 3
      if (isInMiniCycle) {
        startThinkingWords('Updating your agent plan with new details...')
      } else {
        startThinkingWords('Creating your enhanced agent plan...')
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
  // NOTE (2026-05-28): batch question-render path. Single-question mode now
  // populates `questionsSequence` (one question per turn) too, but it ALSO
  // renders the question bubble imperatively in `processPhase2` via
  // `addAIQuestion(data.question.question, data.question.id)` BEFORE this effect
  // runs. The `messages.find(...)` guard below therefore finds the existing
  // bubble and skips, so there is no double-render. This effect remains the
  // render path for any residual multi-question batch flow.
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

      // 2. Add thinking words indicator
      startThinkingWords('Analyzing your request...')

      // Create thread with AI provider/model from system config
      console.log('🔄 Creating thread with prompt:', initialPrompt, 'using:', aiConfig)
      const createRes = await fetch('/api/agent-creation/init-thread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
          'x-session-id': sessionId.current,
          'x-agent-id': agentId.current
        },
        body: JSON.stringify({
          initial_prompt: initialPrompt,
          ai_provider: aiConfig.provider,
          ai_model: aiConfig.model
        })
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
      stopThinkingWords()
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

      // Stop thinking words
      stopThinkingWords()

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

      // Add thinking words for Phase 2
      startThinkingWords('Generating clarification questions...')

      // Move to Phase 2
      setTimeout(() => processPhase2(tid), 1000)

    } catch (error) {
      console.error('❌ Phase 1 error:', error)
      stopThinkingWords()
      addSystemMessage('Error during analysis')
    }
  }

  // Phase 2: Single-question mode (2026-05-28)
  //
  // The backend now drives Phase 2 one question at a time. Every `phase: 2`
  // call returns `{ question, phase2_done, disclosure_banner?,
  // termination_reason? }` and NO `questionsSequence`. We render ONE question
  // per turn and wait for the user's free-text answer (collected by
  // `handleSend`, which calls back into here with `phase2_user_answer`). We
  // advance to Phase 3 ONLY when the response sets `phase2_done === true` —
  // never on an empty `questionsSequence` (that batch auto-advance was the
  // R3 bug that skipped straight to the plugin gate).
  //
  // Mini-cycle refinement (Phase 3 → user_inputs_required, or the "Need
  // changes" edit flow) shares this same path because the route's Phase 2
  // branch is unconditional. We preserve the mini-cycle's distinguishing
  // behavior via `isInMiniCycle` / `pendingEnhancedPrompt`: when a mini-cycle
  // Phase 2 session terminates, we re-run Phase 3 WITH the pending
  // `enhanced_prompt` for refinement (matching the prior batch behavior).
  const processPhase2 = async (
    tid: string,
    options?: {
      enhanced_prompt?: any;       // V10: For mini-cycle refinement
      user_feedback?: string;      // V10: For edit flow refinement
      phase2_user_answer?: string; // Single-question mode: user's reply this turn
    }
  ) => {
    try {
      const isMiniCycleStart = !!options?.enhanced_prompt || !!options?.user_feedback
      console.log('🔄 Phase 2: Single-question...', isMiniCycleStart ? '(mini-cycle start)' : '')

      // E3: a Phase 2 SESSION begins on a turn that carries no `phase2_user_answer`
      // (initial entry or mini-cycle start). Mid-loop answer turns carry the answer.
      // Re-shuffle the hint deck + reset the per-session question counter here.
      const isFirstTurnOfSession = !options?.phase2_user_answer
      if (isFirstTurnOfSession) {
        resetClarificationHints()
      }

      // V10: Track mini-cycle state at the START of a refinement session so the
      // subsequent answer round-trips (which carry only `phase2_user_answer`)
      // still terminate into the refinement Phase 3 path below.
      if (isMiniCycleStart) {
        setIsInMiniCycle(true)
        if (options?.enhanced_prompt) {
          setPendingEnhancedPrompt(options.enhanced_prompt)
        }
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
          thread_id: tid,
          phase: 2,
          enhanced_prompt: options?.enhanced_prompt || null,        // V10: Pass for mini-cycle
          user_feedback: options?.user_feedback || null,            // V10: Pass for edit flow
          phase2_user_answer: options?.phase2_user_answer ?? null,  // Single-question: user's reply
          declined_services: declinedPlugins                        // V10: Maintain declined services
        })
      })

      if (!res.ok) throw new Error('Phase 2 failed')

      const data = await res.json()
      console.log('✅ Phase 2 response:', data)

      // Stop thinking words
      stopThinkingWords()

      // Display conversational summary (if the backend sent one)
      if (data.conversationalSummary) {
        addAIMessage(data.conversationalSummary)
      }

      // Read whether we are (or were) refining an existing plan. We snapshot
      // `isInMiniCycle` here because the state setter above is async; for the
      // first turn of a mini-cycle we rely on `isMiniCycleStart`.
      const refiningPlan = isMiniCycleStart || isInMiniCycle

      // ── Single-question response handling ──────────────────────────────
      if (data.phase2_done === true) {
        // Loop complete — advance to Phase 3. Surface the cap-hit disclosure
        // banner first if the backend included one (cap_hit termination).
        setPhase2AwaitingAnswer(false)

        if (data.disclosure_banner) {
          addAIMessage(data.disclosure_banner)
        }

        if (refiningPlan && pendingEnhancedPrompt) {
          // Mini-cycle complete — re-run Phase 3 WITH the pending enhanced
          // prompt so the plan is refined (not regenerated from scratch).
          setIsInMiniCycle(false)
          startThinkingWords('Updating your agent plan with new details...')
          const refinementPrompt = pendingEnhancedPrompt
          setPendingEnhancedPrompt(null)
          setTimeout(() => {
            processPhase3(tid, undefined, { enhanced_prompt: refinementPrompt })
          }, 1200)
        } else {
          // Initial Phase 2 complete — build the plan. This `else` is ALSO the
          // intentional regenerate fallback for a mini-cycle that has no pending
          // enhanced prompt (e.g. a `user_feedback`-only edit that set
          // `isInMiniCycle` but left `pendingEnhancedPrompt` null): we rebuild from
          // scratch rather than refine. Matches the pre-existing batch fallback.
          startThinkingWords('Creating your agent plan...')
          setTimeout(() => processPhase3(tid), 1200)
        }
      } else if (data.question && typeof data.question === 'object' && typeof data.question.question === 'string' && data.question.question.trim()) {
        // Render exactly ONE STRUCTURED question (2026-05-28). The backend now
        // sends the v15 `ClarificationQuestion` shape ({ id, question, type,
        // options?, allowCustom?, theme? }) so the user gets clickable option
        // buttons (select/multi_select) or a free-text prompt — never
        // "pick a number" prose. We reuse the EXISTING option-button render
        // UI by pushing the single incoming question into `questionsSequence`
        // (which sets `currentQuestionIndex: 0` and `workflowPhase: 'questions'`).
        //
        // IMPORTANT: this REPLACES the array each turn — the single-question
        // loop holds exactly one live question at a time. Per-turn answers are
        // accumulated separately in `clarificationAnswers` (keyed `phase2_turn_N`
        // by `submitPhase2Answer`), so replacing the array loses no history.
        // The batch advance machinery stays inert because we never set
        // `workflowPhase: 'enhancement'` / `currentQuestionIndex: -1` here.
        setQuestionsSequence([data.question])

        // E3: track which question this is within the current Phase 2 session.
        phase2QuestionsRenderedRef.current += 1
        const isFirstQuestionOfSession = phase2QuestionsRenderedRef.current === 1

        // Lead-in bubble BEFORE the question (E3 / E3.5). Rendered as a native AI
        // chat bubble (`addAIMessage`) — NOT the centered system "comment" pill —
        // so it reads like the bot is talking, not a note tacked under the question.
        //   • Q1 of the INITIAL (non-mini-cycle) session → the opening framing
        //     message. Mini-cycles refine an existing plan, so "before I can build
        //     your agent" doesn't apply there.
        //   • Q2+ → a soft converging hint from the shuffled `clarification_hints`
        //     deck (client-side; no longer server-sent). Generic/qualitative only —
        //     never the cap or a number (FR7.19/20).
        if (isFirstQuestionOfSession) {
          if (!refiningPlan) {
            addAIMessage('I need a few quick details before I can build your agent.')
          }
        } else {
          const hint = nextClarificationHint()
          if (hint) {
            addAIMessage(hint)
          }
        }

        // E4: advance the thread-wide running question number (never resets per
        // session, so mini-cycle questions continue the count) and attach it to
        // the message so the render shows "Question N".
        runningQuestionNumberRef.current += 1

        // Render the question bubble so its content matches the current
        // question (the option-button render gate keys off
        // `currentQuestion.question === message.content`).
        addAIQuestion(data.question.question, data.question.id, runningQuestionNumberRef.current)

        setPhase2AwaitingAnswer(true)
      } else {
        // Degraded turn — the backend passed through a payload with neither a
        // question nor `phase2_done` (LLM emitted a bad shape; FR4.11). Do NOT
        // advance to Phase 3 and do NOT fabricate a question. Clear the prior
        // question first so its stale option buttons don't remain clickable next
        // to the rephrase prompt (the option-button render gate keys off a live
        // `questionsSequence` entry). Then ask the user to rephrase and keep
        // waiting for input so the next turn can recover.
        setQuestionsSequence([])
        setBuilderState(prev => ({ ...prev, workflowPhase: 'questions' }))
        addAIMessage("Let me think about that — could you rephrase or add a little more detail?")
        setPhase2AwaitingAnswer(true)
      }

    } catch (error) {
      console.error('❌ Phase 2 error:', error)
      stopThinkingWords()
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
          // Merge the staleness-proof ref over builderState so the just-submitted
          // Phase 2 answer (which may not have flushed into builderState yet) is
          // always present. Without this the last answer is dropped and Phase 3
          // re-asks it. The ref wins on key collisions (it is the latest value).
          clarification_answers: { ...builderState.clarificationAnswers, ...clarificationAnswersRef.current },
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

      // Stop thinking words
      stopThinkingWords()

      // ⚠️ OAuth Gate Check: If missing plugins, show connection cards
      if (data.missingPlugins && data.missingPlugins.length > 0) {
        console.log('🔒 Phase 3 OAuth Gate: Missing plugins detected', data.missingPlugins)

        setMissingPlugins(data.missingPlugins)
        setShowPluginCards(true)

        // Show message asking user to connect plugins
        const oauthMessage = data.metadata?.oauth_message ||
          'To complete your setup, please connect the following services:'
        addAIMessage(oauthMessage)

        return // Stop here, wait for user to connect/skip plugins
      }

      // Phase 3 → mini-cycle SAFETY NET (single-question-aware, 2026-05-28).
      // With the recognition fix in place — Phase 2 answers are keyed by qId, and
      // the v16 Phase 3 prompt resolves user_inputs_required against the full Phase 2
      // conversation — Phase 3 should resolve every input the loop already gathered,
      // leaving `user_inputs_required` empty in the normal case. So this block fires
      // ONLY when an input is GENUINELY still missing; it is a safety net, not the
      // primary gathering mechanism (that's the single-question loop).
      // The `!isInMiniCycle` guard makes it fire at most ONCE per session: the
      // mini-cycle's own Phase 2 round-trips set isInMiniCycle, so when Phase 3 runs
      // again afterward it falls through to the cleanup below and shows the plan —
      // no infinite Phase 3 ↔ Phase 2 loop.
      const userInputsRequired = data.enhanced_prompt?.specifics?.user_inputs_required || []
      if (userInputsRequired.length > 0 && !isInMiniCycle) {
        console.log('🔄 Phase 3: genuinely-missing inputs — mini-cycle safety net:', userInputsRequired)

        // Store the enhanced_prompt so the mini-cycle terminates back into a
        // refinement Phase 3 (not a from-scratch regeneration).
        setPendingEnhancedPrompt(data.enhanced_prompt)
        resetForRefinement()

        // Soft, non-technical message — do NOT echo raw input labels (they can be
        // jargon-y like "sender email address to filter on"). The actual question
        // follows one at a time via the single-question loop.
        addAIMessage('Just one or two more details to finish your agent.')

        startThinkingWords('One more question…')
        setTimeout(() => {
          processPhase2(currentThreadId, { enhanced_prompt: data.enhanced_prompt })
        }, 1000)

        return // wait for the mini-cycle single-question loop to complete
      }

      // Clear mini-cycle / edit-flow state once Phase 3 has run after a refinement.
      if (isInMiniCycle) {
        console.log('✅ Mini-cycle / refinement complete')
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
      stopThinkingWords()

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
        startThinkingWords('All services connected! Creating your enhanced plan...')
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
      startThinkingWords('Re-evaluating with alternative services...')
      await processPhase3(threadId!, connectedPlugins, { declined_services: updatedDeclined })
    }
  }

  // ==================== POST-CREATION CALIBRATION PROMPT ====================

  // Record the user's prompt decision on the agent (non-blocking — navigation
  // must never wait on this; consent is already enforced by the click). The
  // server stamps the decided-at timestamp.
  const recordCalibrationDecision = (agentId: string, decision: 'accepted' | 'declined') => {
    fetch(`/api/v2/agents/${agentId}/calibration-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    }).catch(err => console.warn('⚠️ Failed to record calibration decision (non-blocking)', err))
  }

  const handleStartCalibration = () => {
    if (!createdAgentId) return
    const agentId = createdAgentId
    setShowCalibrationPrompt(false)
    // Echo the user's choice + a bot follow-up so the conversation reflects it.
    setCalibrationChoice('accepted')
    addUserMessage('Yes, test it')
    addAIMessage("Great — we're testing your agent now. You'll get an email with the result, and it'll unlock in your agents list once it passes.")
    // Record the decision (sets calibration_status='running').
    recordCalibrationDecision(agentId, 'accepted')
    // Fire the calibration in the BACKGROUND — do NOT await. The server keeps
    // running after we navigate away; its tail records pass/fail + emails the user.
    fetch('/api/v2/calibrate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, inputValues: inputParameterValues, background: true })
    }).catch(err => console.warn('⚠️ Failed to trigger background calibration (non-blocking)', err))
    // Move the user on — they watch their inbox / the agents list, not a progress
    // screen. Hold long enough (3.5s) for the two-sentence "we're testing your
    // agent now… you'll get an email" message to be read before the route
    // transition (UI #4). The 600ms original flashed past before it was readable.
    setTimeout(() => {
      router.push('/v2/agent-list')
    }, 3500)
  }

  const handleSkipCalibration = () => {
    if (!createdAgentId) return
    const agentId = createdAgentId
    setShowCalibrationPrompt(false)
    setCalibrationChoice('declined')
    addUserMessage('Skip for now')
    addAIMessage("No problem — your agent is in your agents list. You can run the test whenever you're ready.")
    // Record the decision (sets calibration_status='skipped' → gated; click routes to the sandbox).
    recordCalibrationDecision(agentId, 'declined')
    // Hold long enough (2.5s) for the confirmation message to be read before the
    // route transition (UI #4).
    setTimeout(() => {
      router.push('/v2/agent-list')
    }, 2500)
  }

  // ==================== THINKING WORDS HELPERS ====================

  const startThinkingWords = (initialMessage?: string) => {
    // Stop any existing interval before starting a new one
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current)
      thinkingIntervalRef.current = null
    }
    removeTypingIndicator()

    const getNextWord = createTimedThinkingWordCycler()

    // Show contextual message first, then rotate thinking words after first interval
    addTypingIndicator(initialMessage || getNextWord() + '...')

    thinkingIntervalRef.current = setInterval(() => {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === 'typing-indicator'
            ? { ...msg, content: getNextWord() + '...' }
            : msg
        )
      )
    }, THINKING_INTERVAL_MS)
  }

  const stopThinkingWords = () => {
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current)
      thinkingIntervalRef.current = null
    }
    removeTypingIndicator()
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
        enhancedPrompt: builderState.enhancedPrompt,
        // Include plan_description for use as agent description
        plan_description: enhancedPromptData?.plan_description
      }

      // Check if V6 generation is enabled
      const useV6 = useV6AgentGeneration()
      let agentData: CreateAgentData
      // WP-47: captured from v6Data.ir.config_defaults inside the V6 block,
      // read after the V4/V6 branches merge to pre-populate resolvedInputs.
      let v6IrConfigDefaults: Array<{ key?: string; default?: any }> | undefined

      if (useV6) {
        // ================================================================
        // V6 FLOW — IntentContract pipeline (single LLM call, regression-tested).
        // Endpoint: /api/v6/generate-ir-intent-contract
        // Code path: generateGenericIntentContractV1 → CapabilityBinderV2 →
        // IntentToIRConverter → ExecutionGraphCompiler.
        //
        // P6 (2026-05-20): the previous dual-pipeline branching (Pipeline A
        // vs Pipeline B / `useV6PipelineA()` flag) was retired after Pipeline
        // A landed end-to-end across 3 regression scenarios. The Pipeline B
        // endpoints (`/api/v6/generate-ir-semantic` et al.) remain in code
        // and continue to back the diagnostic test pages, but the V2 UI no
        // longer uses them. See docs/v6/V6_PIPELINE_A_MIGRATION.md § P6.
        // ================================================================
        console.log('🚀 Using V6 (IntentContract pipeline)...')

        // Show rotating thinking words during V6 generation
        startThinkingWords()

        const v6StartTime = Date.now()

        // Single API call - runs all pipeline phases
        const v6Response = await fetch('/api/v6/generate-ir-intent-contract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id,
            'x-session-id': sessionId.current,
            'x-agent-id': agentId.current
          },
          body: JSON.stringify({
            enhanced_prompt: enhancedPromptData,
            userId: user.id,
            config: {
              return_intermediate_results: true,  // Get semantic plan for agent name
              provider: 'openai'
            }
          })
        })

        if (!v6Response.ok) {
          const errorData = await v6Response.json()
          throw new Error(errorData.error || errorData.details || 'V6 generation failed')
        }

        const v6Data: V6GenerateResponse = await v6Response.json()
        const v6LatencyMs = Date.now() - v6StartTime

        if (!v6Data.success) {
          throw new Error('V6 generation returned unsuccessful response')
        }

        // WP-47: capture IR's config_defaults for the post-branch resolvedInputs
        // pre-population. Pipeline A returns ir.config_defaults; Pipeline B may
        // not, in which case this stays undefined and the merge is a no-op.
        v6IrConfigDefaults = (v6Data as any)?.ir?.config_defaults

        console.log('✅ V6 generation complete:', {
          steps: v6Data.metadata.steps_generated,
          time: `${v6LatencyMs}ms`,
          phases: v6Data.metadata.phase_times_ms
        })

        // Map V6 response to agent object
        const v6Agent = mapV6ResponseToAgent(v6Data, {
          agentId: agentId.current,
          userId: user.id,
          sessionId: sessionId.current,
          initialPrompt: initialPrompt || '',
          enhancedPromptData,
          connectedPlugins,
          latencyMs: v6LatencyMs
        })

        // Build agent config for V6
        const agentConfig: CreateAgentConfig = {
          creation_metadata: {
            ai_generated_at: new Date().toISOString(),
            session_id: sessionId.current,
            agent_id: agentId.current,
            thread_id: threadId || '',
            prompt_type: 'enhanced',
            clarification_answers: builderState.clarificationAnswers,
            version: '6.0',
            platform_version: 'v6.0',
            enhanced_prompt_data: enhancedPromptData
          },
          // WP-55: buildV6AiContext is the single source of truth for ai_context.
          // It persists the Phase-1 IntentContract + Phase-2 data_schema so
          // post-hoc diagnosis of this agent's LLM emission is a SQL lookup, not
          // a non-deterministic re-run. (mapV6ResponseToAgent no longer builds a
          // divergent copy — see its NOTE.)
          ai_context: buildV6AiContext({
            reasoning: v6Agent.ai_reasoning || '',
            confidence: v6Agent.ai_confidence || 0,
            originalPrompt: initialPrompt || '',
            enhancedPrompt: builderState.enhancedPrompt || '',
            intentContract: v6Data.intent_contract,
            dataSchema: v6Data.data_schema
          })
        }

        // Build final agent data
        agentData = {
          ...v6Agent,
          agent_config: agentConfig,
          schedule_cron: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          mode: 'on_demand',
          status: 'draft'
        } as CreateAgentData

        console.log('✅ V6 Agent mapped:', agentData.agent_name)

      } else {
        // ================================================================
        // V4 FLOW: OpenAI 3-Stage Generation (Existing Flow)
        // ================================================================
        console.log('📞 Calling /api/generate-agent-v4 (OpenAI 3-Stage)...')
        console.log('🎯 Passing services_involved for token optimization:', requiredServices)
        const generateRes = await fetch('/api/generate-agent-v4', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id,
            'x-session-id': sessionId.current,
            'x-agent-id': agentId.current
          },
          body: JSON.stringify({
            // V4 expects 'enhancedPrompt' if we already have it, or 'prompt' for raw
            // Use enhancedPromptData (the structured object) if available, otherwise fallback
            ...(useEnhanced && enhancedPromptData
              ? {
                  enhancedPrompt: typeof enhancedPromptData === 'string'
                    ? enhancedPromptData
                    : JSON.stringify(enhancedPromptData, null, 2)
                }
              : { prompt: initialPrompt }
            ),
            promptType: useEnhanced ? 'enhanced' : 'original',
            clarificationAnswers,
            userId: user.id,
            services_involved: requiredServices,  // Pass filtered plugins from Phase 3
            connectedPlugins: connectedPlugins  // Pass connected plugin keys for v4
          })
        })

        const generatedAgent: GenerateAgentV2Response = await generateRes.json()

        if (!isGenerateAgentV2Success(generatedAgent)) {
          throw new Error(generatedAgent.error || 'Failed to generate agent')
        }

        console.log('✅ Agent generated:', generatedAgent.agent.agent_name)

        // Build agent_config metadata
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

        // Build initial agent data (schedule will be set later)
        agentData = {
          ...generatedAgent.agent,
          agent_config: agentConfig,
          schedule_cron: null, // Will be set after scheduling step
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          mode: 'on_demand', // Will be updated if scheduled
          status: 'draft'
        }
      }

      // Store agent data for later
      setPendingAgentData(agentData)

      // Stop thinking words and show draft ready message
      stopThinkingWords()
      addAIMessage("Agent draft ready!")

      // Add resolved_user_inputs to inputParameterValues if available
      // Keep resolvedInputs in scope so we can filter out already-provided parameters
      let resolvedInputs: Record<string, any> = {}
      if (enhancedPromptData?.specifics?.resolved_user_inputs) {
        enhancedPromptData.specifics.resolved_user_inputs.forEach((input: { key: string; value: string }) => {
          resolvedInputs[input.key] = input.value
        })
      }
      // WP-47: Pipeline A's IR carries `config_defaults` whose keys match the
      // DSL's {{input.X}} refs and whose `default` values are the EP's
      // resolved_user_inputs transcribed by the IC LLM. Without merging these,
      // the requiredParams filter below treats IC keys (e.g. "spreadsheet_id")
      // as missing because resolved_user_inputs uses the EP-Key-Hint format
      // (e.g. "google-sheets__table/get__spreadsheet_id") — the two sets never
      // intersect, so the user gets re-prompted for values they already gave.
      // Pipeline B (semantic) doesn't have this issue because its compiler
      // inlines values into DSL params and there are no {{input.X}} refs at
      // all; ir.config_defaults is absent or unused. Safe no-op for Pipeline B.
      if (v6IrConfigDefaults && Array.isArray(v6IrConfigDefaults)) {
        for (const entry of v6IrConfigDefaults) {
          if (entry?.key && entry.default !== undefined && !(entry.key in resolvedInputs)) {
            resolvedInputs[entry.key] = entry.default
          }
        }
      }
      if (Object.keys(resolvedInputs).length > 0) {
        setInputParameterValues(prev => ({ ...prev, ...resolvedInputs }))
      }

      // Check for required input parameters that don't already have values from resolved_user_inputs
      // Note: Use agentData.input_schema which works for both V6 and V4 flows
      const requiredParams = agentData.input_schema?.filter(
        (input: any) => input.required === true && !(input.name in resolvedInputs)
      ) || []

      if (requiredParams.length > 0) {
        // Start input parameters flow for missing parameters only
        setRequiredInputs(requiredParams)
        setCurrentInputIndex(0)
        setIsAwaitingInputParameter(true)
        addAIMessage("Great! Now let's configure the remaining agent settings.")

        // Ask first parameter question
        const firstParam = requiredParams[0]
        addAIMessage(`What value should I use for **${firstParam.label || firstParam.name}**?\n\n${firstParam.description || ''}`)
      } else {
        // No required parameters or all already have values, mark step complete and go to scheduling
        setInputParametersComplete(true)
        addAIMessage("Great! Now let's decide when the agent will run.")
        setIsAwaitingSchedule(true)
      }

      setIsCreatingAgent(false)
      return // Stop here - continue from input parameters or scheduling handlers

    } catch (error: any) {
      console.error('❌ Agent creation error:', error)
      stopThinkingWords()
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
      // E9 (2026-05-30): fold input_values into a SINGLE /api/create-agent call.
      // The route now inline-saves agent_configurations atomically with the agent
      // insert (eliminates the prior ~1.5 s sequential save-inputs round-trip AND
      // closes the race with the V1 agent edit page's on-mount checkAgentConfiguration).
      // The standalone /api/agent-configurations/save-inputs route remains as the
      // canonical write path for POST-creation updates from the agent edit page.
      console.log('📞 Calling /api/create-agent (with input_values folded in — E9)...')
      const hasInputValues =
        Object.keys(inputParameterValues).length > 0
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
          agentId: agentId.current,
          thread_id: threadId,
          ...(hasInputValues && { input_values: inputParameterValues })
        })
      })

      if (!createRes.ok) {
        const errorData = await createRes.json()
        throw new Error(errorData.error || 'Failed to create agent')
      }

      const result = await createRes.json()
      console.log('✅ Agent created successfully:', result.agent?.id, hasInputValues ? `(inputsSaved=${result.inputsSaved})` : '')

      // If inputs were sent but the inline save did not succeed, the agent
      // exists but its configuration row is missing — surface that in console
      // and the page-side audit. (The user can still configure from the agent
      // edit page; we don't block the navigation.)
      if (hasInputValues && result.inputsSaved === false) {
        console.warn('⚠️ Agent created but inline input save failed — user can re-save from the agent edit page')
      }

      // Mark agent as created (drives the left-rail "Agent Ready" step)
      setAgentCreated(true)

      // Stop thinking words and show the animated success card as an INLINE chat
      // message so it holds its place in the conversation — any calibration Q&A
      // added afterwards renders BELOW it (previously the card was a trailing
      // block pinned to the bottom, so later messages slotted above it and looked
      // like they never appeared).
      stopThinkingWords()
      const createdAgentName =
        (agentData?.agent_name || enhancedPromptData?.plan_title || 'Your agent is ready.').toString().trim()
      addSuccessMessage(createdAgentName)

      if (useMoveToCalibrationAfterCreation()) {
        // Flag ON: offer the user a choice to calibrate before going live.
        // Navigation happens ONLY on a button click (handleStartCalibration /
        // handleSkipCalibration) — never auto-redirect (workplan R3).
        setCreatedAgentId(result.agent.id)
        // Spotlight the success card: let its entrance animation (~1.2s) play
        // ALONE first, THEN reveal the calibration message + prompt. Otherwise
        // all three mount at once and the animation is lost in the flurry.
        setTimeout(() => {
          addAIMessage("Your agent is ready! Want to test it now? Heads up: calibration runs it once on real data (it may send/create real items), so make sure everything it needs is in place first.")
          setShowCalibrationPrompt(true)
        }, 1400)
      } else {
        // Flag OFF (default): unchanged behaviour — auto-redirect to the agent page.
        addAIMessage('Your agent has been created successfully! Taking you to your new agent...')

        // E9 + Option A: 1000 ms → 300 ms. The message stays briefly readable
        // while Next.js starts the route transition.
        setTimeout(() => {
          router.push(`/agents/${result.agent.id}`)
        }, 300)
      }

    } catch (error: any) {
      console.error('❌ Agent creation error:', error)
      addSystemMessage(`Error creating agent: ${error.message}`)
    } finally {
      setIsCreatingAgent(false)
    }
  }

  // ==================== HANDLERS ====================

  // Phase 2 single-question mode (2026-05-28): dedicated answer handler.
  //
  // This is the ONLY path a Phase 2 answer takes in single-question mode —
  // for ALL three question types (text via the chat input, select option
  // clicks, multi_select "Done", and the "Other"/custom text submit). It
  // deliberately does NOT call the batch answer functions
  // (`answerSelectOption` / `submitMultiSelectAnswer` / `answerQuestion` /
  // `submitCustomAnswer`), all of which schedule `proceedToNextQuestion` —
  // which, with a single question in `questionsSequence`, would mark "all
  // answered" → set `workflowPhase: 'enhancement'` / `currentQuestionIndex: -1`
  // → fire the batch auto-advance `useEffect` → jump to Phase 3 after every
  // answer (the bug this round-trip prevents).
  //
  // Instead we round-trip the answer to the backend as `phase2_user_answer`
  // and let `processPhase2` decide whether to render the next question or
  // advance to Phase 3 on `phase2_done`.
  const submitPhase2Answer = async (answerText: string) => {
    const answer = (answerText ?? '').trim()
    // Guard: only act while we are awaiting a Phase 2 answer, and only with a
    // live thread. Flip the flag off immediately to prevent a double-send
    // (e.g. a fast double-click on an option button).
    if (!answer || !phase2AwaitingAnswer || !threadId) return
    setPhase2AwaitingAnswer(false)

    try {
      // Add the user's answer (human-readable label/text) to the transcript.
      addUserMessage(answer)

      // Accumulate into clarificationAnswers KEYED BY THE QUESTION'S id (2026-05-28).
      // Phase 3 resolves `user_inputs_required` → `resolved_user_inputs` by reading
      // `clarification_answers[qId]` (the v16 Phase 3 resolution rules expect a
      // qId-keyed map; a plain-string value is treated as a free-text/custom
      // answer). The earlier `phase2_turn_N` keying had NO link to the question,
      // so Phase 3 could not tell an input had been answered and re-listed it in
      // `user_inputs_required` (which then re-triggered the mini-cycle and asked
      // the same thing again). Keying by qId lets Phase 3 recognise the answer.
      // Fallback to a per-turn key only if the question somehow has no id.
      const answeredQ = builderState.questionsSequence[builderState.currentQuestionIndex]
      phase2TurnRef.current += 1
      const answerKey = answeredQ?.id || `phase2_turn_${phase2TurnRef.current}`
      // Write the staleness-proof ref FIRST (synchronous) so the Phase 3 transition
      // — which may fire in this same call chain when the backend returns
      // `phase2_done` — sees this answer. Then mirror into builderState for render.
      clarificationAnswersRef.current = {
        ...clarificationAnswersRef.current,
        [answerKey]: answer
      }
      setBuilderState(prev => ({
        ...prev,
        clarificationAnswers: {
          ...prev.clarificationAnswers,
          [answerKey]: answer
        }
      }))

      // Show thinking words while the backend picks the next question.
      startThinkingWords('Got it — one moment...')

      // Round-trip the answer. Preserve mini-cycle refinement state so a
      // terminating mini-cycle still refines (not regenerates) the plan.
      await processPhase2(threadId, {
        phase2_user_answer: answer,
        enhanced_prompt: isInMiniCycle ? (pendingEnhancedPrompt || undefined) : undefined
      })
    } catch (error) {
      console.error('❌ Phase 2 answer error:', error)
      stopThinkingWords()
      addSystemMessage('Error sending message')
      // Re-open input so the user can retry this turn.
      setPhase2AwaitingAnswer(true)
    }
  }

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

        // Show thinking words
        startThinkingWords('Updating your plan...')

        // Call Phase 2 with user_feedback and current enhanced_prompt
        await processPhase2(threadId, {
          user_feedback: answer,
          enhanced_prompt: pendingEnhancedPrompt || enhancedPromptData
        })

        return
      }

      // Phase 2 single-question mode (2026-05-28): the user typed a free-text
      // answer to the current question (the `text`-type path, or a typed reply
      // to any question). Delegate to the shared single-question handler, which
      // records the answer, accumulates it per-turn, and round-trips it to the
      // backend as `phase2_user_answer`. The reworked `processPhase2` decides
      // whether to ask the next question or advance to Phase 3 (`phase2_done`).
      if (phase2AwaitingAnswer && threadId) {
        await submitPhase2Answer(answer)
        return
      }

      // Legacy batch questions path (kept for safety; no longer populated by
      // the single-question backend, but harmless if questionsSequence is ever
      // set by another flow).
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
          addSystemMessage(`Error: ${validation.error}`)
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
        ? `${enhancedPromptData.plan_title}\n\n${enhancedPromptData.plan_description}`
        : enhancedPromptData.plan_description
      addPlanSummary(planSummary)
    }

    // B.6: startThinkingWords() inside createAgent() handles the typing indicator
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

    // Show thinking words while creating agent
    startThinkingWords('Creating agent...')
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

  // UI #1: compact per-step "decision map" summaries for the left rail. Each is
  // the real choice the user made at that step, shown (line-clamped) once the
  // step is complete; falls back to the step's generic subtitle when empty.
  // Qualitative only — no counts/denominators (FR7.20-safe).
  // Clarification: showing the raw pasted answers (URLs etc.) is noisy. While
  // questions are being asked show a qualitative status; once done show a
  // numerator-only count ("N answers captured") — no denominator/cap (FR7.20).
  const clarificationAnswerCount = Object.values(builderState.clarificationAnswers)
    .map(answerToText)
    .filter(Boolean)
    .length
  // Input Parameters: a giant value dump reads as clutter in the rail. Show a
  // count instead ("N input parameters configured"). This is the config-step
  // count, unrelated to the Phase 2 question-cap secrecy (FR7.20).
  const inputParamsCount = Object.values(inputParameterValues)
    .filter(v => v != null && String(v).trim() !== '')
    .length
  const inputParamsSummary = inputParamsCount > 0
    ? `${inputParamsCount} input parameter${inputParamsCount === 1 ? '' : 's'} configured`
    : ''
  const scheduleSummary = scheduleCompleted
    ? formatScheduleDisplay(selectedScheduleMode, scheduleCron || undefined)
    : ''

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Logo - First Line */}
      <div className="mb-3">
        <V2Logo />
      </div>

      {/* Back Button + Controls */}
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
        <V2Controls />
      </div>

      {/* Main Grid Layout - Two Columns: Setup Progress → Chat (Extended) */}
      <div className="relative">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,3fr)] gap-4 lg:gap-6 items-start">
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
              <div className="flex-1 space-y-2 pb-6">
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    builderState.workflowPhase !== 'initial' ? '' : 'opacity-60'
                  }`}
                  style={
                    builderState.workflowPhase !== 'initial'
                      ? {
                          backgroundColor: 'var(--v2-status-success-bg)',
                          borderColor: 'var(--v2-status-success-border)'
                        }
                      : {
                          backgroundColor: 'var(--v2-surface)',
                          borderColor: 'var(--v2-border)'
                        }
                  }
                >
                  <CheckCircle2
                    className="w-5 h-5 flex-shrink-0 mt-0.5"
                    style={{
                      color: builderState.workflowPhase !== 'initial'
                        ? 'var(--v2-status-success-text)'
                        : 'var(--v2-text-muted)'
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Initial Request
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2 break-words">
                      {initialPrompt?.trim() || 'Received your agent request'}
                    </p>
                  </div>
                </div>

                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    !(builderState.workflowPhase === 'analysis' || builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted) ? 'opacity-60' : ''
                  }`}
                  style={
                    builderState.workflowPhase === 'analysis'
                      ? {
                          backgroundColor: 'var(--v2-status-executing-bg)',
                          borderColor: 'var(--v2-status-executing-border)'
                        }
                      : (builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted)
                      ? {
                          backgroundColor: 'var(--v2-status-success-bg)',
                          borderColor: 'var(--v2-status-success-border)'
                        }
                      : {
                          backgroundColor: 'var(--v2-surface)',
                          borderColor: 'var(--v2-border)'
                        }
                  }
                >
                  {builderState.workflowPhase === 'analysis' ? (
                    <Clock
                      className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse"
                      style={{ color: 'var(--v2-status-executing-text)' }}
                    />
                  ) : builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted ? (
                    <CheckCircle2
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--v2-status-success-text)' }}
                    />
                  ) : (
                    <div
                      className="w-5 h-5 border-2 rounded-full flex-shrink-0 mt-0.5"
                      style={{ borderColor: 'var(--v2-text-muted)' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Analysis Complete
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {builderState.workflowPhase === 'analysis'
                        ? 'Analyzing your request...'
                        : builderState.workflowPhase === 'initial'
                        ? 'Understand your request'
                        : 'Requirements understood'}
                    </p>
                  </div>
                </div>

                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    !(builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted) ? 'opacity-60' : ''
                  }`}
                  style={
                    builderState.workflowPhase === 'questions'
                      ? {
                          backgroundColor: 'var(--v2-status-executing-bg)',
                          borderColor: 'var(--v2-status-executing-border)'
                        }
                      : (builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted)
                      ? {
                          backgroundColor: 'var(--v2-status-success-bg)',
                          borderColor: 'var(--v2-status-success-border)'
                        }
                      : {
                          backgroundColor: 'var(--v2-surface)',
                          borderColor: 'var(--v2-border)'
                        }
                  }
                >
                  {builderState.workflowPhase === 'questions' ? (
                    <Clock
                      className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse"
                      style={{ color: 'var(--v2-status-executing-text)' }}
                    />
                  ) : builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted ? (
                    <CheckCircle2
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--v2-status-success-text)' }}
                    />
                  ) : (
                    <div
                      className="w-5 h-5 border-2 rounded-full flex-shrink-0 mt-0.5"
                      style={{ borderColor: 'var(--v2-text-muted)' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Clarification Questions
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2 break-words">
                      {/* NOTE (2026-05-28): no DENOMINATOR/total shown — single-question
                          mode has no known total, and leaking the cap is a FR7.20 gate.
                          While asking: a qualitative status. Once done: a numerator-only
                          count of answers captured (no total). */}
                      {builderState.workflowPhase === 'questions'
                        ? 'Collecting your answers…'
                        : clarificationAnswerCount > 0
                        ? `${clarificationAnswerCount} answer${clarificationAnswerCount === 1 ? '' : 's'} captured`
                        : 'Answer clarifying questions'}
                    </p>
                  </div>
                </div>

                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    !(builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted) ? 'opacity-60' : ''
                  }`}
                  style={
                    builderState.workflowPhase === 'enhancement'
                      ? {
                          backgroundColor: 'var(--v2-status-executing-bg)',
                          borderColor: 'var(--v2-status-executing-border)'
                        }
                      : (builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted)
                      ? {
                          backgroundColor: 'var(--v2-status-success-bg)',
                          borderColor: 'var(--v2-status-success-border)'
                        }
                      : {
                          backgroundColor: 'var(--v2-surface)',
                          borderColor: 'var(--v2-border)'
                        }
                  }
                >
                  {builderState.workflowPhase === 'enhancement' ? (
                    <Clock
                      className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse"
                      style={{ color: 'var(--v2-status-executing-text)' }}
                    />
                  ) : builderState.workflowPhase === 'approval' || builderState.planApproved || isAwaitingInputParameter || inputParametersComplete || isAwaitingSchedule || scheduleCompleted ? (
                    <CheckCircle2
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--v2-status-success-text)' }}
                    />
                  ) : (
                    <div
                      className="w-5 h-5 border-2 rounded-full flex-shrink-0 mt-0.5"
                      style={{ borderColor: 'var(--v2-text-muted)' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Plan Creation
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2 break-words">
                      {enhancedPromptData?.plan_title?.trim() ||
                        (builderState.workflowPhase === 'enhancement' ? 'Creating agent plan...' : 'Generate detailed plan')}
                    </p>
                  </div>
                </div>

                {/* Step 5: Input Parameters */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    !(isAwaitingInputParameter || inputParametersComplete) ? 'opacity-60' : ''
                  }`}
                  style={
                    isAwaitingInputParameter
                      ? {
                          backgroundColor: 'var(--v2-status-executing-bg)',
                          borderColor: 'var(--v2-status-executing-border)'
                        }
                      : inputParametersComplete
                      ? {
                          backgroundColor: 'var(--v2-status-success-bg)',
                          borderColor: 'var(--v2-status-success-border)'
                        }
                      : {
                          backgroundColor: 'var(--v2-surface)',
                          borderColor: 'var(--v2-border)'
                        }
                  }
                >
                  {isAwaitingInputParameter ? (
                    <Clock
                      className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse"
                      style={{ color: 'var(--v2-status-executing-text)' }}
                    />
                  ) : inputParametersComplete ? (
                    <CheckCircle2
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--v2-status-success-text)' }}
                    />
                  ) : (
                    <div
                      className="w-5 h-5 border-2 rounded-full flex-shrink-0 mt-0.5"
                      style={{ borderColor: 'var(--v2-text-muted)' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Input Parameters
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2 break-words">
                      {isAwaitingInputParameter
                        ? `Configuring settings (${currentInputIndex + 1}/${requiredInputs.length})`
                        : (inputParametersComplete && inputParamsSummary)
                        ? inputParamsSummary
                        : 'Configure agent settings'
                      }
                    </p>
                  </div>
                </div>

                {/* Step 6: Scheduling */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    !(isAwaitingSchedule || scheduleCompleted) ? 'opacity-60' : ''
                  }`}
                  style={
                    isAwaitingSchedule && !scheduleCompleted
                      ? {
                          backgroundColor: 'var(--v2-status-executing-bg)',
                          borderColor: 'var(--v2-status-executing-border)'
                        }
                      : scheduleCompleted
                      ? {
                          backgroundColor: 'var(--v2-status-success-bg)',
                          borderColor: 'var(--v2-status-success-border)'
                        }
                      : {
                          backgroundColor: 'var(--v2-surface)',
                          borderColor: 'var(--v2-border)'
                        }
                  }
                >
                  {isAwaitingSchedule && !scheduleCompleted ? (
                    <Clock
                      className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse"
                      style={{ color: 'var(--v2-status-executing-text)' }}
                    />
                  ) : scheduleCompleted ? (
                    <CheckCircle2
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--v2-status-success-text)' }}
                    />
                  ) : (
                    <div
                      className="w-5 h-5 border-2 rounded-full flex-shrink-0 mt-0.5"
                      style={{ borderColor: 'var(--v2-text-muted)' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Scheduling
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2 break-words">
                      {isAwaitingSchedule && !scheduleCompleted
                        ? 'Configuring schedule...'
                        : scheduleSummary || 'Set when agent runs'}
                    </p>
                  </div>
                </div>

                {/* Step 7: Agent Ready */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    !(isAwaitingFinalApproval || agentCreated) ? 'opacity-60' : ''
                  }`}
                  style={
                    isAwaitingFinalApproval
                      ? {
                          backgroundColor: 'var(--v2-status-executing-bg)',
                          borderColor: 'var(--v2-status-executing-border)'
                        }
                      : agentCreated
                      ? {
                          backgroundColor: 'var(--v2-status-success-bg)',
                          borderColor: 'var(--v2-status-success-border)'
                        }
                      : {
                          backgroundColor: 'var(--v2-surface)',
                          borderColor: 'var(--v2-border)'
                        }
                  }
                >
                  {isAwaitingFinalApproval ? (
                    <Clock
                      className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse"
                      style={{ color: 'var(--v2-status-executing-text)' }}
                    />
                  ) : agentCreated ? (
                    <CheckCircle2
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      style={{ color: 'var(--v2-status-success-text)' }}
                    />
                  ) : (
                    <div
                      className="w-5 h-5 border-2 rounded-full flex-shrink-0 mt-0.5"
                      style={{ borderColor: 'var(--v2-text-muted)' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Agent Ready
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2 break-words">
                      {isAwaitingFinalApproval
                        ? 'Reviewing agent draft...'
                        : agentCreated
                        ? (pendingAgentData?.agent_name?.trim()
                            ? `Created: ${pendingAgentData.agent_name.trim()}`
                            : 'Agent created!')
                        : 'Deploy your agent'
                      }
                    </p>
                  </div>
                </div>

                {/* Step 8: Calibration Test Run — only when the post-creation
                    calibration feature is enabled (flag). */}
                {useMoveToCalibrationAfterCreation() && (() => {
                  const isActive = showCalibrationPrompt && !calibrationChoice
                  const isCalibrating = calibrationChoice === 'accepted'
                  const isSkipped = calibrationChoice === 'declined'
                  const isLive = isActive || isCalibrating
                  const isPending = !isLive && !isSkipped
                  return (
                    <div
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${isPending ? 'opacity-60' : ''}`}
                      style={
                        isLive
                          ? { backgroundColor: 'var(--v2-status-executing-bg)', borderColor: 'var(--v2-status-executing-border)' }
                          : { backgroundColor: 'var(--v2-surface)', borderColor: 'var(--v2-border)' }
                      }
                    >
                      {isLive ? (
                        <FlaskConical
                          className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse"
                          style={{ color: 'var(--v2-status-executing-text)' }}
                        />
                      ) : (
                        <div
                          className="w-5 h-5 border-2 rounded-full flex-shrink-0 mt-0.5"
                          style={{ borderColor: 'var(--v2-text-muted)' }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                          Calibration Test Run
                        </p>
                        <p className="text-xs text-[var(--v2-text-muted)]">
                          {isCalibrating
                            ? 'Calibrating your agent…'
                            : isActive
                            ? 'Ready to test — choose above'
                            : isSkipped
                            ? 'Skipped for now'
                            : 'Validate your agent on real data'}
                        </p>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Bottom Info Section */}
              <div className="mt-auto pt-4 border-t border-[var(--v2-border)] space-y-3">
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
                    {/* UI #3: animated "Agent created!" success card, rendered
                        INLINE in the stream so later messages append below it.
                        The whole moment is delayed ~0.35s so the chat's smooth
                        auto-scroll settles and the card is IN VIEW before it
                        animates. `message.content` carries the agent name. */}
                    {message.variant === 'success' ? (
                      <div className="flex justify-start mt-4">
                        <div className="w-8 h-8 flex-shrink-0" /> {/* Spacer for avatar alignment */}
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9, y: 12 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.35 }}
                          className="flex-1 max-w-3xl"
                        >
                          <div
                            className="bg-[var(--v2-surface)] border p-5 flex items-center gap-4"
                            style={{
                              borderRadius: 'var(--v2-radius-card)',
                              boxShadow: 'var(--v2-shadow-card)',
                              borderColor: 'var(--v2-status-success-border)'
                            }}
                          >
                            {/* Animated check with two staggered radiating ring pulses */}
                            <div className="relative flex-shrink-0 w-14 h-14 flex items-center justify-center">
                              {[0, 1].map((i) => (
                                <motion.span
                                  key={i}
                                  className="absolute inset-0 rounded-full"
                                  style={{ backgroundColor: 'var(--v2-status-success-text)' }}
                                  initial={{ opacity: 0.4, scale: 0.5 }}
                                  animate={{ opacity: 0, scale: 2 }}
                                  transition={{ duration: 1.4, ease: 'easeOut', delay: 0.55 + i * 0.35, repeat: 1, repeatDelay: 0.3 }}
                                />
                              ))}
                              {/* The circle "pops" in with an overshoot spring */}
                              <motion.div
                                className="relative w-14 h-14 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: 'var(--v2-status-success-bg)' }}
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: 'spring', stiffness: 280, damping: 12, delay: 0.5 }}
                              >
                                <motion.svg
                                  width="30" height="30" viewBox="0 0 24 24" fill="none"
                                  stroke="var(--v2-status-success-text)" strokeWidth="3"
                                  strokeLinecap="round" strokeLinejoin="round"
                                >
                                  <motion.path
                                    d="M4 12.5l5 5L20 6"
                                    initial={{ pathLength: 0 }}
                                    animate={{ pathLength: 1 }}
                                    transition={{ delay: 0.7, duration: 0.45, ease: 'easeInOut' }}
                                  />
                                </motion.svg>
                              </motion.div>
                            </div>
                            <div className="min-w-0">
                              <motion.p
                                className="font-semibold text-[var(--v2-text-primary)]"
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.7, duration: 0.35 }}
                              >
                                Agent created!
                              </motion.p>
                              <motion.p
                                className="text-sm text-[var(--v2-text-secondary)] truncate"
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.85, duration: 0.35 }}
                              >
                                {message.content}
                              </motion.p>
                            </div>
                          </div>
                        </motion.div>
                      </div>
                    ) : /* System messages (centered, no avatar) */
                    message.role === 'system' ? (
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
                          className="w-8 h-8 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center shadow-md flex-shrink-0"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <Bot className="h-4 w-4 text-[var(--v2-text-secondary)]" />
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
                            className={`w-8 h-8 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center shadow-md flex-shrink-0 ${
                              message.variant === 'plan-summary' ? 'opacity-70' : ''
                            }`}
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            {message.variant === 'question' ? (
                              <HelpCircle className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                            ) : message.variant === 'plan-summary' ? (
                              <FileText className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                            ) : (
                              <Bot className="h-4 w-4 text-[var(--v2-text-secondary)]" />
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

                          {/* Question Progress Indicator - shown for AI questions during Phase 2.
                              NOTE (2026-05-28): suppressed in single-question mode. The
                              single-question loop holds exactly ONE question in
                              `questionsSequence` per turn, so showing "Question 1 of 1" every
                              turn would both be meaningless and leak a question count to the
                              user (FR7 grep gate forbids count exposure). The `length > 1` gate
                              means this indicator only renders for a genuine multi-question
                              batch (legacy flow), never for the single-question loop. */}
                          {message.role === 'assistant' &&
                           message.variant === 'question' &&
                           builderState.workflowPhase === 'questions' &&
                           builderState.questionsSequence.length > 1 &&
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

                          {/* E4: single-question running number — numerator ONLY ("Question N"),
                              a thread-wide running total that spans mini-cycles (the number is
                              captured on the message when it's added, so it's stable across
                              re-renders). No "of Y" total and no cap reference (FR7.20/FR8 as
                              amended by E4). */}
                          {message.role === 'assistant' &&
                           message.variant === 'question' &&
                           typeof message.questionNumber === 'number' && (
                            <div
                              className="mt-2 flex items-center gap-2 px-2 py-1 bg-cyan-500/10 border border-cyan-500/20 w-fit"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <HelpCircle className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                              <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                                Question {message.questionNumber}
                              </span>
                            </div>
                          )}

                          {/* V14: Hybrid Question Options - Select/Multi-Select with option buttons.
                              NOTE (2026-05-28): in single-question mode the answer is NOT written
                              to `clarificationAnswers[currentQ.id]` (it is keyed `phase2_turn_N`),
                              so the batch "answered" gate below never hides the buttons. Instead we
                              gate on `phase2AwaitingAnswer`: the buttons show only while we are
                              awaiting THIS turn's answer, and hide the instant the user submits
                              (the handler flips `phase2AwaitingAnswer` false), preventing a
                              double-submit during the round-trip. The legacy batch flow leaves
                              `phase2AwaitingAnswer` false, so the original `clarificationAnswers`
                              gate governs there. */}
                          {message.role === 'assistant' &&
                           message.variant === 'question' &&
                           builderState.workflowPhase === 'questions' &&
                           builderState.currentQuestionIndex >= 0 &&
                           builderState.questionsSequence[builderState.currentQuestionIndex]?.question === message.content &&
                           (builderState.questionsSequence.length === 1
                             ? phase2AwaitingAnswer  // single-question mode: visible only while awaiting this turn
                             : !builderState.clarificationAnswers[builderState.questionsSequence[builderState.currentQuestionIndex]?.id]) && (
                            (() => {
                              const currentQ = builderState.questionsSequence[builderState.currentQuestionIndex];
                              const qType = currentQ?.type;
                              const options = currentQ?.options || [];

                              // Only render option buttons for select/multi_select with options
                              if ((qType === 'select' || qType === 'multi_select') && options.length > 0) {
                                return (
                                  <div className="mt-3 space-y-2">
                                    {/* Option buttons */}
                                    <div className="flex flex-col gap-2">
                                      {options.map((opt, i) => {
                                        const isMulti = qType === 'multi_select';
                                        const isSelected = isMulti && builderState.selectedMultiOptions.includes(opt.value);

                                        return (
                                          <button
                                            key={opt.value}
                                            onClick={() => {
                                              if (isMulti) {
                                                // Multi-select: toggling is pure checkbox UI state in
                                                // both modes; the actual answer is submitted by "Done".
                                                toggleMultiSelectOption(opt.value);
                                              } else if (phase2AwaitingAnswer) {
                                                // Single-question mode: route the human-readable label
                                                // through the round-trip handler — NOT the batch
                                                // `answerSelectOption` (which would trigger
                                                // `proceedToNextQuestion` → premature Phase 3 jump).
                                                submitPhase2Answer(opt.label);
                                              } else {
                                                // Legacy batch select - record answer and proceed
                                                answerSelectOption(currentQ.id, opt.value);
                                                // Add to messages
                                                addUserMessage(opt.label);
                                              }
                                            }}
                                            className={`text-left px-3 py-2.5 border transition-all duration-150 ${
                                              isSelected
                                                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                                                : 'border-[var(--v2-border)] bg-[var(--v2-surface)] hover:border-cyan-400 hover:bg-cyan-500/5 text-[var(--v2-text-primary)]'
                                            }`}
                                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                                          >
                                            <div className="flex items-start gap-2">
                                              {isMulti && (
                                                <div className={`mt-0.5 w-4 h-4 border flex items-center justify-center flex-shrink-0 ${
                                                  isSelected ? 'border-cyan-500 bg-cyan-500' : 'border-[var(--v2-border)]'
                                                }`} style={{ borderRadius: '3px' }}>
                                                  {isSelected && (
                                                    <Check className="w-3 h-3 text-white" />
                                                  )}
                                                </div>
                                              )}
                                              <div className="flex-1 min-w-0">
                                                <span className="text-sm font-medium">{opt.label}</span>
                                                {opt.description && (
                                                  <span className="text-xs text-[var(--v2-text-muted)] ml-1">— {opt.description}</span>
                                                )}
                                              </div>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>

                                    {/* Multi-select: Done button */}
                                    {qType === 'multi_select' && builderState.selectedMultiOptions.length > 0 && (
                                      <button
                                        onClick={() => {
                                          // Get labels for selected options
                                          const selectedLabels = builderState.selectedMultiOptions
                                            .map(v => options.find(o => o.value === v)?.label)
                                            .filter(Boolean)
                                            .join(', ');
                                          if (phase2AwaitingAnswer) {
                                            // Single-question mode: send the joined labels via the
                                            // round-trip handler. Reset the checkbox UI state here
                                            // (the batch `submitMultiSelectAnswer` we skip would
                                            // normally do that, but it also schedules the batch
                                            // auto-advance we must avoid).
                                            setBuilderState(prev => ({ ...prev, selectedMultiOptions: [] }));
                                            submitPhase2Answer(selectedLabels);
                                          } else {
                                            // Legacy batch multi-select submit.
                                            submitMultiSelectAnswer(currentQ.id);
                                            addUserMessage(selectedLabels);
                                          }
                                        }}
                                        className="w-full px-3 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-medium text-sm hover:opacity-90 transition-opacity"
                                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                                      >
                                        Done ({builderState.selectedMultiOptions.length} selected)
                                      </button>
                                    )}

                                    {/* "Other" button - shows custom input */}
                                    {!builderState.showingCustomInput && (
                                      <button
                                        onClick={() => openCustomInput(currentQ.id)}
                                        className="w-full px-3 py-2 border-2 border-dashed border-[var(--v2-border)] text-[var(--v2-text-muted)] text-sm hover:border-cyan-400 hover:text-cyan-600 transition-colors"
                                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                                      >
                                        ✏️ Other (type your own answer)
                                      </button>
                                    )}

                                    {/* Custom input textarea - shown when "Other" clicked */}
                                    {builderState.showingCustomInput && builderState.customInputQuestionId === currentQ.id && (
                                      <div className="space-y-2">
                                        <textarea
                                          value={builderState.customInputValue}
                                          onChange={(e) => updateCustomInput(e.target.value)}
                                          placeholder="Type your answer..."
                                          className="w-full px-3 py-2 border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] text-sm resize-none focus:outline-none focus:border-cyan-500"
                                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                                          rows={2}
                                          autoFocus
                                        />
                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => {
                                              const customText = builderState.customInputValue.trim();
                                              if (phase2AwaitingAnswer) {
                                                // Single-question mode: route the typed custom text
                                                // through the round-trip handler. Reset the custom-input
                                                // UI state here (the batch `submitCustomAnswer` we skip
                                                // would do that, but also schedules the batch advance).
                                                setBuilderState(prev => ({
                                                  ...prev,
                                                  showingCustomInput: false,
                                                  customInputValue: '',
                                                  customInputQuestionId: null
                                                }));
                                                submitPhase2Answer(customText);
                                              } else {
                                                // Legacy batch custom answer submit.
                                                submitCustomAnswer();
                                                addUserMessage(customText);
                                              }
                                            }}
                                            disabled={!builderState.customInputValue.trim()}
                                            className="flex-1 px-3 py-2 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                                          >
                                            Submit
                                          </button>
                                          <button
                                            onClick={() => setBuilderState(prev => ({ ...prev, showingCustomInput: false, customInputValue: '', customInputQuestionId: null }))}
                                            className="px-3 py-2 border border-[var(--v2-border)] text-[var(--v2-text-muted)] text-sm hover:bg-[var(--v2-surface-hover)]"
                                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              return null;
                            })()
                          )}
                        </div>

                        {/* Avatar - User (right side) */}
                        {message.role === 'user' && (
                          <div
                            className="w-8 h-8 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center shadow-md flex-shrink-0"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <User className="h-4 w-4 text-[var(--v2-text-secondary)]" />
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
                              className="w-6 h-6 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
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
                                <h3 className="text-lg font-bold text-[var(--v2-text-primary)] flex items-center gap-2">
                                  <div className="w-5 h-5 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                                    <FileText className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                                  </div>
                                  {enhancedPromptData.plan_title}
                                </h3>
                              </div>
                            )}

                            {/* Description */}
                            {enhancedPromptData.plan_description && (
                              <div>
                                <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                  <div className="w-4 h-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                                    <FileText className="h-2.5 w-2.5 text-slate-600 dark:text-slate-400" />
                                  </div>
                                  Description
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
                                          className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--v2-surface)] border-2 border-[var(--v2-primary)] flex items-center justify-center text-[var(--v2-primary)] text-xs font-bold"
                                        >
                                          {stepIndex + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
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
                                <p className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1.5">
                                  <span className="font-semibold flex items-center gap-1">
                                    <div className="w-3.5 h-3.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                                      <Clock className="h-2 w-2 text-orange-600 dark:text-orange-400" />
                                    </div>
                                    Trigger:
                                  </span>
                                  {enhancedPromptData.specifics.trigger_scope}
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
                          className="w-6 h-6 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
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
                            <h3 className="text-lg font-bold text-[var(--v2-text-primary)] flex items-center gap-2">
                              <div className="w-5 h-5 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                                <FileText className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                              </div>
                              {enhancedPromptData.plan_title}
                            </h3>
                          </div>
                        )}

                        {/* Description */}
                        {enhancedPromptData.plan_description && (
                          <div>
                            <h4 className="text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                              <div className="w-4 h-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                                <FileText className="h-2.5 w-2.5 text-slate-600 dark:text-slate-400" />
                              </div>
                              Description
                            </h4>
                            <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">
                              {enhancedPromptData.plan_description}
                            </p>
                          </div>
                        )}

                        {/* How it works - E8 (2026-05-30): collapsible accordion,
                            default COLLAPSED, mirroring the Configuration block below
                            and the chat-side "Your Agent Plan" card's accordion. Uses
                            its own state so this card and the chat-side card toggle
                            independently. */}
                        {enhancedPromptData.sections?.processing_steps && enhancedPromptData.sections.processing_steps.length > 0 && (
                          <div>
                            <button
                              onClick={() => setIsAgentDraftStepsExpanded(!isAgentDraftStepsExpanded)}
                              className="w-full flex items-center justify-between py-2 px-3 bg-[var(--v2-surface-hover)] hover:bg-[var(--v2-border)] transition-colors"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <span className="text-sm font-semibold text-[var(--v2-text-secondary)] flex items-center gap-2">
                                {isAgentDraftStepsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                <Settings className="w-4 h-4" />
                                How it works ({enhancedPromptData.sections.processing_steps.length} steps)
                              </span>
                            </button>

                            {isAgentDraftStepsExpanded && (
                              <div className="mt-3 space-y-3">
                                {enhancedPromptData.sections.processing_steps.map((step: string, stepIndex: number) => (
                                  <div key={stepIndex} className="flex gap-3">
                                    <div
                                      className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--v2-surface)] border-2 border-[var(--v2-primary)] flex items-center justify-center text-[var(--v2-primary)] text-xs font-bold"
                                    >
                                      {stepIndex + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">{step}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
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

                        {/* Input Parameters — E8 (2026-05-30): collapsible accordion,
                            default COLLAPSED. Mirrors the "How it works" pattern above
                            so the card stays compact when the agent has many fields. */}
                        {Object.keys(inputParameterValues).length > 0 && (
                          <div>
                            <button
                              onClick={() => setIsConfigurationExpanded(!isConfigurationExpanded)}
                              className="w-full flex items-center justify-between py-2 px-3 bg-[var(--v2-surface-hover)] hover:bg-[var(--v2-border)] transition-colors"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <span className="text-sm font-semibold text-[var(--v2-text-secondary)] flex items-center gap-2">
                                {isConfigurationExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                <Settings className="w-4 h-4" />
                                Configuration ({Object.keys(inputParameterValues).length} {Object.keys(inputParameterValues).length === 1 ? 'field' : 'fields'})
                              </span>
                            </button>

                            {isConfigurationExpanded && (
                              <div className="mt-3 space-y-2">
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
                            )}
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

                {/* Post-creation calibration prompt — approve/decline (workplan R1-R4) */}
                {showCalibrationPrompt && createdAgentId && (
                  <div className="flex justify-start mt-4">
                    <div className="w-8 h-8 flex-shrink-0" /> {/* Spacer for avatar alignment */}

                    <div className="flex-1 max-w-3xl">
                      <div
                        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 flex items-center justify-between"
                        style={{ borderRadius: 'var(--v2-radius-card)', boxShadow: 'var(--v2-shadow-card)' }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-10 h-10 bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <FlaskConical className="h-5 w-5 text-[var(--v2-primary)]" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-[var(--v2-text-primary)]">
                              Test your agent before going live?
                            </p>
                            <p className="text-xs text-[var(--v2-text-muted)]">
                              Calibration runs your agent once on real data — make sure the data it needs is ready before you start. It catches issues and auto-fixes what it safely can.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                          <button
                            onClick={handleStartCalibration}
                            className="px-4 py-2 bg-[var(--v2-primary)] text-white font-medium flex items-center justify-center gap-2 whitespace-nowrap hover:opacity-90 transition-all"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            Test it now
                          </button>

                          <button
                            onClick={handleSkipCalibration}
                            className="px-4 py-2 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] font-medium whitespace-nowrap hover:bg-[var(--v2-surface-hover)] transition-all"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            Skip for now
                          </button>
                        </div>
                      </div>
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
