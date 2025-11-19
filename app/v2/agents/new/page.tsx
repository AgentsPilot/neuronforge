// app/v2/agents/new/page.tsx
// V2 Agent Creation Page - Complete Conversational Builder with Phases 1-7

'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useEffect, useRef } from 'react'
import { useAuth } from '@/components/UserProvider'
import { Card } from '@/components/v2/ui/card'
import { V2Header } from '@/components/v2/V2Header'
import {
  ArrowLeft,
  Bot,
  Sparkles,
  MessageSquare,
  Zap,
  CheckCircle2,
  Clock,
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
  AlertCircle
} from 'lucide-react'
import { useAgentBuilderState } from '@/hooks/useAgentBuilderState'
import { useAgentBuilderMessages } from '@/hooks/useAgentBuilderMessages'

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
    approvePlan
  } = useAgentBuilderState()

  const {
    messages,
    messagesEndRef,
    addUserMessage,
    addAIMessage,
    addSystemMessage,
    addTypingIndicator,
    removeTypingIndicator,
    removeLastIfTemporary
  } = useAgentBuilderMessages()

  // Thread management state
  const [threadId, setThreadId] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(false)
  const initializingRef = useRef(false)

  // Enhanced prompt display state
  const [isStepsExpanded, setIsStepsExpanded] = useState(false)
  const [enhancedPromptData, setEnhancedPromptData] = useState<any>(null)

  // Service status tracking
  const [connectedPlugins, setConnectedPlugins] = useState<string[]>([])
  const [requiredServices, setRequiredServices] = useState<string[]>([])

  // Input state
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)

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

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

      // Add typing indicator before Phase 3
      addTypingIndicator('Creating your agent plan...')
      setTimeout(() => {
        processPhase3()
      }, 1000)
    }
  }, [builderState.workflowPhase, builderState.currentQuestionIndex, builderState.questionsSequence, builderState.clarificationAnswers, builderState.enhancementComplete])

  // Display current question when index changes
  useEffect(() => {
    if (builderState.workflowPhase === 'questions' &&
        builderState.currentQuestionIndex >= 0 &&
        builderState.questionsSequence.length > 0) {

      const currentQ = builderState.questionsSequence[builderState.currentQuestionIndex]
      if (currentQ && !messages.find(m => m.content === currentQ.question)) {
        addAIMessage(currentQ.question)
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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

  // Phase 2: Questions
  const processPhase2 = async (tid: string) => {
    try {
      console.log('🔄 Phase 2: Questions...')

      const res = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: tid,
          phase: 2
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
        // First question will be displayed by useEffect
      } else {
        // No questions needed - add typing indicator for Phase 3
        addTypingIndicator('Creating your agent plan...')
        setTimeout(() => processPhase3(tid), 1500)
      }

    } catch (error) {
      console.error('❌ Phase 2 error:', error)
      removeTypingIndicator()
      addSystemMessage('Error generating questions')
    }
  }

  // Phase 3: Enhancement
  const processPhase3 = async (tid?: string) => {
    const currentThreadId = tid || threadId
    if (!currentThreadId) return

    try {
      console.log('🔄 Phase 3: Enhancement...')

      const res = await fetch('/api/agent-creation/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: currentThreadId,
          phase: 3,
          clarification_answers: builderState.clarificationAnswers
        })
      })

      if (!res.ok) throw new Error('Phase 3 failed')

      const data = await res.json()
      console.log('✅ Phase 3 response:', data)

      // Remove typing indicator
      removeTypingIndicator()

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

    } catch (error) {
      console.error('❌ Phase 3 error:', error)
      removeTypingIndicator()
      addSystemMessage('Error creating agent plan')
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
      } else {
        // General message (not during questions)
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
  const handleApprove = () => {
    addUserMessage('Yes, perfect!')
    addAIMessage('Great! Creating your agent now...')
    approvePlan()

    // TODO: Navigate to agent creation completion
    setTimeout(() => {
      router.push('/v2/dashboard')
    }, 2000)
  }

  // Handle edit plan
  const handleEdit = () => {
    addUserMessage('I need to make some changes')
    addAIMessage('No problem! What would you like to change?')
    startEditingEnhanced()
    // TODO: Implement edit flow
  }

  // Handle use original
  const handleUseOriginal = () => {
    addUserMessage('Use the original prompt instead')
    addAIMessage('Got it! Creating agent with your original request...')
    // TODO: Create agent with original prompt
    setTimeout(() => {
      router.push('/v2/dashboard')
    }, 2000)
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

      {/* Main Grid Layout - Three Columns with Arrows */}
      <div className="relative">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_auto_1fr_auto_1fr] gap-4 lg:gap-6 items-start">
          {/* Left Column - Conversational Chat (WIDER) */}
          <div className="space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 min-h-[800px] flex flex-col">
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
                      <div className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {/* Avatar - AI (left side) */}
                        {message.role === 'assistant' && (
                          <div
                            className="w-8 h-8 flex items-center justify-center shadow-md flex-shrink-0"
                            style={{
                              background: 'linear-gradient(135deg, var(--v2-primary), var(--v2-secondary))',
                              borderRadius: 'var(--v2-radius-button)'
                            }}
                          >
                            <Bot className="h-4 w-4 text-white" />
                          </div>
                        )}

                        {/* Message bubble */}
                        <div className="max-w-[80%]">
                          <div
                            className={`p-3 shadow-md backdrop-blur-sm ${
                              message.role === 'user'
                                ? 'text-white'
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
                              message.role === 'user' ? '' : 'text-[var(--v2-text-primary)]'
                            }`}>
                              {message.content}
                            </p>
                          </div>

                          {/* Question Progress Indicator - shown for AI questions during Phase 2 */}
                          {message.role === 'assistant' &&
                           builderState.workflowPhase === 'questions' &&
                           builderState.questionsSequence.length > 0 &&
                           builderState.currentQuestionIndex >= 0 &&
                           builderState.questionsSequence[builderState.currentQuestionIndex]?.question === message.content && (
                            <div
                              className="mt-2 flex items-center gap-2 px-2 py-1 bg-[var(--v2-primary)]/10 border border-[var(--v2-primary)]/20 w-fit"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <MessageSquare className="w-3 h-3 text-[var(--v2-primary)]" />
                              <span className="text-xs font-semibold text-[var(--v2-primary)]">
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

                    {/* Enhanced Prompt Accordion - Show after Phase 3 complete */}
                    {builderState.enhancementComplete &&
                     builderState.workflowPhase === 'approval' &&
                     index === messages.length - 1 &&
                     message.role === 'assistant' &&
                     !builderState.planApproved &&
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

                                    {/* Additional sections */}
                                    {enhancedPromptData.sections.data && (
                                      <div className="pt-3 border-t border-[var(--v2-border)]">
                                        <h5 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-1">📥 Data Source</h5>
                                        <p className="text-sm text-[var(--v2-text-secondary)]">{enhancedPromptData.sections.data}</p>
                                      </div>
                                    )}

                                    {enhancedPromptData.sections.output && (
                                      <div className="pt-3 border-t border-[var(--v2-border)]">
                                        <h5 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-1">📤 Output</h5>
                                        <p className="text-sm text-[var(--v2-text-secondary)]">{enhancedPromptData.sections.output}</p>
                                      </div>
                                    )}

                                    {enhancedPromptData.sections.delivery && (
                                      <div className="pt-3 border-t border-[var(--v2-border)]">
                                        <h5 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-1">🚀 Delivery</h5>
                                        <p className="text-sm text-[var(--v2-text-secondary)]">{enhancedPromptData.sections.delivery}</p>
                                      </div>
                                    )}

                                    {enhancedPromptData.sections.error_handling && (
                                      <div className="pt-3 border-t border-[var(--v2-border)]">
                                        <h5 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-1">⚠️ Error Handling</h5>
                                        <p className="text-sm text-[var(--v2-text-secondary)]">{enhancedPromptData.sections.error_handling}</p>
                                      </div>
                                    )}
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

                            {/* Trigger Scope */}
                            {enhancedPromptData.specifics?.trigger_scope && (
                              <div className="pt-3 border-t border-[var(--v2-border)]">
                                <p className="text-xs text-[var(--v2-text-muted)]">
                                  <span className="font-semibold">⏰ Trigger:</span> {enhancedPromptData.specifics.trigger_scope}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Confirmation Text */}
                          <p className="text-sm text-[var(--v2-text-muted)]">Does this look right?</p>

                          {/* Improved Approval Buttons */}
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={handleApprove}
                              className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold flex items-center justify-center gap-2 transition-all hover:from-emerald-600 hover:to-green-700 active:scale-[0.98]"
                              style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-button)' }}
                            >
                              <CheckCircle className="h-5 w-5" />
                              Yes, perfect!
                            </button>

                            <button
                              onClick={handleEdit}
                              className="px-6 py-3 bg-[var(--v2-surface)] border-2 border-[var(--v2-border)] text-[var(--v2-text-primary)] font-semibold flex items-center justify-center gap-2 transition-all hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)] active:scale-[0.98]"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <Edit className="h-5 w-5" />
                              Need changes
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
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
                    placeholder="Type your answer or question..."
                    disabled={isSending || builderState.planApproved}
                    className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleSend}
                    disabled={isSending || !inputValue.trim() || builderState.planApproved}
                    className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* Arrow between left and middle - hidden on mobile */}
          <div className="hidden lg:flex items-center justify-center">
            <ArrowRight className="w-6 h-6 text-[var(--v2-primary)]" />
          </div>

          {/* Middle Column - Progress Steps */}
          <div className="space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 min-h-[800px] flex flex-col">
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

              {/* Progress Steps from Chat */}
              <div className="flex-1 space-y-3">
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  builderState.workflowPhase !== 'initial'
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  <CheckCircle2 className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                    builderState.workflowPhase !== 'initial' ? 'text-blue-500' : 'text-gray-300 dark:text-gray-600'
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
                    : builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {builderState.workflowPhase === 'analysis' ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : builderState.workflowPhase === 'questions' || builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' ? (
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
                    : builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {builderState.workflowPhase === 'questions' ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : builderState.workflowPhase === 'enhancement' || builderState.workflowPhase === 'approval' ? (
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
                    : builderState.workflowPhase === 'approval'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {builderState.workflowPhase === 'enhancement' ? (
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  ) : builderState.workflowPhase === 'approval' ? (
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

                <div className={`flex items-start gap-3 p-3 rounded-lg border ${
                  builderState.planApproved
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-60'
                }`}>
                  {builderState.planApproved ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                      Agent Ready
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      Deploy your agent
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

          {/* Arrow between middle and right - hidden on mobile */}
          <div className="hidden lg:flex items-center justify-center">
            <ArrowRight className="w-6 h-6 text-[var(--v2-primary)]" />
          </div>

          {/* Right Column - Generated Agent Preview */}
          <div className="space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 min-h-[800px] flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <Bot className="w-6 h-6 text-[#10B981]" />
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    Agent Preview
                  </h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Configuration as it builds
                  </p>
                </div>
              </div>

              {/* Agent Configuration Preview */}
              <div className="flex-1 space-y-4">
                {/* Agent Name */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)]">
                  <p className="text-xs text-[var(--v2-text-muted)] mb-1">Agent Name</p>
                  <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {enhancedPromptData?.plan_title || (initialPrompt ? 'Agent (Building...)' : 'Untitled Agent')}
                  </p>
                </div>

                {/* Description */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)]">
                  <p className="text-xs text-[var(--v2-text-muted)] mb-1">Description</p>
                  <p className="text-sm text-[var(--v2-text-primary)]">
                    {enhancedPromptData?.plan_description || initialPrompt || 'Describe what this agent will do...'}
                  </p>
                </div>

                {/* Integrations */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)]">
                  <p className="text-xs text-[var(--v2-text-muted)] mb-2">Integrations</p>
                  <div className="flex flex-wrap gap-2">
                    {requiredServices.length > 0 ? (
                      requiredServices.map((service: string) => (
                        <span key={service} className="text-xs px-2 py-1 bg-white dark:bg-gray-700 rounded-full border border-gray-200 dark:border-gray-600 text-[var(--v2-text-primary)] capitalize">
                          {service.replace(/-/g, ' ')}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs px-2 py-1 bg-white dark:bg-gray-700 rounded-full border border-gray-200 dark:border-gray-600 text-[var(--v2-text-muted)]">
                        None configured
                      </span>
                    )}
                  </div>
                </div>

                {/* Schedule - Compact V2 Design (keeping from original - not part of phases 1-7) */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)] space-y-3 relative">
                  <p className="text-xs text-[var(--v2-text-muted)]">Schedule</p>

                  {/* Mode Selection */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setScheduleMode('manual')}
                      className={`flex-1 p-2.5 sm:p-2 rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1.5 transition-all ${
                        scheduleMode === 'manual'
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'bg-white dark:bg-gray-700 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                      }`}
                    >
                      <PlayCircle className="w-3 h-3" />
                      Manual
                    </button>
                    <button
                      onClick={() => setScheduleMode('scheduled')}
                      className={`flex-1 p-2.5 sm:p-2 rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1.5 transition-all ${
                        scheduleMode === 'scheduled'
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'bg-white dark:bg-gray-700 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                      }`}
                    >
                      <Calendar className="w-3 h-3" />
                      Scheduled
                    </button>
                  </div>

                  {/* Interactive Schedule Builder */}
                  {scheduleMode === 'scheduled' && (
                    <div className="space-y-2 relative">
                      {/* Schedule Display/Trigger Button */}
                      <button
                        onClick={() => setShowScheduleBuilder(!showScheduleBuilder)}
                        className="w-full px-3 py-2.5 sm:px-2 sm:py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded-lg text-xs text-left flex items-center justify-between hover:border-[var(--v2-primary)] transition-colors active:scale-[0.98]"
                      >
                        <span className={scheduleType ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                          {getScheduleDescription()}
                        </span>
                        <Settings className="w-4 h-4 sm:w-3 sm:h-3 text-gray-400" />
                      </button>

                      {/* Schedule Builder Modal */}
                      {showScheduleBuilder && (
                        <div className="fixed sm:absolute z-50 left-0 right-0 sm:left-auto sm:right-auto sm:w-[340px] bottom-0 sm:bottom-auto sm:top-full sm:mt-1 bg-white dark:bg-gray-800 border-t sm:border border-[var(--v2-border)] sm:rounded-lg rounded-t-2xl sm:rounded-t-lg shadow-2xl p-4 max-h-[80vh] sm:max-h-[500px] overflow-y-auto" ref={builderRef}>
                          <div className="space-y-3">
                            {/* Header */}
                            <div className="flex items-center justify-between pb-2 border-b border-[var(--v2-border)]">
                              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Configure Schedule</h3>
                              <button
                                onClick={() => setShowScheduleBuilder(false)}
                                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Step 1: Choose Type */}
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Frequency</label>
                              <div className="grid grid-cols-4 gap-2 sm:gap-1.5">
                                {[
                                  { value: 'hourly', label: 'Hourly', icon: Clock },
                                  { value: 'daily', label: 'Daily', icon: Calendar },
                                  { value: 'weekly', label: 'Weekly', icon: Calendar },
                                  { value: 'monthly', label: 'Monthly', icon: Calendar },
                                ].map((type) => (
                                  <button
                                    key={type.value}
                                    onClick={() => {
                                      setScheduleType(type.value as any)
                                      if (type.value === 'weekly' && selectedDays.length === 0) {
                                        setSelectedDays(['monday'])
                                      }
                                    }}
                                    className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium flex flex-col items-center gap-1 sm:gap-0.5 transition-all active:scale-95 ${
                                      scheduleType === type.value
                                        ? 'bg-[var(--v2-primary)] text-white'
                                        : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                                  >
                                    <type.icon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                    <span className="leading-tight">{type.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Hourly Configuration */}
                            {scheduleType === 'hourly' && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Every</label>
                                <div className="grid grid-cols-4 gap-2 sm:gap-1.5">
                                  {['1', '2', '3', '4', '6', '8', '12'].map((interval) => (
                                    <button
                                      key={interval}
                                      onClick={() => setHourlyInterval(interval)}
                                      className={`p-2 sm:p-1.5 rounded text-xs font-medium transition-all active:scale-95 ${
                                        hourlyInterval === interval
                                          ? 'bg-[var(--v2-primary)] text-white'
                                          : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                      }`}
                                    >
                                      {interval}h
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Daily Configuration */}
                            {scheduleType === 'daily' && (
                              <div className="space-y-2">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Days</label>
                                  <div className="grid grid-cols-3 gap-2 sm:gap-1.5">
                                    {[
                                      { value: 'everyday', label: 'Every day' },
                                      { value: 'weekdays', label: 'Weekdays' },
                                      { value: 'weekends', label: 'Weekends' },
                                    ].map((option) => (
                                      <button
                                        key={option.value}
                                        onClick={() => setDailyOption(option.value as any)}
                                        className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium transition-all active:scale-95 ${
                                          dailyOption === option.value
                                            ? 'bg-[var(--v2-primary)] text-white'
                                            : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                      >
                                        {option.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Time</label>
                                  <input
                                    type="time"
                                    value={scheduleTime}
                                    onChange={(e) => setScheduleTime(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded text-xs"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Weekly Configuration */}
                            {scheduleType === 'weekly' && (
                              <div className="space-y-2">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Select Days</label>
                                  <div className="grid grid-cols-7 gap-1.5 sm:gap-1">
                                    {[
                                      { short: 'M', full: 'monday' },
                                      { short: 'T', full: 'tuesday' },
                                      { short: 'W', full: 'wednesday' },
                                      { short: 'T', full: 'thursday' },
                                      { short: 'F', full: 'friday' },
                                      { short: 'S', full: 'saturday' },
                                      { short: 'S', full: 'sunday' }
                                    ].map((day, index) => (
                                      <button
                                        key={index}
                                        onClick={() => handleDayToggle(day.full)}
                                        className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium transition-all leading-tight active:scale-95 ${
                                          selectedDays.includes(day.full)
                                            ? 'bg-[var(--v2-primary)] text-white'
                                            : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                      >
                                        {day.short}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Time</label>
                                  <input
                                    type="time"
                                    value={scheduleTime}
                                    onChange={(e) => setScheduleTime(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded text-xs"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Monthly Configuration */}
                            {scheduleType === 'monthly' && (
                              <div className="space-y-2">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Day of Month</label>
                                  <div className="grid grid-cols-7 gap-1.5 sm:gap-1 max-h-[200px] sm:max-h-[140px] overflow-y-auto">
                                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                      <button
                                        key={day}
                                        onClick={() => setSelectedMonthDay(day.toString())}
                                        className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium transition-all leading-tight active:scale-95 ${
                                          selectedMonthDay === day.toString()
                                            ? 'bg-[var(--v2-primary)] text-white'
                                            : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                      >
                                        {day}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Time</label>
                                  <input
                                    type="time"
                                    value={scheduleTime}
                                    onChange={(e) => setScheduleTime(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded text-xs"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Preview & Apply */}
                            {scheduleType && (
                              <div className="pt-3 border-t border-[var(--v2-border)] space-y-3">
                                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-primary)]/10 rounded-lg">
                                  <Clock className="w-4 h-4 text-[var(--v2-primary)]" />
                                  <span className="text-xs font-medium text-[var(--v2-primary)]">
                                    {getScheduleDescription()}
                                  </span>
                                </div>
                                <button
                                  onClick={() => setShowScheduleBuilder(false)}
                                  className="w-full px-4 py-3 sm:px-3 sm:py-2 bg-[var(--v2-primary)] text-white rounded-lg text-sm sm:text-xs font-medium hover:opacity-90 active:scale-[0.98] transition-all"
                                >
                                  Apply Schedule
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-auto pt-4 border-t border-[var(--v2-border)] space-y-2">
                <button
                  disabled={!builderState.planApproved}
                  className="w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-[var(--v2-text-muted)] rounded-lg text-sm font-medium cursor-not-allowed disabled:opacity-50"
                >
                  {builderState.planApproved ? 'Creating agent...' : 'Complete setup to deploy'}
                </button>
                <button className="w-full px-4 py-2.5 bg-white dark:bg-gray-800 text-[var(--v2-text-secondary)] border border-[var(--v2-border)] rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  Save as Draft
                </button>
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
