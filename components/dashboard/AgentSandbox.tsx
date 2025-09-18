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
  Download, Zap, Settings, Info, ChevronDown, ChevronUp, Loader2
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
    title: 'Loading Context',
    icon: Database,
    color: 'from-purple-500 to-indigo-500',
    keywords: ['loading contextual memory', 'phase 1', 'memory', 'contextual memory']
  },
  {
    id: 'intent',
    title: 'Analyzing Intent',
    icon: Brain,
    color: 'from-blue-500 to-cyan-500',
    keywords: ['intent analysis', 'phase 2', 'analyzing intent', 'universal intent', 'primaryIntent']
  },
  {
    id: 'strategy',
    title: 'Planning Strategy',
    icon: Target,
    color: 'from-green-500 to-emerald-500',
    keywords: ['adaptive strategy', 'phase 3', 'strategy generation', 'generating adaptive strategy']
  },
  {
    id: 'plugins',
    title: 'Executing Plugins',
    icon: Cog,
    color: 'from-orange-500 to-red-500',
    keywords: ['plugin coordination', 'phase 4', 'executing smart plugin', 'chatgpt-research', 'google-mail', 'smart plugin']
  },
  {
    id: 'documents',
    title: 'Processing Data',
    icon: FileText,
    color: 'from-yellow-500 to-orange-500',
    keywords: ['processing documents', 'phase 5', 'document intelligence', 'extracted content']
  },
  {
    id: 'prompt',
    title: 'Generating Response',
    icon: Lightbulb,
    color: 'from-pink-500 to-rose-500',
    keywords: ['prompt generation', 'phase 6', 'universal smart prompt', 'generating universal smart prompt']
  },
  {
    id: 'llm',
    title: 'AI Processing',
    icon: Cpu,
    color: 'from-violet-500 to-purple-500',
    keywords: ['executing with gpt-4o', 'phase 7', 'data-aware intelligence', 'llm execution']
  },
  {
    id: 'validation',
    title: 'Quality Check',
    icon: Shield,
    color: 'from-teal-500 to-green-500',
    keywords: ['quality validation', 'phase 8', 'learning system', 'execution completed', 'ultra-smart execution completed']
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
    outputs: true,
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
      if (field.required) {
        const value = formData[field.name]
        
        if (value === undefined || value === null || value === '') {
          errors[field.name] = `${field.name} is required`
        } else if (field.type === 'number' && isNaN(Number(value))) {
          errors[field.name] = `${field.name} must be a valid number`
        }
      }
    })
    
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
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
    
    if (validationErrors[name]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
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
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-lg">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg">
                <Brain className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Agent Sandbox</h2>
                <p className="text-sm text-gray-600">Test and execute your AI agent</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 ml-8">
              <button
                onClick={() => setShowVisualizer(!showVisualizer)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  showVisualizer 
                    ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-lg'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {showVisualizer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                Live Tracking
              </button>
              
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
              >
                <Settings className="h-4 w-4" />
                Advanced
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-3 text-sm text-gray-500">
            {executionTime && (
              <span className="bg-green-100 text-green-700 px-3 py-1 rounded-lg font-medium">
                Last: {formatDuration(executionTime)}
              </span>
            )}
            {currentExecutionId && (
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg font-mono text-xs">
                {currentExecutionId.split('_')[2]?.slice(0, 8)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Plugin Status Alert */}
      {safePluginsRequired.length > 0 && (
        <div className="bg-blue-50 border-b border-blue-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-blue-600" />
              <div>
                <h3 className="font-semibold text-blue-900">Required Plugins</h3>
                <p className="text-sm text-blue-700">
                  {safePluginsRequired.length} plugin{safePluginsRequired.length > 1 ? 's' : ''} needed for this agent
                </p>
              </div>
            </div>
            <button
              onClick={() => toggleSection('plugins')}
              className="text-blue-600 hover:text-blue-800"
            >
              {expandedSections.plugins ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
          
          {expandedSections.plugins && (
            <div className="mt-4 flex flex-wrap gap-2">
              {safePluginsRequired.map(plugin => {
                const isConnected = getPluginStatus(plugin)
                return (
                  <span
                    key={plugin}
                    className={`inline-flex items-center gap-2 px-3 py-1 text-sm rounded-lg ${
                      isConnected 
                        ? 'bg-green-100 text-green-800 border border-green-200' 
                        : 'bg-red-100 text-red-800 border border-red-200'
                    }`}
                  >
                    {isConnected ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    {plugin}
                  </span>
                )
              })}
            </div>
          )}
          
          {missingPlugins.length > 0 && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm font-medium">
                Please connect the missing plugins before running the agent.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Configuration Grid */}
        <div className="grid lg:grid-cols-2 gap-6">
          
          {/* Input Configuration */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 overflow-hidden">
            <div 
              className="bg-white/80 backdrop-blur-sm p-4 border-b border-blue-200 cursor-pointer"
              onClick={() => toggleSection('inputs')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500 rounded-lg">
                    <FileText className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-blue-900">Input Parameters</h3>
                    <p className="text-sm text-blue-600">
                      {filteredInputSchema.length} field{filteredInputSchema.length !== 1 ? 's' : ''}
                      {filteredInputSchema.filter(f => f.required).length > 0 && 
                        ` • ${filteredInputSchema.filter(f => f.required).length} required`
                      }
                    </p>
                  </div>
                </div>
                {expandedSections.inputs ? 
                  <ChevronUp className="h-5 w-5 text-blue-600" /> : 
                  <ChevronDown className="h-5 w-5 text-blue-600" />
                }
              </div>
            </div>

            {expandedSections.inputs && (
              <div className="p-4">
                {filteredInputSchema.length === 0 ? (
                  <div className="bg-white/70 border border-blue-200 rounded-xl p-6 text-center">
                    <Info className="h-8 w-8 text-blue-500 mx-auto mb-2" />
                    <p className="text-blue-700 font-medium">No Input Required</p>
                    <p className="text-sm text-blue-600 mt-1">
                      This agent handles data automatically through connected plugins
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredInputSchema.map((field, index) => (
                      <div key={index} className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-blue-100">
                        <div className="flex items-center gap-2 mb-3">
                          <label className="font-medium text-gray-900">
                            {field.name}
                          </label>
                          {field.required && <span className="text-red-500">*</span>}
                          <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-lg">
                            {field.type}
                          </span>
                        </div>
                        
                        {field.description && (
                          <p className="text-sm text-gray-600 mb-3 bg-gray-50 p-2 rounded-lg">
                            {field.description}
                          </p>
                        )}
                        
                        {field.type === 'enum' ? (
                          <select
                            className={`w-full border px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition-all ${
                              validationErrors[field.name] ? 'border-red-500' : 'border-gray-300'
                            }`}
                            onChange={(e) => handleInputChange(field.name, e.target.value)}
                            value={formData[field.name] || ''}
                          >
                            <option value="">
                              {field.placeholder || 'Select an option'}
                            </option>
                            {(field.enum || field.options || []).map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : field.type === 'file' ? (
                          <div>
                            <input
                              type="file"
                              accept="application/pdf,image/*,.txt,.csv"
                              className={`w-full border px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition-all ${
                                validationErrors[field.name] ? 'border-red-500' : 'border-gray-300'
                              }`}
                              onChange={(e) => handleFileUpload(e, field.name)}
                            />
                            {formData[field.name] && (
                              <div className="mt-2 flex items-center gap-2 text-green-600 text-sm">
                                <CheckCircle className="h-4 w-4" />
                                File uploaded successfully
                              </div>
                            )}
                          </div>
                        ) : field.type === 'boolean' ? (
                          <div className="flex items-center gap-3 bg-white rounded-xl p-4 border border-gray-200">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 h-5 w-5 text-blue-600 focus:ring-blue-500"
                              onChange={(e) => handleInputChange(field.name, e.target.checked)}
                              checked={formData[field.name] || false}
                            />
                            <span className="text-gray-700">Enable this option</span>
                          </div>
                        ) : (
                          <input
                            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            className={`w-full border px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition-all ${
                              validationErrors[field.name] ? 'border-red-500' : 'border-gray-300'
                            }`}
                            placeholder={field.placeholder || `Enter ${field.name.toLowerCase()}`}
                            onChange={(e) => handleInputChange(field.name, e.target.value)}
                            value={formData[field.name] || ''}
                          />
                        )}
                        
                        {validationErrors[field.name] && (
                          <div className="mt-2 flex items-center gap-2 text-red-600 text-sm">
                            <AlertCircle className="h-4 w-4" />
                            {validationErrors[field.name]}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Output Configuration */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 overflow-hidden">
            <div 
              className="bg-white/80 backdrop-blur-sm p-4 border-b border-green-200 cursor-pointer"
              onClick={() => toggleSection('outputs')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500 rounded-lg">
                    <Target className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-green-900">Expected Output</h3>
                    <p className="text-sm text-green-600">
                      {safeOutputSchema.length} field{safeOutputSchema.length !== 1 ? 's' : ''} to generate
                    </p>
                  </div>
                </div>
                {expandedSections.outputs ? 
                  <ChevronUp className="h-5 w-5 text-green-600" /> : 
                  <ChevronDown className="h-5 w-5 text-green-600" />
                }
              </div>
            </div>

            {expandedSections.outputs && (
              <div className="p-4">
                {safeOutputSchema.length === 0 ? (
                  <div className="bg-white/70 border border-green-200 rounded-xl p-6 text-center">
                    <Target className="h-8 w-8 text-green-500 mx-auto mb-2" />
                    <p className="text-green-700 font-medium">Dynamic Output</p>
                    <p className="text-sm text-green-600 mt-1">
                      Output structure will be determined automatically
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {safeOutputSchema.map((field, index) => (
                      <div key={index} className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-green-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-green-900">{field.name}</span>
                          <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-lg">
                            {field.type}
                          </span>
                        </div>
                        {field.description && (
                          <p className="text-sm text-green-700 bg-green-50 p-2 rounded-lg">
                            {field.description}
                          </p>
                        )}
                        {!result && (
                          <div className="text-xs text-green-600 italic mt-2 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Waiting for execution...
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Execution Controls */}
        <div className="bg-gradient-to-r from-slate-50 to-gray-50 rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl shadow-lg">
                <Play className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Execute Agent</h3>
                <p className="text-sm text-gray-600">Run your agent with the configured parameters</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button
              className={`px-8 py-4 rounded-xl flex items-center gap-3 text-lg font-semibold transition-all duration-200 ${
                canRun && !loading
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              onClick={() => handleRun(false)}
              disabled={!canRun || loading}
            >
              {loading && !showVisualizer ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-5 w-5" />
                  Run Agent
                </>
              )}
            </button>

            {showVisualizer && (
              <button
                className={`px-8 py-4 rounded-xl flex items-center gap-3 text-lg font-semibold transition-all duration-200 ${
                  canRun && !loading
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
                onClick={() => handleRun(true)}
                disabled={!canRun || loading}
              >
                {loading && showVisualizer && isLiveExecution ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Live Streaming...
                  </>
                ) : (
                  <>
                    <Brain className="h-5 w-5" />
                    Run with Live Tracking
                  </>
                )}
              </button>
            )}
            
            {!canRun && !loading && (
              <div className="flex items-center gap-3 text-amber-700 bg-amber-50 px-4 py-3 rounded-xl border border-amber-200">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">
                  {missingPlugins.length > 0 
                    ? 'Missing required plugins'
                    : !isFormValid() 
                    ? 'Complete all required fields'
                    : ''
                  }
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Live Execution Visualizer */}
        {showVisualizer && (dynamicPhases.length > 0 || executionLogs.length > 0) && (
          <div className="bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 rounded-2xl p-6 text-white">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Brain className="h-6 w-6 text-blue-400" />
                <div>
                  <h3 className="text-xl font-bold">Live Agent Execution</h3>
                  <p className="text-blue-300">Real-time monitoring and insights</p>
                </div>
              </div>
              {isLiveExecution && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-green-400 font-semibold">LIVE</span>
                </div>
              )}
            </div>
            
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-800/50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{executionLogs.length}</div>
                <div className="text-gray-400 text-sm">Total Logs</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-green-400">
                  {executionMetrics.confidence > 0 ? (executionMetrics.confidence * 100).toFixed(1) + '%' : 'N/A'}
                </div>
                <div className="text-gray-400 text-sm">Confidence</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-purple-400">
                  {executionMetrics.qualityScore}
                </div>
                <div className="text-gray-400 text-sm">Quality</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-cyan-400">
                  {executionTime ? formatDuration(executionTime) : formatDuration(executionMetrics.duration)}
                </div>
                <div className="text-gray-400 text-sm">Duration</div>
              </div>
            </div>

            {/* Execution Phases */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Execution Phases
              </h4>
              
              {dynamicPhases.map((phase, index) => {
                const IconComponent = phase.icon
                return (
                  <div
                    key={phase.id}
                    className={`bg-slate-800/30 backdrop-blur-sm rounded-xl p-5 border transition-all duration-300 ${
                      phase.status === 'active' 
                        ? 'border-blue-500/50 shadow-lg shadow-blue-500/20' 
                        : phase.status === 'completed'
                        ? 'border-green-500/50'
                        : phase.status === 'error'
                        ? 'border-red-500/50'
                        : 'border-slate-700/30'
                    }`}
                  >
                    <div className="flex items-center gap-4 mb-4">
                      <div className={`p-3 rounded-xl bg-gradient-to-r ${phase.color} shadow-lg`}>
                        <IconComponent className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-white text-lg">{phase.title}</h5>
                        <p className="text-gray-400 text-sm">
                          {phase.logs.length} log{phase.logs.length !== 1 ? 's' : ''}
                          {phase.startTime && ` • Started ${new Date(phase.startTime).toLocaleTimeString()}`}
                        </p>
                      </div>
                      <div>
                        {phase.status === 'completed' && (
                          <CheckCircle className="h-6 w-6 text-green-400" />
                        )}
                        {phase.status === 'active' && (
                          <div className="animate-spin">
                            <Loader2 className="h-6 w-6 text-blue-400" />
                          </div>
                        )}
                        {phase.status === 'error' && (
                          <AlertCircle className="h-6 w-6 text-red-400" />
                        )}
                      </div>
                    </div>

                    <div className="mb-4">
                      <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${phase.color} transition-all duration-500`}
                          style={{ width: `${phase.progress}%` }}
                        />
                      </div>
                      <div className="text-right text-sm text-gray-400 mt-2">
                        {phase.progress.toFixed(1)}%
                      </div>
                    </div>

                    {phase.logs.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-sm text-gray-400">Recent logs:</div>
                        {phase.logs.slice(-2).map((log, logIndex) => (
                          <div
                            key={logIndex}
                            className="text-sm p-3 rounded-lg bg-slate-700/50 text-gray-300 border border-slate-600/30"
                          >
                            <div className="font-mono text-xs break-all">
                              {log.message.slice(0, 150)}
                              {log.message.length > 150 && '...'}
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
        )}

        {/* Status Message */}
        {sendStatus && (
          <div className={`p-4 rounded-xl border flex items-center gap-3 ${
            sendStatus.includes('successfully') 
              ? 'bg-green-50 border-green-200 text-green-800' 
              : sendStatus.includes('failed') || sendStatus.includes('Failed')
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            {sendStatus.includes('successfully') ? (
              <CheckCircle className="h-5 w-5" />
            ) : sendStatus.includes('failed') || sendStatus.includes('Failed') ? (
              <AlertCircle className="h-5 w-5" />
            ) : (
              <Clock className="h-5 w-5" />
            )}
            <p className="font-semibold">{sendStatus}</p>
          </div>
        )}

        {/* Results Display */}
        {result && (
          <div className={`border rounded-2xl overflow-hidden ${
            result.error 
              ? 'bg-red-50 border-red-200' 
              : 'bg-gray-50 border-gray-200'
          }`}>
            <div className={`p-5 border-b ${
              result.error ? 'border-red-200' : 'border-gray-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl ${
                    result.error ? 'bg-red-100' : 'bg-green-100'
                  }`}>
                    {result.error ? (
                      <AlertCircle className="h-6 w-6 text-red-600" />
                    ) : (
                      <CheckCircle className="h-6 w-6 text-green-600" />
                    )}
                  </div>
                  <div>
                    <h3 className={`text-lg font-bold ${
                      result.error ? 'text-red-900' : 'text-green-900'
                    }`}>
                      {result.error ? 'Execution Error' : 'Agent Results'}
                    </h3>
                    <p className={`text-sm ${
                      result.error ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {result.error ? 'Something went wrong during execution' : 'Agent completed successfully'}
                    </p>
                  </div>
                </div>
                
                {!result.error && (
                  <div className="flex gap-2">
                    {(connectedPluginKeys.includes('google-mail') && result?.to && result?.subject && result?.body) && (
                      <button
                        className="bg-green-600 text-white px-4 py-2 rounded-xl hover:bg-green-700 flex items-center gap-2 font-medium transition-colors"
                        onClick={handleSendEmail}
                      >
                        <Send className="h-4 w-4" />
                        Send Email
                      </button>
                    )}

                    {(safeOutputSchema.some((f) => ['SummaryBlock', 'EmailDraft'].includes(f.type))) && (
                      <button
                        className="bg-gray-700 text-white px-4 py-2 rounded-xl hover:bg-gray-800 flex items-center gap-2 font-medium transition-colors"
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

            <div className="p-5">
              {result.error ? (
                <div className="bg-white border border-red-200 rounded-xl p-4">
                  <code className="text-red-700 text-sm font-mono">{result.error}</code>
                </div>
              ) : typeof result === 'object' ? (
                <div className="space-y-4">
                  {safeOutputSchema.map((field) => (
                    <div key={field.name} className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="font-semibold text-gray-900">{field.name}</span>
                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-lg">
                          {field.type}
                        </span>
                      </div>
                      <div className="text-gray-900">
                        {result[field.name] ? (
                          typeof result[field.name] === 'object' ? (
                            <pre className="text-sm bg-gray-100 p-4 rounded-xl overflow-x-auto font-mono">
                              {JSON.stringify(result[field.name], null, 2)}
                            </pre>
                          ) : (
                            <div className="break-words bg-gray-50 p-4 rounded-xl">
                              {result[field.name]}
                            </div>
                          )
                        ) : (
                          <span className="text-gray-400 italic bg-gray-100 p-4 rounded-xl block">
                            No data returned for this field
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="break-words text-gray-900">{result}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}