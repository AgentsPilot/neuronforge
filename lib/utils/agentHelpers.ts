import { SMART_AGENT_TEMPLATES } from '../../components/orchestration/constants/agentTemplates'
import { AgentLibraryItem } from '../../components/orchestration/types/agents'
import { WorkflowStep } from '../../components/orchestration/types/workflow'

/**
 * Create smart agent library based on workflow description
 */
export const createSmartAgentLibrary = (workflowDescription: string): AgentLibraryItem[] => {
  const description = workflowDescription.toLowerCase()
  
  if (description.includes('email') && description.includes('invoice') && description.includes('crm')) {
    return [...SMART_AGENT_TEMPLATES.emailAgents, ...SMART_AGENT_TEMPLATES.documentAgents, ...SMART_AGENT_TEMPLATES.crmAgents]
  }
  
  return [...SMART_AGENT_TEMPLATES.emailAgents, ...SMART_AGENT_TEMPLATES.documentAgents, ...SMART_AGENT_TEMPLATES.crmAgents]
}

/**
 * Generate AI-generated agents based on workflow steps
 */
export const generateAIAgents = (steps: WorkflowStep[]): AgentLibraryItem[] => {
  return steps.map((step, idx) => {
    const name = step.suggestedAgent?.trim() || `Step ${idx + 1} Agent`
    
    const formattedInputs = (step.inputs || []).map(input => 
      typeof input === 'string' ? 
        { name: input.toLowerCase().replace(/\s+/g, '_'), type: 'data', description: input } :
        input
    )
    
    const formattedOutputs = (step.outputs || []).map(output => 
      typeof output === 'string' ? 
        { name: output.toLowerCase().replace(/\s+/g, '_'), type: 'data', description: output } :
        output
    )
    
    // Determine required plugins based on agent type and step description
    let requiredPlugins: string[] = []
    let businessValue = 'Automate manual work in this step'
    
    const lowerName = name.toLowerCase()
    const lowerDesc = (step.description || '').toLowerCase()
    const lowerTitle = (step.title || '').toLowerCase()
    
    // Email-related agents
    if (lowerName.includes('email') || lowerName.includes('parser') || 
        lowerDesc.includes('email') || lowerTitle.includes('email') ||
        lowerName.includes('extract') && (lowerDesc.includes('inbox') || lowerTitle.includes('inbox'))) {
      requiredPlugins = ['gmail', 'outlook']
      businessValue = 'Never miss invoices in your inbox'
    }
    // Document processing agents  
    else if (lowerName.includes('document') || lowerName.includes('parser') || 
             lowerName.includes('extract') || lowerName.includes('parse') ||
             lowerDesc.includes('invoice') || lowerDesc.includes('document')) {
      requiredPlugins = [] // Pure AI processing, no external plugins needed
      businessValue = 'Extract data 100x faster than manual entry'
    }
    // CRM-related agents
    else if (lowerName.includes('crm') || lowerName.includes('insert') || 
             lowerName.includes('create') || lowerDesc.includes('crm') ||
             lowerTitle.includes('crm')) {
      requiredPlugins = ['salesforce', 'hubspot']
      businessValue = 'Automatically update CRM with 100% accuracy'
    }
    // Summary/reporting agents
    else if (lowerName.includes('summary') || lowerName.includes('summarize') || 
             lowerName.includes('report')) {
      requiredPlugins = ['notion', 'google-drive']
      businessValue = 'Generate professional summaries instantly'
    }
    // Notification/email sending agents
    else if (lowerName.includes('notif') || lowerName.includes('send') || 
             lowerDesc.includes('send') || lowerDesc.includes('notify')) {
      requiredPlugins = ['gmail', 'outlook']
      businessValue = 'Notify teams automatically'
    }
    
    return {
      id: `ai-generated-${idx}`,
      name,
      description: step.description || `AI-generated agent for ${step.title || `Step ${idx + 1}`}`,
      category: 'AI Generated',
      inputs: formattedInputs,
      outputs: formattedOutputs,
      usageCount: 0,
      rating: 4.5,
      requiredPlugins,
      businessValue,
      configurable: true
    }
  })
}

/**
 * Validate agent requirements
 */
export const validateAgent = (agent: AgentLibraryItem): boolean => {
  return !!(agent.name && agent.description && agent.category)
}

/**
 * Get agent by ID from library
 */
export const getAgentById = (agents: AgentLibraryItem[], id: string): AgentLibraryItem | undefined => {
  return agents.find(agent => agent.id === id)
}

/**
 * Filter agents by category
 */
export const filterAgentsByCategory = (agents: AgentLibraryItem[], category: string): AgentLibraryItem[] => {
  return agents.filter(agent => agent.category === category)
}

/**
 * Get agents by required plugins
 */
export const getAgentsByPlugins = (agents: AgentLibraryItem[], pluginIds: string[]): AgentLibraryItem[] => {
  return agents.filter(agent => 
    agent.requiredPlugins?.some(plugin => pluginIds.includes(plugin))
  )
}