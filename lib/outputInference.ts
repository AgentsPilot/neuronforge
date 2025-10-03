// lib/outputInference.ts
import { pluginRegistry, getPluginDefinition } from './plugins/pluginRegistry'

export interface OutputSchema {
  name: string
  type: string
  description: string
  category: 'human-facing' | 'machine-facing'
  examples?: string[]
}

export interface OutputInference {
  outputs: OutputSchema[]
  confidence: number
  reasoning: string
}

export function enhanceOutputInference(
  prompt: string,
  clarificationAnswers: Record<string, any>,
  connectedPluginKeys: string[],
  workflowSteps?: any[]
): OutputInference {
  try {
    console.log('🎯 Starting registry-driven output inference...')
    
    // Use plugin registry to dynamically generate outputs
    const outputs = generateOutputsFromRegistry(prompt, workflowSteps, connectedPluginKeys)
    
    const confidence = calculateConfidence(workflowSteps, connectedPluginKeys, outputs)
    
    const reasoning = `Generated ${outputs.length} outputs using plugin registry analysis of ${workflowSteps?.length || 0} workflow steps across ${new Set(workflowSteps?.map(s => s.plugin)).size || 0} plugins`
    
    console.log('✅ Registry-driven output inference completed:', {
      outputCount: outputs.length,
      confidence,
      humanFacing: outputs.filter(o => o.category === 'human-facing').length,
      machineFacing: outputs.filter(o => o.category === 'machine-facing').length
    })
    
    return {
      outputs,
      confidence,
      reasoning
    }
    
  } catch (error) {
    console.error('❌ Registry-driven output inference failed:', error)
    
    // Fallback to simple but improved outputs
    return {
      outputs: [
        {
          name: 'Workflow Results',
          type: 'object',
          description: 'Complete results from your automated workflow including all processed data and actions taken',
          category: 'human-facing',
          examples: ['Processed data', 'Generated content', 'Completed actions']
        },
        {
          name: 'Execution Status',
          type: 'string',
          description: 'Success or failure status with detailed information about any issues encountered',
          category: 'human-facing',
          examples: ['Success with details', 'Error with explanation', 'Partial completion with notes']
        }
      ],
      confidence: 0.6,
      reasoning: 'Using improved fallback outputs due to analysis error'
    }
  }
}

function generateOutputsFromRegistry(
  prompt: string, 
  workflowSteps: any[], 
  connectedPluginKeys: string[]
): OutputSchema[] {
  const outputs: OutputSchema[] = []
  
  if (!workflowSteps || workflowSteps.length === 0) {
    return generateFallbackOutputs(prompt)
  }
  
  // Group workflow steps by plugin
  const pluginSteps = groupStepsByPlugin(workflowSteps)
  
  // Generate outputs for each plugin based on registry metadata
  for (const [pluginKey, steps] of Object.entries(pluginSteps)) {
    const pluginOutputs = generatePluginOutputs(pluginKey, steps, prompt)
    outputs.push(...pluginOutputs)
  }
  
  // NEW: Detect and add document generation outputs
  const documentOutputs = detectDocumentOutputs(prompt, workflowSteps)
  outputs.push(...documentOutputs)
  
  // Always add execution status
  outputs.push({
    name: 'Execution Summary',
    type: 'string',
    description: 'Complete status of your automation with success/failure details and any important notes',
    category: 'human-facing',
    examples: [
      'Successfully completed all tasks',
      'Completed with 1 warning', 
      'Failed at step 3 - check configuration'
    ]
  })
  
  // Add workflow metadata for complex automations
  if (Object.keys(pluginSteps).length > 1 || workflowSteps.length > 3) {
    outputs.push({
      name: 'Process Metadata',
      type: 'object',
      description: 'Technical details about execution including timing, counts, and performance data',
      category: 'machine-facing'
    })
  }
  
  return outputs
}

// NEW: Function to detect document creation from prompt
function detectDocumentOutputs(fullPrompt: string, workflowSteps: any[]): OutputSchema[] {
  const documentOutputs: OutputSchema[] = []
  const promptLower = fullPrompt.toLowerCase()
  
  // Document creation patterns with their corresponding formats
  const documentPatterns = [
    { 
      pattern: /create.*pdf|generate.*pdf|pdf.*document|save.*pdf/i, 
      format: 'PDF',
      type: 'PDFDocument',
      mimeType: 'application/pdf'
    },
    { 
      pattern: /create.*csv|generate.*csv|csv.*file|export.*csv/i, 
      format: 'CSV', 
      type: 'CSVFile',
      mimeType: 'text/csv'
    },
    { 
      pattern: /create.*word|generate.*docx|word.*document|create.*doc\b/i, 
      format: 'Word Document', 
      type: 'WordDocument',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    },
    { 
      pattern: /create.*excel|generate.*xlsx|excel.*file|spreadsheet/i, 
      format: 'Excel Spreadsheet', 
      type: 'ExcelFile',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    },
    { 
      pattern: /create.*text|generate.*txt|text.*file|\.txt/i, 
      format: 'Text File', 
      type: 'TextFile',
      mimeType: 'text/plain'
    },
    { 
      pattern: /create.*json|generate.*json|json.*file/i, 
      format: 'JSON File', 
      type: 'JSONFile',
      mimeType: 'application/json'
    },
    { 
      pattern: /create.*html|generate.*html|html.*file|web.*page/i, 
      format: 'HTML File', 
      type: 'HTMLFile',
      mimeType: 'text/html'
    },
    { 
      pattern: /create.*document|generate.*document|create.*file(?!\s+system)/i, 
      format: 'Document', 
      type: 'GeneratedDocument',
      mimeType: 'application/octet-stream'
    }
  ]
  
  // Check for document creation patterns
  for (const { pattern, format, type, mimeType } of documentPatterns) {
    if (pattern.test(fullPrompt)) {
      // Determine what content will be in the document based on workflow
      const contentDescription = inferDocumentContent(fullPrompt, workflowSteps)
      
      documentOutputs.push({
        name: `Generated ${format}`,
        type: type,
        description: `AI-generated ${format.toLowerCase()} containing ${contentDescription}`,
        category: 'human-facing',
        examples: [
          `${format} file with formatted content`,
          'Download link for the generated file',
          'File metadata (size, creation date, etc.)',
          `Formatted ${contentDescription} in ${format} format`
        ]
      })
      
      // Only add the first matching pattern to avoid duplicates
      break
    }
  }
  
  return documentOutputs
}

// NEW: Function to infer what content will be in the document
function inferDocumentContent(prompt: string, workflowSteps: any[]): string {
  const promptLower = prompt.toLowerCase()
  
  // Look for content clues in the prompt
  if (promptLower.includes('email') && promptLower.includes('summar')) {
    return 'email summaries and analysis'
  } else if (promptLower.includes('report')) {
    return 'comprehensive report data'
  } else if (promptLower.includes('analysis') || promptLower.includes('insights')) {
    return 'analysis results and insights'
  } else if (promptLower.includes('data') || promptLower.includes('information')) {
    return 'processed data and information'
  } else if (promptLower.includes('list') || promptLower.includes('extract')) {
    return 'extracted information and lists'
  } else {
    // Infer from workflow steps
    const hasEmailStep = workflowSteps?.some(step => 
      step.plugin === 'google-mail' || step.operation?.toLowerCase().includes('email')
    )
    const hasSummarizeStep = workflowSteps?.some(step => 
      step.plugin_action === 'summarize' || step.operation?.toLowerCase().includes('summar')
    )
    
    if (hasEmailStep && hasSummarizeStep) {
      return 'summarized email content'
    } else if (hasEmailStep) {
      return 'email data and information'
    } else if (hasSummarizeStep) {
      return 'summarized content'
    } else {
      return 'processed workflow results'
    }
  }
}

function groupStepsByPlugin(workflowSteps: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {}
  
  for (const step of workflowSteps) {
    if (!step.plugin) continue
    
    if (!grouped[step.plugin]) {
      grouped[step.plugin] = []
    }
    grouped[step.plugin].push(step)
  }
  
  return grouped
}

function generatePluginOutputs(pluginKey: string, steps: any[], prompt: string): OutputSchema[] {
  const pluginDef = getPluginDefinition(pluginKey)
  if (!pluginDef) {
    return []
  }
  
  // Get only the actual plugin actions being used
  const usedActions = [...new Set(steps
    .filter(step => step.plugin_action)
    .map(step => step.plugin_action)
  )]
  
  if (usedActions.length === 0) {
    return []
  }
  
  const outputs: OutputSchema[] = []
  
  // Generate one consolidated output per plugin, not per capability
  const pluginOutput = generateConsolidatedPluginOutput(pluginDef, usedActions, prompt)
  if (pluginOutput) {
    outputs.push(pluginOutput)
  }
  
  return outputs
}

function generateConsolidatedPluginOutput(pluginDef: any, usedActions: string[], prompt: string): OutputSchema | null {
  const primaryAction = usedActions[0] // Use first action for primary output type
  const outputTemplate = pluginDef.outputTemplates?.[primaryAction]
  
  if (outputTemplate) {
    // Use registry-defined output template
    return {
      name: generateOutputName(pluginDef.displayName || pluginDef.label, primaryAction, prompt),
      type: outputTemplate.type,
      description: generateUserFriendlyDescription(outputTemplate.description, primaryAction, pluginDef.label),
      category: 'human-facing',
      examples: generateExamplesFromSchema(outputTemplate.schema)
    }
  } else {
    // Generate consolidated output based on all actions used
    const actionNames = usedActions.map(action => action.replace(/_/g, ' ')).join(', ')
    
    return {
      name: generateOutputName(pluginDef.displayName || pluginDef.label, primaryAction, prompt),
      type: inferTypeFromCapability(primaryAction),
      description: `Results from ${actionNames} using ${pluginDef.label} - organized and ready for your review`,
      category: 'human-facing',
      examples: [`Processed ${actionNames} data`, `${actionNames} results`, `Completed ${actionNames} task`]
    }
  }
}

function findRelevantCapabilities(capabilities: string[], steps: any[], prompt: string): string[] {
  // ONLY use the specific plugin_action from workflow steps - don't guess
  const relevant = steps
    .filter(step => step.plugin_action && capabilities.includes(step.plugin_action))
    .map(step => step.plugin_action)
  
  // Remove duplicates
  return [...new Set(relevant)]
}

function generateOutputName(pluginName: string, capability: string, prompt: string): string {
  const capWords = capability.replace(/_/g, ' ')
  const lowerPrompt = prompt.toLowerCase()
  
  // Generate contextual names based on prompt content
  if (lowerPrompt.includes('report') || lowerPrompt.includes('summary')) {
    return `${pluginName} Report`
  } else if (lowerPrompt.includes('list') || lowerPrompt.includes('extract')) {
    return `${pluginName} Data`
  } else if (lowerPrompt.includes('analysis') || lowerPrompt.includes('insights')) {
    return `${pluginName} Analysis`
  } else {
    // Use capability-based name
    return `${pluginName} ${capWords.replace(/^\w/, c => c.toUpperCase())}`
  }
}

function generateUserFriendlyDescription(
  templateDescription: string, 
  capability: string, 
  pluginLabel: string
): string {
  // Convert technical descriptions to user-friendly language
  const friendlyDesc = templateDescription
    .replace(/^[A-Z]/, c => c.toLowerCase())
    .replace(/\btechnical\b/gi, '')
    .replace(/\bAPI\b/gi, '')
    .replace(/\bdata structure\b/gi, 'organized information')
    .replace(/\bobject\b/gi, 'information')
    .replace(/\barray\b/gi, 'list')
    
  return `${friendlyDesc.charAt(0).toUpperCase()}${friendlyDesc.slice(1)} from your ${pluginLabel} automation`
}

function generateExamplesFromSchema(schema?: Record<string, any>): string[] {
  if (!schema) return []
  
  const examples: string[] = []
  
  for (const [key, type] of Object.entries(schema)) {
    if (typeof type === 'string') {
      switch (type) {
        case 'string':
          examples.push(`${key.replace(/_/g, ' ')}`);
          break;
        case 'number':
          examples.push(`${key.replace(/_/g, ' ')} count`);
          break;
        case 'array':
          examples.push(`List of ${key.replace(/_/g, ' ')}`);
          break;
        case 'boolean':
          examples.push(`${key.replace(/_/g, ' ')} status`);
          break;
        default:
          examples.push(`${key.replace(/_/g, ' ')} information`);
      }
    }
  }
  
  return examples.slice(0, 3) // Limit to 3 examples
}

function inferTypeFromCapability(capability: string): string {
  if (capability.includes('list') || capability.includes('search') || capability.includes('filter')) {
    return 'array'
  } else if (capability.includes('count') || capability.includes('number')) {
    return 'number'
  } else if (capability.includes('status') || capability.includes('check')) {
    return 'boolean'
  } else {
    return 'object'
  }
}

function generateCapabilityExamples(capability: string): string[] {
  const capWords = capability.replace(/_/g, ' ')
  return [
    `Processed ${capWords} data`,
    `${capWords.charAt(0).toUpperCase()}${capWords.slice(1)} results`,
    `Completed ${capWords} task`
  ]
}

function generateFallbackOutputs(prompt: string): OutputSchema[] {
  return [
    {
      name: 'Automation Results',
      type: 'object',
      description: 'Complete results from your workflow including all processed data and completed actions',
      category: 'human-facing',
      examples: ['Processed information', 'Generated content', 'Updated records']
    },
    {
      name: 'Task Status',
      type: 'string',
      description: 'Success or error status with detailed information about what happened',
      category: 'human-facing',
      examples: ['All tasks completed successfully', 'Error occurred - see details', 'Partially completed with notes']
    }
  ]
}

function calculateConfidence(workflowSteps: any[], connectedPluginKeys: string[], outputs: OutputSchema[]): number {
  let confidence = 0.5 // Base confidence
  
  // Higher confidence with more workflow steps
  if (workflowSteps && workflowSteps.length > 0) {
    confidence += Math.min(workflowSteps.length * 0.1, 0.3)
  }
  
  // Higher confidence with more connected plugins
  if (connectedPluginKeys.length > 0) {
    confidence += Math.min(connectedPluginKeys.length * 0.05, 0.2)
  }
  
  // Cap at 1.0
  return Math.min(confidence, 1.0)
}