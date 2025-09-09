'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Step1BasicsPrompts from './wizard/Step1BasicsPrompts'
import Step2SmartPreview from './wizard/Step2SmartPreview'
import Step3ExecutionMode from './wizard/Step3ExecutionMode'
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
  CheckCircle
} from 'lucide-react'

const TOTAL_STEPS = 3

const STEP_CONFIG = [
  { id: 1, title: 'Setup & Prompts', icon: Bot, description: 'Name, description, and task configuration' },
  { id: 2, title: 'Smart Preview', icon: Sparkles, description: 'AI-generated plan and suggestions' },
  { id: 3, title: 'Execution Mode', icon: Settings, description: 'When and how your agent runs' }
]

export default function AgentWizard({ agentId }: { agentId?: string }) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)
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
    mode: 'on_demand',
    schedule_cron: '',
    trigger_conditions: '',
    // Smart preview fields
    generatedPlan: null,
    suggestedPlugins: {},
    suggestedInputs: [],
    suggestedOutputs: [],
    planAccepted: false, // This should start as false
    // Additional fields from Step 2 plan acceptance
    plugins: {},
    inputSchema: [],
    outputSchema: [],
    aiGenerated: false,
    finalWorkflowSteps: [],
    workflowSteps: [],
    connectedPlugins: {},
    pluginsRequired: []
  })

  const updateData = useCallback((data: Partial<typeof agentData>) => {
    console.log('🔄 Updating agent data:', data)
    console.log('🔄 planAccepted in update:', data.planAccepted)
    setAgentData((prev) => ({ ...prev, ...data }))
  }, [])

  // Validation change handlers
  const handleStep2ValidationChange = useCallback((isValid: boolean, errorMsg?: string) => {
    setStepValidation(prev => ({ ...prev, 2: { isValid, error: errorMsg } }))
  }, [])

  useEffect(() => {
    const initialPrompt = searchParams.get('prompt')
    if (!agentId && user && initialPrompt) {
      setAgentData((prev) => {
        if (prev.userPrompt?.trim() !== initialPrompt) {
          return { ...prev, userPrompt: prev.userPrompt?.trim() ? prev.userPrompt : initialPrompt }
        }
        return prev
      })
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
            reasoning: data.system_prompt || '',
            confidence: 85,
            missingPlugins: [],
            unconnectedPlugins: []
          }
          isPlanAccepted = true // If we have workflow steps, plan was accepted
        }

        setAgentData({
          agentName: data.agent_name || '',
          description: data.description || '',
          userPrompt: data.user_prompt || '',
          mode: data.mode || 'on_demand',
          schedule_cron: data.schedule_cron || '',
          trigger_conditions: JSON.stringify(data.trigger_conditions || {}),
          generatedPlan: reconstructedPlan,
          suggestedPlugins: data.connected_plugins || {},
          suggestedInputs: data.input_schema || [],
          suggestedOutputs: data.output_schema || [],
          planAccepted: isPlanAccepted, // Set based on whether we have workflow data
          // Load workflow data from database
          plugins: data.connected_plugins || {},
          inputSchema: data.input_schema || [],
          outputSchema: data.output_schema || [],
          aiGenerated: !!reconstructedPlan,
          finalWorkflowSteps: data.workflow_steps || [],
          workflowSteps: data.workflow_steps || [],
          connectedPlugins: data.connected_plugins || {},
          pluginsRequired: data.plugins_required || []
        })
      } catch (err) {
        console.error('Error fetching agent:', err)
      } finally {
        setLoadingDraft(false)
      }
    }

    fetchAgent()
  }, [agentId, user])

  const validateStep = useCallback(() => {
    const currentStepValidation = stepValidation[step]
    if (currentStepValidation && !currentStepValidation.isValid) {
      setError(currentStepValidation.error || 'Please complete all required fields')
      return false
    }

    switch (step) {
      case 1:
        if (!agentData.agentName.trim()) {
          setError('Agent name is required.')
          return false
        }
        if (!agentData.userPrompt.trim()) {
          setError('User prompt is required.')
          return false
        }
        return true
      case 2:
        if (!agentData.planAccepted) {
          setError('Please generate and accept an agent plan.')
          return false
        }
        return true
      case 3:
        // Validate execution mode configuration
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
  }, [step, stepValidation, agentData.agentName, agentData.userPrompt, agentData.planAccepted, agentData.mode, agentData.schedule_cron, agentData.trigger_conditions])

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
        mode: agentData.mode,
        schedule_cron: agentData.schedule_cron || null,
        trigger_conditions: agentData.trigger_conditions ? JSON.parse(agentData.trigger_conditions) : null,
        status: 'active',
        // Include workflow data from Step 2
        system_prompt: agentData.generatedPlan?.reasoning || '',
        input_schema: agentData.inputSchema || [],
        output_schema: agentData.outputSchema || [],
        connected_plugins: agentData.connectedPlugins || {},
        plugins_required: agentData.pluginsRequired || [],
        workflow_steps: agentData.workflowSteps || []
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
        mode: agentData.mode,
        schedule_cron: agentData.schedule_cron || null,
        trigger_conditions: agentData.trigger_conditions ? JSON.parse(agentData.trigger_conditions) : null,
        status: 'draft',
        // Include workflow data from Step 2
        system_prompt: agentData.generatedPlan?.reasoning || '',
        input_schema: agentData.inputSchema || [],
        output_schema: agentData.outputSchema || [],
        connected_plugins: agentData.connectedPlugins || {},
        plugins_required: agentData.pluginsRequired || [],
        workflow_steps: agentData.workflowSteps || []
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
    console.log('🔍 hasPlanGenerated check:', !!agentData.generatedPlan)
    return !!agentData.generatedPlan
  }, [agentData.generatedPlan])

  const hasPlanAccepted = useMemo(() => {
    console.log('🔍 hasPlanAccepted check:', {
      planAccepted: agentData.planAccepted,
      generatedPlan: !!agentData.generatedPlan,
      workflowSteps: agentData.workflowSteps?.length
    })
    return !!agentData.planAccepted
  }, [agentData.planAccepted])

  // Check if we can proceed to next step - this is the key fix
  const canProceedToNextStep = useMemo(() => {
    switch (step) {
      case 1:
        return agentData.agentName.trim() && agentData.userPrompt.trim()
      case 2:
        // CRITICAL: Only allow proceeding if plan is actually accepted
        return hasPlanAccepted && agentData.planAccepted === true
      case 3:
        return true
      default:
        return false
    }
  }, [step, agentData.agentName, agentData.userPrompt, hasPlanAccepted, agentData.planAccepted])

  // Determine button text and state for Step 2
  const getStep2ButtonConfig = useMemo(() => {
    if (!hasPlanGenerated) {
      return {
        text: 'Generate AI Plan',
        icon: <Sparkles className="h-4 w-4" />,
        disabled: false
      }
    }
    
    if (hasPlanGenerated && !hasPlanAccepted) {
      return {
        text: 'Continue to Execution',
        icon: <Check className="h-4 w-4" />,
        disabled: true // Disabled until they click Accept AI Plan in Step 2
      }
    }
    
    return {
      text: 'Continue to Execution',
      icon: <ArrowRight className="h-4 w-4" />,
      disabled: false
    }
  }, [hasPlanGenerated, hasPlanAccepted])

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

        {/* Debug Info */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mb-4 p-4 bg-gray-100 rounded-lg text-sm">
            <p><strong>Debug Info:</strong></p>
            <p>Step: {step}</p>
            <p>Has Plan Generated: {hasPlanGenerated ? 'Yes' : 'No'}</p>
            <p>Plan Accepted: {hasPlanAccepted ? 'Yes' : 'No'}</p>
            <p>Can Proceed: {canProceedToNextStep ? 'Yes' : 'No'}</p>
            <p>Workflow Steps: {agentData.workflowSteps?.length || 0}</p>
            <p>Plan Accepted Flag: {agentData.planAccepted ? 'True' : 'False'}</p>
          </div>
        )}

        {/* Step Content */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
          <div className="p-8">
            {step === 1 && (
              <Step1BasicsPrompts 
                data={agentData} 
                onUpdate={updateData} 
                userId={user?.id}
              />
            )}
            {step === 2 && (
              <Step2SmartPreview 
                data={agentData} 
                onUpdate={updateData} 
                onValidationChange={handleStep2ValidationChange}
                userId={user?.id}
              />
            )}
            {step === 3 && (
              <Step3ExecutionMode 
                data={agentData} 
                onUpdate={updateData} 
              />
            )}
          </div>
        </div>

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
                className={`flex items-center gap-2 px-6 py-3 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                  step === 1 
                    ? 'bg-purple-600 hover:bg-purple-700' 
                    : step === 2 
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onClick={nextStep}
                disabled={loading || !canProceedToNextStep}
                title={
                  step === 2 && !canProceedToNextStep 
                    ? 'Please accept the AI plan first by clicking "Accept AI Plan" button in Step 2'
                    : ''
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : step === 1 ? (
                  hasPlanGenerated ? (
                    <>
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate AI Plan
                    </>
                  )
                ) : step === 2 ? (
                  <>
                    {getStep2ButtonConfig.icon}
                    {getStep2ButtonConfig.text}
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