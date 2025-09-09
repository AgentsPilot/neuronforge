// lib/workflow/stepParameterBuilder.ts

export interface WorkflowStep {
  id: number
  phase: 'input' | 'process' | 'output'
  action: string
  pluginKey: string
}

export interface InputField {
  name: string
  type: string
}

export function buildStepParameters(
  step: WorkflowStep,
  inputVariables: Record<string, any>,
  executionContext: Record<string, any>,
  inputSchema: InputField[]
): Record<string, any> {
  
  const parameters: Record<string, any> = {}
  
  // Phase-specific parameter building
  switch (step.phase) {
    case 'input':
      return filterParametersForInputPhase(inputVariables, step.pluginKey, inputSchema)
      
    case 'process':
      const inputData = findDataInContext(executionContext, 'input')
      if (inputData) {
        parameters.inputData = inputData
        parameters.sourceData = inputData
        
        // Dynamic mode detection based on action keywords
        parameters.processingMode = step.action
        parameters.workflowTask = step.action
        
        if (step.action.toLowerCase().includes('summarize')) {
          parameters.mode = 'summarize'
          parameters.task = 'summarize_content'
        }
        
        if (step.action.toLowerCase().includes('analyze')) {
          parameters.mode = 'analyze'
          parameters.task = 'analyze_content'
        }
        
        if (step.action.toLowerCase().includes('research')) {
          parameters.mode = 'research'
          parameters.task = 'research_content'
        }
      }
      
      Object.assign(parameters, filterParametersForProcessPhase(inputVariables, step.pluginKey, inputSchema))
      break
      
    case 'output':
      const processedData = findDataInContext(executionContext, 'process')
      if (processedData) {
        parameters.contentToSave = processedData
        parameters.outputData = processedData
      }
      
      Object.assign(parameters, filterParametersForOutputPhase(inputVariables, step.pluginKey, inputSchema))
      break
  }
  
  // Add workflow metadata
  parameters._workflowContext = {
    stepId: step.id,
    phase: step.phase,
    action: step.action,
    pluginKey: step.pluginKey,
    hasInputData: !!findDataInContext(executionContext, 'input'),
    hasProcessedData: !!findDataInContext(executionContext, 'process')
  }
  
  return parameters
}

function filterParametersForInputPhase(
  inputVariables: Record<string, any>,
  pluginKey: string,
  inputSchema: InputField[]
): Record<string, any> {
  
  const filtered: Record<string, any> = {}
  
  inputSchema.forEach(field => {
    const fieldName = field.name.toLowerCase()
    const value = inputVariables[field.name]
    
    if (value !== undefined) {
      // Include field if it's NOT an output parameter
      if (!fieldName.includes('folder') && 
          !fieldName.includes('path') && 
          !fieldName.includes('destination') &&
          !fieldName.includes('output')) {
        filtered[field.name] = value
      }
    }
  })
  
  return filtered
}

function filterParametersForProcessPhase(
  inputVariables: Record<string, any>,
  pluginKey: string,
  inputSchema: InputField[]
): Record<string, any> {
  return filterParametersForInputPhase(inputVariables, pluginKey, inputSchema)
}

function filterParametersForOutputPhase(
  inputVariables: Record<string, any>,
  pluginKey: string,
  inputSchema: InputField[]
): Record<string, any> {
  
  const filtered: Record<string, any> = {}
  
  inputSchema.forEach(field => {
    const fieldName = field.name.toLowerCase()
    const value = inputVariables[field.name]
    
    if (value !== undefined) {
      // Include field if it IS an output parameter or general config
      if (fieldName.includes('folder') || 
          fieldName.includes('path') || 
          fieldName.includes('destination') ||
          fieldName.includes('output') ||
          fieldName.includes('account') ||
          fieldName.includes('workspace')) {
        filtered[field.name] = value
      }
    }
  })
  
  return filtered
}

export function findDataInContext(context: Record<string, any>, phaseType: 'input' | 'process'): any {
  for (const [key, value] of Object.entries(context)) {
    if (value && typeof value === 'object') {
      
      if (phaseType === 'input') {
        // Look for input-like data structures
        if (value.emails || value.emailsReturned || value.documents || value.data || value.files) {
          return value
        }
      }
      
      if (phaseType === 'process') {
        // Look for processed data structures
        if (value.summary || value.analysis || value.result || value.processed || value.research) {
          return value
        }
      }
    }
  }
  
  return null
}