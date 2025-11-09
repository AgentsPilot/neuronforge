import { availablePlugins } from '../../components/orchestration-NOT-USED/constants/plugins'
import { ConfigurationField } from '../../components/orchestration-NOT-USED/types/configuration'
import { WorkflowStep } from '../../components/orchestration-NOT-USED/types/workflow'

/**
 * Generate configuration fields for an agent
 */
export const generateConfigurationFields = (agent: any, step: WorkflowStep): ConfigurationField[] => {
  const fields: ConfigurationField[] = []
  const agentName = agent.name.toLowerCase()

  // Connection fields for external integrations
  if (agent.requiredPlugins?.length > 0) {
    agent.requiredPlugins.forEach((pluginId: string) => {
      const plugin = availablePlugins.find(p => p.id === pluginId)
      if (plugin) {
        if (plugin.category === 'Email') {
          fields.push({
            id: `${pluginId}_account`,
            type: 'email',
            label: `${plugin.name} Account`,
            placeholder: 'your-email@domain.com',
            required: true,
            description: `The ${plugin.name} account to use for this step`,
            testable: true
          })
        } else if (plugin.category === 'CRM') {
          fields.push({
            id: `${pluginId}_url`,
            type: 'url',
            label: `${plugin.name} Instance URL`,
            placeholder: `https://yourcompany.${pluginId}.com`,
            required: true,
            description: `Your ${plugin.name} instance URL`,
            testable: true
          })
        }
      }
    })
  }

  // Purpose-based configuration
  if (agentName.includes('scan') || agentName.includes('monitor')) {
    fields.push({
      id: 'search_criteria',
      type: 'text',
      label: 'What should I look for?',
      placeholder: 'keywords, terms, patterns to search for',
      required: true,
      description: 'Describe what this agent should search for',
      testable: true
    })
  }

  if (agentName.includes('extract') || agentName.includes('parse')) {
    fields.push({
      id: 'extraction_prompt',
      type: 'textarea',
      label: 'What information should I extract?',
      placeholder: 'Describe in plain English what data you need extracted...',
      required: true,
      description: 'Tell the AI what specific information to look for and extract',
      testable: true
    })
  }

  if (agentName.includes('send') || agentName.includes('notify')) {
    fields.push({
      id: 'recipients',
      type: 'textarea',
      label: 'Who should receive notifications?',
      placeholder: 'email1@company.com, email2@company.com',
      required: true,
      description: 'Email addresses separated by commas',
      testable: true
    })
  }

  // Generic error handling
  fields.push({
    id: 'error_handling',
    type: 'select',
    label: 'If something goes wrong',
    options: ['Stop and notify me', 'Skip and continue', 'Retry 3 times'],
    required: false,
    description: 'How should errors be handled?',
    testable: false
  })

  return fields
}

/**
 * Validate configuration data
 */
export const validateConfiguration = (fields: ConfigurationField[], data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  fields.forEach(field => {
    if (field.required && (!data[field.id] || data[field.id].toString().trim() === '')) {
      errors.push(`${field.label} is required`)
    }
    
    if (field.type === 'email' && data[field.id]) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(data[field.id])) {
        errors.push(`${field.label} must be a valid email address`)
      }
    }
    
    if (field.type === 'url' && data[field.id]) {
      try {
        new URL(data[field.id])
      } catch {
        errors.push(`${field.label} must be a valid URL`)
      }
    }
  })
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

/**
 * Get default configuration values
 */
export const getDefaultConfiguration = (fields: ConfigurationField[]): any => {
  const defaults: any = {}
  
  fields.forEach(field => {
    switch (field.type) {
      case 'select':
        defaults[field.id] = field.options?.[0] || ''
        break
      case 'checkbox':
        defaults[field.id] = false
        break
      default:
        defaults[field.id] = ''
    }
  })
  
  return defaults
}

/**
 * Check if configuration is complete
 */
export const isConfigurationComplete = (fields: ConfigurationField[], data: any): boolean => {
  const requiredFields = fields.filter(field => field.required)
  return requiredFields.every(field => 
    data[field.id] && data[field.id].toString().trim() !== ''
  )
}