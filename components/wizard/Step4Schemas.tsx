'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Copy, Trash2, AlertTriangle, CheckCircle, Loader2, X, Star, Brain, Sparkles, Target, Lightbulb, Zap, Database } from 'lucide-react'
import { pluginDescriptions } from '@/lib/plugins/pluginDescriptions'

// Simple UUID generator
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const toast = {
  success: (message: string) => console.log('✅ Success:', message),
  warning: (message: string) => console.log('⚠️ Warning:', message),
  error: (message: string) => console.log('❌ Error:', message)
}

const FIELD_TYPES = [
  { value: 'string', label: 'Text', icon: '📝', color: 'bg-blue-500' },
  { value: 'number', label: 'Number', icon: '🔢', color: 'bg-green-500' },
  { value: 'boolean', label: 'True/False', icon: '✅', color: 'bg-purple-500' },
  { value: 'date', label: 'Date', icon: '📅', color: 'bg-orange-500' },
  { value: 'enum', label: 'Options', icon: '📋', color: 'bg-indigo-500' },
  { value: 'file', label: 'File Upload', icon: '📎', color: 'bg-pink-500' }
]

// Generated Field for the UI
interface Field {
  id: string
  name: string
  type: string
  required: boolean
  description?: string
  placeholder?: string
  validation?: any
  enum?: string[]
  options?: string[]
  pluginSource?: string
  confidence?: number
}

// Mock Claude API call - replace with actual implementation
async function callClaude({ systemPrompt, userMessage }: { systemPrompt: string, userMessage: string }) {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  console.log('🤖 Claude API Call:')
  console.log('System Prompt:', systemPrompt)
  console.log('User Message:', userMessage)
  
  // Parse the user message to extract prompt and plugins
  const messageData = JSON.parse(userMessage)
  const { userPrompt, selectedPlugins } = messageData
  
  // Mock intelligent schema generation based on prompt and plugin capabilities
  const fields: any[] = []
  const lowerPrompt = userPrompt.toLowerCase()
  
  // Analyze plugins for capabilities
  const hasEmailPlugin = selectedPlugins.some((p: any) => 
    p.description.toLowerCase().includes('email') || p.name.includes('mail')
  )
  const hasStoragePlugin = selectedPlugins.some((p: any) => 
    p.description.toLowerCase().includes('storage') || p.description.toLowerCase().includes('drive')
  )
  const hasSearchCapability = selectedPlugins.some((p: any) => 
    p.description.toLowerCase().includes('search') || p.description.toLowerCase().includes('filter')
  )
  
  // Email workflow detection
  if (lowerPrompt.includes('email') && (lowerPrompt.includes('retrieve') || lowerPrompt.includes('summariz'))) {
    if (hasEmailPlugin) {
      // Time range for email retrieval
      if (lowerPrompt.includes('timeframe') || lowerPrompt.includes('time period')) {
        fields.push({
          id: generateUUID(),
          name: 'Time Period',
          type: 'enum',
          required: true,
          description: 'Time range for email retrieval',
          placeholder: 'Select time period',
          options: ['Last 24 hours', 'Last 3 days', 'Last week', 'Last month', 'Custom date range']
        })
      }
      
      // Search criteria
      if (lowerPrompt.includes('filter') || hasSearchCapability) {
        fields.push({
          id: generateUUID(),
          name: 'Email Search Criteria',
          type: 'string',
          required: false,
          description: 'Optional filters for email search (sender, subject, keywords)',
          placeholder: 'from:manager@company.com, subject:urgent, has:attachment'
        })
      }
    }
    
    // Output destination
    if (lowerPrompt.includes('output destination') || lowerPrompt.includes('store') || lowerPrompt.includes('folder')) {
      fields.push({
        id: generateUUID(),
        name: 'Output Folder',
        type: 'string',
        required: true,
        description: 'Folder path where summaries will be stored',
        placeholder: '/Documents/Email Summaries'
      })
    }
    
    // Report recipient
    if (lowerPrompt.includes('recipient') || lowerPrompt.includes('send') && lowerPrompt.includes('report')) {
      fields.push({
        id: generateUUID(),
        name: 'Report Recipient',
        type: 'string',
        required: true,
        description: 'Email address to receive the summary report',
        placeholder: 'manager@company.com'
      })
    }
    
    // Summary format
    if (lowerPrompt.includes('format') || lowerPrompt.includes('summary')) {
      fields.push({
        id: generateUUID(),
        name: 'Summary Format',
        type: 'enum',
        required: false,
        description: 'Preferred format for email summaries',
        placeholder: 'Choose format',
        options: ['Brief bullet points', 'Detailed paragraphs', 'Executive summary', 'Custom format']
      })
    }
  }
  
  // General search workflows
  else if (lowerPrompt.includes('search') || lowerPrompt.includes('find')) {
    fields.push({
      id: generateUUID(),
      name: 'Search Query',
      type: 'string',
      required: true,
      description: 'What to search for',
      placeholder: 'Enter search terms or keywords'
    })
    
    if (lowerPrompt.includes('recent') || lowerPrompt.includes('time')) {
      fields.push({
        id: generateUUID(),
        name: 'Time Range',
        type: 'enum',
        required: false,
        description: 'Limit search to specific time period',
        placeholder: 'Any time',
        options: ['Today', 'Last 7 days', 'Last 30 days', 'Last 3 months', 'Any time']
      })
    }
  }
  
  // Communication workflows
  else if (lowerPrompt.includes('send') || lowerPrompt.includes('message') || lowerPrompt.includes('notify')) {
    fields.push({
      id: generateUUID(),
      name: 'Recipient',
      type: 'string',
      required: true,
      description: 'Who should receive the message',
      placeholder: hasEmailPlugin ? 'user@company.com' : '@username or #channel'
    })
    
    fields.push({
      id: generateUUID(),
      name: 'Message Content',
      type: 'string',
      required: true,
      description: 'Content of the message to send',
      placeholder: 'Enter your message content'
    })
  }
  
  // File/document workflows
  else if (lowerPrompt.includes('create') || lowerPrompt.includes('generate') || lowerPrompt.includes('document')) {
    if (lowerPrompt.includes('name') || lowerPrompt.includes('file')) {
      fields.push({
        id: generateUUID(),
        name: 'Document Name',
        type: 'string',
        required: false,
        description: 'Name for the generated document',
        placeholder: 'My Document'
      })
    }
    
    if (hasStoragePlugin) {
      fields.push({
        id: generateUUID(),
        name: 'Save Location',
        type: 'string',
        required: false,
        description: 'Where to save the document',
        placeholder: '/Documents/Generated Files'
      })
    }
  }
  
  // Fallback: if no specific pattern matched, create a generic input
  if (fields.length === 0) {
    fields.push({
      id: generateUUID(),
      name: 'Workflow Input',
      type: 'string',
      required: true,
      description: 'Primary input for your workflow',
      placeholder: 'Enter the main input for your automation'
    })
  }
  
  console.log('🎯 Generated schema:', fields)
  return JSON.stringify(fields)
}

// Schema generation function
export async function generateInputSchema({ userPrompt, pluginKeys }: { userPrompt: string, pluginKeys: string[] }) {
  const selectedPluginDescriptions = pluginKeys.map(plugin => ({
    name: plugin,
    description: pluginDescriptions[plugin as keyof typeof pluginDescriptions] ?? 'A productivity plugin that provides data management and automation capabilities.'
  }))
  
  const systemPrompt = `
You are an AI that creates structured input forms for workflow automation.
The user has written a goal for an AI agent and selected plugins to achieve it.

IMPORTANT: Only create fields for data the USER must provide. Never include:
- Account credentials (email addresses, usernames, API keys)
- Plugin connection details (these come from authenticated connections)
- Output specifications that are determined by the workflow logic

Focus on workflow parameters like:
- Search queries, filters, criteria
- Time ranges, dates, specific periods
- Content to be created or sent
- Configuration options the user should choose
- File names, folder paths, recipients

Return a JSON array with this exact structure:
[
  {
    "id": "generated-uuid",
    "name": "Human-readable field label",
    "type": "string | number | boolean | enum | date",
    "required": true | false,
    "description": "Brief explanation of what this field is for",
    "placeholder": "Example value for the user",
    "enum": [...], // REQUIRED for enum type - array of options
    "options": [...] // ALSO include for enum type - same array as enum
  }
]

For enum fields, ALWAYS include both "enum" and "options" properties with the same array of choices.

If no user input is needed, return an empty array.
`

  const userMessage = {
    userPrompt,
    selectedPlugins: selectedPluginDescriptions
  }
  
  try {
    // Call your existing API endpoint
    const response = await fetch('/api/generate/input-schema', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: userPrompt,
        plugins: pluginKeys
      }),
    })

    if (response.ok) {
      const data = await response.json()
      let schema = data.input_schema || []
      
      // Ensure each field has required properties and add missing IDs
      schema = schema.map((field: any) => ({
        id: field.id || generateUUID(),
        name: field.name || 'Untitled Field',
        type: field.type || 'string',
        required: field.required !== undefined ? field.required : true,
        description: field.description || `Input field for ${field.name}`,
        placeholder: field.placeholder || `Enter ${field.name}...`,
        enum: field.enum || [],
        options: field.options || field.enum || [] // Ensure both enum and options are set
      }))
      
      console.log('✅ Generated schema from API:', schema)
      return schema
    } else {
      console.warn('API returned error, using intelligent fallback')
    }
    
  } catch (error) {
    console.warn('API call failed, using intelligent fallback:', error)
  }
  
  // Intelligent fallback based on prompt analysis
  const fields: any[] = []
  const lowerPrompt = userPrompt.toLowerCase()
  
  // Email workflow detection
  if (lowerPrompt.includes('email') && (lowerPrompt.includes('summar') || lowerPrompt.includes('report'))) {
    fields.push({
      id: generateUUID(),
      name: 'Time Period',
      type: 'enum',
      required: true,
      description: 'Time range for email analysis',
      placeholder: 'Select time period',
      enum: ['Last 24 hours', 'Last 3 days', 'Last week', 'Last month', 'Custom range'],
      options: ['Last 24 hours', 'Last 3 days', 'Last week', 'Last month', 'Custom range']
    })
    
    if (lowerPrompt.includes('filter') || lowerPrompt.includes('search') || lowerPrompt.includes('criteria')) {
      fields.push({
        id: generateUUID(),
        name: 'Search Criteria',
        type: 'string',
        required: false,
        description: 'Optional email filters',
        placeholder: 'from:sender@company.com, subject:urgent'
      })
    }
    
    if (lowerPrompt.includes('recipient') || lowerPrompt.includes('send')) {
      fields.push({
        id: generateUUID(),
        name: 'Report Recipient',
        type: 'string',
        required: true,
        description: 'Who should receive the summary',
        placeholder: 'manager@company.com'
      })
    }
  }
  
  // Communication workflows
  else if (lowerPrompt.includes('send') || lowerPrompt.includes('message') || lowerPrompt.includes('notify')) {
    fields.push({
      id: generateUUID(),
      name: 'Recipient',
      type: 'string',
      required: true,
      description: 'Message recipient',
      placeholder: 'user@company.com or @username'
    })
    
    fields.push({
      id: generateUUID(),
      name: 'Message Content',
      type: 'string',
      required: true,
      description: 'Content of the message',
      placeholder: 'Enter your message...'
    })
  }
  
  // Search workflows
  else if (lowerPrompt.includes('search') || lowerPrompt.includes('find')) {
    fields.push({
      id: generateUUID(),
      name: 'Search Query',
      type: 'string',
      required: true,
      description: 'What to search for',
      placeholder: 'Enter search terms...'
    })
    
    if (lowerPrompt.includes('time') || lowerPrompt.includes('recent') || lowerPrompt.includes('date')) {
      fields.push({
        id: generateUUID(),
        name: 'Time Range',
        type: 'enum',
        required: false,
        description: 'Limit search to time period',
        placeholder: 'Any time',
        enum: ['Today', 'Last 7 days', 'Last 30 days', 'Last 3 months', 'Any time'],
        options: ['Today', 'Last 7 days', 'Last 30 days', 'Last 3 months', 'Any time']
      })
    }
  }
  
  // Document/file workflows  
  else if (lowerPrompt.includes('create') || lowerPrompt.includes('generate') || lowerPrompt.includes('document')) {
    fields.push({
      id: generateUUID(),
      name: 'Content Topic',
      type: 'string',
      required: true,
      description: 'What should the content be about',
      placeholder: 'Enter topic or description...'
    })
    
    if (lowerPrompt.includes('save') || lowerPrompt.includes('store')) {
      fields.push({
        id: generateUUID(),
        name: 'File Name',
        type: 'string',
        required: false,
        description: 'Name for the file',
        placeholder: 'my-document'
      })
    }
  }
  
  // Generic fallback
  if (fields.length === 0) {
    fields.push({
      id: generateUUID(),
      name: 'Workflow Input',
      type: 'string',
      required: true,
      description: 'Primary input for your workflow',
      placeholder: 'Enter your input...'
    })
  }
  
  return fields
}

// React Component
interface Props {
  data: any
  onUpdate: (updates: any) => void
  setStepLoading: (val: boolean) => void
  onValidationChange?: (isValid: boolean, error?: string) => void
}

export default function SmartSchemaGenerator({ data, onUpdate, setStepLoading, onValidationChange }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationPhase, setGenerationPhase] = useState<'idle' | 'analyzing' | 'generating' | 'complete'>('idle')
  const [selectedPluginInfo, setSelectedPluginInfo] = useState<Array<{ name: string, description: string }>>([])
  
  // Use refs to prevent recreating objects and track generation state
  const hasGeneratedRef = useRef(false)
  const lastPromptRef = useRef<string>('')
  const generationTimeoutRef = useRef<NodeJS.Timeout>()
  
  // AI Assistant state
  const [assistantActive, setAssistantActive] = useState(true)
  const [assistantMode, setAssistantMode] = useState<'idle' | 'thinking' | 'celebrating'>('idle')
  const [assistantMessages, setAssistantMessages] = useState<string[]>([])

  const addAssistantMessage = useCallback((message: string) => {
    setAssistantMessages(prev => [...prev.slice(-2), message])
  }, [])

  // Initialize assistant
  useEffect(() => {
    if (assistantMessages.length === 0) {
      addAssistantMessage("Smart Schema Generator ready! I analyze your workflow and create the exact input fields you need.")
      const timeoutId = setTimeout(() => {
        addAssistantMessage("I focus on what YOU need to provide - no account details or plugin setup, just workflow parameters.")
      }, 2500)
      
      return () => clearTimeout(timeoutId)
    }
  }, [])

  // Main schema generation function
  const generateSmartSchema = useCallback(async () => {
    if (isGenerating || !data.userPrompt) return
    
    const promptChanged = lastPromptRef.current !== data.userPrompt
    const shouldGenerate = promptChanged && (!hasGeneratedRef.current || (data.inputSchema?.length || 0) === 0)
    
    if (!shouldGenerate) return
    
    try {
      setIsGenerating(true)
      setStepLoading(true)
      setError(null)
      setAssistantMode('thinking')
      
      lastPromptRef.current = data.userPrompt
      hasGeneratedRef.current = true

      // Extract selected plugins
      const plugins = data.plugins || {}
      const selectedPlugins = Object.keys(plugins).filter(key => {
        const value = plugins[key]
        return value === true || (typeof value === 'object' && value !== null)
      })

      if (selectedPlugins.length === 0) {
        throw new Error('No plugins selected')
      }

      // Phase 1: Analyze plugins
      setGenerationPhase('analyzing')
      addAssistantMessage(`Analyzing ${selectedPlugins.length} selected plugins and their capabilities...`)
      
      // Get plugin descriptions for display
      const pluginInfo = selectedPlugins.map(plugin => ({
        name: plugin,
        description: pluginDescriptions[plugin as keyof typeof pluginDescriptions] ?? 'A productivity plugin with data management capabilities.'
      }))
      setSelectedPluginInfo(pluginInfo)
      
      console.log('📋 Selected plugins:', pluginInfo)

      // Phase 2: Generate schema
      setGenerationPhase('generating')
      addAssistantMessage("Generating smart input fields based on your workflow requirements...")
      
      const fields = await generateInputSchema({
        userPrompt: data.userPrompt,
        pluginKeys: selectedPlugins
      })
      
      console.log('✅ Generated fields:', fields)

      // Update the schema
      onUpdate({ inputSchema: fields })
      
      setGenerationPhase('complete')
      setAssistantMode('celebrating')
      
      addAssistantMessage(`Generated ${fields.length} contextual input fields. Each field focuses on what you need to provide for the workflow!`)
      
      setTimeout(() => {
        addAssistantMessage("Schema generated successfully! These fields capture your workflow parameters without any plugin setup complexity.")
        setAssistantMode('idle')
      }, 3000)

      toast.success(`Smart schema generated with ${fields.length} fields`)

    } catch (err: any) {
      console.error('Schema generation error:', err)
      setError(err.message || 'Schema generation failed')
      toast.error('Schema generation failed, but you can add fields manually')
      addAssistantMessage("Generation encountered an issue. You can manually add fields or adjust your prompt.")
      
      hasGeneratedRef.current = false
      lastPromptRef.current = ''
      setGenerationPhase('idle')
    } finally {
      setIsGenerating(false)
      setStepLoading(false)
    }
  }, [data.userPrompt, data.plugins, onUpdate, setStepLoading, addAssistantMessage, isGenerating])

  // Auto-generate with debouncing
  useEffect(() => {
    if (generationTimeoutRef.current) {
      clearTimeout(generationTimeoutRef.current)
    }

    if (!data.userPrompt || data.userPrompt.trim().length < 10) return
    
    const promptChanged = lastPromptRef.current !== data.userPrompt
    const shouldGenerate = promptChanged && (!hasGeneratedRef.current || (data.inputSchema?.length || 0) === 0)
    
    if (!shouldGenerate) return

    generationTimeoutRef.current = setTimeout(() => {
      generateSmartSchema()
    }, 1500) // 1.5 second debounce
    
    return () => {
      if (generationTimeoutRef.current) {
        clearTimeout(generationTimeoutRef.current)
      }
    }
  }, [data.userPrompt, generateSmartSchema])

  // Reset generation when prompt changes significantly
  useEffect(() => {
    const currentPrompt = data.userPrompt || ''
    const lastPrompt = lastPromptRef.current || ''
    
    const promptDifference = Math.abs(currentPrompt.length - lastPrompt.length)
    const significantChange = promptDifference > Math.min(currentPrompt.length, lastPrompt.length) * 0.3
    
    if (significantChange && currentPrompt.length > 10) {
      hasGeneratedRef.current = false
    }
  }, [data.userPrompt])

  // Field validation
  const validateField = useCallback((field: Field) => {
    const errors: string[] = []

    if (!field.name?.trim()) {
      errors.push('Field name is required')
    }

    if (field.name && !/^[a-zA-Z][a-zA-Z0-9_\s]*$/.test(field.name.trim())) {
      errors.push('Field name must start with a letter and contain only letters, numbers, spaces, and underscores')
    }

    if (field.type === 'enum' && (!field.options || field.options.length === 0) && (!field.enum || field.enum.length === 0)) {
      errors.push('Options type requires at least one choice')
    }

    const duplicates = data.inputSchema?.filter((f: Field) =>
      f.name?.toLowerCase().trim() === field.name?.toLowerCase().trim() && f.id !== field.id
    )
    if (duplicates?.length > 0) {
      errors.push('Field name must be unique')
    }

    return errors.join(', ')
  }, [data.inputSchema])

  const handleFieldChange = useCallback((id: string, changes: Partial<Field>) => {
    const updatedFields = data.inputSchema.map((f: Field) =>
      f.id === id ? { ...f, ...changes } : f
    )
    onUpdate({ inputSchema: updatedFields })

    const updatedField = updatedFields.find((f: Field) => f.id === id)
    if (updatedField) {
      const error = validateField(updatedField)
      setFieldErrors(prev => ({
        ...prev,
        [id]: error || undefined
      }))
    }
  }, [data.inputSchema, validateField, onUpdate])

  const handleAddField = useCallback(() => {
    const newField: Field = {
      id: generateUUID(),
      name: '',
      type: 'string',
      required: false,
      description: '',
      placeholder: ''
    }
    onUpdate({ inputSchema: [...(data.inputSchema || []), newField] })
    
    addAssistantMessage("Manual field added! This supplements the auto-generated fields for any custom requirements.")
    setAssistantActive(true)
  }, [data.inputSchema, onUpdate, addAssistantMessage])

  const handleRemoveField = useCallback((id: string) => {
    const updated = data.inputSchema.filter((f: Field) => f.id !== id)
    onUpdate({ inputSchema: updated })
    setFieldErrors(prev => {
      const { [id]: _, ...rest } = prev
      return rest
    })
  }, [data.inputSchema, onUpdate])

  const handleDuplicateField = useCallback((field: Field) => {
    const duplicatedField: Field = {
      ...field,
      id: generateUUID(),
      name: `${field.name} Copy`
    }
    onUpdate({ inputSchema: [...data.inputSchema, duplicatedField] })
  }, [data.inputSchema, onUpdate])

  const hasErrors = Object.values(fieldErrors).some(error => error)

  // Validation effect
  useEffect(() => {
    if (!onValidationChange) return

    let errorMsg = ''
    let isValid = true

    if (!data.inputSchema || data.inputSchema.length === 0) {
      // Allow empty schema - some workflows might not need user input
      isValid = true
    } else {
      for (let field of data.inputSchema) {
        const error = validateField(field)
        if (error) {
          errorMsg = error
          isValid = false
          break
        }
      }
      if (hasErrors) {
        errorMsg = 'Please fix all validation errors.'
        isValid = false
      }
    }

    onValidationChange(isValid, errorMsg)
  }, [data.inputSchema?.length, hasErrors, validateField, onValidationChange])

  const getFieldTypeInfo = (type: string) => {
    return FIELD_TYPES.find(t => t.value === type) || FIELD_TYPES[0]
  }

  // Get phase display info
  const getPhaseInfo = () => {
    switch (generationPhase) {
      case 'analyzing':
        return { icon: Brain, text: 'Analyzing workflow...', color: 'text-blue-600' }
      case 'generating':
        return { icon: Zap, text: 'Generating fields...', color: 'text-purple-600' }
      case 'complete':
        return { icon: CheckCircle, text: 'Schema ready!', color: 'text-green-600' }
      default:
        return { icon: Database, text: 'Ready to generate', color: 'text-slate-600' }
    }
  }

  // AI Assistant Component
  const AIAssistant = () => {
    if (!assistantActive) return null

    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer group ${
            assistantMode === 'celebrating' 
              ? 'bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 animate-pulse' 
              : assistantMode === 'thinking'
              ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 animate-spin'
              : 'bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 hover:scale-110'
          }`}>
            {assistantMode === 'celebrating' ? (
              <Star className="h-8 w-8 text-white animate-bounce" />
            ) : assistantMode === 'thinking' ? (
              <Brain className="h-8 w-8 text-white" />
            ) : (
              <Sparkles className="h-8 w-8 text-white group-hover:rotate-12 transition-transform" />
            )}
          </div>

          {assistantMessages.length > 0 && (
            <div className="fixed bottom-6 right-24 space-y-3 z-40" style={{ width: '350px' }}>
              {assistantMessages.map((message, index) => (
                <div 
                  key={index}
                  className="bg-gradient-to-r from-white to-blue-50 border-2 border-blue-200 rounded-2xl shadow-xl animate-in slide-in-from-right-2 duration-300"
                  style={{ padding: '20px 28px' }}
                >
                  <p className="text-base font-semibold text-gray-800 leading-relaxed">
                    {message}
                  </p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              setAssistantActive(false)
              setAssistantMessages([])
            }}
            className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Smart Schema Generator
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto mb-6">
            AI-powered input field generation that focuses on what you need to provide for your workflow
          </p>
        </div>

        {/* System Overview */}
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-xl p-6 mb-8">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0">
              <Target className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="text-lg font-semibold text-emerald-900 mb-3">Smart Generation Process</h4>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-emerald-200 rounded-lg p-4 text-center">
              <div className="text-2xl mb-2">🎯</div>
              <h5 className="font-semibold text-emerald-900 mb-2">Workflow Analysis</h5>
              <p className="text-xs text-emerald-700">Analyze your prompt and selected plugins for capabilities</p>
            </div>
            
            <div className="bg-white border border-emerald-200 rounded-lg p-4 text-center">
              <div className="text-2xl mb-2">⚡</div>
              <h5 className="font-semibold text-emerald-900 mb-2">Smart Field Generation</h5>
              <p className="text-xs text-emerald-700">Create only the input fields you need to provide</p>
            </div>
            
            <div className="bg-white border border-emerald-200 rounded-lg p-4 text-center">
              <div className="text-2xl mb-2">🎉</div>
              <h5 className="font-semibold text-emerald-900 mb-2">Clean Results</h5>
              <p className="text-xs text-emerald-700">No account setup or plugin config - just workflow params</p>
            </div>
          </div>

          {/* Selected Plugin Display */}
          {selectedPluginInfo.length > 0 && (
            <div className="mt-6 p-4 bg-emerald-100 rounded-lg">
              <h5 className="font-semibold text-emerald-900 mb-3">Selected Plugin Capabilities:</h5>
              <div className="space-y-2">
                {selectedPluginInfo.map(({ name, description }) => (
                  <div key={name} className="text-sm">
                    <span className="font-medium text-emerald-800">{name}:</span>
                    <span className="text-emerald-700 ml-2">{description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Generation Status */}
        {isGenerating && (
          <div className="mb-8 animate-in slide-in-from-top-2 duration-300">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-200 p-6">
              <div className="flex items-center justify-center gap-4">
                <div className="relative">
                  {React.createElement(getPhaseInfo().icon, { 
                    className: `h-8 w-8 ${generationPhase === 'analyzing' ? 'animate-pulse' : generationPhase === 'generating' ? 'animate-spin' : ''} ${getPhaseInfo().color}` 
                  })}
                </div>
                <div>
                  <p className="font-semibold text-lg text-slate-800">{getPhaseInfo().text}</p>
                  <p className="text-sm text-slate-600">
                    {generationPhase === 'analyzing' && 'Understanding your workflow and plugin capabilities...'}
                    {generationPhase === 'generating' && 'Creating contextual input fields...'}
                    {generationPhase === 'complete' && 'Schema generated successfully!'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-8">
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6">
              <div className="flex items-center gap-4">
                <AlertTriangle className="h-6 w-6 text-red-600" />
                <div>
                  <p className="font-semibold text-red-900">Generation Issue</p>
                  <p className="text-red-700">{error}</p>
                  <p className="text-red-600 text-sm mt-1">You can manually add fields or adjust your workflow prompt</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Generated Fields */}
        {data.inputSchema?.length > 0 && (
          <div className="space-y-6 mb-8">
            {data.inputSchema.map((field: Field, index: number) => {
              const fieldType = getFieldTypeInfo(field.type)
              const hasFieldError = fieldErrors[field.id]

              return (
                <div
                  key={field.id}
                  className={`bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border transition-all duration-300 ${
                    hasFieldError ? 'border-red-300' : 'border-white/40 hover:border-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between p-6 border-b border-slate-200">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 ${fieldType.color} rounded-xl flex items-center justify-center text-white shadow-lg`}>
                        <span className="text-xl">{fieldType.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-semibold text-slate-900">Field #{index + 1}</span>
                          {field.required && (
                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                              Required
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600">{fieldType.label}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDuplicateField(field)}
                        className="flex items-center gap-2 px-4 py-2 text-blue-700 hover:bg-blue-50 rounded-xl text-sm"
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </button>
                      <button
                        onClick={() => handleRemoveField(field.id)}
                        className="flex items-center gap-2 px-4 py-2 text-red-700 hover:bg-red-50 rounded-xl text-sm"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">
                          Field Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all ${
                            hasFieldError?.includes('name') 
                              ? 'border-red-300 focus:border-red-500 bg-red-50' 
                              : 'border-slate-200 focus:border-blue-500 bg-white/50'
                          }`}
                          placeholder="e.g., Search Query, Time Period"
                          value={field.name || ''}
                          onChange={(e) => handleFieldChange(field.id, { name: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Field Type</label>
                        <select
                          className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/50"
                          value={field.type}
                          onChange={(e) => handleFieldChange(field.id, { type: e.target.value })}
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.icon} {type.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Description</label>
                        <input
                          className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/50"
                          placeholder="Brief description"
                          value={field.description || ''}
                          onChange={(e) => handleFieldChange(field.id, { description: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Placeholder</label>
                        <input
                          className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/50"
                          placeholder="Example for users"
                          value={field.placeholder || ''}
                          onChange={(e) => handleFieldChange(field.id, { placeholder: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* Options for enum type */}
                    {field.type === 'enum' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Options</label>
                        <textarea
                          className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/50"
                          placeholder="Enter options separated by commas (e.g., Option 1, Option 2, Option 3)"
                          value={(field.options || field.enum || []).join(', ')}
                          onChange={(e) => {
                            const options = e.target.value.split(',').map(opt => opt.trim()).filter(opt => opt)
                            handleFieldChange(field.id, { options, enum: options })
                          }}
                          rows={3}
                        />
                      </div>
                    )}

                    <div className="flex items-center">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.required || false}
                          onChange={(e) => handleFieldChange(field.id, { required: e.target.checked })}
                          className="w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-slate-700">Required field</span>
                      </label>
                    </div>

                    {hasFieldError && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 text-red-600" />
                          <p className="text-red-800">{hasFieldError}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Empty State */}
        {(!data.inputSchema || data.inputSchema.length === 0) && !isGenerating && (
          <div className="text-center py-20">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-12">
              <div className="text-8xl mb-6">🎯</div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Smart Generator Ready</h3>
              <p className="text-slate-600 mb-8">Write your workflow prompt and select plugins to generate intelligent input fields</p>
              <button
                onClick={handleAddField}
                className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all transform hover:scale-105 shadow-lg"
              >
                <Plus className="h-5 w-5" />
                Add Manual Field
              </button>
            </div>
          </div>
        )}

        {/* Add Field Button */}
        {data.inputSchema?.length > 0 && (
          <div className="mb-8">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Add Custom Fields</h3>
                  <p className="text-slate-600">The smart generator created workflow-specific fields. Add custom ones if needed.</p>
                </div>
                <button
                  onClick={handleAddField}
                  className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all transform hover:scale-105 shadow-lg"
                >
                  <Plus className="h-5 w-5" />
                  Add Custom Field
                </button>
              </div>
            </div>
          </div>
        )}

        <AIAssistant />
      </div>
    </div>
  )
}