import { useState, useMemo, useCallback } from 'react'
import { DndContext, useDraggable, useDroppable, DragOverlay, closestCenter } from '@dnd-kit/core'
import { Bot, Library, Plus, TrendingUp, GripVertical, Settings, Plug, ArrowRight, Mail, FileText, Database, Users, Calendar, CheckCircle, AlertCircle, Edit3, Link2, Play, TestTube2, Trash2, Copy } from 'lucide-react'
import { WorkflowData, WorkflowStep, AgentLibraryItem } from '../types/workflow'

// Available Plugins/Integrations
const availablePlugins = [
  { id: 'gmail', name: 'Gmail', icon: Mail, category: 'Email', description: 'Connect to Gmail account' },
  { id: 'outlook', name: 'Outlook', icon: Mail, category: 'Email', description: 'Connect to Outlook account' },
  { id: 'salesforce', name: 'Salesforce', icon: Users, category: 'CRM', description: 'Connect to Salesforce CRM' },
  { id: 'hubspot', name: 'HubSpot', icon: Users, category: 'CRM', description: 'Connect to HubSpot CRM' },
  { id: 'notion', name: 'Notion', icon: FileText, category: 'Documents', description: 'Connect to Notion workspace' },
  { id: 'google-drive', name: 'Google Drive', icon: FileText, category: 'Documents', description: 'Connect to Google Drive' },
]

// Smart Agent Templates (moved outside to prevent recreation)
const SMART_AGENT_TEMPLATES = {
  emailAgents: [
    {
      id: 'email-scanner',
      name: 'Email Scanner',
      description: 'Scan email inbox for specific types of emails and attachments',
      category: 'Email Processing',
      inputs: [
        { name: 'email_account', type: 'connection', description: 'Email account to scan', required: true },
        { name: 'search_criteria', type: 'config', description: 'What to search for', required: true }
      ],
      outputs: [
        { name: 'found_emails', type: 'email_list', description: 'Emails matching criteria' },
        { name: 'attachments', type: 'file_list', description: 'Files attached to emails' }
      ],
      requiredPlugins: ['gmail', 'outlook'],
      businessValue: 'Never miss important emails again',
      configurable: true
    }
  ],
  documentAgents: [
    {
      id: 'invoice-extractor',
      name: 'Invoice Data Extractor', 
      description: 'Extract specific data fields from invoices and documents',
      category: 'Document Processing',
      inputs: [
        { name: 'documents', type: 'file_list', description: 'Documents to process', required: true }
      ],
      outputs: [
        { name: 'invoice_data', type: 'structured_data', description: 'Extracted invoice information' }
      ],
      requiredPlugins: [],
      businessValue: 'Extract data 100x faster than manual entry',
      configurable: true
    }
  ],
  crmAgents: [
    {
      id: 'crm-inserter',
      name: 'CRM Record Creator',
      description: 'Create new records in your CRM system',
      category: 'CRM Integration', 
      inputs: [
        { name: 'structured_data', type: 'structured_data', description: 'Data to insert', required: true }
      ],
      outputs: [
        { name: 'crm_records', type: 'crm_data', description: 'Created CRM records' }
      ],
      requiredPlugins: ['salesforce', 'hubspot'],
      businessValue: 'Automatically update CRM with 100% accuracy',
      configurable: true
    }
  ]
}

// Draggable Input/Output Item
function DraggableIOItem({ item, type, stepIndex }: { 
  item: any, 
  type: 'input' | 'output', 
  stepIndex: number 
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${type}-${stepIndex}-${item.name}`,
    data: { type: 'io', ioType: type, item, stepIndex }
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 p-2 rounded-md border cursor-grab hover:shadow-sm transition-all ${
        isDragging ? 'opacity-50 bg-blue-100 border-blue-300' : 'bg-white border-slate-200 hover:border-blue-300'
      }`}
    >
      <GripVertical className="h-3 w-3 text-slate-400" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-900 truncate">
          {item.name || item}
        </div>
        {item.description && (
          <div className="text-xs text-slate-600 truncate">{item.description}</div>
        )}
      </div>
      <div className={`w-3 h-3 rounded-full ${type === 'input' ? 'bg-blue-500' : 'bg-green-500'}`} />
    </div>
  )
}

// Droppable Connection Zone (Enhanced for Phase 2)
function DroppableConnection({ 
  stepIndex, 
  type, 
  input,
  onConnect 
}: { 
  stepIndex: number, 
  type: 'input' | 'output',
  input?: any,
  onConnect: (connection: any) => void 
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `connect-${type}-${stepIndex}-${input?.name || 'default'}`,
    data: { type: 'connection', connectionType: type, stepIndex, input }
  })

  return (
    <div
      ref={setNodeRef}
      className={`border-2 border-dashed rounded-lg p-3 text-center transition-all min-h-[60px] flex items-center justify-center ${
        isOver ? 'border-purple-400 bg-purple-50' : 'border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${type === 'input' ? 'bg-blue-500' : 'bg-green-500'}`} />
        <div className="text-sm">
          {input ? (
            <div>
              <div className="font-medium text-slate-900">{input.name || input}</div>
              {input.description && (
                <div className="text-xs text-slate-600">{input.description}</div>
              )}
            </div>
          ) : (
            <span className="text-slate-600">
              {isOver ? `Drop ${type === 'input' ? 'output' : 'input'} here` : `Connect ${type}`}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Enhanced Step Builder with Visual Connections
function FlexibleStepBuilder({ 
  step, 
  index, 
  isSelected, 
  onSelect, 
  onUpdate, 
  onRemove,
  onTest,
  totalSteps,
  nextStep,
  connections 
}: {
  step: WorkflowStep,
  index: number,
  isSelected: boolean,
  onSelect: () => void,
  onUpdate: (updates: Partial<WorkflowStep>) => void,
  onRemove: () => void,
  onTest: () => void,
  totalSteps: number,
  nextStep?: WorkflowStep,
  connections: any[]
}) {
  const [showConfig, setShowConfig] = useState(false)
  const [customInputs, setCustomInputs] = useState(step.customInputs || [])
  const [customOutputs, setCustomOutputs] = useState(step.customOutputs || [])
  
  const hasAgent = !!step.selectedAgent
  const isConfigured = hasAgent && step.isConfigured !== false
  const hasConnections = connections.some(c => c.fromStep === index || c.toStep === index)

  const addCustomInput = () => {
    const newInput = { name: 'new_input', type: 'data', description: 'Custom input' }
    const updatedInputs = [...customInputs, newInput]
    setCustomInputs(updatedInputs)
    onUpdate({ customInputs: updatedInputs })
  }

  const addCustomOutput = () => {
    const newOutput = { name: 'new_output', type: 'data', description: 'Custom output' }
    const updatedOutputs = [...customOutputs, newOutput]
    setCustomOutputs(updatedOutputs)
    onUpdate({ customOutputs: updatedOutputs })
  }

  const removeCustomIO = (type: 'input' | 'output', idx: number) => {
    if (type === 'input') {
      const updated = customInputs.filter((_, i) => i !== idx)
      setCustomInputs(updated)
      onUpdate({ customInputs: updated })
    } else {
      const updated = customOutputs.filter((_, i) => i !== idx)
      setCustomOutputs(updated)
      onUpdate({ customOutputs: updated })
    }
  }

  const allInputs = [
    ...(step.selectedAgent?.inputs || []),
    ...customInputs
  ]

  const allOutputs = [
    ...(step.selectedAgent?.outputs || []),
    ...customOutputs
  ]

  return (
    <div className={`bg-white rounded-xl border-2 transition-all duration-200 ${
      isSelected ? 'border-purple-400 shadow-lg' : 
      hasAgent ? 'border-green-200 shadow-sm' : 'border-slate-200 hover:border-slate-300'
    }`}>
      {/* Step Header */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
              isConfigured ? 'bg-green-100 text-green-700' :
              hasAgent ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {isConfigured ? <CheckCircle className="h-4 w-4" /> : 
               hasAgent ? <AlertCircle className="h-4 w-4" /> : index + 1}
            </div>
            <div>
              <h3 className="font-medium text-slate-900">
                {step.title || `Step ${index + 1}`}
              </h3>
              <p className="text-sm text-slate-600">
                {step.description || 'Configure this step by adding an agent'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {hasAgent && (
              <>
                <button
                  onClick={onTest}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Test this step"
                >
                  <Play className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowConfig(!showConfig)}
                  className={`p-2 rounded-lg transition-colors ${
                    showConfig ? 'bg-blue-100 text-blue-700' : 'text-blue-600 hover:bg-blue-50'
                  }`}
                  title="Configure step"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={onSelect}
              className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <Bot className="h-4 w-4" />
            </button>
            {totalSteps > 1 && (
              <button
                onClick={() => onRemove()}
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Remove step"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Agent Assignment Area */}
      <div className="p-4">
        {!hasAgent ? (
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center bg-slate-50/50">
            <div className="text-4xl mb-3">🤖</div>
            <h4 className="font-medium text-slate-900 mb-2">No Agent Assigned</h4>
            <p className="text-sm text-slate-600 mb-4">
              Drag an agent from the sidebar to automate this step
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Assigned Agent */}
            <div className={`border rounded-lg p-4 ${
              isConfigured ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'
            }`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isConfigured ? 'bg-green-100' : 'bg-yellow-100'
                  }`}>
                    <Bot className={`h-5 w-5 ${isConfigured ? 'text-green-600' : 'text-yellow-600'}`} />
                  </div>
                  <div>
                    <h4 className={`font-medium ${isConfigured ? 'text-green-900' : 'text-yellow-900'}`}>
                      {step.selectedAgent.name}
                    </h4>
                    <p className={`text-sm ${isConfigured ? 'text-green-700' : 'text-yellow-700'}`}>
                      {step.selectedAgent.description}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onUpdate({ selectedAgent: null, isConfigured: false })}
                  className={`${isConfigured ? 'text-green-600 hover:text-green-800' : 'text-yellow-600 hover:text-yellow-800'} transition-colors`}
                >
                  ×
                </button>
              </div>

              {/* Input/Output Management */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {/* Inputs */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                      📥 Inputs ({allInputs.length})
                    </h5>
                    <button
                      onClick={addCustomInput}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Add custom input"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {allInputs.map((input, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <DraggableIOItem item={input} type="input" stepIndex={index} />
                        {idx >= (step.selectedAgent?.inputs?.length || 0) && (
                          <button
                            onClick={() => removeCustomIO('input', idx - (step.selectedAgent?.inputs?.length || 0))}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {allInputs.length === 0 && (
                      <div className="text-sm text-slate-500 text-center py-2">No inputs</div>
                    )}
                  </div>
                </div>

                {/* Outputs */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                      📤 Outputs ({allOutputs.length})
                    </h5>
                    <button
                      onClick={addCustomOutput}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Add custom output"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {allOutputs.map((output, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <DraggableIOItem item={output} type="output" stepIndex={index} />
                        {idx >= (step.selectedAgent?.outputs?.length || 0) && (
                          <button
                            onClick={() => removeCustomIO('output', idx - (step.selectedAgent?.outputs?.length || 0))}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {allOutputs.length === 0 && (
                      <div className="text-sm text-slate-500 text-center py-2">No outputs</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Visual Connection Indicator */}
      {index < totalSteps - 1 && (
        <div className="flex justify-center pb-4">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${
            hasConnections ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'
          }`}>
            {hasConnections ? (
              <>
                <Link2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Connected to Step {index + 2}</span>
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4 text-slate-500" />
                <span className="text-sm text-slate-600">Drag inputs/outputs to connect</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Draggable Agent Card
function DraggableAgent({ agent }: { agent: AgentLibraryItem }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `agent-${agent.id}`,
    data: { type: 'agent', agent }
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-white/80 rounded-lg p-4 border border-slate-200 transition-all duration-200 cursor-grab active:cursor-grabbing group hover:shadow-md hover:border-purple-300
        ${isDragging ? 'opacity-50 scale-95 shadow-lg ring-2 ring-purple-400 border-purple-400' : ''}
      `}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-1">
          <GripVertical className="h-4 w-4 text-slate-400 group-hover:text-purple-500 transition-colors" />
          <div className="flex-1">
            <h4 className="font-medium text-slate-900 group-hover:text-purple-700 transition-colors text-sm">
              {agent.name}
            </h4>
            {agent.businessValue && (
              <p className="text-xs text-green-600 font-medium mt-1">💡 {agent.businessValue}</p>
            )}
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-600 mb-3 line-clamp-2">{agent.description}</p>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{agent.category}</span>
          {agent.configurable && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Configurable</span>
          )}
        </div>

        {/* Input/Output Preview */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-slate-500">In:</span>
            <div className="text-slate-700">
              {agent.inputs?.slice(0, 2).map(input => 
                typeof input === 'object' ? input.name : input
              ).join(', ')}
              {agent.inputs?.length > 2 && '...'}
            </div>
          </div>
          <div>
            <span className="text-slate-500">Out:</span>
            <div className="text-slate-700">
              {agent.outputs?.slice(0, 2).map(output => 
                typeof output === 'object' ? output.name : output
              ).join(', ')}
              {agent.outputs?.length > 2 && '...'}
            </div>
          </div>
        </div>

        {/* Required Plugins */}
        {agent.requiredPlugins && agent.requiredPlugins.length > 0 && (
          <div className="flex items-center gap-1">
            <Plug className="h-3 w-3 text-slate-500" />
            <div className="flex gap-1">
              {agent.requiredPlugins.slice(0, 2).map(pluginId => {
                const plugin = availablePlugins.find(p => p.id === pluginId)
                return plugin ? (
                  <span key={pluginId} className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full flex items-center gap-1">
                    <plugin.icon className="h-3 w-3" />
                    {plugin.name}
                  </span>
                ) : null
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Enhanced Drop Zone
function DroppableStep({ step, index, children, isOver }: {
  step: WorkflowStep,
  index: number,
  children: React.ReactNode,
  isOver: boolean
}) {
  const { setNodeRef } = useDroppable({
    id: `step-${index}`,
    data: { type: 'step', stepIndex: index, step }
  })

  return (
    <div
      ref={setNodeRef}
      className={`relative transition-all duration-200 ${
        isOver ? 'ring-2 ring-purple-400 bg-purple-50/30 rounded-xl' : ''
      }`}
    >
      {children}
      {isOver && (
        <div className="absolute inset-0 bg-gradient-to-r from-purple-100/60 to-blue-100/60 rounded-xl pointer-events-none border-2 border-dashed border-purple-400 flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg">
            <div className="flex items-center gap-2 text-purple-700">
              <Bot className="h-4 w-4" />
              <span className="text-sm font-medium">Drop agent here to assign</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const createSmartAgentLibrary = (workflowDescription: string) => {
  const description = workflowDescription.toLowerCase()
  
  if (description.includes('email') && description.includes('invoice') && description.includes('crm')) {
    return [...SMART_AGENT_TEMPLATES.emailAgents, ...SMART_AGENT_TEMPLATES.documentAgents, ...SMART_AGENT_TEMPLATES.crmAgents]
  }
  
  return [...SMART_AGENT_TEMPLATES.emailAgents, ...SMART_AGENT_TEMPLATES.documentAgents, ...SMART_AGENT_TEMPLATES.crmAgents]
}

// Main Component
export const AgentBuildingPhase = ({
  data,
  onUpdate,
  onNext,
  onBack,
}: {
  data: WorkflowData
  onUpdate: (updates: Partial<WorkflowData>) => void
  onNext: () => void
  onBack: () => void
}) => {
  const [steps, setSteps] = useState<WorkflowStep[]>(() => {
    const initialSteps = data.finalSteps || data.generatedSteps || []
    return initialSteps.map((step) => ({
      ...step,
      selectedAgent: step.selectedAgent || null,
      isConfigured: step.isConfigured || false,
      customInputs: step.customInputs || [],
      customOutputs: step.customOutputs || [],
      configurationComplete: step.configurationComplete || false
    }))
  })
  
  const [selectedStep, setSelectedStep] = useState<number | null>(null)
  const [activeAgent, setActiveAgent] = useState<AgentLibraryItem | null>(null)
  const [activeIOItem, setActiveIOItem] = useState<any>(null)
  const [connections, setConnections] = useState<any[]>([])
  const [currentPhase, setCurrentPhase] = useState<'build' | 'connect' | 'configure' | 'test'>('build')

  // Get smart agent library
  const smartAgentLibrary = useMemo(() => {
    const workflowDesc = data?.description || ''
    return createSmartAgentLibrary(workflowDesc)
  }, [data?.description])

  // Get AI-generated agents with proper plugin requirements
  const aiGeneratedAgents = useMemo(() => {
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
      let requiredPlugins = []
      let businessValue = 'Automate manual work in this step'
      let configurable = true
      
      const lowerName = name.toLowerCase()
      const lowerDesc = (step.description || '').toLowerCase()
      const lowerTitle = (step.title || '').toLowerCase()
      
      // Notification/email sending agents (check first to avoid conflicts)
      if (lowerName.includes('notif') || lowerName.includes('send') || 
          lowerDesc.includes('send') || lowerDesc.includes('notify') ||
          lowerTitle.includes('send') || lowerTitle.includes('notify') ||
          (lowerName.includes('email') && (lowerName.includes('notif') || lowerDesc.includes('send')))) {
        requiredPlugins = ['gmail', 'outlook']
        businessValue = 'Notify teams automatically'
      }
      // Email scanning/parsing agents (inbox processing)
      else if ((lowerName.includes('email') || lowerName.includes('parser')) && 
               (lowerDesc.includes('inbox') || lowerTitle.includes('inbox') || 
                lowerDesc.includes('retrieve') || lowerDesc.includes('scan') ||
                lowerName.includes('scan') || lowerName.includes('extract'))) {
        requiredPlugins = ['gmail', 'outlook']
        businessValue = 'Never miss invoices in your inbox'
      }
      // Document processing agents  
      else if (lowerName.includes('document') || lowerName.includes('parser') || 
               lowerName.includes('extract') || lowerName.includes('parse') ||
               lowerDesc.includes('invoice') || lowerDesc.includes('document') ||
               lowerDesc.includes('extract') || lowerDesc.includes('parse')) {
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
      
      return {
        id: `ai-generated-${idx}`,
        name,
        description: step.description || `AI-generated agent for ${step.title || `Step ${idx + 1}`}`,
        category: 'AI Generated',
        inputs: formattedInputs,
        outputs: formattedOutputs,
        usageCount: 0,
        rating: 4.5,
        requiredPlugins, // Now properly set based on agent type
        businessValue,
        configurable
      }
    })
  }, [steps])

  // Persist changes
  const persistSteps = useCallback((newSteps: WorkflowStep[]) => {
    setSteps(newSteps)
    onUpdate({ finalSteps: newSteps })
  }, [onUpdate])

  // Drag handlers
  function handleDragStart(event: any) {
    const { active } = event
    const activeData = active?.data?.current
    
    if (activeData?.type === 'agent') {
      setActiveAgent(activeData.agent)
      setActiveIOItem(null)
    } else if (activeData?.type === 'io') {
      setActiveAgent(null)
      setActiveIOItem(activeData.item)
    }
  }

  function handleDragEnd(event: any) {
    const { over, active } = event
    setActiveAgent(null)
    setActiveIOItem(null)
    
    if (over && active) {
      const overData = over.data?.current
      const activeData = active.data?.current
      
      if (overData?.type === 'step' && activeData?.type === 'agent') {
        // Agent dropped on step (Phase 1)
        const stepIndex = overData.stepIndex
        const agent = activeData.agent
        
        if (typeof stepIndex === 'number' && agent) {
          updateStep(stepIndex, {
            selectedAgent: agent,
            isConfigured: false
          })
        }
      } else if (overData?.type === 'connection' && activeData?.type === 'io') {
        // Input/Output connection (Phase 2)
        const fromStep = activeData.stepIndex
        const toStep = overData.stepIndex
        const fromIO = activeData.item
        const toInput = overData.input
        
        // Only allow output to input connections
        if (activeData.ioType === 'output' && overData.connectionType === 'input' && fromStep !== toStep) {
          const connection = {
            id: `${fromStep}-${toStep}-${Date.now()}`,
            fromStep,
            toStep,
            fromIO,
            toInput,
            type: 'data_flow'
          }
          
          // Check if connection already exists
          const existingConnection = connections.find(c => 
            c.fromStep === fromStep && c.toStep === toStep
          )
          
          if (!existingConnection) {
            setConnections(prev => [...prev, connection])
          }
        }
      }
    }
  }

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
      customInputs: [],
      customOutputs: [],
      configurationComplete: false
    }
    persistSteps([...steps, newStep])
  }, [steps, persistSteps])

  const removeStep = useCallback((index: number) => {
    if (steps.length <= 1) return
    const newSteps = steps.filter((_, i) => i !== index)
    const reIndexedSteps = newSteps.map((step, i) => ({ ...step, id: i + 1 }))
    persistSteps(reIndexedSteps)
    if (selectedStep === index) setSelectedStep(null)
    else if (selectedStep !== null && selectedStep > index) setSelectedStep(selectedStep - 1)
  }, [steps, selectedStep, persistSteps])

  const testStep = useCallback((index: number) => {
    console.log(`Testing step ${index + 1}:`, steps[index])
    // TODO: Implement step testing logic
  }, [steps])

  // Calculate progress
  const configuredStepsCount = steps.filter((s) => !!s.selectedAgent && s.isConfigured).length
  const hasAgentCount = steps.filter((s) => !!s.selectedAgent).length
  const remainingStepsCount = steps.length - hasAgentCount
  const needsConfigCount = hasAgentCount - configuredStepsCount
  const isReadyForNext = steps.length > 0 && remainingStepsCount === 0

  // Phase progression
  const phases = [
    { id: 'build', name: 'Build Workflow', description: 'Assign agents to steps' },
    { id: 'connect', name: 'Connect Data', description: 'Link inputs and outputs' },
    { id: 'configure', name: 'Configure Integrations', description: 'Set up plugins and rules' },
    { id: 'test', name: 'Test & Validate', description: 'Test your workflow' }
  ]

  const currentPhaseIndex = phases.findIndex(p => p.id === currentPhase)

  return (
    <DndContext 
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      collisionDetection={closestCenter}
    >
      <div className="max-w-7xl mx-auto">
        {/* Phase Navigation */}
        <div className="mb-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Workflow Configuration</h2>
            <button
              onClick={onBack}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
            >
              ← Back
            </button>
          </div>
          
          <div className="flex items-center justify-between">
            {phases.map((phase, idx) => (
              <div key={phase.id} className="flex items-center">
                <button
                  onClick={() => setCurrentPhase(phase.id as any)}
                  className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-all ${
                    currentPhase === phase.id ? 'bg-purple-100 text-purple-900' :
                    idx < currentPhaseIndex ? 'bg-green-100 text-green-900' :
                    'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                    currentPhase === phase.id ? 'bg-purple-200' :
                    idx < currentPhaseIndex ? 'bg-green-200' : 'bg-slate-200'
                  }`}>
                    {idx < currentPhaseIndex ? <CheckCircle className="h-4 w-4" /> : idx + 1}
                  </div>
                  <div>
                    <div className="font-medium">{phase.name}</div>
                    <div className="text-xs opacity-75">{phase.description}</div>
                  </div>
                </button>
                {idx < phases.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-slate-400 mx-2" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Phase Content */}
        {currentPhase === 'build' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                      <Bot className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">
                        Phase 1: Build Your Workflow
                      </h3>
                      <p className="text-slate-600">Assign agents to automate each step</p>
                    </div>
                  </div>
                </div>

                {/* Progress Summary */}
                <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-900">{steps.length}</div>
                        <div className="text-xs text-blue-700">Steps</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-yellow-600">{hasAgentCount}</div>
                        <div className="text-xs text-yellow-700">Assigned</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{configuredStepsCount}</div>
                        <div className="text-xs text-green-700">Configured</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-900 mb-1">
                        {steps.length > 0 ? Math.round((hasAgentCount / steps.length) * 100) : 0}% Assigned
                      </div>
                      <div className="w-40 h-3 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
                          style={{
                            width: `${steps.length > 0 ? (hasAgentCount / steps.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Workflow Steps */}
                <div className="space-y-6">
                  {steps.map((step, index) => (
                    <DroppableStep
                      key={step.id}
                      step={step}
                      index={index}
                      isOver={false}
                    >
                      <FlexibleStepBuilder
                        step={step}
                        index={index}
                        isSelected={selectedStep === index}
                        onSelect={() => setSelectedStep(selectedStep === index ? null : index)}
                        onUpdate={(updates) => updateStep(index, updates)}
                        onRemove={() => removeStep(index)}
                        onTest={() => testStep(index)}
                        totalSteps={steps.length}
                        nextStep={steps[index + 1]}
                        connections={connections}
                      />
                    </DroppableStep>
                  ))}

                  <div className="text-center pt-6">
                    <button
                      onClick={addStep}
                      className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-105"
                    >
                      <Plus className="h-5 w-5" />
                      Add Another Step
                    </button>
                  </div>
                </div>

                {/* Navigation */}
                <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
                  <button
                    onClick={onBack}
                    className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => setCurrentPhase('connect')}
                    disabled={!isReadyForNext}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-slate-400 disabled:to-slate-500 text-white rounded-xl font-semibold transition-all disabled:cursor-not-allowed"
                  >
                    {!isReadyForNext ? `Assign ${remainingStepsCount} More Agents` : 'Next: Connect Data →'}
                  </button>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* AI-Generated Recommended Agents */}
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                    <Library className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="font-bold text-slate-900">Recommended Agents</h3>
                </div>
                <p className="text-sm text-slate-600 mb-4">
                  Based on your workflow: "{data.description}"
                </p>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {aiGeneratedAgents.length === 0 ? (
                    <div className="text-sm text-slate-500 text-center py-4">
                      No AI-generated agents available.
                    </div>
                  ) : (
                    aiGeneratedAgents.map((agent) => (
                      <DraggableAgent agent={agent} key={agent.id} />
                    ))
                  )}
                </div>
              </div>

              {/* Smart Agents */}
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="font-bold text-slate-900">Smart Agents</h3>
                </div>
                <p className="text-sm text-slate-600 mb-4">
                  Advanced configurable agents with full customization
                </p>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {smartAgentLibrary.map((agent) => (
                    <DraggableAgent agent={agent} key={agent.id} />
                  ))}
                </div>
              </div>

              {/* Progress Summary */}
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="font-bold text-slate-900">Build Progress</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Workflow Steps</span>
                    <span className="font-semibold text-slate-900">{steps.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Agents Assigned</span>
                    <span className="font-semibold text-yellow-600">{hasAgentCount}</span>
                  </div>
                  
                  {isReadyForNext ? (
                    <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex items-center gap-2 text-green-800">
                        <CheckCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">Ready for next phase!</span>
                      </div>
                      <p className="text-xs text-green-700 mt-1">
                        All agents assigned - time to connect data flow
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-center gap-2 text-blue-800">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">Next Steps:</span>
                      </div>
                      <ul className="text-xs text-blue-700 mt-2 space-y-1">
                        {remainingStepsCount > 0 && (
                          <li>• Assign agents to {remainingStepsCount} steps</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Phase 2: Connect Data */}
        {currentPhase === 'connect' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl flex items-center justify-center">
                  <Link2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">
                    Phase 2: Connect Your Data Flow
                  </h3>
                  <p className="text-slate-600">Drag inputs and outputs to create data connections between steps</p>
                </div>
              </div>

              {/* Connection Progress */}
              <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-900">{connections.length}</div>
                      <div className="text-xs text-green-700">Connections</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-900">{steps.length - 1}</div>
                      <div className="text-xs text-blue-700">Possible Links</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-900">
                        {connections.length > 0 ? Math.round((connections.length / (steps.length - 1)) * 100) : 0}%
                      </div>
                      <div className="text-xs text-purple-700">Connected</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-slate-900 mb-1">Data Flow Status</div>
                    <div className="w-40 h-3 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-500"
                        style={{
                          width: `${connections.length > 0 && steps.length > 1 ? (connections.length / (steps.length - 1)) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Instructions */}
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-200">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Link2 className="h-3 w-3 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="font-medium text-blue-900 mb-1">How to Connect Data</h4>
                    <div className="text-sm text-blue-700 space-y-1">
                      <p>• <strong>Green dots (📤)</strong> are outputs from a step</p>
                      <p>• <strong>Blue dots (📥)</strong> are inputs to a step</p>
                      <p>• <strong>Drag outputs</strong> from one step to inputs of the next step</p>
                      <p>• Data flows from left to right through your workflow</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Workflow Builder */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <h4 className="text-lg font-semibold text-slate-900 mb-6">Visual Workflow</h4>
              
              <div className="relative">
                {/* SVG for connection lines */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" style={{ minHeight: '600px' }}>
                  {connections.map((connection, idx) => {
                    // Calculate line positions (simplified - would need actual element positions)
                    const fromX = (connection.fromStep * 300) + 250
                    const fromY = 100 + (connection.fromStep * 200)
                    const toX = (connection.toStep * 300) + 50
                    const toY = 150 + (connection.toStep * 200)
                    
                    return (
                      <g key={connection.id}>
                        <defs>
                          <marker
                            id={`arrowhead-${idx}`}
                            markerWidth="10"
                            markerHeight="7"
                            refX="10"
                            refY="3.5"
                            orient="auto"
                          >
                            <polygon
                              points="0 0, 10 3.5, 0 7"
                              fill="#10b981"
                            />
                          </marker>
                        </defs>
                        <path
                          d={`M ${fromX} ${fromY} Q ${fromX + 50} ${fromY} ${toX} ${toY}`}
                          stroke="#10b981"
                          strokeWidth="2"
                          fill="none"
                          markerEnd={`url(#arrowhead-${idx})`}
                        />
                        <text
                          x={(fromX + toX) / 2}
                          y={(fromY + toY) / 2 - 10}
                          textAnchor="middle"
                          className="text-xs fill-green-700 font-medium"
                        >
                          {typeof connection.fromIO === 'object' ? connection.fromIO.name : connection.fromIO}
                        </text>
                      </g>
                    )
                  })}
                </svg>

                {/* Workflow Steps in Visual Layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-20">
                  {steps.map((step, index) => (
                    <div key={step.id} className="relative">
                      {/* Step Card */}
                      <div className="bg-white rounded-xl border-2 border-slate-200 shadow-sm">
                        {/* Step Header */}
                        <div className="p-4 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold text-blue-700">
                              {index + 1}
                            </div>
                            <div>
                              <h5 className="font-medium text-slate-900">{step.title}</h5>
                              <p className="text-sm text-slate-600">{step.selectedAgent?.name || 'No agent'}</p>
                            </div>
                          </div>
                        </div>

                        {/* Inputs Section */}
                        <div className="p-4 border-b border-slate-100">
                          <div className="flex items-center justify-between mb-3">
                            <h6 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                              📥 Inputs
                            </h6>
                          </div>
                          <div className="space-y-2">
                            {[...(step.selectedAgent?.inputs || []), ...(step.customInputs || [])].map((input, inputIdx) => (
                              <DroppableConnection
                                key={`input-${index}-${inputIdx}`}
                                stepIndex={index}
                                type="input"
                                input={input}
                                onConnect={(connection) => {
                                  console.log('Input connection:', connection)
                                }}
                              />
                            ))}
                            {(!step.selectedAgent?.inputs?.length && !step.customInputs?.length) && (
                              <DroppableConnection
                                stepIndex={index}
                                type="input"
                                onConnect={(connection) => {
                                  console.log('Input connection:', connection)
                                }}
                              />
                            )}
                          </div>
                        </div>

                        {/* Outputs Section */}
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h6 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                              📤 Outputs
                            </h6>
                          </div>
                          <div className="space-y-2">
                            {[...(step.selectedAgent?.outputs || []), ...(step.customOutputs || [])].map((output, outputIdx) => (
                              <DraggableIOItem
                                key={`output-${index}-${outputIdx}`}
                                item={output}
                                type="output"
                                stepIndex={index}
                              />
                            ))}
                            {(!step.selectedAgent?.outputs?.length && !step.customOutputs?.length) && (
                              <div className="text-sm text-slate-500 text-center py-2">No outputs defined</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Connection Arrow to Next Step */}
                      {index < steps.length - 1 && (
                        <div className="absolute -right-4 top-1/2 transform -translate-y-1/2 z-30">
                          <ArrowRight className="h-6 w-6 text-slate-400" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Current Connections List */}
              {connections.length > 0 && (
                <div className="mt-8 p-6 bg-green-50 rounded-xl border border-green-200">
                  <h5 className="font-medium text-green-900 mb-4 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Active Data Connections
                  </h5>
                  <div className="space-y-2">
                    {connections.map((connection) => (
                      <div key={connection.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-green-200">
                        <div className="flex items-center gap-3">
                          <div className="text-sm">
                            <span className="font-medium">Step {connection.fromStep + 1}</span>
                            <span className="text-slate-600 mx-2">→</span>
                            <span className="font-medium">Step {connection.toStep + 1}</span>
                          </div>
                          <div className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                            {typeof connection.fromIO === 'object' ? connection.fromIO.name : connection.fromIO}
                          </div>
                        </div>
                        <button
                          onClick={() => setConnections(connections.filter(c => c.id !== connection.id))}
                          className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Remove connection"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
                <button
                  onClick={() => setCurrentPhase('build')}
                  className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  ← Back to Build
                </button>
                <button
                  onClick={() => setCurrentPhase('configure')}
                  disabled={connections.length === 0}
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-slate-400 disabled:to-slate-500 text-white rounded-xl font-semibold transition-all disabled:cursor-not-allowed"
                >
                  {connections.length === 0 ? 'Create Data Connections First' : 'Next: Configure Integrations →'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Phase 3: Configure Integrations - Redesigned */}
        {currentPhase === 'configure' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-orange-500 to-red-600 rounded-xl flex items-center justify-center">
                  <Settings className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">
                    Phase 3: Configure Your Workflow
                  </h3>
                  <p className="text-slate-600">Set up your integrations and business rules</p>
                </div>
              </div>

              {/* Configuration Progress */}
              <div className="mb-6 p-4 bg-gradient-to-r from-orange-50 to-red-50 rounded-xl border border-orange-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-900">
                        {steps.filter(s => s.selectedAgent && s.configurationComplete).length}
                      </div>
                      <div className="text-xs text-orange-700">Configured</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-900">
                        {steps.filter(s => s.selectedAgent).length}
                      </div>
                      <div className="text-xs text-blue-700">Total Agents</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-slate-900 mb-1">
                      Configuration Progress
                    </div>
                    <div className="w-40 h-3 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-500"
                        style={{
                          width: `${steps.filter(s => s.selectedAgent).length > 0 ? 
                            (steps.filter(s => s.selectedAgent && s.configurationComplete).length / 
                             steps.filter(s => s.selectedAgent).length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step-by-Step Configuration */}
            <div className="space-y-6">
              {steps.filter(step => step.selectedAgent).map((step, stepIndex) => {
                const agent = step.selectedAgent
                const isConfigured = step.configurationComplete
                const actualStepIndex = steps.findIndex(s => s.id === step.id)
                
                return (
                  <div key={step.id} className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
                    {/* Step Header */}
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                          isConfigured ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {isConfigured ? <CheckCircle className="h-5 w-5" /> : actualStepIndex + 1}
                        </div>
                        <div>
                          <h4 className="text-lg font-semibold text-slate-900">
                            {step.title || `Step ${actualStepIndex + 1}`}: {agent?.name}
                          </h4>
                          <p className="text-slate-600">{step.description}</p>
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                        isConfigured ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {isConfigured ? 'Configured' : 'Needs Setup'}
                      </div>
                    </div>

                    {/* Configuration Interface */}
                    <div className="space-y-6">
                      
                      {/* Plugin Selection (if agent supports multiple plugins) */}
                      {agent?.requiredPlugins && agent.requiredPlugins.length > 0 && (
                        <div className="border border-slate-200 rounded-xl p-6">
                          <h5 className="font-medium text-slate-900 mb-4 flex items-center gap-2">
                            <Plug className="h-4 w-4" />
                            Choose Your Integration
                          </h5>
                          <p className="text-sm text-slate-600 mb-4">
                            Select which service you want to connect for this step:
                          </p>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {agent.requiredPlugins.map(pluginId => {
                              const plugin = availablePlugins.find(p => p.id === pluginId)
                              if (!plugin) return null
                              
                              return (
                                <div key={pluginId} className="border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition-colors cursor-pointer">
                                  <div className="flex items-center gap-3 mb-3">
                                    <input 
                                      type="radio" 
                                      name={`plugin-${step.id}`}
                                      className="text-blue-600"
                                      defaultChecked={pluginId === agent.requiredPlugins[0]}
                                    />
                                    <plugin.icon className="h-6 w-6 text-slate-600" />
                                    <div>
                                      <h6 className="font-medium text-slate-900">{plugin.name}</h6>
                                      <p className="text-xs text-slate-600">{plugin.description}</p>
                                    </div>
                                  </div>
                                  <div className={`text-xs px-2 py-1 rounded-full inline-block ${
                                    Math.random() > 0.5 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {Math.random() > 0.5 ? '✓ Connected' : '⚠ Needs Connection'}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* AI-Assisted Configuration */}
                      <div className="border border-slate-200 rounded-xl p-6">
                        <h5 className="font-medium text-slate-900 mb-4 flex items-center gap-2">
                          <Bot className="h-4 w-4" />
                          Configure This Step
                        </h5>
                        
                        {/* Email Scanner Configuration */}
                        {(agent?.name.toLowerCase().includes('email') && 
                          (agent?.name.toLowerCase().includes('scan') || agent?.name.toLowerCase().includes('parser'))) && (
                          <div className="space-y-4">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                              <h6 className="font-medium text-blue-900 mb-2">📧 Email Monitoring Setup</h6>
                              <p className="text-sm text-blue-700 mb-3">
                                Tell me what emails you want to monitor for invoices:
                              </p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  Which email account should I monitor? *
                                </label>
                                <input
                                  type="email"
                                  placeholder="billing@yourcompany.com"
                                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                  The email address where invoices are received
                                </p>
                              </div>
                              
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  What emails should I look for? *
                                </label>
                                <input
                                  type="text"
                                  placeholder="invoice, bill, payment due"
                                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                  Keywords that appear in invoice emails
                                </p>
                              </div>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                Are there specific senders I should watch for?
                              </label>
                              <textarea
                                placeholder="billing@vendor1.com, invoices@supplier.com, accounts@company.com"
                                rows={2}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                              <p className="text-xs text-slate-500 mt-1">
                                Optional: Specific email addresses that send you invoices
                              </p>
                            </div>
                            
                            <div className="space-y-3">
                              <h6 className="font-medium text-slate-900">Additional Options:</h6>
                              <div className="space-y-2">
                                <label className="flex items-center gap-2">
                                  <input type="checkbox" className="rounded border-slate-300" defaultChecked />
                                  <span className="text-sm text-slate-700">Only process emails with PDF attachments</span>
                                </label>
                                <label className="flex items-center gap-2">
                                  <input type="checkbox" className="rounded border-slate-300" />
                                  <span className="text-sm text-slate-700">Include emails from the last 30 days</span>
                                </label>
                                <label className="flex items-center gap-2">
                                  <input type="checkbox" className="rounded border-slate-300" />
                                  <span className="text-sm text-slate-700">Skip emails already processed</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Document Parser Configuration */}
                        {agent?.name.toLowerCase().includes('extract') || agent?.name.toLowerCase().includes('parser') && 
                         !agent?.name.toLowerCase().includes('email') && (
                          <div className="space-y-4">
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <h6 className="font-medium text-green-900 mb-2">📄 Document Processing Setup</h6>
                              <p className="text-sm text-green-700 mb-3">
                                Tell me what information you want to extract from invoices:
                              </p>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                What information do you need from each invoice? *
                              </label>
                              <textarea
                                placeholder="I need: invoice number, date, total amount, vendor name, due date, and line items with descriptions and costs"
                                rows={3}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                              <p className="text-xs text-slate-500 mt-1">
                                Describe in plain English what data you want extracted
                              </p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  What if I can't find some information?
                                </label>
                                <select className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                  <option>Leave it blank and continue</option>
                                  <option>Mark it as "Not Found"</option>
                                  <option>Stop and ask for help</option>
                                  <option>Try to estimate from context</option>
                                </select>
                              </div>
                              
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  How confident should I be?
                                </label>
                                <select className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                  <option>High confidence (95%+)</option>
                                  <option>Medium confidence (80%+)</option>
                                  <option>Low confidence (60%+)</option>
                                  <option>Extract everything I can find</option>
                                </select>
                              </div>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                Any special rules or formats?
                              </label>
                              <textarea
                                placeholder="Format dates as MM/DD/YYYY, round amounts to 2 decimals, extract tax separately if shown..."
                                rows={2}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                              <p className="text-xs text-slate-500 mt-1">
                                Optional: Any specific formatting or business rules
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Email Notifier Configuration */}
                        {(agent?.name.toLowerCase().includes('notif') || 
                          (agent?.name.toLowerCase().includes('email') && agent?.name.toLowerCase().includes('send'))) && (
                          <div className="space-y-4">
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                              <h6 className="font-medium text-purple-900 mb-2">📬 Email Notification Setup</h6>
                              <p className="text-sm text-purple-700 mb-3">
                                Configure who should receive the invoice notifications:
                              </p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  Who should receive the notifications? *
                                </label>
                                <textarea
                                  placeholder="accounting@company.com, finance@company.com, john.doe@company.com"
                                  rows={3}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                  Email addresses separated by commas
                                </p>
                              </div>
                              
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  What should the email subject be?
                                </label>
                                <input
                                  type="text"
                                  placeholder="New Invoice: [vendor] - $[amount]"
                                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                  Use &#123;vendor&#125;, &#123;amount&#125;, &#123;date&#125; for dynamic values
                                </p>
                              </div>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                What should the email message say?
                              </label>
                              <textarea
                                placeholder="A new invoice has been received and processed:&#10;&#10;Vendor: [vendor]&#10;Amount: $[amount]&#10;Date: [date]&#10;&#10;The original invoice is attached for your review."
                                rows={4}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                              <p className="text-xs text-slate-500 mt-1">
                                You can use {vendor}, {amount}, {date}, {invoice_number} in your message
                              </p>
                            </div>
                            
                            <div className="space-y-2">
                              <label className="flex items-center gap-2">
                                <input type="checkbox" className="rounded border-slate-300" defaultChecked />
                                <span className="text-sm text-slate-700">Attach the original invoice PDF</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" className="rounded border-slate-300" />
                                <span className="text-sm text-slate-700">Include extracted data as Excel file</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" className="rounded border-slate-300" />
                                <span className="text-sm text-slate-700">Send high priority emails for amounts over $1000</span>
                              </label>
                            </div>
                          </div>
                        )}

                        {/* CRM Integration Configuration */}
                        {(agent?.name.toLowerCase().includes('crm') || agent?.name.toLowerCase().includes('insert')) && (
                          <div className="space-y-4">
                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                              <h6 className="font-medium text-indigo-900 mb-2">🏢 CRM Integration Setup</h6>
                              <p className="text-sm text-indigo-700 mb-3">
                                Configure how invoice data should be saved to your CRM:
                              </p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  What type of record should I create? *
                                </label>
                                <select className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                  <option>Lead (New potential customers)</option>
                                  <option>Account (Company records)</option>
                                  <option>Opportunity (Sales deals)</option>
                                  <option>Contact (Individual people)</option>
                                  <option>Custom Object (Invoice records)</option>
                                </select>
                              </div>
                              
                              <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                  What if the vendor already exists?
                                </label>
                                <select className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                  <option>Update the existing record</option>
                                  <option>Create a new record anyway</option>
                                  <option>Skip and don't create anything</option>
                                  <option>Ask me what to do</option>
                                </select>
                              </div>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                How should I map the invoice data to CRM fields?
                              </label>
                              <div className="space-y-3 border border-slate-200 rounded-lg p-4">
                                <div className="grid grid-cols-3 gap-3 text-sm">
                                  <div className="font-medium text-slate-700">Invoice Field</div>
                                  <div className="font-medium text-slate-700">→ CRM Field</div>
                                  <div className="font-medium text-slate-700">Required?</div>
                                </div>
                                
                                {[
                                  { from: 'Vendor Name', to: 'Account Name', required: true },
                                  { from: 'Total Amount', to: 'Amount', required: true },
                                  { from: 'Invoice Number', to: 'Opportunity Name', required: false },
                                  { from: 'Invoice Date', to: 'Close Date', required: false },
                                  { from: 'Due Date', to: 'Custom Field', required: false }
                                ].map((mapping, idx) => (
                                  <div key={idx} className="grid grid-cols-3 gap-3 items-center">
                                    <div className="text-sm text-slate-600">{mapping.from}</div>
                                    <input 
                                      type="text" 
                                      defaultValue={mapping.to}
                                      className="px-2 py-1 border border-slate-300 rounded text-sm"
                                    />
                                    <input 
                                      type="checkbox" 
                                      defaultChecked={mapping.required}
                                      className="rounded border-slate-300"
                                    />
                                  </div>
                                ))}
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                Map invoice data to your CRM fields. Leave blank to skip a field.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* No Configuration Needed */}
                        {!agent?.requiredPlugins?.length && (
                          <div className="text-center py-8">
                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                              <CheckCircle className="h-6 w-6 text-green-600" />
                            </div>
                            <h6 className="font-medium text-slate-900 mb-1">No Configuration Needed</h6>
                            <p className="text-sm text-slate-600">
                              This agent processes data using AI and doesn't need external setup
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex justify-between items-center pt-4 border-t border-slate-200">
                        <button className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors">
                          Skip Configuration
                        </button>
                        <div className="flex gap-3">
                          <button className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors">
                            Test Configuration
                          </button>
                          <button 
                            onClick={() => updateStep(actualStepIndex, { configurationComplete: true })}
                            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all font-medium"
                          >
                            Save Configuration
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Show message if no agents assigned */}
              {steps.filter(step => step.selectedAgent).length === 0 && (
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8 text-center">
                  <div className="text-6xl mb-4">🤖</div>
                  <h4 className="text-xl font-semibold text-slate-900 mb-2">No Agents to Configure</h4>
                  <p className="text-slate-600 mb-6">
                    Go back to Phase 1 to assign agents to your workflow steps
                  </p>
                  <button
                    onClick={() => setCurrentPhase('build')}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                  >
                    ← Back to Build Phase
                  </button>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
              <div className="flex justify-between">
                <button
                  onClick={() => setCurrentPhase('connect')}
                  className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  ← Back to Connect Data
                </button>
                <button
                  onClick={() => setCurrentPhase('test')}
                  disabled={steps.filter(s => s.selectedAgent && !s.configurationComplete).length > 0}
                  className="px-6 py-3 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 disabled:from-slate-400 disabled:to-slate-500 text-white rounded-xl font-semibold transition-all disabled:cursor-not-allowed"
                >
                  {steps.filter(s => s.selectedAgent && !s.configurationComplete).length > 0 ? 
                    `Configure ${steps.filter(s => s.selectedAgent && !s.configurationComplete).length} More Steps` : 
                    'Next: Test & Validate →'
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Phase 4: Test & Validate */}
        {currentPhase === 'test' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
                  <TestTube2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">
                    Phase 4: Test & Validate
                  </h3>
                  <p className="text-slate-600">Test your workflow with sample data before going live</p>
                </div>
              </div>

              {/* Testing Interface */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 mb-4">Individual Step Testing</h4>
                  <div className="space-y-4">
                    {steps.map((step, index) => (
                      <div key={step.id} className="bg-white rounded-lg border border-slate-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h5 className="font-medium text-slate-900">Step {index + 1}: {step.title}</h5>
                            <p className="text-sm text-slate-600">{step.selectedAgent?.name}</p>
                          </div>
                          <button
                            onClick={() => testStep(index)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                          >
                            <Play className="h-4 w-4" />
                            Test Step
                          </button>
                        </div>
                        <div className="text-xs text-slate-500">
                          Last tested: Never
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-semibold text-slate-900 mb-4">End-to-End Testing</h4>
                  <div className="bg-white rounded-lg border border-slate-200 p-6">
                    <div className="text-center mb-6">
                      <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Play className="h-8 w-8 text-purple-600" />
                      </div>
                      <h5 className="text-lg font-medium text-slate-900 mb-2">Run Full Workflow Test</h5>
                      <p className="text-sm text-slate-600 mb-4">
                        Test the complete workflow from start to finish with sample data
                      </p>
                      <button className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-semibold">
                        Start End-to-End Test
                      </button>
                    </div>
                    
                    <div className="border-t border-slate-200 pt-4">
                      <h6 className="font-medium text-slate-900 mb-2">Test Results</h6>
                      <div className="text-sm text-slate-500">
                        No test results yet. Run a test to see results here.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
                <button
                  onClick={() => setCurrentPhase('configure')}
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
          </div>
        )}
      </div>
      
      <DragOverlay>
        {activeAgent && (
          <div className="bg-white rounded-lg p-4 border-2 border-purple-400 shadow-xl transform rotate-3 opacity-90">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="h-4 w-4 text-purple-600" />
              <h4 className="font-medium text-slate-900 text-sm">{activeAgent.name}</h4>
            </div>
            <p className="text-sm text-slate-600 line-clamp-1">{activeAgent.description}</p>
          </div>
        )}
        {activeIOItem && (
          <div className="bg-white rounded-lg p-3 border-2 border-green-400 shadow-xl transform rotate-2 opacity-90">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <div className="text-sm font-medium text-slate-900">
                {typeof activeIOItem === 'object' ? activeIOItem.name : activeIOItem}
              </div>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}