// Agent Library Item Interface
export interface AgentLibraryItem {
  id: string
  name: string
  description: string
  category: string
  inputs?: any[]
  outputs?: any[]
  usageCount?: number
  rating?: number
  requiredPlugins?: string[]
  businessValue?: string
  configurable?: boolean
}

// Plugin Interface
export interface Plugin {
  id: string
  name: string
  icon: any
  category: string
  description: string
  status?: string
  testEndpoint?: string
  authUrl?: string
}

// Agent Template Interface
export interface AgentTemplate {
  id: string
  name: string
  description: string
  category: string
  inputs: any[]
  outputs: any[]
  requiredPlugins: string[]
  businessValue: string
  configurable: boolean
}

// Agent Templates Collection
export interface AgentTemplates {
  emailAgents: AgentTemplate[]
  documentAgents: AgentTemplate[]
  crmAgents: AgentTemplate[]
}