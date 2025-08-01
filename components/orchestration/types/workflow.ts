// types/workflow.ts

export type WorkflowPhase = 'describe' | 'build' | 'connect'

export interface WorkflowStep {
  id: number
  title: string
  description: string
  suggestedAgent?: string
  inputs: string[]
  outputs: string[]
  selectedAgent?: AgentLibraryItem
  agentConfig?: any
}

export interface WorkflowData {
  title: string
  description: string
  industry: string
  processDescription: string
  generatedSteps: WorkflowStep[]
  finalSteps: WorkflowStep[]
  triggerType: string
}

export interface AgentLibraryItem {
  id: string
  name: string
  description: string
  category: string
  inputs: string[]
  outputs: string[]
  usageCount: number
  rating: number
}

export interface IndustryTemplate {
  name: string
  icon: string
  processes: string[]
  description: string
}

export interface DataMapping {
  targetField: string
  sourceType: 'previous_step' | 'user_input' | 'static_value'
  sourceStep?: string
  sourceField?: string
  staticValue?: any
}