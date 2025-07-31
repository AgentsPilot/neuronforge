'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Step1Basics from './wizard/Step1Basics'
import Step2Prompts from './wizard/Step2Prompts'
import Step3Plugins from './wizard/Step3Plugins'
import Step4Schema from './wizard/Step4Schemas'
import Step4_5_Mode from './wizard/Step4_5_mode'
import Step5OutputSchema from './wizard/Step5OutputSchema'
import Step6Review from './wizard/Step5Review'
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
  Settings,
  MessageSquare,
  Puzzle,
  Database,
  Calendar,
  Eye,
  CheckCircle
} from 'lucide-react'

const TOTAL_STEPS = 7

const STEP_CONFIG = [
  { id: 1, title: 'Basic Info', icon: Bot, description: 'Name and description' },
  { id: 2, title: 'Prompts', icon: MessageSquare, description: 'System and user prompts' },
  { id: 3, title: 'Plugins', icon: Puzzle, description: 'Connect external services' },
  { id: 4, title: 'Input Schema', icon: Database, description: 'Define input structure' },
  { id: 5, title: 'Output Schema', icon: Database, description: 'Define output format' },
  { id: 6, title: 'Mode & Schedule', icon: Calendar, description: 'Execution settings' },
  { id: 7, title: 'Review', icon: Eye, description: 'Final review and deploy' }
]

export default function AgentWizard({ agentId }: { agentId?: string }) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Step validation states
  const [stepValidation, setStepValidation] = useState<Record<number, { isValid: boolean; error?: string }>>({})

  const [agentData, setAgentData] = useState({
    agentName: '',
    description: '',
    systemPrompt: '',
    userPrompt: '',
    inputSchema: [],
    outputSchema: [],
    plugins: {},
    mode: 'on_demand',
    schedule_cron: '',
    trigger_conditions: '',
  })

  // Memoize the update function to prevent recreation on every render
  const updateData = useCallback((data: Partial<typeof agentData>) => {
    console.log('🔄 Updating agent data:', data)
    setAgentData((prev) => ({ ...prev, ...data }))
  }, [])

  // Stable validation change handler
  const handleValidationChange = useCallback((stepNum: number) => 
    (isValid: boolean, errorMsg?: string) => {
      setStepValidation(prev => ({
        ...prev,
        [stepNum]: { isValid, error: errorMsg }
      }))
    }, []
  )

  // Fix: Better plugin keys extraction with debugging
  const getPluginKeys = useCallback(() => {
    const plugins = agentData.plugins || {}
    console.log('🔍 Current plugins object:', plugins)
    
    // Handle different plugin data structures
    let keys = []
    if (typeof plugins === 'object' && plugins !== null) {
      // If plugins is an object with plugin names as keys and boolean/config as values
      keys = Object.keys(plugins).filter(key => {
        const value = plugins[key]
        // Include if value is true, or if it's an object (plugin config)
        return value === true || (typeof value === 'object' && value !== null)
      })
    }
    
    console.log('🔍 Extracted plugin keys:', keys)
    return keys
  }, [agentData.plugins])

  const pluginKeys = useMemo(() => getPluginKeys(), [getPluginKeys])

  useEffect(() => {
    const initialPrompt = searchParams.get('prompt')
    if (!agentId && user && initialPrompt) {
      setAgentData((prev) => ({
        ...prev,
        userPrompt: prev.userPrompt?.trim() ? prev.userPrompt : initialPrompt
      }))
    }
  }, [searchParams, agentId, user])

  useEffect(() => {
    if (!agentId || !user) return
    const fetchAgent = async () => {
      setLoadingDraft(true)
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .single()

      if (error || !data) {
        alert('Failed to load agent data')
        setLoadingDraft(false)
        return
      }

      console.log('📥 Loaded agent data:', data)

      setAgentData({
        agentName: data.agent_name,
        description: data.description,
        systemPrompt: data.system_prompt,
        userPrompt: data.user_prompt,
        inputSchema: data.input_schema || [],
        outputSchema: data.output_schema || [],
        plugins: data.connected_plugins || {},
        mode: data.mode || 'on_demand',
        schedule_cron: data.schedule_cron || '',
        trigger_conditions: JSON.stringify(data.trigger_conditions || {}),
      })

      setLoadingDraft(false)
    }

    fetchAgent()
  }, [agentId, user])

  const validateStep = useCallback(() => {
    // Check step-specific validation first
    const currentStepValidation = stepValidation[step]
    if (currentStepValidation && !currentStepValidation.isValid) {
      setError(currentStepValidation.error || 'Please complete all required fields')
      return false
    }

    // Fallback to basic validation for steps without complex validation
    switch (step) {
      case 1:
        if (!agentData.agentName.trim()) {
          setError('Agent name is required.')
          return false
        }
        return true
      case 2:
        if (!agentData.userPrompt.trim()) {
          setError('User prompt is required.')
          return false
        }
        return true
      default:
        return true
    }
  }, [step, stepValidation, agentData.agentName, agentData.userPrompt])

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

    const currentPluginKeys = getPluginKeys()
    console.log('🧩 Final agentData.plugins:', agentData.plugins)
    console.log('🔑 Final plugin keys:', currentPluginKeys)

    const payload = {
      user_id: user.id,
      agent_name: agentData.agentName,
      description: agentData.description,
      system_prompt: agentData.systemPrompt,
      user_prompt: agentData.userPrompt,
      input_schema: agentData.inputSchema,
      output_schema: agentData.outputSchema,
      connected_plugins: agentData.plugins,
      plugins_required: currentPluginKeys,
      mode: agentData.mode,
      schedule_cron: agentData.schedule_cron || null,
      trigger_conditions: agentData.trigger_conditions ? JSON.parse(agentData.trigger_conditions) : null,
      status: 'active',
    }

    console.log('💾 Saving payload:', payload)

    let result
    if (agentId) {
      console.log('📝 Updating agent with ID:', agentId)
      result = await supabase.from('agents').update(payload).eq('id', agentId).select()
    } else {
      console.log('✨ Creating new agent')
      result = await supabase.from('agents').insert([payload]).select()
    }

    console.log('💾 Database result:', result)

    const { error, data } = result

    if (error) {
      console.error('❌ Database error:', error)
      setError(`Failed to save agent: ${error.message}`)
    } else {
      console.log('✅ Successfully saved agent:', data)
      router.push('/agents')
    }

    setLoading(false)
  }

  const saveDraft = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const currentPluginKeys = getPluginKeys()

    const payload = {
      user_id: user.id,
      agent_name: agentData.agentName || 'Untitled Agent',
      description: agentData.description,
      system_prompt: agentData.systemPrompt,
      user_prompt: agentData.userPrompt,
      input_schema: agentData.inputSchema,
      output_schema: agentData.outputSchema,
      connected_plugins: agentData.plugins,
      plugins_required: currentPluginKeys,
      mode: agentData.mode,
      schedule_cron: agentData.schedule_cron || null,
      trigger_conditions: agentData.trigger_conditions ? JSON.parse(agentData.trigger_conditions) : null,
      status: 'draft',
    }

    let result
    if (agentId) {
      result = await supabase.from('agents').update(payload).eq('id', agentId).select()
    } else {
      result = await supabase.from('agents').insert([payload]).select()
    }

    const { error } = result

    if (error) {
      console.error('❌ Draft save error:', error)
      setError(`Failed to save draft: ${error.message}`)
    } else {
      router.push('/agents')
    }

    setLoading(false)
  }

  const progressPercent = (step / TOTAL_STEPS) * 100
  const currentStepConfig = STEP_CONFIG[step - 1]
  const StepIcon = currentStepConfig?.icon || Bot

  // Check if current step is valid for navigation
  const canProceed = useMemo(() => {
    const currentStepValidation = stepValidation[step]
    return !currentStepValidation || currentStepValidation.isValid
  }, [stepValidation, step])

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
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/agents')}
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

      <div className="max-w-4xl mx-auto p-6">
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
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                      isCompleted 
                        ? 'bg-green-100 border-green-500 text-green-600' 
                        : isCurrent 
                        ? 'bg-blue-100 border-blue-500 text-blue-600' 
                        : 'bg-gray-100 border-gray-300 text-gray-400'
                    }`}>
                      {isCompleted ? (
                        <CheckCircle className="h-5 w-5" />
                      ) : (
                        <StepIconComponent className="h-5 w-5" />
                      )}
                    </div>
                    <div className="mt-2 text-center">
                      <p className={`text-xs font-medium ${
                        isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'
                      }`}>
                        {stepConfig.title}
                      </p>
                      <p className="text-xs text-gray-400 mt-1 max-w-20">
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
          <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Current Step Header */}
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <StepIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{currentStepConfig?.title}</h2>
              <p className="text-gray-600">{currentStepConfig?.description}</p>
            </div>
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
          <div className="p-8">
            {step === 1 && <Step1Basics data={agentData} onUpdate={updateData} />}
            {step === 2 && <Step2Prompts data={agentData} onUpdate={updateData} />}
            {step === 3 && <Step3Plugins data={agentData} onUpdate={updateData} />}
            {step === 4 && <Step4Schema data={agentData} onUpdate={updateData} setStepLoading={setLoading} onValidationChange={handleValidationChange(4)} />}
            {step === 5 && <Step5OutputSchema data={agentData} onUpdate={updateData} onValidationChange={handleValidationChange(5)} />}
            {step === 6 && <Step4_5_Mode data={agentData} onUpdate={updateData} />}
            {step === 7 && <Step6Review data={agentData} onEditStep={(s) => setStep(s)} />}
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

        {/* Debug Info */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mb-6 p-4 bg-gray-100 rounded-lg">
            <details>
              <summary className="cursor-pointer font-medium text-gray-700 mb-2">
                Debug Information
              </summary>
              <div className="text-xs text-gray-600 space-y-1">
                <p><strong>Plugins:</strong> {JSON.stringify(agentData.plugins)}</p>
                <p><strong>Plugin Keys:</strong> {JSON.stringify(pluginKeys)}</p>
                <p><strong>Current Step:</strong> {step}</p>
                <p><strong>Agent ID:</strong> {agentId || 'New Agent'}</p>
                <p><strong>Step Validation:</strong> {JSON.stringify(stepValidation)}</p>
                <p><strong>Can Proceed:</strong> {canProceed ? 'Yes' : 'No'}</p>
              </div>
            </details>
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
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={nextStep}
                disabled={loading || !canProceed}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
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