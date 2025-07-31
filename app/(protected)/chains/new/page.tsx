'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useUser } from '@/lib/hooks/useUser'
import { useAgents } from '@/lib/hooks/useAgent'
import { supabase } from '@/lib/supabaseClient'
import { InputMappingEditor } from '@/components/chains/InputMappingEditor'
import {
  Bot,
  Plus,
  ArrowDown,
  ArrowRight,
  Settings,
  Play,
  Clock,
  Code,
  Trash2,
  Copy,
  GitBranch,
  Zap,
  Save,
  Eye,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Link,
  Workflow,
  ArrowUpDown,
  Database,
  FileOutput,
  Target
} from 'lucide-react'

type Step = {
  agent_id: string
  alias: string
  input_map: any[]
}

type TriggerType = 'manual' | 'scheduled' | 'api'

type DataMapping = {
  targetField: string
  sourceType: 'previous_step' | 'user_input' | 'static_value'
  sourceStep?: string
  sourceField?: string
  staticValue?: any
}

// Data Flow Mapper Component
const DataFlowMapper = ({ 
  currentStep, 
  stepIndex, 
  selectedAgent, 
  previousSteps, 
  agents, 
  updateStep 
}: {
  currentStep: Step
  stepIndex: number
  selectedAgent: any
  previousSteps: Step[]
  agents: any[]
  updateStep: (index: number, key: keyof Step, value: any) => void
}) => {
  const [mappings, setMappings] = useState<DataMapping[]>(currentStep.input_map || [])
  const [showAllFields, setShowAllFields] = useState(false)

  // Get agent's input schema
  const inputSchema = selectedAgent?.input_schema || []
  const requiredFields = inputSchema.filter((field: any) => field.required)
  const optionalFields = inputSchema.filter((field: any) => !field.required)

  // Get available data sources from previous steps
  const getAvailableDataSources = () => {
    const sources: { stepAlias: string; agentName: string; outputs: any[] }[] = []
    
    previousSteps.forEach((step) => {
      const agent = agents.find(a => a.id === step.agent_id)
      if (agent && agent.output_schema) {
        const outputs = getOutputFields(agent.output_schema)
        sources.push({
          stepAlias: step.alias,
          agentName: agent.agent_name,
          outputs
        })
      }
    })
    
    return sources
  }

  const getOutputFields = (outputSchema: any) => {
    if (!outputSchema) return []
    
    // Handle different output schema types
    if (outputSchema.type === 'StructuredData' && outputSchema.fields) {
      return outputSchema.fields
    }
    
    // For other types, return predefined fields
    const typeFields: { [key: string]: any[] } = {
      'EmailDraft': [
        { name: 'email_content', type: 'string', description: 'Generated email content' },
        { name: 'subject', type: 'string', description: 'Email subject line' },
        { name: 'recipient', type: 'string', description: 'Email recipient' }
      ],
      'Alert': [
        { name: 'alert_title', type: 'string', description: 'Alert title' },
        { name: 'alert_message', type: 'string', description: 'Alert message' },
        { name: 'severity', type: 'string', description: 'Alert severity level' }
      ],
      'SummaryBlock': [
        { name: 'summary_text', type: 'string', description: 'Generated summary' },
        { name: 'key_points', type: 'array', description: 'List of key points' }
      ]
    }
    
    return typeFields[outputSchema.type] || []
  }

  const updateMapping = (fieldName: string, mapping: Partial<DataMapping>) => {
    const newMappings = mappings.filter(m => m.targetField !== fieldName)
    newMappings.push({ targetField: fieldName, ...mapping } as DataMapping)
    setMappings(newMappings)
    updateStep(stepIndex, 'input_map', newMappings)
  }

  const removeMapping = (fieldName: string) => {
    const newMappings = mappings.filter(m => m.targetField !== fieldName)
    setMappings(newMappings)
    updateStep(stepIndex, 'input_map', newMappings)
  }

  const getMapping = (fieldName: string) => {
    return mappings.find(m => m.targetField === fieldName)
  }

  const dataSources = getAvailableDataSources()
  const fieldsToShow = showAllFields ? inputSchema : requiredFields

  if (inputSchema.length === 0) {
    return (
      <div className="bg-amber-50 rounded-xl p-6 border border-amber-200">
        <div className="flex items-center gap-3 mb-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <p className="font-medium text-amber-900">No Input Schema</p>
        </div>
        <p className="text-amber-700 text-sm">
          This agent doesn't have a defined input schema. It may not require specific input fields.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Data Sources Overview */}
      {dataSources.length > 0 && (
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
          <div className="flex items-center gap-2 mb-3">
            <Database className="h-4 w-4 text-blue-600" />
            <span className="font-medium text-blue-900">Available Data Sources</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dataSources.map((source, idx) => (
              <div key={idx} className="bg-white/70 rounded-lg p-3 border border-blue-200">
                <div className="font-medium text-blue-900 text-sm">{source.stepAlias}</div>
                <div className="text-xs text-blue-700 mb-2">{source.agentName}</div>
                <div className="flex flex-wrap gap-1">
                  {source.outputs.slice(0, 3).map((field, fieldIdx) => (
                    <span key={fieldIdx} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {field.name}
                    </span>
                  ))}
                  {source.outputs.length > 3 && (
                    <span className="text-xs text-blue-600">+{source.outputs.length - 3} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Field Mappings */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-slate-900">Map Input Fields</h4>
          {optionalFields.length > 0 && (
            <button
              onClick={() => setShowAllFields(!showAllFields)}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {showAllFields ? 'Show Required Only' : `Show All (${inputSchema.length})`}
              <ChevronDown className={`h-3 w-3 transition-transform ${showAllFields ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {fieldsToShow.map((field: any) => {
          const mapping = getMapping(field.name)
          const isMapped = !!mapping
          
          return (
            <div key={field.name} className={`bg-white rounded-xl border-2 p-4 transition-all ${
              field.required 
                ? isMapped 
                  ? 'border-green-300 bg-green-50/50' 
                  : 'border-red-300 bg-red-50/50'
                : isMapped
                  ? 'border-blue-300 bg-blue-50/50'
                  : 'border-slate-200'
            }`}>
              {/* Field Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    field.required ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                  }`}>
                    <Target className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{field.name}</span>
                      {field.required && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">
                          Required
                        </span>
                      )}
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
                        {field.type}
                      </span>
                    </div>
                    {field.description && (
                      <p className="text-sm text-slate-600 mt-1">{field.description}</p>
                    )}
                  </div>
                </div>
                
                {isMapped && (
                  <button
                    onClick={() => removeMapping(field.name)}
                    className="text-red-600 hover:text-red-800 p-1"
                    title="Remove mapping"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Mapping Configuration */}
              <div className="space-y-3">
                {/* Source Type Selection */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Data Source</label>
                  <select
                    value={mapping?.sourceType || ''}
                    onChange={(e) => {
                      const sourceType = e.target.value as 'previous_step' | 'user_input' | 'static_value'
                      if (sourceType) {
                        updateMapping(field.name, { sourceType })
                      } else {
                        removeMapping(field.name)
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">Select data source...</option>
                    <option value="previous_step">From Previous Step</option>
                    <option value="user_input">User Input</option>
                    <option value="static_value">Static Value</option>
                  </select>
                </div>

                {/* Previous Step Selection */}
                {mapping?.sourceType === 'previous_step' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-2">Step</label>
                      <select
                        value={mapping.sourceStep || ''}
                        onChange={(e) => updateMapping(field.name, { ...mapping, sourceStep: e.target.value, sourceField: '' })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="">Select step...</option>
                        {dataSources.map((source) => (
                          <option key={source.stepAlias} value={source.stepAlias}>
                            {source.stepAlias}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-2">Field</label>
                      <select
                        value={mapping.sourceField || ''}
                        onChange={(e) => updateMapping(field.name, { ...mapping, sourceField: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-500 focus:ring-blue-500"
                        disabled={!mapping.sourceStep}
                      >
                        <option value="">Select field...</option>
                        {mapping.sourceStep && 
                          dataSources
                            .find(s => s.stepAlias === mapping.sourceStep)
                            ?.outputs.map((output) => (
                              <option key={output.name} value={output.name}>
                                {output.name} ({output.type})
                              </option>
                            ))
                        }
                      </select>
                    </div>
                  </div>
                )}

                {/* Static Value Input */}
                {mapping?.sourceType === 'static_value' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-2">Static Value</label>
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={mapping.staticValue || ''}
                      onChange={(e) => updateMapping(field.name, { 
                        ...mapping, 
                        staticValue: field.type === 'number' ? Number(e.target.value) : e.target.value 
                      })}
                      placeholder={`Enter ${field.type} value...`}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                )}

                {/* User Input Description */}
                {mapping?.sourceType === 'user_input' && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>User Input:</strong> This field will be provided by the user when they run the chain.
                    </p>
                  </div>
                )}

                {/* Mapping Preview */}
                {isMapped && (
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <div className="flex items-center gap-2 text-sm">
                      <ArrowUpDown className="h-3 w-3 text-slate-500" />
                      <span className="text-slate-700">
                        {mapping.sourceType === 'previous_step' && mapping.sourceStep && mapping.sourceField 
                          ? `${mapping.sourceStep}.${mapping.sourceField} → ${field.name}`
                          : mapping.sourceType === 'static_value'
                          ? `"${mapping.staticValue}" → ${field.name}`
                          : mapping.sourceType === 'user_input'
                          ? `User Input → ${field.name}`
                          : 'Incomplete mapping'
                        }
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mapping Summary */}
      {mappings.length > 0 && (
        <div className="bg-green-50 rounded-xl p-4 border border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="font-medium text-green-900">Data Flow Summary</span>
          </div>
          <div className="text-sm text-green-800">
            {mappings.length} field{mappings.length !== 1 ? 's' : ''} mapped • 
            {requiredFields.length - mappings.filter(m => requiredFields.find((f: any) => f.name === m.targetField)).length} required field{requiredFields.length - mappings.filter(m => requiredFields.find((f: any) => f.name === m.targetField)).length !== 1 ? 's' : ''} remaining
          </div>
        </div>
      )}
    </div>
  )
}

const TRIGGER_TYPES = [
  {
    value: 'manual' as TriggerType,
    label: 'Manual Trigger',
    description: 'Start the chain manually when needed',
    icon: Play,
    color: 'from-blue-500 to-indigo-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  },
  {
    value: 'scheduled' as TriggerType,
    label: 'Scheduled',
    description: 'Run automatically on a schedule',
    icon: Clock,
    color: 'from-green-500 to-emerald-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  },
  {
    value: 'api' as TriggerType,
    label: 'API Trigger',
    description: 'Trigger via API calls',
    icon: Code,
    color: 'from-purple-500 to-pink-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  }
]

export default function NewChainPage() {
  const [mounted, setMounted] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState<TriggerType>('manual')
  const [steps, setSteps] = useState<Step[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())

  const router = useRouter()
  const { user } = useUser()
  const { agents } = useAgents()

  useEffect(() => {
    setMounted(true)
  }, [])

  const addStep = () => {
    const newStep: Step = {
      agent_id: '',
      alias: `step_${steps.length + 1}`,
      input_map: []
    }
    setSteps(prev => [...prev, newStep])
    // Auto-expand the new step
    setExpandedSteps(prev => new Set([...prev, steps.length]))
  }

  const duplicateStep = (index: number) => {
    const stepToDuplicate = steps[index]
    const duplicatedStep: Step = {
      ...stepToDuplicate,
      alias: `${stepToDuplicate.alias}_copy`
    }
    const newSteps = [...steps]
    newSteps.splice(index + 1, 0, duplicatedStep)
    setSteps(newSteps)
  }

  const removeStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index))
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      newSet.delete(index)
      return newSet
    })
  }

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...steps]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    
    if (targetIndex < 0 || targetIndex >= newSteps.length) return
    
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]]
    setSteps(newSteps)
  }

  const updateStep = (index: number, key: keyof Step, value: any) => {
    const newSteps = [...steps]
    newSteps[index][key] = value
    setSteps(newSteps)
  }

  const toggleStepExpansion = (index: number) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }

  const getSelectedAgent = (agentId: string) => {
    return agents.find(a => a.id === agentId)
  }

  const validateChain = () => {
    const errors = []
    if (!title.trim()) errors.push('Chain title is required')
    if (steps.length === 0) errors.push('At least one step is required')
    
    steps.forEach((step, index) => {
      if (!step.agent_id) errors.push(`Step ${index + 1} needs an agent selected`)
      if (!step.alias.trim()) errors.push(`Step ${index + 1} needs an alias`)
    })
    
    return errors
  }

  const saveChain = async () => {
    const errors = validateChain()
    if (errors.length > 0) {
      alert('Please fix the following issues:\n' + errors.join('\n'))
      return
    }

    if (!user) return alert('User not authenticated')

    const { error } = await supabase.from('agent_chains').insert([
      {
        user_id: user.id,
        title,
        description,
        trigger_type: triggerType,
        steps,
      },
    ])

    if (error) {
      console.error('❌ Failed to save chain:', error)
      return alert('Failed to save chain')
    }

    router.push('/app/agents')
  }

  if (!mounted) return null

  const selectedTrigger = TRIGGER_TYPES.find(t => t.value === triggerType)
  const TriggerIcon = selectedTrigger?.icon || Play

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <Workflow className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Agent Chain Builder
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Create powerful business workflows by connecting multiple agents in sequence
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Configuration */}
          <div className="lg:col-span-2 space-y-8">
            {/* Basic Information */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                  <Settings className="h-5 w-5 text-white" />
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">Chain Configuration</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">
                    Chain Title <span className="text-red-500">*</span>
                  </label>
                  <Input
                    placeholder="e.g., Customer Onboarding Process"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-blue-500 bg-white/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">
                    Description
                  </label>
                  <Textarea
                    placeholder="Describe what this chain accomplishes..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-blue-500 bg-white/50 resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Trigger Configuration */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl flex items-center justify-center">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">Trigger Method</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {TRIGGER_TYPES.map((trigger) => {
                  const Icon = trigger.icon
                  const isSelected = triggerType === trigger.value
                  return (
                    <button
                      key={trigger.value}
                      onClick={() => setTriggerType(trigger.value)}
                      className={`p-6 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] ${
                        isSelected
                          ? `${trigger.bgColor} ${trigger.borderColor} shadow-lg`
                          : 'bg-white/50 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex flex-col items-center text-center space-y-3">
                        <div className={`w-12 h-12 bg-gradient-to-r ${trigger.color} rounded-xl flex items-center justify-center shadow-lg`}>
                          <Icon className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">{trigger.label}</h3>
                          <p className="text-sm text-slate-600 mt-1">{trigger.description}</p>
                        </div>
                        {isSelected && (
                          <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                            <CheckCircle className="h-4 w-4 text-white" />
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Steps Configuration */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-600 rounded-xl flex items-center justify-center">
                    <GitBranch className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-slate-900">Workflow Steps</h2>
                    <p className="text-slate-600">Define the sequence of agents in your chain</p>
                  </div>
                </div>
                <div className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                  {steps.length} step{steps.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-4">
                {steps.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-6xl mb-4">🔗</div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">No Steps Added Yet</h3>
                    <p className="text-slate-600 mb-6">Start building your workflow by adding your first agent step</p>
                  </div>
                ) : (
                  steps.map((step, index) => {
                    const isExpanded = expandedSteps.has(index)
                    const selectedAgent = getSelectedAgent(step.agent_id)
                    const isValid = step.agent_id && step.alias.trim()

                    return (
                      <div key={index} className="relative">
                        {/* Step Card */}
                        <div className={`bg-white/50 rounded-xl border-2 transition-all duration-200 ${
                          isValid ? 'border-slate-200' : 'border-orange-300 bg-orange-50/50'
                        }`}>
                          {/* Step Header */}
                          <div className="p-6">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white ${
                                    isValid ? 'bg-gradient-to-r from-blue-500 to-indigo-600' : 'bg-orange-500'
                                  }`}>
                                    {index + 1}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h3 className="font-semibold text-slate-900">
                                        {step.alias || `Step ${index + 1}`}
                                      </h3>
                                      {!isValid && (
                                        <AlertCircle className="h-4 w-4 text-orange-500" />
                                      )}
                                    </div>
                                    <p className="text-sm text-slate-600">
                                      {selectedAgent ? selectedAgent.agent_name : 'No agent selected'}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => toggleStepExpansion(index)}
                                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-slate-600" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-slate-600" />
                                  )}
                                </button>
                                <button
                                  onClick={() => duplicateStep(index)}
                                  className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                                  title="Duplicate step"
                                >
                                  <Copy className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => removeStep(index)}
                                  className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                                  title="Remove step"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Configuration */}
                          {isExpanded && (
                            <div className="px-6 pb-6 border-t border-slate-200 pt-6 space-y-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                  <label className="block text-sm font-semibold text-slate-700 mb-3">
                                    Select Agent <span className="text-red-500">*</span>
                                  </label>
                                  <select
                                    value={step.agent_id}
                                    onChange={(e) => updateStep(index, 'agent_id', e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-blue-500 bg-white"
                                  >
                                    <option value="">Choose an agent...</option>
                                    {agents.map((agent) => (
                                      <option key={agent.id} value={agent.id}>
                                        🤖 {agent.agent_name}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-sm font-semibold text-slate-700 mb-3">
                                    Step Alias <span className="text-red-500">*</span>
                                  </label>
                                  <Input
                                    placeholder="e.g., validate_customer"
                                    value={step.alias}
                                    onChange={(e) => updateStep(index, 'alias', e.target.value)}
                                    className="px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-blue-500 bg-white"
                                  />
                                </div>
                              </div>

                              {/* Input Mapping - Enhanced Data Flow */}
                              <div>
                                <div className="flex items-center gap-2 mb-4">
                                  <Link className="h-4 w-4 text-blue-600" />
                                  <label className="text-sm font-semibold text-slate-700">
                                    Data Flow Mapping
                                  </label>
                                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                    Connect data between steps
                                  </span>
                                </div>
                                
                                {selectedAgent ? (
                                  <DataFlowMapper
                                    currentStep={step}
                                    stepIndex={index}
                                    selectedAgent={selectedAgent}
                                    previousSteps={steps.slice(0, index)}
                                    agents={agents}
                                    updateStep={updateStep}
                                  />
                                ) : (
                                  <div className="bg-slate-50 rounded-xl p-8 border border-slate-200 text-center">
                                    <div className="text-4xl mb-3">🔗</div>
                                    <p className="text-slate-600 font-medium">Select an agent first</p>
                                    <p className="text-sm text-slate-500">Choose an agent to see its input requirements and map data</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Arrow to Next Step */}
                        {index < steps.length - 1 && (
                          <div className="flex justify-center py-4">
                            <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-lg">
                              <ArrowDown className="h-4 w-4 text-white" />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}

                {/* Add Step Button */}
                <div className="text-center pt-6">
                  <button
                    onClick={addStep}
                    className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
                  >
                    <Plus className="h-5 w-5" />
                    Add Step
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - Chain Preview */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 space-y-6">
              {/* Chain Overview */}
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Eye className="h-5 w-5" />
                  </div>
                  <h3 className="text-xl font-bold">Chain Overview</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                    <div className="text-2xl font-bold">{steps.length}</div>
                    <div className="text-blue-100 text-sm">Total Steps</div>
                  </div>
                  
                  <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <TriggerIcon className="h-4 w-4" />
                      <div className="text-sm font-medium">{selectedTrigger?.label}</div>
                    </div>
                    <div className="text-blue-100 text-xs">{selectedTrigger?.description}</div>
                  </div>
                </div>
              </div>

              {/* Validation Status */}
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
                <h3 className="font-semibold text-slate-900 mb-4">Validation Status</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    {title.trim() ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-orange-500" />
                    )}
                    <span className="text-sm text-slate-700">Chain title</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {steps.length > 0 ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-orange-500" />
                    )}
                    <span className="text-sm text-slate-700">At least one step</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {steps.every(s => s.agent_id && s.alias.trim()) ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-orange-500" />
                    )}
                    <span className="text-sm text-slate-700">All steps configured</span>
                  </div>
                </div>
              </div>

              {/* Save Chain */}
              <button
                onClick={saveChain}
                disabled={validateChain().length > 0}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-slate-400 disabled:to-slate-500 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl disabled:cursor-not-allowed disabled:transform-none"
              >
                <Save className="h-5 w-5" />
                Save Chain
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}