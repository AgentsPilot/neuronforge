import { Phase } from '../types/workflow'

// Phase Configuration
export interface PhaseConfig {
  id: Phase
  name: string
  description: string
  icon?: string
}

export const phases: PhaseConfig[] = [
  { id: 'build', name: 'Build Workflow', description: 'Assign agents to steps', icon: '🔨' },
  { id: 'connect', name: 'Connect Data', description: 'Link inputs and outputs', icon: '🔗' },
  { id: 'configure', name: 'Configure Integrations', description: 'Set up plugins and rules', icon: '⚙️' },
  { id: 'test', name: 'Test & Validate', description: 'Test your workflow', icon: '🧪' }
]