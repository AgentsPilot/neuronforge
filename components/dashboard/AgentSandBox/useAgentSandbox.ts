// COMPLETE FIX: useAgentSandbox hook changes

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { generatePDF } from '@/lib/pdf/generatePDF'
import { sendEmailDraft } from '@/lib/plugins/google-mail/sendEmailDraft'
import { 
  AgentSandboxProps, Field, ExecutionLog, DynamicPhase, ExecutionMetrics, 
  ExpandedSections, BLOCKED_FIELDS_BY_PLUGIN, OPTIONAL_IN_TEST_MODE_FIELDS, 
  PHASE_PATTERNS 
} from './types'

// Helper function to format schedule display
const formatScheduleDisplay = (mode: string, scheduleCron?: string): string => {
  if (mode === 'on_demand') {
    return 'Manual trigger only';
  }
  
  if (mode === 'scheduled' && scheduleCron) {
    return parseCronToHuman(scheduleCron);
  }
  
  return 'Not scheduled';
};

const parseCronToHuman = (cron: string): string => {
  if (!cron || typeof cron !== 'string') return 'Invalid schedule';
  
  const parts = cron.trim().split(' ');
  if (parts.length !== 5) return cron; // fallback to raw cron
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  try {
    // Convert hour to 12-hour format
    const hourNum = parseInt(hour);
    const minuteNum = parseInt(minute);
    
    if (isNaN(hourNum) || isNaN(minuteNum)) return cron;
    
    const time = hourNum === 0 ? `12:${minuteNum.toString().padStart(2, '0')} AM` : 
                 hourNum < 12 ? `${hourNum}:${minuteNum.toString().padStart(2, '0')} AM` :
                 hourNum === 12 ? `12:${minuteNum.toString().padStart(2, '0')} PM` :
                 `${hourNum - 12}:${minuteNum.toString().padStart(2, '0')} PM`;
    
    // Handle day of week
    if (dayOfWeek !== '*') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = days[parseInt(dayOfWeek)] || `Day ${dayOfWeek}`;
      return `${dayName}s at ${time}`;
    }
    
    // Handle daily
    if (dayOfMonth === '*' && month === '*') {
      return `Daily at ${time}`;
    }
    
    // Handle monthly
    if (dayOfMonth !== '*' && month === '*') {
      const getOrdinalSuffix = (num: number): string => {
        const j = num % 10;
        const k = num % 100;
        if (j == 1 && k != 11) return "st";
        if (j == 2 && k != 12) return "nd";
        if (j == 3 && k != 13) return "rd";
        return "th";
      };
      return `Monthly on the ${dayOfMonth}${getOrdinalSuffix(parseInt(dayOfMonth))} at ${time}`;
    }
    
    return cron; // fallback
  } catch (error) {
    return cron; // fallback to raw cron on any parsing error
  }
};

export function useAgentSandbox({
  agentId,
  inputSchema = [],
  outputSchema = [],
  userPrompt,
  pluginsRequired = [],
  workflowSteps = [],
  connectedPlugins = {},
  initialContext = 'test',
  onExecutionComplete,
  onFormCompletionChange,
}: AgentSandboxProps) {
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [connectedPluginKeys, setConnectedPluginKeys] = useState<string[]>([])
  const [sendStatus, setSendStatus] = useState<string | null>(null)
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Add loading states
  const [loadingConfiguration, setLoadingConfiguration] = useState(false)
  const [loadingSchema, setLoadingSchema] = useState(false)

  // Add actual input schema state (loaded from DB)
  const [dbInputSchema, setDbInputSchema] = useState<Field[]>([])
  const [schemaLoaded, setSchemaLoaded] = useState(false)

  // Execution context state - 'test' or 'configure' - use initialContext prop
  const [executionContext, setExecutionContext] = useState<'test' | 'configure'>(initialContext)
  
  // Configuration state
  const [savedConfiguration, setSavedConfiguration] = useState<Record<string, any> | null>(null)
  const [isConfigurationSaved, setIsConfigurationSaved] = useState(false)
  
  // ADDED: Track if configuration has been loaded to prevent re-loading
  const [configurationLoaded, setConfigurationLoaded] = useState(false)
  
  // UI State
  const [showVisualizer, setShowVisualizer] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    inputs: true,
    outputs: false,
    plugins: false
  })
  
  // Execution visualization
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([])
  const [dynamicPhases, setDynamicPhases] = useState<DynamicPhase[]>([])
  const [executionMetrics, setExecutionMetrics] = useState<ExecutionMetrics>({
    confidence: 0,
    qualityScore: 'B',
    duration: 0,
    businessContext: 'general',
    dataProcessed: false,
    pluginsUsed: []
  })
  const [isLiveExecution, setIsLiveExecution] = useState(false)
  const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null)
  const logCounter = useRef(0)

  const { user } = useAuth()

  // Use props schema first (since parent already loaded it), then DB schema as fallback
  const actualInputSchema = (() => {
    // If props schema exists and is valid, use it (even if empty)
    if (Array.isArray(inputSchema)) {
      console.log('Using props inputSchema:', inputSchema.length, 'fields')
      return inputSchema
    }
    // Otherwise use DB schema if available (even if empty)
    if (schemaLoaded && Array.isArray(dbInputSchema)) {
      console.log('Using DB inputSchema:', dbInputSchema.length, 'fields')
      return dbInputSchema
    }
    // Final fallback to empty array
    console.log('Using empty inputSchema fallback')
    return []
  })()
  const safeInputSchema = Array.isArray(actualInputSchema) ? actualInputSchema : []
  const safeOutputSchema = Array.isArray(outputSchema) ? outputSchema : []
  const safePluginsRequired = Array.isArray(pluginsRequired) ? pluginsRequired : []

  // Load input schema from database
  const loadInputSchemaFromDB = async () => {
    if (!agentId) {
      console.log('No agentId provided, cannot load schema')
      setDbInputSchema([])
      setSchemaLoaded(true)
      return
    }

    setLoadingSchema(true)
    try {
      console.log('Loading input schema for agent:', agentId)
      
      // Try to get schema from agents table
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('input_schema, workflow_config')
        .eq('id', agentId)
        .single()

      if (agentError) {
        console.log('Database error loading agent schema:', agentError)
        // If it's a "no rows" error, that's expected for some agents
        if (agentError.code === 'PGRST116') {
          console.log('No agent found with ID:', agentId)
          setDbInputSchema([])
          setSchemaLoaded(true)
          return
        }
        // For other errors, still set empty schema and continue
        console.log('Setting empty schema due to database error')
        setDbInputSchema([])
        setSchemaLoaded(true)
        return
      }

      if (agentData) {
        console.log('Agent data loaded:', agentData)
        
        // Handle input_schema - explicitly handle null, undefined, and empty array cases
        let inputSchemaToUse = []
        
        // Check input_schema field first
        if (agentData.input_schema !== null && agentData.input_schema !== undefined) {
          if (Array.isArray(agentData.input_schema)) {
            inputSchemaToUse = agentData.input_schema
            if (inputSchemaToUse.length === 0) {
              console.log('Agent has empty input schema - no user inputs required')
            } else {
              console.log('Found input_schema in agent data:', inputSchemaToUse.length, 'fields')
            }
          } else {
            console.log('input_schema is not an array, defaulting to empty')
            inputSchemaToUse = []
          }
        }
        // Check workflow_config as fallback
        else if (agentData.workflow_config?.inputSchema !== null && agentData.workflow_config?.inputSchema !== undefined) {
          if (Array.isArray(agentData.workflow_config.inputSchema)) {
            inputSchemaToUse = agentData.workflow_config.inputSchema
            if (inputSchemaToUse.length === 0) {
              console.log('Agent workflow has empty input schema - no user inputs required')
            } else {
              console.log('Found inputSchema in workflow_config:', inputSchemaToUse.length, 'fields')
            }
          } else {
            console.log('workflow_config.inputSchema is not an array, defaulting to empty')
            inputSchemaToUse = []
          }
        } else {
          console.log('No input schema found in agent data - defaulting to empty array')
          inputSchemaToUse = []
        }
        
        setDbInputSchema(inputSchemaToUse)
        setSchemaLoaded(true)
        return
      }

      // If no agent data found, try agent_configurations for historical data
      console.log('No agent data found, checking executions table')
      const { data: executionData, error: executionError } = await supabase
        .from('agent_configurations')
        .select('input_schema')
        .eq('agent_id', agentId)
        .not('input_schema', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (executionError) {
        console.log('Error loading execution schema (this is OK if table doesn\'t exist):', executionError)
        setDbInputSchema([])
      } else if (executionData && executionData.input_schema !== null && executionData.input_schema !== undefined) {
        console.log('Found input_schema in agent_configurations')
        if (Array.isArray(executionData.input_schema)) {
          const executionSchema = executionData.input_schema
          if (executionSchema.length === 0) {
            console.log('Execution has empty input schema - no user inputs required')
          }
          setDbInputSchema(executionSchema)
        } else {
          console.log('Execution input_schema is not an array, defaulting to empty')
          setDbInputSchema([])
        }
      } else {
        console.log('No schema found in database - agent will use empty schema (no inputs required)')
        setDbInputSchema([])
      }
      
      setSchemaLoaded(true)

    } catch (error) {
      console.error('Unexpected error loading input schema:', error)
      // Don't fail completely - set empty schema and mark as loaded
      setDbInputSchema([])
      setSchemaLoaded(true)
    } finally {
      setLoadingSchema(false)
    }
  }

  // Helper function to check if field should be treated as optional in test mode
  const isFieldOptionalInTestMode = (field: Field): boolean => {
    if (executionContext !== 'test') return false
    
    const name = field.name.toLowerCase()
    return OPTIONAL_IN_TEST_MODE_FIELDS.some(timingField => 
      name.includes(timingField) || timingField.includes(name)
    )
  }

  // Filter input schema based on execution context and plugins
  const filteredInputSchema = safeInputSchema.filter((field) => {
    const name = field.name.toLowerCase()
    
    // Filter out plugin-blocked fields
    return !connectedPluginKeys.some((plugin) =>
      (BLOCKED_FIELDS_BY_PLUGIN[plugin] || []).includes(name)
    )
  })

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

  // Load schema on mount or when agentId changes - always load from DB if no props schema
  useEffect(() => {
    // Always load from DB if we don't have a props schema, even if it might be empty
    if (agentId && (!inputSchema || !Array.isArray(inputSchema))) {
      console.log('Loading schema from DB because props schema is missing/invalid')
      loadInputSchemaFromDB()
    } else {
      console.log('Using props schema, skipping DB load')
      setSchemaLoaded(true) // Mark as "loaded" even though we're using props
    }
  }, [agentId, inputSchema])

  // FIXED: Load saved configuration ONLY ONCE when component mounts and has schema
  useEffect(() => {
    const loadSavedConfiguration = async () => {
      // IMPORTANT: Only load if we haven't loaded before and have necessary data
      if (!user?.id || !agentId || configurationLoaded) return
      
      // Check if we have any schema available (props or DB) - include empty schemas as valid
      const hasSchema = (inputSchema && Array.isArray(inputSchema)) || 
                       (schemaLoaded && Array.isArray(dbInputSchema))
      
      if (!hasSchema) return // Wait until we have schema from somewhere
      
      setLoadingConfiguration(true)
      try {
        console.log('Loading saved configuration for agent (one time only):', agentId)
        
        // FIXED: Use maybeSingle() to avoid errors when no records exist
        const { data, error } = await supabase
          .from('agent_configurations') // FIXED: Use correct table name (plural)
          .select('input_values, status')
          .eq('agent_id', agentId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() // This won't throw errors when no records exist

        // Handle the results - no error logging for missing table or empty results
        if (data && data.input_values) {
          console.log('Found saved configuration:', data)
          setSavedConfiguration(data.input_values)
          setFormData(data.input_values)
          setIsConfigurationSaved(true)
        } else {
          console.log('No saved configuration found')
          setSavedConfiguration(null)
          setIsConfigurationSaved(false)
        }
      } catch (error) {
        console.log('Error loading saved configuration:', error)
        setSavedConfiguration(null)
        setIsConfigurationSaved(false)
      } finally {
        setLoadingConfiguration(false)
        setConfigurationLoaded(true) // Mark as loaded so we don't load again
      }
    }
    
    loadSavedConfiguration()
  }, [user?.id, agentId, schemaLoaded]) // REMOVED: inputSchema and dbInputSchema from dependencies

  // Debug logging
  useEffect(() => {
    console.log('Schema state:', {
      agentId,
      propsInputSchemaLength: inputSchema?.length || 0,
      dbInputSchemaLength: dbInputSchema.length,
      schemaLoaded,
      actualSchemaLength: safeInputSchema.length,
      filteredSchemaLength: filteredInputSchema.length,
      configurationLoaded
    })
  }, [agentId, inputSchema, dbInputSchema, schemaLoaded, safeInputSchema, filteredInputSchema, configurationLoaded])

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

  const getPluginStatus = (plugin: string) => {
    if (plugin === 'chatgpt-research') {
      return true
    }
    return connectedPluginKeys.includes(plugin)
  }

  // Simple approach: ALL fields are optional in test mode
  const isFieldRequiredInCurrentContext = (field: Field): boolean => {
    if (executionContext === 'test') {
      return false // No fields are required in test mode
    }
    return field.required || false // Use original required status in configure mode
  }

  // Check if current form state satisfies all required fields (for real-time activation status)
  const isCurrentFormCompleteForActivation = (): boolean => {
    if (executionContext !== 'configure') return true // Only relevant in configure mode
    
    // If no input schema or empty schema, form is always complete
    if (!filteredInputSchema || filteredInputSchema.length === 0) {
      return true
    }
    
    const requiredFields = filteredInputSchema.filter(field => field.required)
    return requiredFields.every(field => {
      const value = formData[field.name]
      return value !== undefined && value !== null && value !== ''
    })
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}
    
    // If no input schema, validation always passes
    if (!filteredInputSchema || filteredInputSchema.length === 0) {
      setValidationErrors({})
      return true
    }
    
    filteredInputSchema.forEach(field => {
      const value = formData[field.name]
      const isRequired = isFieldRequiredInCurrentContext(field)
      
      // Required field validation
      if (isRequired) {
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
    const isRequired = isFieldRequiredInCurrentContext(field)
    
    // Required field validation
    if (isRequired && (value === undefined || value === null || value === '')) {
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
    // If no input schema or empty schema, form is always valid
    if (!filteredInputSchema || filteredInputSchema.length === 0) {
      return true
    }
    
    const requiredFields = filteredInputSchema.filter(field => 
      isFieldRequiredInCurrentContext(field)
    )
    
    return requiredFields.every(field => {
      const value = formData[field.name]
      // Check for valid values - not undefined, null, or empty string
      if (value === undefined || value === null || value === '') return false
      
      // Additional type-specific validation
      if (field.type === 'number') {
        const numValue = Number(value)
        return !isNaN(numValue)
      }
      
      if (field.type === 'email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return emailRegex.test(value)
      }
      
      if (field.type === 'enum' || field.type === 'select') {
        const validOptions = field.enum || field.options || []
        return validOptions.length === 0 || validOptions.includes(value)
      }
      
      return true
    })
  }

  const missingPlugins = safePluginsRequired.filter(
    (key) => !getPluginStatus(key)
  )

  // Different validation logic for test vs configure mode
  const canRun = (() => {
    // Always check for missing plugins
    if (missingPlugins.length > 0) {
      return false
    }
    
    // In configure mode, just check if form is valid (required fields filled)
    if (executionContext === 'configure') {
      return isFormValid()
    }
    
    // In test mode, form validation is more lenient (all fields optional)
    return isFormValid()
  })()

  // FIXED: handleInputChange no longer triggers any database operations
  const handleInputChange = (name: string, value: any) => {
    // ONLY update local state - no database operations
    setFormData((prev) => ({ ...prev, [name]: value }))
    
    // Clear existing error for this field
    if (validationErrors[name]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
    
    // Real-time validation for better UX - NO DATABASE CALLS
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

  const handleRun = async (withVisualizer = false) => {
    // Validate form first
    if (!validateForm()) {
      return false
    }

    try {
      setLoading(true)
      setSendStatus(null)
      setResult(null)
      setExecutionTime(null)

      // Check for missing plugins
      if (missingPlugins.length > 0) {
        setResult({ error: `Missing required plugin(s): ${missingPlugins.join(', ')}` })
        return false
      }

      // ADDED: Handle configure mode - save directly to agent_execution
      if (executionContext === 'configure') {
        try {
          const configId = `config_${agentId}_${user?.id}`
          
          const { error } = await supabase
            .from('agent_configurations')
            .upsert({
              id: configId,
              agent_id: agentId,
              user_id: user?.id,
              input_values: formData,
              status: 'configured',
              created_at: new Date().toISOString() // This will be updated on each upsert
            }, {
              onConflict: 'id'
            })

          if (error) {
            throw new Error(`Failed to save configuration: ${error.message}`)
          }

          // Update local state
          setSavedConfiguration(formData)
          setIsConfigurationSaved(true)
          setSendStatus('✅ Configuration saved successfully! Your agent is now activated and ready to use.')
          // Don't set result for configuration saves - only for actual executions

          // Notify parent component about configuration completion
          if (onExecutionComplete) {
            onExecutionComplete(configId)
          }

          return true
        } catch (configError: any) {
          // Don't set result for configuration errors either - use sendStatus
          setSendStatus(`❌ Failed to save configuration: ${configError.message}`)
          return false
        }
      }

      // Handle visualizer mode (streaming execution) - only in test mode
      if (withVisualizer && executionContext === 'test') {
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
        return true
      }

      // Handle regular execution via AgentKit (unified execution path)
      const startTime = Date.now()

      const requestBody = {
        agent_id: agentId,
        input_variables: executionContext === 'test' ? formData : undefined, // Only send UI values in test mode
        use_agentkit: true, // Use OpenAI AgentKit for consistent execution
        execution_type: executionContext === 'test' ? 'test' : 'run' // Distinguish test vs configured run
      }

      console.log('Sending request to run-agent (AgentKit):', {
        agentId,
        executionContext,
        requestBody
      })

      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Execution failed: ${response.statusText} - ${errorText}`)
      }

      const res = await response.json()
      const endTime = Date.now()
      setExecutionTime(endTime - startTime)

      console.log('AgentKit response:', res)

      // Handle AgentKit execution results
      if (res.success) {
        // Build result object compatible with existing sandbox UI
        const result = {
          message: res.message,
          agentkit: true,
          data: res.data,
          send_status: res.success ? '✅ Agent execution completed successfully' : '❌ Execution failed'
        }

        setResult(result)

        // Extract and update memory stats if available
        if (res.data?.memoryStats) {
          setExecutionMetrics(prev => ({
            ...prev,
            memoriesLoaded: res.data.memoryStats.memoriesLoaded || 0,
            memoryTokenCount: res.data.memoryStats.tokenCount || 0
          }))
        }

        // Set appropriate success message based on output type
        const hasEmailOutput = safeOutputSchema.some(f =>
          f.type === 'EmailDraft' || f.name.toLowerCase().includes('email')
        )
        const hasReportOutput = safeOutputSchema.some(f =>
          f.type === 'SummaryBlock' || f.name.toLowerCase().includes('report')
        )

        if (hasEmailOutput) {
          setSendStatus('✅ Email draft generated successfully')
        } else if (hasReportOutput) {
          setSendStatus('✅ Report generated successfully')
        } else {
          setSendStatus('✅ Agent execution completed successfully')
        }

        // Notify parent component about execution completion
        if (onExecutionComplete) {
          onExecutionComplete(res.data?.agent_id || agentId)
        }

        return true
      } else {
        // Handle execution failure
        setResult({ error: res.error || 'Execution failed' })
        setSendStatus(`❌ Execution failed: ${res.error || 'Unknown error'}`)
        return false
      }

    } catch (err: any) {
      console.error('handleRun error:', err)
      setResult({ error: err.message })
      setSendStatus(`❌ Execution failed: ${err.message}`)
      return false
    } finally {
      setLoading(false)
      setIsLiveExecution(false)
    }
  }

  // Simplified handleSaveConfiguration that just calls handleRun in configure mode
  const handleSaveConfiguration = async () => {
    return await handleRun(false)
  }

  const handleDownloadPDF = () => {
    if (result && safeOutputSchema.length > 0) {
      generatePDF(result, safeOutputSchema)
    }
  }

  const handleSendEmail = async () => {
    if (result && result.to && result.subject && result.body) {
      try {
        await sendEmailDraft({
          userId: user?.id!,
          to: result.to,
          subject: result.subject,
          body: result.body
        })
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
      handleInputChange(name, base64) // This only updates local state now
    }
    reader.readAsDataURL(file)
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
  }

  const toggleSection = (section: keyof ExpandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  return {
    // State
    formData,
    result,
    loading,
    connectedPluginKeys,
    sendStatus,
    executionTime,
    validationErrors,
    executionContext,
    showVisualizer,
    showAdvanced,
    expandedSections,
    executionLogs,
    dynamicPhases,
    executionMetrics,
    isLiveExecution,
    currentExecutionId,
    
    // Configuration state
    savedConfiguration,
    isConfigurationSaved,
    
    // Loading states
    loadingConfiguration,
    loadingSchema,
    schemaLoaded,
    
    // Schema debugging
    dbInputSchema,
    actualInputSchema,
    
    // Computed values
    safeInputSchema,
    safeOutputSchema,
    safePluginsRequired,
    filteredInputSchema,
    missingPlugins,
    canRun,
    
    // Handlers
    setExecutionContext,
    setShowVisualizer,
    setShowAdvanced,
    toggleSection,
    handleInputChange,
    handleRun,
    handleSaveConfiguration,
    handleDownloadPDF,
    handleSendEmail,
    handleFileUpload,
    formatDuration,
    getPluginStatus,
    isFieldRequiredInCurrentContext,
    validateForm,
    isFormValid,
    isCurrentFormCompleteForActivation,
    loadInputSchemaFromDB, // Expose for manual debugging
    formatScheduleDisplay, // Export for use in UI components
    parseCronToHuman // Export for use in UI components
  }
}