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

export function useAgentSandbox({
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
  
  // Add loading states
  const [loadingConfiguration, setLoadingConfiguration] = useState(false)
  const [loadingSchema, setLoadingSchema] = useState(false)
  
  // Add actual input schema state (loaded from DB)
  const [dbInputSchema, setDbInputSchema] = useState<Field[]>([])
  const [schemaLoaded, setSchemaLoaded] = useState(false)
  
  // Execution context state - 'test' or 'configure'
  const [executionContext, setExecutionContext] = useState<'test' | 'configure'>('test')
  
  // Configuration state
  const [savedConfiguration, setSavedConfiguration] = useState<Record<string, any> | null>(null)
  const [isConfigurationSaved, setIsConfigurationSaved] = useState(false)
  
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
    // If props schema exists and is valid, use it
    if (Array.isArray(inputSchema) && inputSchema.length > 0) {
      console.log('Using props inputSchema:', inputSchema.length, 'fields')
      return inputSchema
    }
    // Otherwise use DB schema if available
    if (schemaLoaded && dbInputSchema.length > 0) {
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
        console.error('Error loading agent schema:', agentError)
      } else if (agentData) {
        console.log('Agent data loaded:', agentData)
        
        // Try input_schema first
        if (agentData.input_schema && Array.isArray(agentData.input_schema)) {
          console.log('Found input_schema in agent data')
          setDbInputSchema(agentData.input_schema)
          setSchemaLoaded(true)
          return
        }
        
        // Try workflow_config.inputSchema as fallback
        if (agentData.workflow_config?.inputSchema && Array.isArray(agentData.workflow_config.inputSchema)) {
          console.log('Found inputSchema in workflow_config')
          setDbInputSchema(agentData.workflow_config.inputSchema)
          setSchemaLoaded(true)
          return
        }
      }

      // If no schema found in agents table, try agent_executions for historical data
      const { data: executionData, error: executionError } = await supabase
        .from('agent_executions')
        .select('input_schema')
        .eq('agent_id', agentId)
        .not('input_schema', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (executionData && executionData.input_schema) {
        console.log('Found input_schema in agent_executions')
        setDbInputSchema(executionData.input_schema)
        setSchemaLoaded(true)
      } else {
        console.log('No schema found in database, using props schema')
        setSchemaLoaded(true) // Mark as loaded even if we didn't find anything
      }

    } catch (error) {
      console.error('Error loading input schema:', error)
      setSchemaLoaded(true) // Mark as loaded to prevent infinite loading
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

  // Load schema on mount or when agentId changes - but only if no props schema
  useEffect(() => {
    // Only load from DB if we don't have a props schema or if it's empty
    if (agentId && (!inputSchema || !Array.isArray(inputSchema) || inputSchema.length === 0)) {
      console.log('Loading schema from DB because props schema is missing/empty')
      loadInputSchemaFromDB()
    } else {
      console.log('Using props schema, skipping DB load')
      setSchemaLoaded(true) // Mark as "loaded" even though we're using props
    }
  }, [agentId, inputSchema])

  // Load saved configuration - works with either props schema or DB schema
  useEffect(() => {
    const loadSavedConfiguration = async () => {
      if (!user?.id || !agentId) return
      
      // Check if we have any schema available (props or DB)
      const hasSchema = (inputSchema && Array.isArray(inputSchema) && inputSchema.length > 0) || 
                       (schemaLoaded && dbInputSchema.length > 0)
      
      if (!hasSchema) return // Wait until we have schema from somewhere
      
      setLoadingConfiguration(true)
      try {
        console.log('Loading saved configuration for agent:', agentId)
        
        const { data, error } = await supabase
          .from('agent_executions')
          .select('input_values, status')
          .eq('agent_id', agentId)
          .eq('user_id', user.id)
          .in('status', ['completed', 'configured']) // Look for both statuses
          .order('created_at', { ascending: false })

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading configuration:', error)
          return
        }

        if (data && data.length > 0) {
          // Look for the most recent configuration save (marked with _configuration_save: true)
          const configSave = data.find(record => 
            record.input_values && 
            record.input_values._configuration_save === true
          )

          if (configSave && configSave.input_values) {
            console.log('Found saved configuration:', configSave)
            const cleanValues = { ...configSave.input_values }
            // Remove internal markers
            delete cleanValues._configuration_save
            delete cleanValues._saved_at
            
            setSavedConfiguration(cleanValues)
            setFormData(cleanValues)
            setIsConfigurationSaved(true)
          } else {
            console.log('No configuration save found')
          }
        } else {
          console.log('No records found')
        }
      } catch (error) {
        console.log('No saved configuration found:', error)
      } finally {
        setLoadingConfiguration(false)
      }
    }
    
    loadSavedConfiguration()
  }, [user?.id, agentId, inputSchema, schemaLoaded, dbInputSchema])

  // Debug logging
  useEffect(() => {
    console.log('Schema state:', {
      agentId,
      propsInputSchemaLength: inputSchema?.length || 0,
      dbInputSchemaLength: dbInputSchema.length,
      schemaLoaded,
      actualSchemaLength: safeInputSchema.length,
      filteredSchemaLength: filteredInputSchema.length
    })
  }, [agentId, inputSchema, dbInputSchema, schemaLoaded, safeInputSchema, filteredInputSchema])

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
      status: 'pending' as const, // Fixed: changed back to 'pending'
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
    
    const requiredFields = filteredInputSchema.filter(field => field.required)
    return requiredFields.every(field => {
      const value = formData[field.name]
      return value !== undefined && value !== null && value !== ''
    })
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}
    
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

  const handleSaveConfiguration = async () => {
    if (!validateForm()) {
      return false
    }

    if (missingPlugins.length > 0) {
      setResult({ error: `Missing required plugin(s): ${missingPlugins.join(', ')}` })
      return false
    }

    if (!user?.id) {
      setResult({ error: 'User not authenticated' })
      return false
    }

    try {
      setLoading(true)
      setSendStatus(null)
      setResult(null)

      // Create a unique execution ID for this configuration save
      const executionId = `config_${agentId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Add a special marker to identify this as a configuration save
      const configurationData = {
        ...formData,
        _configuration_save: true,
        _saved_at: new Date().toISOString()
      }
      
      const { data, error } = await supabase
        .from('agent_executions')
        .insert({
          id: executionId,
          agent_id: agentId,
          user_id: user.id,
          status: 'configured',
          input_values: configurationData,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) {
        throw new Error(`Failed to save configuration: ${error.message}`)
      }

      setSavedConfiguration(formData)
      setIsConfigurationSaved(true)
      setSendStatus('Configuration saved successfully! Your agent is now ready to be activated.')
      setResult({ message: 'Agent configuration saved successfully' })
      
      // Notify parent component about configuration completion if callback exists
      if (onExecutionComplete) {
        onExecutionComplete(executionId)
      }
      
      return true

    } catch (err: any) {
      setResult({ error: err.message })
      setSendStatus('Failed to save configuration')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async (withVisualizer = false) => {
    // If in configure mode, save configuration instead of running
    if (executionContext === 'configure') {
      return await handleSaveConfiguration()
    }

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
    loadInputSchemaFromDB // Expose for manual debugging
  }
}