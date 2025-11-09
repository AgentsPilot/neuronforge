import { useState, useMemo, useCallback } from 'react'
import { WorkflowData, WorkflowStep, Connection, Phase } from '../types/workflow'
import { AgentLibraryItem } from '../types/agents'
import { StepNavigation } from '../components/workflow/StepNavigation'
import { BuildWorkflowPhase } from './BuildWorkflowPhase'
import { ConnectDataPhase } from './ConnectDataPhase'
import { ConfigureIntegrationsPhase } from './ConfigureIntegrationsPhase'
import { TestValidatePhase } from './TestValidatePhase'
import { createSmartAgentLibrary, generateAIAgents } from '../../../lib/utils/agentHelpers'
import { createConnection, connectionExists, updateConnectionIndices } from '../../../lib/utils/connectionHelpers'
import { WorkflowService } from '../../../lib/services/workflowService'

interface AgentBuildingPhaseProps {
  data?: WorkflowData
  onUpdate?: (updates: Partial<WorkflowData>) => void
  onNext?: () => void
  onBack?: () => void
}

export default function AgentBuildingPhase({
  data = { description: 'Sample workflow for processing emails and invoices' },
  onUpdate = () => {},
  onNext = () => {},
  onBack = () => {},
}: AgentBuildingPhaseProps) {
  // Initialize workflow steps - FIXED: Removed hardcoded fallback steps
  const [steps, setSteps] = useState<WorkflowStep[]>(() => {
    // Try to load from database first, then from legacy formats, then empty array
    const initialSteps = data.finalSteps || data.generatedSteps || data.steps || []
    
    return initialSteps.map((step) => ({
      ...step,
      selectedAgent: step.selectedAgent || null,
      isConfigured: step.isConfigured || false,
      configurationComplete: step.configurationComplete || false,
      configurationData: step.configurationData || {},
      customInputs: step.customInputs || [],
      customOutputs: step.customOutputs || []
    }))
  })
  
  const [connections, setConnections] = useState<Connection[]>([])
  const [currentPhase, setCurrentPhase] = useState<Phase>('build')
  const [selectedStep, setSelectedStep] = useState<number | null>(null)

  // Get smart agent library
  const smartAgentLibrary = useMemo(() => {
    const workflowDesc = data?.description || ''
    return createSmartAgentLibrary(workflowDesc)
  }, [data?.description])

  // Get AI-generated agents
  const aiGeneratedAgents = useMemo(() => {
    return generateAIAgents(steps)
  }, [steps])

  // Persist changes
  const persistSteps = useCallback((newSteps: WorkflowStep[]) => {
    setSteps(newSteps)
    onUpdate({ finalSteps: newSteps })
  }, [onUpdate])

  // Step management functions
  const updateStep = useCallback((index: number, updates: Partial<WorkflowStep>) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], ...updates }
    persistSteps(newSteps)
  }, [steps, persistSteps])

  const addStep = useCallback(() => {
    const newStep: WorkflowStep = {
      id: steps.length + 1,
      title: `Step ${steps.length + 1}`,
      description: '',
      inputs: [],
      outputs: [],
      selectedAgent: null,
      isConfigured: false,
      configurationComplete: false,
      configurationData: {},
      customInputs: [],
      customOutputs: []
    }
    persistSteps([...steps, newStep])
  }, [steps, persistSteps])

  const removeStep = useCallback((index: number) => {
    if (steps.length <= 1) return
    
    // Remove connections for this step and update indices
    const updatedConnections = updateConnectionIndices(connections, index)
    setConnections(updatedConnections)
    
    // Remove the step and reindex
    const newSteps = steps.filter((_, i) => i !== index)
    const reIndexedSteps = newSteps.map((step, i) => ({ ...step, id: i + 1 }))
    persistSteps(reIndexedSteps)
    
    // Update selected step
    if (selectedStep === index) setSelectedStep(null)
    else if (selectedStep !== null && selectedStep > index) setSelectedStep(selectedStep - 1)
  }, [steps, selectedStep, connections, persistSteps])

  const testStep = useCallback((index: number) => {
    console.log(`Testing step ${index + 1}:`, steps[index])
    // Test functionality is handled in TestValidatePhase
  }, [steps])

  // Agent assignment handler
  const handleAgentAssignment = useCallback((agent: AgentLibraryItem, stepIndex?: number) => {
    if (typeof stepIndex === 'number') {
      updateStep(stepIndex, {
        selectedAgent: agent,
        isConfigured: false,
        configurationComplete: false
      })
    }
  }, [updateStep])

  // Connection management
  const handleConnectionsChange = useCallback((newConnections: Connection[]) => {
    setConnections(newConnections)
    onUpdate({ connections: newConnections })
  }, [onUpdate])

  const handleConnectionUpdate = useCallback((connectionData: any) => {
    const { fromStep, toStep, fromIO, toInput } = connectionData
    
    // Validate connection
    if (fromStep === toStep) return
    if (toStep <= fromStep) return
    if (connectionExists(connections, fromStep, toStep, fromIO)) return
    
    // Create new connection
    const newConnection = createConnection(fromStep, toStep, fromIO, toInput)
    setConnections(prev => [...prev, newConnection])
  }, [connections])

  const handleConnectionRemove = useCallback((connectionId: string) => {
    setConnections(prev => prev.filter(conn => conn.id !== connectionId))
  }, [])

  // Phase change handler
  const handlePhaseChange = useCallback((phase: Phase) => {
    setCurrentPhase(phase)
  }, [])

  // Configuration handlers
  const handleStepConfiguration = useCallback((stepIndex: number, configData: any) => {
    updateStep(stepIndex, {
      configurationData: configData,
      isConfigured: true,
      configurationComplete: Object.keys(configData).length > 0
    })
  }, [updateStep])

  // Convert legacy format to new workflow format for TestValidatePhase
  const convertToWorkflowFormat = useCallback(() => {
    console.log('🔄 [AgentBuildingPhase] Converting legacy format to workflow format')
    
    const workflowForTest = {
      id: WorkflowService.generateUUID(),
      name: data?.title || 'Test Workflow',
      description: data?.description || 'Workflow created from legacy format',
      steps: steps.map((step, index) => ({
        id: step.id.toString(),
        name: step.title || `Step ${index + 1}`,
        description: step.description || '',
        agentId: step.selectedAgent?.id || step.suggestedAgent || `agent-${step.id}`,
        inputs: (step.inputs || []).map(input => ({
          name: input.name || input.displayName || `input-${Math.random()}`,
          type: input.type || 'string',
          required: input.required !== undefined ? input.required : true,
          source: index === 0 ? 'user' as const : 'previous_step' as const
        })),
        outputs: (step.outputs || []).map(output => ({
          name: output.name || output.displayName || `output-${Math.random()}`,
          type: output.type || 'string',
          required: true,
          description: output.description
        })),
        position: { x: 100 + index * 200, y: 100 }
      })),
      agents: steps.map((step, index) => ({
        id: step.selectedAgent?.id || step.suggestedAgent || `agent-${step.id}`,
        name: step.selectedAgent?.name || step.suggestedAgent || `Agent ${index + 1}`,
        type: 'custom' as const,
        configuration: step.configurationData || {},
        outputSchema: {
          type: 'object',
          fields: (step.outputs || []).map(output => ({
            name: output.name || output.displayName || 'output',
            type: output.type || 'string'
          }))
        }
      })),
      connections: connections.map(conn => ({
        id: conn.id,
        fromStepId: conn.fromStep.toString(),
        toStepId: conn.toStep.toString(),
        fromOutputName: conn.fromIO,
        toInputName: conn.toInput
      })),
      status: 'draft' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    console.log('✅ [AgentBuildingPhase] Converted workflow:', {
      stepsCount: workflowForTest.steps.length,
      agentsCount: workflowForTest.agents.length,
      connectionsCount: workflowForTest.connections.length
    })

    return workflowForTest
  }, [data, steps, connections])

  // Render current phase
  const renderCurrentPhase = () => {
    const commonProps = {
      steps,
      connections,
      onUpdateStep: updateStep,
      onPhaseChange: handlePhaseChange
    }

    switch (currentPhase) {
      case 'build':
        return (
          <BuildWorkflowPhase
            {...commonProps}
            selectedStep={selectedStep}
            aiGeneratedAgents={aiGeneratedAgents}
            smartAgentLibrary={smartAgentLibrary}
            workflowDescription={data?.description || ''}
            onAddStep={addStep}
            onRemoveStep={removeStep}
            onSelectStep={setSelectedStep}
            onTestStep={testStep}
            onAgentAssignment={handleAgentAssignment}
            onBack={onBack}
          />
        )
      
      case 'connect':
        return (
          <ConnectDataPhase
            steps={steps}
            connections={connections}
            onStepsChange={persistSteps}
            onConnectionsChange={handleConnectionsChange}
            onPhaseComplete={() => handlePhaseChange('configure')}
            onPreviousPhase={() => handlePhaseChange('build')}
          />
        )
      
      case 'configure':
        return (
          <ConfigureIntegrationsPhase
            steps={steps}
            connections={connections}
            onStepsChange={persistSteps}
            onStepConfiguration={handleStepConfiguration}
            onPhaseComplete={() => handlePhaseChange('test')}
            onPreviousPhase={() => handlePhaseChange('connect')}
          />
        )
      
      case 'test':
        // Convert legacy format to new workflow format
        const workflowForTest = convertToWorkflowFormat()
        
        return (
          <TestValidatePhase
            workflow={workflowForTest}
            testResults={undefined}
            onTestComplete={async () => {
              // Handle test completion
              console.log('✅ [AgentBuildingPhase] Test completed')
            }}
            onNext={onNext}
            onBack={() => handlePhaseChange('configure')}
          />
        )
      
      default:
        return null
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Phase Navigation */}
      <StepNavigation
        currentPhase={currentPhase}
        onPhaseChange={handlePhaseChange}
        onBack={onBack}
      />

      {/* Current Phase Content */}
      {renderCurrentPhase()}
    </div>
  )
}