'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Step1ClarificationQuestions from './wizard/Step1ClarificationQuestions'
import Step2BasicsPrompts from './wizard/Step2BasicsPrompts'
import Step3SmartPreview from './wizard/Step3SmartPreview'
import Step4ExecutionMode from './wizard/Step4ExecutionMode'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import {
  Bot,
  ArrowLeft,
  ArrowRight,
  Check,
  Save,
  AlertTriangle,
  Loader2,
  MessageSquare,
  Sparkles,
  Settings,
  CheckCircle,
  Brain
} from 'lucide-react'

const TOTAL_STEPS = 4

const STEP_CONFIG = [
  { id: 1, title: 'AI Questions', icon: Brain, description: 'Clarification questions from AI' },
  { id: 2, title: 'User Prompts', icon: Bot, description: 'Name, description, and task configuration' },
  { id: 3, title: 'Smart Preview', icon: Sparkles, description: 'AI-generated plan and suggestions' },
  { id: 4, title: 'Execution Mode', icon: Settings, description: 'When and how your agent runs' }
]

interface ClarificationData {
  questions: Array<{
    id: string
    question: string
    placeholder?: string
    required?: boolean
    type?: 'text' | 'textarea' | 'select'
    options?: string[]
  }>
  answers: Record<string, string>
  questionsGenerated: boolean
  questionsSkipped: boolean
  aiReasoning?: string
  confidence?: number
}

export default function AgentWizard({ agentId }: { agentId?: string }) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false) // NEW: Track enhancement status
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Debug user in parent component
  useEffect(() => {
    console.log('AgentWizard user state:', { user, userId: user?.id, email: user?.email })
  }, [user])

  // Step validation states
  const [stepValidation, setStepValidation] = useState<Record<number, { isValid: boolean; error?: string }>>({})

  const [agentData, setAgentData] = useState({
    agentName: '',
    description: '',
    userPrompt: '',
    originalPrompt: '', // NEW: Track original prompt separately
    mode: 'on_demand',
    schedule_cron: '',
    trigger_conditions: '',
    // NEW: Clarification data
    clarificationData: {
      questions: [],
      answers: {},
      questionsGenerated: false,
      questionsSkipped: false
    } as ClarificationData,
    // Smart preview fields
    generatedPlan: null,
    suggestedPlugins: {},
    suggestedInputs: [],
    suggestedOutputs: [],
    planAccepted: false,
    // Additional fields from Step 3 plan acceptance
    plugins: {},
    inputSchema: [],
    outputSchema: [],
    aiGenerated: false,
    finalWorkflowSteps: [],
    workflowSteps: [],
    connectedPlugins: {},
    pluginsRequired: [],
    // NEW: Enhancement state tracking
    enhancedPrompt: '',
    enhancementComplete: false,
    userChoice: null as 'original' | 'enhanced' | null,
    enhancementError: '',
    enhancementRationale: '' // NEW: Store rationale for backend
  })

  const updateData = useCallback((data: Partial<typeof agentData>) => {
    console.log('🔄 AgentWizard updateData called with:', data)
    console.log('🔄 Previous agentData.originalPrompt:', agentData.originalPrompt)
    console.log('🔄 Previous agentData.userPrompt:', agentData.userPrompt)
    console.log('🔄 New data.originalPrompt:', data.originalPrompt)
    console.log('🔄 New data.userPrompt:', data.userPrompt)
    
    setAgentData((prev) => {
      const newData = { ...prev, ...data }
      console.log('🔄 AgentWizard final agentData after update:', {
        originalPrompt: newData.originalPrompt,
        userPrompt: newData.userPrompt,
        userChoice: newData.userChoice,
        enhancementComplete: newData.enhancementComplete
      })
      return newData
    })
  }, [agentData.originalPrompt, agentData.userPrompt])

  // NEW: Handle enhancement status changes from Step2
  const handleEnhancementStatusChange = useCallback((enhancing: boolean) => {
    console.log('🔄 Enhancement status changed:', enhancing)
    setIsEnhancing(enhancing)
  }, [])

  // Validation change handlers - CORRECTED FOR NEW SEQUENCE
  const handleStep1ValidationChange = useCallback((isValid: boolean, errorMsg?: string) => {
    setStepValidation(prev => ({ ...prev, 1: { isValid, error: errorMsg } }))
  }, [])

  const handleStep3ValidationChange = useCallback((isValid: boolean, errorMsg?: string) => {
    setStepValidation(prev => ({ ...prev, 3: { isValid, error: errorMsg } }))
  }, [])

  useEffect(() => {
    const initialPrompt = searchParams.get('prompt')
    if (!agentId && user && initialPrompt) {
      console.log('Setting initial prompt from URL:', initialPrompt)
      setAgentData((prev) => ({
        ...prev,
        userPrompt: initialPrompt
      }))
    }
  }, [searchParams, agentId, user])

  useEffect(() => {
    if (!agentId || !user || loadingDraft) return
    
    const fetchAgent = async () => {
      setLoadingDraft(true)
      try {
        const { data, error } = await supabase
          .from('agents')
          .select('*')
          .eq('id', agentId)
          .eq('user_id', user.id)
          .single()

        if (error || !data) {
          console.error('Failed to load agent data:', error)
          return
        }

        // Reconstruct generatedPlan from saved data if workflow exists
        let reconstructedPlan = null
        let isPlanAccepted = false
        
        if (data.workflow_steps && data.workflow_steps.length > 0) {
          reconstructedPlan = {
            steps: data.workflow_steps,
            requiredInputs: data.input_schema || [],
            outputs: data.output_schema || [],
            reasoning: data.ai_reasoning || data.system_prompt || '',
            confidence: data.ai_confidence || 85,
            detectedCategories: data.detected_categories || [],
            missingPlugins: [],
            unconnectedPlugins: []
          }
          isPlanAccepted = true
        }

        // Reconstruct clarification data if it exists
        let clarificationData: ClarificationData = {
          questions: [],
          answers: {},
          questionsGenerated: false,
          questionsSkipped: false
        }

        if (data.clarification_questions && data.clarification_answers) {
          clarificationData = {
            questions: data.clarification_questions,
            answers: data.clarification_answers,
            questionsGenerated: true,
            questionsSkipped: false,
            aiReasoning: data.clarification_reasoning,
            confidence: data.clarification_confidence
          }
        } else if (data.clarification_skipped) {
          clarificationData.questionsSkipped = true
          clarificationData.questionsGenerated = true
        }

        setAgentData({
          agentName: data.agent_name || '',
          description: data.description || '',
          userPrompt: data.user_prompt || '',
          originalPrompt: data.original_prompt || data.user_prompt || '', // NEW: Load original prompt
          mode: data.mode || 'on_demand',
          schedule_cron: data.schedule_cron || '',
          trigger_conditions: JSON.stringify(data.trigger_conditions || {}),
          clarificationData,
          generatedPlan: reconstructedPlan,
          suggestedPlugins: data.connected_plugins || {},
          suggestedInputs: data.input_schema || [],
          suggestedOutputs: data.output_schema || [],
          planAccepted: isPlanAccepted,
          // Load workflow data from database
          plugins: data.connected_plugins || {},
          inputSchema: data.input_schema || [],
          outputSchema: data.output_schema || [],
          aiGenerated: !!reconstructedPlan,
          finalWorkflowSteps: data.workflow_steps || [],
          workflowSteps: data.workflow_steps || [],
          connectedPlugins: data.connected_plugins || {},
          pluginsRequired: data.plugins_required || [],
          // NEW: Load enhancement state from database if available
          enhancedPrompt: data.enhanced_prompt || '',
          enhancementComplete: data.enhancement_complete || false,
          userChoice: data.user_choice || null,
          enhancementError: '',
          enhancementRationale: data.enhancement_rationale || '' // NEW: Load rationale
        })
      } catch (err) {
        console.error('Error fetching agent:', err)
      } finally {
        setLoadingDraft(false)
      }
    }

    fetchAgent()
  }, [agentId, user])

  // Track workflow analytics
  const trackWorkflowAnalytics = async (agentId: string) => {
    if (!agentData.generatedPlan) return;
    
    try {
      await supabase.from('workflow_analytics').insert([{
        agent_id: agentId,
        user_prompt: agentData.userPrompt,
        ai_reasoning: agentData.generatedPlan.reasoning,
        confidence_score: agentData.generatedPlan.confidence,
        steps_generated: agentData.generatedPlan.steps.length,
        plugins_used: agentData.connectedPlugins,
        user_accepted: agentData.planAccepted,
        modifications_made: {},
        clarification_questions: agentData.clarificationData.questions,
        clarification_answers: agentData.clarificationData.answers
      }]);
    } catch (err) {
      console.error('Failed to track analytics:', err);
    }
  };

  // CORRECTED VALIDATION FOR NEW SEQUENCE - AGENT NAME REMOVED FROM STEP 2
  const validateStep = useCallback(() => {
    const currentStepValidation = stepValidation[step]
    if (currentStepValidation && !currentStepValidation.isValid) {
      setError(currentStepValidation.error || 'Please complete all required fields')
      return false
    }

    switch (step) {
      case 1: // AI QUESTIONS FIRST
        if (!agentData.clarificationData.questionsGenerated) {
          setError('Please generate clarification questions or skip this step.')
          return false
        }
        if (!agentData.clarificationData.questionsSkipped) {
          const hasAnsweredRequired = agentData.clarificationData.questions.every(q => 
            !q.required || (agentData.clarificationData.answers[q.id]?.trim() || '').length > 0
          )
          if (!hasAnsweredRequired) {
            setError('Please answer all required clarification questions.')
            return false
          }
        }
        return true
      case 2: // SETUP & PROMPTS SECOND - NO AGENT NAME REQUIRED
        if (!agentData.userPrompt.trim()) {
          setError('User prompt is required.')
          return false
        }
        // Check if enhancement is complete and user has made a choice
        if (agentData.enhancementComplete && agentData.userChoice === null) {
          setError('Please select either the original or enhanced prompt to continue.')
          return false
        }
        // FIXED: Check if currently enhancing
        if (isEnhancing) {
          setError('Please wait for prompt enhancement to complete.')
          return false
        }
        return true
      case 3: // SMART PREVIEW THIRD - AGENT NAME REQUIRED HERE
        if (!agentData.agentName.trim()) {
          setError('Agent name is required.')
          return false
        }
        if (!agentData.planAccepted) {
          setError('Please generate and accept an agent plan.')
          return false
        }
        return true
      case 4: // EXECUTION MODE FOURTH
        if (!agentData.mode) {
          setError('Please select an execution mode.')
          return false
        }
        if (agentData.mode === 'scheduled' && !agentData.schedule_cron.trim()) {
          setError('Schedule configuration is required for scheduled mode.')
          return false
        }
        if (agentData.mode === 'triggered' && !agentData.trigger_conditions.trim()) {
          setError('Trigger conditions are required for triggered mode.')
          return false
        }
        return true
      default:
        return true
    }
  }, [step, stepValidation, agentData, isEnhancing]) // Added isEnhancing dependency

  const nextStep = useCallback(() => {
    if (validateStep()) {
      setError(null)
      setStep((prev) => Math.min(prev + 1, TOTAL_STEPS))
    }
  }, [validateStep])

  const prevStep = useCallback(() => {
    setError(null)
    setStep((prev) => Math.max(prev - 1, 1))
  }, [])

  const handleSubmit = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      const payload = {
        user_id: user.id,
        agent_name: agentData.agentName,
        description: agentData.description,
        user_prompt: agentData.userPrompt,
        original_prompt: agentData.originalPrompt, // NEW: Save original prompt
        mode: agentData.mode,
        schedule_cron: agentData.schedule_cron || null,
        trigger_conditions: agentData.trigger_conditions ? JSON.parse(agentData.trigger_conditions) : null,
        status: 'active',
        
        // Clarification data
        clarification_questions: agentData.clarificationData.questions,
        clarification_answers: agentData.clarificationData.answers,
        clarification_reasoning: agentData.clarificationData.aiReasoning,
        clarification_confidence: agentData.clarificationData.confidence,
        clarification_skipped: agentData.clarificationData.questionsSkipped,
        
        // NEW: Enhancement state persistence
        enhanced_prompt: agentData.enhancedPrompt,
        enhancement_complete: agentData.enhancementComplete,
        user_choice: agentData.userChoice,
        enhancement_rationale: agentData.enhancementRationale, // NEW: Save rationale
        
        // Original fields
        system_prompt: agentData.generatedPlan?.reasoning || '',
        input_schema: agentData.inputSchema || [],
        output_schema: agentData.outputSchema || [],
        connected_plugins: agentData.connectedPlugins || {},
        plugins_required: agentData.pluginsRequired || [],
        workflow_steps: agentData.workflowSteps || [],
        
        // Enhanced reasoning fields for learning
        ai_reasoning: agentData.generatedPlan?.reasoning || null,
        ai_confidence: agentData.generatedPlan?.confidence || null,
        detected_categories: agentData.generatedPlan?.detectedCategories || null,
        created_from_prompt: agentData.userPrompt,
        ai_generated_at: agentData.generatedPlan ? new Date().toISOString() : null
      }

      let result
      if (agentId) {
        result = await supabase.from('agents').update(payload).eq('id', agentId).select()
      } else {
        result = await supabase.from('agents').insert([payload]).select()
      }

      const { error, data } = result

      if (error) {
        setError(`Failed to save agent: ${error.message}`)
      } else {
        const savedAgentId = agentId || data[0]?.id
        
        // Track analytics for learning
        await trackWorkflowAnalytics(savedAgentId)
        
        router.push(`/agents/${savedAgentId}`)
      }
    } catch (err) {
      setError('An unexpected error occurred while saving the agent')
    } finally {
      setLoading(false)
    }
  }

  const saveDraft = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      const payload = {
        user_id: user.id,
        agent_name: agentData.agentName || 'Untitled Agent',
        description: agentData.description,
        user_prompt: agentData.userPrompt,
        original_prompt: agentData.originalPrompt, // NEW: Save original prompt
        mode: agentData.mode,
        schedule_cron: agentData.schedule_cron || null,
        trigger_conditions: agentData.trigger_conditions ? JSON.parse(agentData.trigger_conditions) : null,
        status: 'draft',
        
        // Clarification data
        clarification_questions: agentData.clarificationData.questions,
        clarification_answers: agentData.clarificationData.answers,
        clarification_reasoning: agentData.clarificationData.aiReasoning,
        clarification_confidence: agentData.clarificationData.confidence,
        clarification_skipped: agentData.clarificationData.questionsSkipped,
        
        // NEW: Enhancement state persistence
        enhanced_prompt: agentData.enhancedPrompt,
        enhancement_complete: agentData.enhancementComplete,
        user_choice: agentData.userChoice,
        enhancement_rationale: agentData.enhancementRationale, // NEW: Save rationale
        
        // Original fields
        system_prompt: agentData.generatedPlan?.reasoning || '',
        input_schema: agentData.inputSchema || [],
        output_schema: agentData.outputSchema || [],
        connected_plugins: agentData.connectedPlugins || {},
        plugins_required: agentData.pluginsRequired || [],
        workflow_steps: agentData.workflowSteps || [],
        
        // Enhanced reasoning fields for learning
        ai_reasoning: agentData.generatedPlan?.reasoning || null,
        ai_confidence: agentData.generatedPlan?.confidence || null,
        detected_categories: agentData.generatedPlan?.detectedCategories || null,
        created_from_prompt: agentData.userPrompt,
        ai_generated_at: agentData.generatedPlan ? new Date().toISOString() : null
      }

      let result
      if (agentId) {
        result = await supabase.from('agents').update(payload).eq('id', agentId).select()
      } else {
        result = await supabase.from('agents').insert([payload]).select()
      }

      const { error, data } = result

      if (error) {
        setError(`Failed to save draft: ${error.message}`)
      } else {
        const savedAgentId = agentId || data[0]?.id
        
        // Track analytics for learning (even for drafts)
        if (agentData.generatedPlan) {
          await trackWorkflowAnalytics(savedAgentId)
        }
        
        router.push(`/agents/${savedAgentId}`)
      }
    } catch (err) {
      setError('An unexpected error occurred while saving the draft')
    } finally {
      setLoading(false)
    }
  }

  const progressPercent = (step / TOTAL_STEPS) * 100
  const currentStepConfig = STEP_CONFIG[step - 1]
  const StepIcon = currentStepConfig?.icon || Bot

  const canProceed = useMemo(() => {
    const currentStepValidation = stepValidation[step]
    return !currentStepValidation || currentStepValidation.isValid
  }, [stepValidation, step])

  // Check if plan has been generated and accepted for step navigation
  const hasPlanGenerated = useMemo(() => {
    return !!agentData.generatedPlan
  }, [agentData.generatedPlan])

  const hasPlanAccepted = useMemo(() => {
    return !!agentData.planAccepted
  }, [agentData.planAccepted])

  // CORRECTED NAVIGATION LOGIC FOR NEW SEQUENCE - AGENT NAME REMOVED FROM STEP 2
  const canProceedToNextStep = useMemo(() => {
    switch (step) {
      case 1: // AI QUESTIONS - check if questions generated/skipped and answered
        return agentData.clarificationData.questionsGenerated && 
          (agentData.clarificationData.questionsSkipped || 
           agentData.clarificationData.questions.every(q => 
             !q.required || (agentData.clarificationData.answers[q.id]?.trim() || '').length > 0
           ))
      case 2: // SETUP & PROMPTS - check if prompt filled AND enhancement choice made (NO AGENT NAME)
        const hasUserPrompt = agentData.userPrompt.trim()
        const hasEnhancementChoice = agentData.enhancementComplete 
          ? agentData.userChoice !== null 
          : true // If enhancement not complete, don't require choice yet
        
        // FIXED: Also check if currently enhancing
        const notCurrentlyEnhancing = !isEnhancing
        
        return hasUserPrompt && hasEnhancementChoice && notCurrentlyEnhancing
      case 3: // SMART PREVIEW - check if agent name filled and plan accepted
        return agentData.agentName.trim() && hasPlanAccepted && agentData.planAccepted === true
      case 4: // EXECUTION MODE
        return true
      default:
        return false
    }
  }, [step, agentData, hasPlanAccepted, isEnhancing]) // Added isEnhancing dependency

  if (loadingDraft) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading agent data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(agentId ? `/agents/${agentId}` : '/agents')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Bot className="h-6 w-6 text-blue-600" />
                {agentId ? 'Edit Agent' : 'Create New Agent'}
              </h1>
              <p className="text-gray-600 text-sm">
                {agentData.agentName || 'Untitled Agent'}
              </p>
            </div>
          </div>
          
          <div className="text-sm text-gray-500">
            Step {step} of {TOTAL_STEPS}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            {STEP_CONFIG.map((stepConfig, index) => {
              const isCompleted = step > stepConfig.id
              const isCurrent = step === stepConfig.id
              const StepIconComponent = stepConfig.icon

              return (
                <div key={stepConfig.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors ${
                      isCompleted 
                        ? 'bg-green-100 border-green-500 text-green-600' 
                        : isCurrent 
                        ? 'bg-blue-100 border-blue-500 text-blue-600' 
                        : 'bg-gray-100 border-gray-300 text-gray-400'
                    }`}>
                      {isCompleted ? (
                        <CheckCircle className="h-6 w-6" />
                      ) : (
                        <StepIconComponent className="h-6 w-6" />
                      )}
                    </div>
                    <div className="mt-3 text-center">
                      <p className={`text-sm font-medium ${
                        isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'
                      }`}>
                        {stepConfig.title}
                      </p>
                      <p className="text-xs text-gray-400 mt-1 max-w-24">
                        {stepConfig.description}
                      </p>
                    </div>
                  </div>
                  
                  {index < STEP_CONFIG.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-4 ${
                      step > stepConfig.id ? 'bg-green-500' : 'bg-gray-300'
                    }`} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 h-3 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Current Step Header */}
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center">
              <StepIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{currentStepConfig?.title}</h2>
              <p className="text-gray-600">{currentStepConfig?.description}</p>
            </div>
          </div>
        </div>

        {/* Step Content - CORRECTED ORDER */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
          <div className="p-8">
            {step === 1 && (
              <Step1ClarificationQuestions
                data={agentData}
                onUpdate={updateData}
                onValidationChange={handleStep1ValidationChange}
                userId={user?.id}
              />
            )}
            {step === 2 && (
              <Step2BasicsPrompts 
                data={agentData} 
                onUpdate={updateData} 
                userId={user?.id}
                clarificationAnswers={agentData.clarificationData?.answers || {}}
                onStepLoad={() => console.log('Step 2 loaded')}
                onEnhancementStatusChange={handleEnhancementStatusChange}
              />
            )}            
            {step === 3 && (
              <Step3SmartPreview 
                data={agentData} 
                onUpdate={updateData} 
                onValidationChange={handleStep3ValidationChange}
                userId={user?.id}
              />
            )}
            {step === 4 && (
              <Step4ExecutionMode 
                data={agentData} 
                onUpdate={updateData} 
              />
            )}
          </div>
        </div>

        {/* DEBUG INFO - Enhanced with enhancement status */}
        {step === 2 && (
          <div className="bg-gray-100 border border-gray-300 rounded-xl p-4 mb-6 text-sm">
            <h4 className="font-bold text-gray-700 mb-2">DEBUG INFO (Step 2 - Fixed Enhancement Logic):</h4>
            <div className="space-y-1 text-gray-600">
              <p>User Prompt: "{agentData.userPrompt?.slice(0, 50)}..." (length: {agentData.userPrompt?.length || 0})</p>
              <p>User Choice: {agentData.userChoice || 'null'}</p>
              <p>Enhancement Complete: {agentData.enhancementComplete ? 'true' : 'false'}</p>
              <p>Enhanced Prompt Exists: {agentData.enhancedPrompt ? 'true' : 'false'}</p>
              <p>Is Enhancing: {isEnhancing ? 'true' : 'false'}</p>
              <p>Has Prompt: {agentData.userPrompt?.trim() ? 'YES' : 'NO'}</p>
              <p>Has Enhancement Choice: {(agentData.userChoice !== null || !agentData.enhancementComplete) ? 'YES' : 'NO'}</p>
              <p>Not Currently Enhancing: {!isEnhancing ? 'YES' : 'NO'}</p>
              <p>Can Proceed: {canProceedToNextStep ? 'YES' : 'NO'}</p>
              <p>Next Button Disabled: {(loading || !canProceedToNextStep) ? 'YES' : 'NO'}</p>
              <p>Manual Check: {(() => {
                const hasPrompt = !!(agentData.userPrompt?.trim())
                const hasEnhancementChoice = agentData.userChoice !== null || !agentData.enhancementComplete
                const notCurrentlyEnhancing = !isEnhancing
                const manualResult = hasPrompt && hasEnhancementChoice && notCurrentlyEnhancing
                return `hasPrompt(${hasPrompt}) && hasEnhancementChoice(${hasEnhancementChoice}) && notCurrentlyEnhancing(${notCurrentlyEnhancing}) = ${manualResult}`
              })()}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-red-800 font-medium">Error</p>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-2 px-6 py-3 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={prevStep}
            disabled={step === 1 || loading}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-4">
            {step < TOTAL_STEPS ? (
              <button
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={nextStep}
                disabled={loading || !canProceedToNextStep}
              >
                {loading || isEnhancing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isEnhancing ? 'Enhancing...' : 'Loading...'}
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={saveDraft}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save as Draft
                </button>
                
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {agentId ? 'Updating...' : 'Creating...'}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {agentId ? 'Update Agent' : 'Create Agent'}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}