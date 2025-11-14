// Test Result Types
export interface TestResult {
  stepId: string
  stepName: string
  status: 'pending' | 'running' | 'success' | 'error'
  message: string
  duration?: number
  output?: any
  error?: string
  timestamp: Date
}

// Workflow Step Interface
export interface WorkflowStep {
  id: number
  title?: string
  description?: string
  inputs?: any[]
  outputs?: any[]
  selectedAgent?: any
  isConfigured?: boolean
  configurationComplete?: boolean
  configurationData?: any
  suggestedAgent?: string
  testResults?: TestResult[]
  customInputs?: any[]
  customOutputs?: any[]
}

// Workflow Data Interface
export interface WorkflowData {
  description?: string
  finalSteps?: WorkflowStep[]
  generatedSteps?: WorkflowStep[]
}

// Phase Types
export type Phase = 'build' | 'connect' | 'configure' | 'test'

// Connection Interface
export interface Connection {
  id: string
  fromStep: number
  toStep: number
  fromIO: any
  toInput?: any
  type: 'data_flow'
}

// Workflow State Interface
export interface WorkflowState {
  steps: WorkflowStep[]
  connections: Connection[]
  currentPhase: Phase
  selectedStep: number | null
}