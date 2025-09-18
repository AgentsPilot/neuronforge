'use client'

import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { interpolatePrompt } from '@/lib/utils/interpolatePrompt'
import { generatePDF } from '@/lib/pdf/generatePDF'
import { sendEmailDraft } from '@/lib/plugins/google-mail/sendEmailDraft'
import { 
  Brain, Database, FileText, Cog, CheckCircle, AlertCircle, Clock, Target, 
  Shield, Lightbulb, Cpu, Activity, Eye, EyeOff, ArrowRight, Play, Send,
  Download, Zap, Settings, Info, ChevronDown, ChevronUp, Loader2, Sparkles,
  Rocket, Magic, Timer, Star, Puzzle, Wand2, Coffee, Heart, Smile, PartyPopper,
  TrendingUp, Award, CheckCircle2, AlertTriangle, Terminal, Gauge
} from 'lucide-react'

// Types
type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'file'
  enum?: string[]
  options?: string[]
  description?: string
  required?: boolean
  placeholder?: string
}

interface OutputField {
  name: string
  type: string
  description?: string
}

interface AgentSandboxProps {
  agentId: string
  inputSchema?: Field[]
  outputSchema?: OutputField[]
  userPrompt: string
  pluginsRequired?: string[]
  onExecutionComplete?: (executionId: string | null) => void
}

interface ExecutionLog {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  phase?: string
  execution_id?: string
}

interface DynamicPhase {
  id: string
  title: string
  icon: any
  color: string
  status: 'pending' | 'active' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  logs: ExecutionLog[]
  progress: number
}

const BLOCKED_FIELDS_BY_PLUGIN: Record<string, string[]> = {
  'google-mail': ['email'],
  'notion': ['workspace', 'workspacename'],
}

const PHASE_PATTERNS = [
  {
    id: 'memory',
    title: 'Getting Ready',
    icon: Coffee,
    color: 'from-amber-400 to-orange-500',
    keywords: ['loading contextual memory', 'phase 1', 'memory', 'contextual memory'],
    friendlyName: 'Setting up workspace'
  },
  {
    id: 'intent',
    title: 'Understanding You',
    icon: Heart,
    color: 'from-pink-400 to-rose-500',
    keywords: ['intent analysis', 'phase 2', 'analyzing intent', 'universal intent', 'primaryIntent'],
    friendlyName: 'Reading your request'
  },
  {
    id: 'strategy',
    title: 'Making a Plan',
    icon: Lightbulb,
    color: 'from-yellow-400 to-amber-500',
    keywords: ['adaptive strategy', 'phase 3', 'strategy generation', 'generating adaptive strategy'],
    friendlyName: 'Planning the approach'
  },
  {
    id: 'plugins',
    title: 'Using Tools',
    icon: Wand2,
    color: 'from-purple-400 to-indigo-500',
    keywords: ['plugin coordination', 'phase 4', 'executing smart plugin', 'chatgpt-research', 'google-mail', 'smart plugin'],
    friendlyName: 'Working with connected apps'
  },
  {
    id: 'documents',
    title: 'Processing Data',
    icon: Puzzle,
    color: 'from-blue-400 to-cyan-500',
    keywords: ['processing documents', 'phase 5', 'document intelligence', 'extracted content'],
    friendlyName: 'Analyzing information'
  },
  {
    id: 'prompt',
    title: 'Crafting Response',
    icon: Sparkles,
    color: 'from-green-400 to-emerald-500',
    keywords: ['prompt generation', 'phase 6', 'universal smart prompt', 'generating universal smart prompt'],
    friendlyName: 'Preparing your answer'
  },
  {
    id: 'llm',
    title: 'AI Magic Happening',
    icon: Star,
    color: 'from-violet-400 to-purple-500',
    keywords: ['executing with gpt-4o', 'phase 7', 'data-aware intelligence', 'llm execution'],
    friendlyName: 'AI is thinking hard'
  },
  {
    id: 'validation',
    title: 'Quality Check',
    icon: Award,
    color: 'from-teal-400 to-green-500',
    keywords: ['quality validation', 'phase 8', 'learning system', 'execution completed', 'ultra-smart execution completed'],
    friendlyName: 'Making sure it\'s perfect'
  }
]

export default function AgentSandbox({
  agentId,
  inputSchema = [],
  outputSchema = [],
  userPrompt,
  pluginsRequired = [],
  onExecutionComplete,
}: AgentSandboxProps) {
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [connectedPluginKeys, setConnectedPluginKeys] = useState<string[]>([])
  const [sendStatus, setSendStatus] = useState<string | null>(null)
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  
  // UI State
  const [showVisualizer, setShowVisualizer] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    inputs: true,
    outputs: false,
    plugins: false
  })
  
  // Execution visualization
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([])
  const [dynamicPhases, setDynamicPhases] = useState<DynamicPhase[]>([])
  const [executionMetrics, setExecutionMetrics] = useState({
    confidence: 0,
    qualityScore: 'B',
    duration: 0,
    businessContext: 'general',
    dataProcessed: false,
    pluginsUsed: [] as string[]
  })
  const [isLiveExecution, setIsLiveExecution] = useState(false)
  const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null)
  const logCounter = useRef(0)

  const { user } = useAuth()

  const safeInputSchema = Array.isArray(inputSchema) ? inputSchema : []
  const safeOutputSchema = Array.isArray(outputSchema) ? outputSchema : []
  const safePluginsRequired = Array.isArray(pluginsRequired) ? pluginsRequired : []

  useEffect(() => {
    const fetchConnectedPlugins = async () => {
      if (!user?.id) return
      const { data } = await supabase
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', user.id)

      if (data) setConnectedPluginKeys(data.map((row) => row.plugin_key))
    }
    fetchConnectedPlugins()
  }, [user])

  const initializeVisualization = () => {
    const executionId = `exec_${agentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setCurrentExecutionId(executionId)
    
    setExecutionLogs([])
    setIsLiveExecution(true)
    logCounter.current = 0
    
    const initialPhases: DynamicPhase[] = PHASE_PATTERNS.map(pattern => ({
      id: pattern.id,
      title: pattern.title,
      icon: pattern.icon,
      color: pattern.color,
      status: 'pending' as const,
      logs: [],
      progress: 0
    }))
    setDynamicPhases(initialPhases)
    
    setExecutionMetrics({
      confidence: 0,
      qualityScore: 'B',
      duration: 0,
      businessContext: 'general',
      dataProcessed: false,
      pluginsUsed: []
    })

    return executionId
  }

  const handleStreamEvent = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      
      switch (data.type) {
        case 'start':
          console.log('🚀 Agent execution started')
          break
          
        case 'log':
          const logEntry: ExecutionLog = {
            id: `log_${Date.now()}_${++logCounter.current}`,
            timestamp: data.timestamp,
            level: data.level,
            message: data.message,
            phase: data.phase,
            execution_id: currentExecutionId!
          }
          
          setExecutionLogs(prev => {
            const newLogs = [...prev, logEntry]
            updateExecutionMetrics(newLogs)
            updateDynamicPhases(newLogs)
            return newLogs
          })
          
          if (data.metrics) {
            setExecutionMetrics(prev => ({
              ...prev,
              ...data.metrics,
              pluginsUsed: data.metrics.pluginUsed 
                ? [...prev.pluginsUsed, data.metrics.pluginUsed].filter((v, i, a) => a.indexOf(v) === i)
                : prev.pluginsUsed
            }))
          }
          break
          
        case 'result':
          setResult(data.result)
          setExecutionTime(data.execution_time)
          
          if (data.result?.send_status) {
            setSendStatus(data.result.send_status)
          } else {
            const usedOutputType = safeOutputSchema.find((f) =>
              ['SummaryBlock', 'EmailDraft'].includes(f.type)
            )?.type

            if (usedOutputType === 'SummaryBlock') {
              setSendStatus('Report generated successfully')
            } else if (usedOutputType === 'EmailDraft') {
              setSendStatus('Email draft generated successfully')
            } else {
              setSendStatus('Agent execution completed')
            }
          }
          break
          
        case 'error':
          setResult({ error: data.error })
          break
          
        case 'complete':
          setIsLiveExecution(false)
          onExecutionComplete?.(currentExecutionId)
          
          setTimeout(() => {
            setExecutionLogs(prev => {
              updateDynamicPhases(prev)
              return prev
            })
          }, 100)
          break
      }
    } catch (error) {
      console.error('Error parsing SSE data:', error)
    }
  }

  const updateExecutionMetrics = (logs: ExecutionLog[]) => {
    const metrics = {
      confidence: 0,
      qualityScore: 'B',
      duration: 0,
      businessContext: 'general',
      dataProcessed: false,
      pluginsUsed: [] as string[]
    }
    
    logs.forEach(log => {
      const message = log.message
      
      const confidenceMatch = message.match(/confidence[:\s]+([0-9.]+)/i)
      if (confidenceMatch) {
        metrics.confidence = parseFloat(confidenceMatch[1])
      }
      
      const qualityMatch = message.match(/qualityScore[:\s]+['"]?([A-F][+-]?)['"]?/i)
      if (qualityMatch) {
        metrics.qualityScore = qualityMatch[1]
      }
      
      const contextMatch = message.match(/businessContext[:\s]+['"]([^'"]+)['"]?/i)
      if (contextMatch) {
        metrics.businessContext = contextMatch[1]
      }
      
      if (message.toLowerCase().includes('dataprocessed: true')) {
        metrics.dataProcessed = true
      }
      
      const pluginMatch = message.match(/smart plugin[:\s]+([a-z-]+)/i)
      if (pluginMatch && !metrics.pluginsUsed.includes(pluginMatch[1])) {
        metrics.pluginsUsed.push(pluginMatch[1])
      }
    })
    
    if (logs.length > 1) {
      const start = new Date(logs[0].timestamp).getTime()
      const end = new Date(logs[logs.length - 1].timestamp).getTime()
      metrics.duration = end - start
    }
    
    setExecutionMetrics(metrics)
  }

  const updateDynamicPhases = (logs: ExecutionLog[]) => {
    const phases: DynamicPhase[] = PHASE_PATTERNS.map(pattern => ({
      id: pattern.id,
      title: pattern.title,
      icon: pattern.icon,
      color: pattern.color,
      status: 'pending' as const,
      logs: logs.filter(log => log.phase === pattern.id),
      progress: 0
    }))

    let currentActivePhase = null
    const currentTime = Date.now()

    phases.forEach((phase, index) => {
      if (phase.logs.length > 0) {
        phase.startTime = new Date(phase.logs[0].timestamp).getTime()
        
        const hasCompletion = phase.logs.some(log => 
          log.message.toLowerCase().includes('completed') ||
          log.message.toLowerCase().includes('successful') ||
          log.message.toLowerCase().includes('✅')
        )
        
        const hasError = phase.logs.some(log => 
          log.level === 'error' ||
          log.message.toLowerCase().includes('error') ||
          log.message.toLowerCase().includes('failed') ||
          log.message.toLowerCase().includes('❌')
        )
        
        const nextPhaseStarted = index < phases.length - 1 && 
          phases[index + 1].logs.length > 0
        
        if (hasError) {
          phase.status = 'error'
          phase.progress = 100
        } else if (hasCompletion || nextPhaseStarted) {
          phase.status = 'completed'
          phase.progress = 100
          phase.endTime = new Date(phase.logs[phase.logs.length - 1].timestamp).getTime()
        } else if (isLiveExecution) {
          phase.status = 'active'
          currentActivePhase = phase.id
          const timeSinceStart = currentTime - phase.startTime
          const logProgress = Math.min(phase.logs.length * 15, 60)
          const timeProgress = Math.min(timeSinceStart / 1000 * 5, 30)
          phase.progress = Math.min(logProgress + timeProgress, 90)
        }
      }
    })

    if (!isLiveExecution && currentActivePhase) {
      const lastActivePhase = phases.find(p => p.id === currentActivePhase)
      if (lastActivePhase && lastActivePhase.status === 'active') {
        lastActivePhase.status = 'completed'
        lastActivePhase.progress = 100
        lastActivePhase.endTime = currentTime
      }
    }

    setDynamicPhases(phases)
  }

  const filteredInputSchema = safeInputSchema.filter((field) => {
    const name = field.name.toLowerCase()
    return !connectedPluginKeys.some((plugin) =>
      (BLOCKED_FIELDS_BY_PLUGIN[plugin] || []).includes(name)
    )
  })

  const getPluginStatus = (plugin: string) => {
    if (plugin === 'chatgpt-research') {
      return true
    }
    return connectedPluginKeys.includes(plugin)
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}
    
    filteredInputSchema.forEach(field => {
      const value = formData[field.name]
      
      // Required field validation
      if (field.required) {
        if (value === undefined || value === null || value === '') {
          errors[field.name] = `${field.name} is required`
          return
        }
      }
      
      // Skip further validation if field is empty and not required
      if (!value) return
      
      // Type-specific validation
      switch (field.type) {
        case 'number':
          if (isNaN(Number(value))) {
            errors[field.name] = `${field.name} must be a valid number`
          }
          break
          
        case 'email':
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
          if (!emailRegex.test(value)) {
            errors[field.name] = `Please enter a valid email address`
          }
          break
          
        case 'time':
          const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
          if (!timeRegex.test(value)) {
            errors[field.name] = `Please enter a valid time format (HH:MM)`
          }
          break
          
        case 'date':
          const dateValue = new Date(value)
          if (isNaN(dateValue.getTime())) {
            errors[field.name] = `Please enter a valid date`
          }
          break
          
        case 'enum':
        case 'select':
          const validOptions = field.enum || field.options || []
          if (validOptions.length > 0 && !validOptions.includes(value)) {
            errors[field.name] = `Please select a valid option`
          }
          break
          
        case 'file':
          // File validation could be added here if needed
          break
      }
    })
    
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const validateField = (name: string, value: any, field: Field): string | null => {
    // Required field validation
    if (field.required && (value === undefined || value === null || value === '')) {
      return `${field.name} is required`
    }
    
    // Skip further validation if field is empty and not required
    if (!value) return null
    
    // Type-specific validation
    switch (field.type) {
      case 'number':
        if (isNaN(Number(value))) {
          return `${field.name} must be a valid number`
        }
        break
        
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(value)) {
          return `Please enter a valid email address`
        }
        break
        
      case 'time':
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
        if (!timeRegex.test(value)) {
          return `Please enter a valid time format (HH:MM)`
        }
        break
        
      case 'date':
        const dateValue = new Date(value)
        if (isNaN(dateValue.getTime())) {
          return `Please enter a valid date`
        }
        break
        
      case 'enum':
      case 'select':
        const validOptions = field.enum || field.options || []
        if (validOptions.length > 0 && !validOptions.includes(value)) {
          return `Please select a valid option`
        }
        break
    }
    
    return null
  }

  const isFormValid = (): boolean => {
    const requiredFields = filteredInputSchema.filter(field => field.required)
    
    return requiredFields.every(field => {
      const value = formData[field.name]
      if (value === undefined || value === null || value === '') return false
      if (field.type === 'number' && isNaN(Number(value))) return false
      return true
    })
  }

  const missingPlugins = safePluginsRequired.filter(
    (key) => !getPluginStatus(key)
  )

  const canRun = isFormValid() && missingPlugins.length === 0

  const handleInputChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
    
    // Clear existing error for this field
    if (validationErrors[name]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
    
    // Real-time validation for better UX
    const field = filteredInputSchema.find(f => f.name === name)
    if (field) {
      const error = validateField(name, value, field)
      if (error) {
        setValidationErrors(prev => ({
          ...prev,
          [name]: error
        }))
      }
    }
  }

  const handleFormSubmit = (e: React.FormEvent, withVisualizer = false) => {
    e.preventDefault()
    handleRun(withVisualizer)
  }

  const handleRun = async (withVisualizer = false) => {
    if (!validateForm()) {
      return
    }

    try {
      setLoading(true)
      setSendStatus(null)
      setResult(null)
      setExecutionTime(null)

      if (missingPlugins.length > 0) {
        setResult({ error: `Missing required plugin(s): ${missingPlugins.join(', ')}` })
        return
      }

      if (withVisualizer) {
        const executionId = initializeVisualization()
        
        const streamUrl = '/api/agent-stream'
        const requestBody = {
          agent_id: agentId,
          input_variables: formData,
          user_prompt: userPrompt,
          execution_id: executionId
        }

        const response = await fetch(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          throw new Error(`Stream failed: ${response.statusText}`)
        }

        if (!response.body) {
          throw new Error('No response body for stream')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        const readStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              const lines = chunk.split('\n')

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const eventData = line.slice(6)
                  if (eventData.trim()) {
                    handleStreamEvent({ data: eventData } as MessageEvent)
                  }
                }
              }
            }
          } catch (error) {
            console.error('Stream reading error:', error)
            setResult({ error: 'Stream connection failed' })
          } finally {
            setLoading(false)
            setIsLiveExecution(false)
          }
        }

        readStream()

      } else {
        const startTime = Date.now()
        
        const response = await fetch(`/api/agents/${agentId}/execute-workflow`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputVariables: formData,
            testMode: true
          }),
        })
        
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Workflow execution failed: ${response.statusText} - ${errorText}`)
        }

        const res = await response.json()
        const endTime = Date.now()
        setExecutionTime(endTime - startTime)
        
        let finalResult
        
        if (res?.result) {
          finalResult = res.result
        } else if (res?.output) {
          finalResult = res.output
        } else if (res?.message) {
          finalResult = res.message
        } else {
          finalResult = res
        }
        
        setResult(finalResult)

        if (finalResult?.send_status) {
          setSendStatus(finalResult.send_status)
        } else if (res?.success === false) {
          setSendStatus('Workflow execution failed')
        } else if (typeof finalResult === 'string' && finalResult.includes('error')) {
          setSendStatus('Execution completed with errors')
        } else {
          const hasEmailOutput = safeOutputSchema.some(f => 
            f.type === 'EmailDraft' || f.name.toLowerCase().includes('email')
          )
          const hasReportOutput = safeOutputSchema.some(f => 
            f.type === 'SummaryBlock' || f.name.toLowerCase().includes('report')
          )
          
          if (hasEmailOutput) {
            setSendStatus('Email draft generated successfully')
          } else if (hasReportOutput) {
            setSendStatus('Report generated successfully')
          } else {
            setSendStatus('Agent execution completed')
          }
        }

        setLoading(false)
      }

    } catch (err: any) {
      setResult({ error: err.message })
      setLoading(false)
      setIsLiveExecution(false)
    }
  }

  const handleDownloadPDF = () => {
    if (result && safeOutputSchema.length > 0) {
      generatePDF(result, safeOutputSchema)
    }
  }

  const handleSendEmail = async () => {
    if (result && result.to && result.subject && result.body) {
      try {
        await sendEmailDraft(user?.id!, result)
        setSendStatus('Email sent successfully via Gmail.')
      } catch (error) {
        setSendStatus('Failed to send email.')
      }
    } else {
      alert('Missing required email fields.')
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, name: string) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result?.toString()
      handleInputChange(name, base64)
    }
    reader.readAsDataURL(file)
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
  }

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 rounded-2xl border border-blue-200">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Rocket className="h-6 w-6 text-white" />
            </div>
            {loading && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full animate-pulse">
                <div className="w-full h-full bg-green-500 rounded-full animate-ping"></div>
              </div>
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Try Your Agent</h2>
            <p className="text-slate-600">Let's see what magic it can do!</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowVisualizer(!showVisualizer)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
              showVisualizer 
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg transform scale-105'
                : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-purple-300 hover:shadow-md'
            }`}
          >
            {showVisualizer ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            Live Mode
          </button>
          
          {executionTime && (
            <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-green-200 text-green-700">
              <Timer className="h-4 w-4" />
              <span className="font-medium text-sm">{formatDuration(executionTime)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Plugin Requirements */}
      {safePluginsRequired.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div 
            className="bg-gradient-to-r from-indigo-50 to-blue-50 p-4 cursor-pointer hover:from-indigo-100 hover:to-blue-100 transition-colors"
            onClick={() => toggleSection('plugins')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center">
                  <Puzzle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Connected Tools</h3>
                  <p className="text-slate-600 text-sm">Your agent needs these to work properly</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-slate-600">
                  {safePluginsRequired.filter(p => getPluginStatus(p)).length}/{safePluginsRequired.length} ready
                </div>
                {expandedSections.plugins ? 
                  <ChevronUp className="h-5 w-5 text-slate-600" /> : 
                  <ChevronDown className="h-5 w-5 text-slate-600" />
                }
              </div>
            </div>
          </div>
          
          {expandedSections.plugins && (
            <div className="p-4 space-y-3">
              {safePluginsRequired.map(plugin => {
                const isConnected = getPluginStatus(plugin)
                return (
                  <div
                    key={plugin}
                    className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all ${
                      isConnected 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isConnected ? 'bg-green-100' : 'bg-red-100'
                      }`}>
                        {isConnected ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-red-600" />
                        )}
                      </div>
                      <div>
                        <span className={`font-medium ${
                          isConnected ? 'text-green-800' : 'text-red-800'
                        }`}>
                          {plugin}
                        </span>
                        <p className={`text-xs ${
                          isConnected ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {isConnected ? 'Ready to use' : 'Needs to be connected'}
                        </p>
                      </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                      isConnected 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {isConnected ? 'Connected' : 'Missing'}
                    </div>
                  </div>
                )
              })}
              
              {missingPlugins.length > 0 && (
                <div className="mt-4 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl">
                  <div className="flex items-center gap-2 text-amber-800">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-medium">Please connect the missing tools before running your agent.</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expected Output */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div 
          className="bg-gradient-to-r from-emerald-50 to-green-50 p-4 cursor-pointer hover:from-emerald-100 hover:to-green-100 transition-colors"
          onClick={() => toggleSection('outputs')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center">
                <Target className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">What you'll get</h3>
                <p className="text-slate-600 text-sm">The magic your agent will create</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-slate-600">
                {safeOutputSchema.length} field{safeOutputSchema.length !== 1 ? 's' : ''}
              </div>
              {expandedSections.outputs ? 
                <ChevronUp className="h-5 w-5 text-slate-600" /> : 
                <ChevronDown className="h-5 w-5 text-slate-600" />
              }
            </div>
          </div>
        </div>

        {expandedSections.outputs && (
          <div className="p-4">
            {safeOutputSchema.length === 0 ? (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-dashed border-emerald-300 rounded-xl p-6 text-center">
                <Magic className="h-8 w-8 text-emerald-500 mx-auto mb-3" />
                <h4 className="font-semibold text-emerald-900 mb-2">Surprise Output!</h4>
                <p className="text-emerald-700 text-sm">
                  Your agent will decide the best format for your results
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {safeOutputSchema.map((field, index) => (
                  <div key={index} className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all ${
                    result ? 'bg-green-50 border-green-200' : 'bg-emerald-50 border-emerald-200'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        result ? 'bg-green-100' : 'bg-emerald-100'
                      }`}>
                        {result ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                          <Clock className="h-5 w-5 text-emerald-600" />
                        )}
                      </div>
                      <div>
                        <span className={`font-medium ${
                          result ? 'text-green-800' : 'text-emerald-800'
                        }`}>
                          {field.name}
                        </span>
                        <p className={`text-xs ${
                          result ? 'text-green-600' : 'text-emerald-600'
                        }`}>
                          {field.description || 'Output field'}
                        </p>
                      </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                      result 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {field.type}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={(e) => handleFormSubmit(e, false)} className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div 
            className="bg-gradient-to-r from-slate-50 to-gray-50 p-4 border-b border-slate-200 cursor-pointer hover:from-slate-100 hover:to-gray-100 transition-colors"
            onClick={() => toggleSection('inputs')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-gray-700 rounded-xl flex items-center justify-center">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">What do you need?</h3>
                  <p className="text-slate-600 text-sm">
                    {filteredInputSchema.length === 0 
                      ? 'All set! No input needed'
                      : `Fill out the form below to get started`
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-slate-600">
                  {filteredInputSchema.length} field{filteredInputSchema.length !== 1 ? 's' : ''}
                </div>
                {expandedSections.inputs ? 
                  <ChevronUp className="h-5 w-5 text-slate-600" /> : 
                  <ChevronDown className="h-5 w-5 text-slate-600" />
                }
              </div>
            </div>
          </div>

          {expandedSections.inputs && (
            <div className="p-6">
              {filteredInputSchema.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Smile className="h-8 w-8 text-green-600" />
                  </div>
                  <h4 className="font-semibold text-slate-900 mb-2">You're all set!</h4>
                  <p className="text-slate-600">
                    This agent works automatically with your connected tools. Just hit the run button below!
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredInputSchema.map((field, index) => (
                    <div key={index} className="space-y-2">
                      <label className="block">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-slate-900">
                            {field.name}
                          </span>
                          {field.required && (
                            <span className="text-red-500 text-sm">*</span>
                          )}
                          <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full font-medium">
                            {field.type}
                          </span>
                        </div>
                        
                        {field.description && (
                          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-sm text-blue-800">{field.description}</p>
                          </div>
                        )}
                        
                        {field.type === 'enum' || field.type === 'select' ? (
                          <select
                            className={`w-full px-4 py-3 border-2 rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:border-blue-500 bg-white ${
                              validationErrors[field.name] 
                                ? 'border-red-400 focus:ring-red-500 focus:border-red-500 bg-red-50' 
                                : 'border-slate-300 hover:border-slate-400 focus:ring-blue-500'
                            }`}
                            onChange={(e) => handleInputChange(field.name, e.target.value)}
                            value={formData[field.name] || ''}
                          >
                            <option value="" className="text-slate-500">
                              {field.placeholder || 'Select an option...'}
                            </option>
                            {(field.enum || field.options || []).map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : field.type === 'file' ? (
                          <div className="space-y-3">
                            <input
                              type="file"
                              accept="application/pdf,image/*,.txt,.csv"
                              className={`w-full px-4 py-3 border-2 rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:border-blue-500 bg-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 ${
                                validationErrors[field.name] 
                                  ? 'border-red-400 focus:ring-red-500 focus:border-red-500' 
                                  : 'border-slate-300 hover:border-slate-400 focus:ring-blue-500'
                              }`}
                              onChange={(e) => handleFileUpload(e, field.name)}
                            />
                            {formData[field.name] && (
                              <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg p-3">
                                <CheckCircle2 className="h-4 w-4" />
                                File uploaded successfully
                              </div>
                            )}
                          </div>
                        ) : field.type === 'boolean' ? (
                          <div className={`flex items-center gap-3 p-3 border-2 rounded-lg ${
                            validationErrors[field.name] 
                              ? 'bg-red-50 border-red-300' 
                              : 'bg-slate-50 border-slate-300'
                          }`}>
                            <input
                              type="checkbox"
                              id={`field-${field.name}`}
                              className="rounded border-slate-400 h-4 w-4 text-blue-600 focus:ring-blue-500 focus:ring-2"
                              onChange={(e) => handleInputChange(field.name, e.target.checked)}
                              checked={formData[field.name] || false}
                            />
                            <label htmlFor={`field-${field.name}`} className="text-sm text-slate-700 cursor-pointer">
                              {field.placeholder || `Enable ${field.name}`}
                            </label>
                          </div>
                        ) : (
                          <input
                            type={
                              field.type === 'number' ? 'number' : 
                              field.type === 'date' ? 'date' : 
                              field.type === 'email' ? 'email' :
                              field.type === 'time' ? 'time' :
                              'text'
                            }
                            className={`w-full px-4 py-3 border-2 rounded-lg text-sm transition-all focus:outline-none focus:ring-2 focus:border-blue-500 bg-white ${
                              validationErrors[field.name] 
                                ? 'border-red-400 focus:ring-red-500 focus:border-red-500 bg-red-50' 
                                : 'border-slate-300 hover:border-slate-400 focus:ring-blue-500'
                            }`}
                            placeholder={field.placeholder || `Enter ${field.name.toLowerCase()}...`}
                            onChange={(e) => handleInputChange(field.name, e.target.value)}
                            value={formData[field.name] || ''}
                          />
                        )}
                      </label>
                      
                      {validationErrors[field.name] && (
                        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          <span>{validationErrors[field.name]}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Run Controls */}
        <div className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 rounded-2xl border-2 border-blue-200 p-6">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Ready to Launch?</h3>
                <p className="text-slate-600">Your agent is waiting to show you what it can do!</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                type="submit"
                className={`px-8 py-4 rounded-2xl flex items-center gap-3 text-lg font-bold transition-all duration-300 ${
                  canRun && !loading
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-xl hover:shadow-2xl transform hover:-translate-y-1 hover:scale-105'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
                disabled={!canRun || loading}
              >
                {loading && !showVisualizer ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin" />
                    Working on it...
                  </>
                ) : (
                  <>
                    <Rocket className="h-6 w-6" />
                    Let's Go!
                  </>
                )}
              </button>

              {showVisualizer && (
                <button
                  type="button"
                  className={`px-8 py-4 rounded-2xl flex items-center gap-3 text-lg font-bold transition-all duration-300 ${
                    canRun && !loading
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 shadow-xl hover:shadow-2xl transform hover:-translate-y-1 hover:scale-105'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                  onClick={() => handleRun(true)}
                  disabled={!canRun || loading}
                >
                  {loading && showVisualizer && isLiveExecution ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin" />
                      Live streaming...
                    </>
                  ) : (
                    <>
                      <Eye className="h-6 w-6" />
                      Watch It Work!
                    </>
                  )}
                </button>
              )}
            </div>
            
            {!canRun && !loading && (
              <div className="flex items-center justify-center gap-2 text-amber-700 bg-amber-100 px-4 py-3 rounded-xl border border-amber-200">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">
                  {missingPlugins.length > 0 
                    ? 'Connect your tools first!'
                    : !isFormValid() 
                    ? 'Fill out the required fields above'
                    : ''
                  }
                </span>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Live Execution Visualizer */}
      {showVisualizer && (dynamicPhases.length > 0 || executionLogs.length > 0) && (
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 opacity-95 rounded-2xl"></div>
          <div className="relative p-6 text-white">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center animate-pulse">
                  <Brain className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">Your Agent is Working!</h3>
                  <p className="text-blue-300">Watch the magic happen in real-time</p>
                </div>
              </div>
              {isLiveExecution && (
                <div className="flex items-center gap-2 bg-green-500/20 px-4 py-2 rounded-xl border border-green-400/30">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-ping"></div>
                  <span className="text-green-400 font-bold">LIVE</span>
                </div>
              )}
            </div>
            
            {/* Fun Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/20">
                <div className="text-2xl font-bold text-yellow-400">{executionLogs.length}</div>
                <div className="text-slate-300 text-sm">Steps Taken</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/20">
                <div className="text-2xl font-bold text-green-400">
                  {executionMetrics.confidence > 0 ? (executionMetrics.confidence * 100).toFixed(0) + '%' : '—'}
                </div>
                <div className="text-slate-300 text-sm">Confidence</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/20">
                <div className="text-2xl font-bold text-purple-400">
                  {executionMetrics.qualityScore}
                </div>
                <div className="text-slate-300 text-sm">Quality</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center border border-white/20">
                <div className="text-2xl font-bold text-cyan-400">
                  {executionTime ? formatDuration(executionTime) : formatDuration(executionMetrics.duration)}
                </div>
                <div className="text-slate-300 text-sm">Time</div>
              </div>
            </div>

            {/* Execution Steps */}
            <div className="space-y-4">
              <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                <Activity className="h-5 w-5" />
                What's Happening
              </h4>
              
              {dynamicPhases.map((phase, index) => {
                const IconComponent = phase.icon
                const pattern = PHASE_PATTERNS.find(p => p.id === phase.id)
                return (
                  <div
                    key={phase.id}
                    className={`bg-white/10 backdrop-blur-sm rounded-xl p-4 border transition-all duration-500 ${
                      phase.status === 'active' 
                        ? 'border-yellow-400/50 shadow-lg shadow-yellow-400/20 scale-105' 
                        : phase.status === 'completed'
                        ? 'border-green-400/50'
                        : phase.status === 'error'
                        ? 'border-red-400/50'
                        : 'border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-4 mb-3">
                      <div className={`p-3 rounded-xl bg-gradient-to-r ${phase.color} shadow-lg`}>
                        <IconComponent className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-bold text-white">{phase.title}</h5>
                        <p className="text-slate-300 text-sm">
                          {pattern?.friendlyName || phase.title}
                        </p>
                      </div>
                      <div>
                        {phase.status === 'completed' && (
                          <div className="flex items-center gap-1 text-green-400">
                            <CheckCircle2 className="h-5 w-5" />
                            <span className="text-sm font-medium">Done!</span>
                          </div>
                        )}
                        {phase.status === 'active' && (
                          <div className="flex items-center gap-1 text-yellow-400">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span className="text-sm font-medium">Working...</span>
                          </div>
                        )}
                        {phase.status === 'error' && (
                          <div className="flex items-center gap-1 text-red-400">
                            <AlertTriangle className="h-5 w-5" />
                            <span className="text-sm font-medium">Oops!</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mb-3">
                      <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${phase.color} transition-all duration-1000 rounded-full`}
                          style={{ width: `${phase.progress}%` }}
                        />
                      </div>
                      <div className="text-right text-xs text-slate-400 mt-1">
                        {phase.progress.toFixed(0)}%
                      </div>
                    </div>

                    {phase.logs.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">Latest updates:</div>
                        {phase.logs.slice(-1).map((log, logIndex) => (
                          <div
                            key={logIndex}
                            className="text-xs p-3 rounded-lg bg-black/30 text-slate-200 border border-white/10"
                          >
                            <div className="font-mono break-all">
                              {log.message.slice(0, 100)}
                              {log.message.length > 100 && '...'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Status Message */}
      {sendStatus && (
        <div className={`p-4 rounded-2xl border-2 flex items-center gap-3 ${
          sendStatus.includes('successfully') 
            ? 'bg-green-50 border-green-200 text-green-800' 
            : sendStatus.includes('failed') || sendStatus.includes('Failed')
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
            sendStatus.includes('successfully') ? 'bg-green-100' :
            sendStatus.includes('failed') ? 'bg-red-100' : 'bg-blue-100'
          }`}>
            {sendStatus.includes('successfully') ? (
              <PartyPopper className="h-5 w-5" />
            ) : sendStatus.includes('failed') || sendStatus.includes('Failed') ? (
              <AlertCircle className="h-5 w-5" />
            ) : (
              <Clock className="h-5 w-5" />
            )}
          </div>
          <p className="font-semibold">{sendStatus}</p>
        </div>
      )}

      {/* Results Display */}
      {result && (
        <div className={`border-2 rounded-2xl overflow-hidden ${
          result.error 
            ? 'bg-red-50 border-red-200' 
            : 'bg-white border-green-200'
        }`}>
          <div className={`p-4 border-b-2 ${
            result.error ? 'border-red-200 bg-red-100' : 'border-green-200 bg-green-50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  result.error ? 'bg-red-200' : 'bg-green-200'
                }`}>
                  {result.error ? (
                    <AlertCircle className="h-6 w-6 text-red-600" />
                  ) : (
                    <PartyPopper className="h-6 w-6 text-green-600" />
                  )}
                </div>
                <div>
                  <h3 className={`text-xl font-bold ${
                    result.error ? 'text-red-900' : 'text-green-900'
                  }`}>
                    {result.error ? 'Oops! Something went wrong' : 'Ta-da! Your results are ready'}
                  </h3>
                  <p className={`text-sm ${
                    result.error ? 'text-red-700' : 'text-green-700'
                  }`}>
                    {result.error ? 'Don\'t worry, we can try again' : 'Your agent did an amazing job!'}
                  </p>
                </div>
              </div>
              
              {!result.error && (
                <div className="flex gap-3">
                  {(connectedPluginKeys.includes('google-mail') && result?.to && result?.subject && result?.body) && (
                    <button
                      className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-2 rounded-xl hover:from-blue-700 hover:to-purple-700 flex items-center gap-2 font-medium transition-all transform hover:scale-105"
                      onClick={handleSendEmail}
                    >
                      <Send className="h-4 w-4" />
                      Send Email
                    </button>
                  )}

                  {(safeOutputSchema.some((f) => ['SummaryBlock', 'EmailDraft'].includes(f.type))) && (
                    <button
                      className="bg-gradient-to-r from-slate-600 to-gray-700 text-white px-4 py-2 rounded-xl hover:from-slate-700 hover:to-gray-800 flex items-center gap-2 font-medium transition-all transform hover:scale-105"
                      onClick={handleDownloadPDF}
                    >
                      <Download className="h-4 w-4" />
                      Download PDF
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="p-6">
            {result.error ? (
              <div className="bg-white border-2 border-red-200 rounded-xl p-4">
                <code className="text-red-700 text-sm font-mono">{result.error}</code>
              </div>
            ) : typeof result === 'object' ? (
              <div className="space-y-4">
                {safeOutputSchema.map((field) => (
                  <div key={field.name} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="font-bold text-slate-900">{field.name}</span>
                      <span className="bg-slate-200 text-slate-700 text-xs px-2 py-1 rounded-lg">
                        {field.type}
                      </span>
                    </div>
                    <div className="text-slate-900">
                      {result[field.name] ? (
                        typeof result[field.name] === 'object' ? (
                          <pre className="text-sm bg-white p-4 rounded-lg overflow-x-auto font-mono border border-slate-200">
                            {JSON.stringify(result[field.name], null, 2)}
                          </pre>
                        ) : (
                          <div className="break-words bg-white p-4 rounded-lg border border-slate-200">
                            {result[field.name]}
                          </div>
                        )
                      ) : (
                        <div className="text-slate-500 italic bg-white p-4 rounded-lg border-2 border-dashed border-slate-200 text-center">
                          No data was returned for this field
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="break-words text-slate-900">{result}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}