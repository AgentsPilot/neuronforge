import { useState, useMemo, useCallback } from 'react'
import { WorkflowData, WorkflowStep, Connection, Phase } from '../types/workflow'
import { AgentLibraryItem } from '../types/agents'
import { StepNavigation } from '../components/workflow/StepNavigation'
import { BuildWorkflowPhase } from './BuildWorkflowPhase'
import { ConnectDataPhase } from './ConnectDataPhase'
import { createSmartAgentLibrary, generateAIAgents } from '../../../lib/utils/agentHelpers'
import { createConnection, connectionExists, updateConnectionIndices } from '../../../lib/utils/connectionHelpers'

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
  // Initialize workflow steps
  const [steps, setSteps] = useState<WorkflowStep[]>(() => {
    const initialSteps = data.finalSteps || data.generatedSteps || [
      {
        id: 1,
        title: 'Email Processing',
        description: 'Scan emails for invoices and attachments',
        inputs: [
          { name: 'email_folder', type: 'text', displayName: 'Email Folder', required: true },
          { name: 'search_criteria', type: 'text', displayName: 'Search Criteria' }
        ],
        outputs: [
          { name: 'found_emails', type: 'json', displayName: 'Found Emails' },
          { name: 'attachment_count', type: 'number', displayName: 'Attachment Count' }
        ],
        selectedAgent: null,
        isConfigured: false,
        configurationComplete: false,
        configurationData: {},
        suggestedAgent: 'Email Scanner',
        customInputs: [],
        customOutputs: []
      },
      {
        id: 2,
        title: 'Invoice Extraction',
        description: 'Extract data from invoice documents',
        inputs: [
          { name: 'email_attachments', type: 'json', displayName: 'Email Attachments', required: true },
          { name: 'extraction_rules', type: 'text', displayName: 'Extraction Rules' }
        ],
        outputs: [
          { name: 'invoice_data', type: 'json', displayName: 'Invoice Data' },
          { name: 'confidence_score', type: 'number', displayName: 'Confidence Score' }
        ],
        selectedAgent: null,
        isConfigured: false,
        configurationComplete: false,
        configurationData: {},
        suggestedAgent: 'Invoice Data Extractor',
        customInputs: [],
        customOutputs: []
      },
      {
        id: 3,
        title: 'CRM Update',
        description: 'Update CRM with extracted invoice data',
        inputs: [
          { name: 'processed_invoices', type: 'json', displayName: 'Processed Invoices', required: true },
          { name: 'crm_settings', type: 'json', displayName: 'CRM Settings' }
        ],
        outputs: [
          { name: 'updated_records', type: 'json', displayName: 'Updated Records' },
          { name: 'success_count', type: 'number', displayName: 'Success Count' }
        ],
        selectedAgent: null,
        isConfigured: false,
        configurationComplete: false,
        configurationData: {},
        suggestedAgent: 'CRM Record Creator',
        customInputs: [],
        customOutputs: []
      }
    ]
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
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8 text-center">
            <div className="text-6xl mb-4">⚙️</div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">Configure Integrations Phase</h3>
            <p className="text-slate-600 mb-6">Configuration phase coming soon...</p>
            <div className="flex justify-between">
              <button
                onClick={() => handlePhaseChange('connect')}
                className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
              >
                ← Back to Connect
              </button>
              <button
                onClick={() => handlePhaseChange('test')}
                className="px-6 py-3 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white rounded-xl font-semibold transition-all"
              >
                Next: Test →
              </button>
            </div>
          </div>
        )
      
      case 'test':
        return (
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8 text-center">
            <div className="text-6xl mb-4">🧪</div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">Test & Validate Phase</h3>
            <p className="text-slate-600 mb-6">Testing phase coming soon...</p>
            <div className="flex justify-between">
              <button
                onClick={() => handlePhaseChange('configure')}
                className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
              >
                ← Back to Configure
              </button>
              <button
                onClick={onNext}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all"
              >
                Deploy Workflow →
              </button>
            </div>
          </div>
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