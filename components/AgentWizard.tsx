'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Step1Basics from './wizard/Step1Basics'
import Step2Prompts from './wizard/Step2Prompts'
import Step3Schema from './wizard/Step3Schemas'
import Step4Plugins from './wizard/Step4Plugins'
import Step5Review from './wizard/Step5Review'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'

const TOTAL_STEPS = 5

export default function AgentWizard({ agentId }: { agentId?: string }) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)

  const { user } = useAuth()
  const router = useRouter()

  const [agentData, setAgentData] = useState({
    agentName: '',
    description: '',
    systemPrompt: '',
    userPrompt: '',
    inputSchema: [],
    outputSchema: [],
    plugins: {}
  })

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

      setAgentData({
        agentName: data.agent_name,
        description: data.description,
        systemPrompt: data.system_prompt,
        userPrompt: data.user_prompt,
        inputSchema: data.input_schema || [],
        outputSchema: data.output_schema || [],
        plugins: data.connected_plugins || {},
      })

      setLoadingDraft(false)
    }

    fetchAgent()
  }, [agentId, user])

  const updateData = (data: Partial<typeof agentData>) => {
    setAgentData((prev) => ({ ...prev, ...data }))
  }

  const validateStep = () => {
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
  }

  const nextStep = () => {
    if (validateStep()) {
      setError(null)
      setStep((prev) => Math.min(prev + 1, TOTAL_STEPS))
    }
  }

  const prevStep = () => {
    setError(null)
    setStep((prev) => Math.max(prev - 1, 1))
  }

  const handleSubmit = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const payload = {
      user_id: user.id,
      agent_name: agentData.agentName,
      description: agentData.description,
      system_prompt: agentData.systemPrompt,
      user_prompt: agentData.userPrompt,
      input_schema: agentData.inputSchema,
      output_schema: agentData.outputSchema,
      connected_plugins: agentData.plugins,
      status: 'active'
    }

    let result
    if (agentId) {
      result = await supabase.from('agents').update(payload).eq('id', agentId)
    } else {
      result = await supabase.from('agents').insert([payload])
    }

    const { error } = result

    if (error) {
      setError('Failed to save agent.')
    } else {
      router.push('/dashboard')
    }

    setLoading(false)
  }

  const saveDraft = async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const payload = {
      user_id: user.id,
      agent_name: agentData.agentName || 'Untitled Agent',
      description: agentData.description,
      system_prompt: agentData.systemPrompt,
      user_prompt: agentData.userPrompt,
      input_schema: agentData.inputSchema,
      output_schema: agentData.outputSchema,
      connected_plugins: agentData.plugins,
      status: 'draft'
    }

    let result
    if (agentId) {
      result = await supabase.from('agents').update(payload).eq('id', agentId)
    } else {
      result = await supabase.from('agents').insert([payload])
    }

    const { error } = result

    if (error) {
      setError('Failed to save draft.')
    } else {
      router.push('/dashboard')
    }

    setLoading(false)
  }

  const progressPercent = (step / TOTAL_STEPS) * 100

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold">🧠 Agent Builder</h1>
        <p className="text-gray-600 mb-2">Step {step} of {TOTAL_STEPS}</p>

        <div className="w-full bg-gray-200 h-2 rounded">
          <div
            className="bg-blue-500 h-2 rounded transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {step === 1 && <Step1Basics data={agentData} onUpdate={updateData} />}
      {step === 2 && <Step2Prompts data={agentData} onUpdate={updateData} />}
      {step === 3 && <Step3Schema data={agentData} onUpdate={updateData} />}
      {step === 4 && <Step4Plugins data={agentData} onUpdate={updateData} />}
      {step === 5 && <Step5Review data={agentData} onEditStep={(s) => setStep(s)} />}

      {error && <p className="text-red-500 text-sm mt-4 text-center">{error}</p>}

      <div className="flex flex-col sm:flex-row justify-between mt-8 gap-4">
        <button
          className="px-4 py-2 bg-gray-300 rounded disabled:opacity-50"
          onClick={prevStep}
          disabled={step === 1}
        >
          Back
        </button>

        {step < TOTAL_STEPS ? (
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded"
            onClick={nextStep}
          >
            Next
          </button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={saveDraft}
              disabled={loading}
              className="bg-yellow-500 text-white px-6 py-3 rounded-lg hover:bg-yellow-600 transition font-medium"
            >
              {loading ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-medium"
            >
              {loading ? (agentId ? 'Updating...' : 'Creating...') : agentId ? 'Update Agent' : 'Create Agent'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}