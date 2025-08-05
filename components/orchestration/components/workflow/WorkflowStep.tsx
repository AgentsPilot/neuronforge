import { useState } from 'react'
import { Bot, CheckCircle, AlertCircle, Settings, Play, Trash2, Plus, Link2, ArrowRight } from 'lucide-react'
import { WorkflowStep as WorkflowStepType, Connection } from '../../types/workflow'

interface WorkflowStepProps {
  step: WorkflowStepType
  index: number
  isSelected: boolean
  onSelect: () => void
  onUpdate: (updates: Partial<WorkflowStepType>) => void
  onRemove: () => void
  onTest: () => void
  totalSteps: number
  nextStep?: WorkflowStepType
  connections: Connection[]
}

export const WorkflowStep = ({ 
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
}: WorkflowStepProps) => {
  const [showConfig, setShowConfig] = useState(false)
  const [customInputs, setCustomInputs] = useState(step.customInputs || [])
  const [customOutputs, setCustomOutputs] = useState(step.customOutputs || [])
  const [showInputModal, setShowInputModal] = useState(false)
  const [showOutputModal, setShowOutputModal] = useState(false)
  const [newField, setNewField] = useState({ name: '', type: 'text', description: '', required: false })
  
  const hasAgent = !!step.selectedAgent
  const isConfigured = hasAgent && step.isConfigured !== false
  const hasConnections = connections.some(c => c.fromStep === index || c.toStep === index)

  // Field type options
  const fieldTypes = [
    { value: 'text', label: 'Text', icon: '📝', description: 'Single line text input' },
    { value: 'textarea', label: 'Long Text', icon: '📄', description: 'Multi-line text input' },
    { value: 'number', label: 'Number', icon: '🔢', description: 'Numeric values' },
    { value: 'email', label: 'Email', icon: '📧', description: 'Email address' },
    { value: 'date', label: 'Date', icon: '📅', description: 'Date picker' },
    { value: 'datetime', label: 'Date & Time', icon: '🕐', description: 'Date and time picker' },
    { value: 'select', label: 'Dropdown', icon: '📋', description: 'Select from options' },
    { value: 'multiselect', label: 'Multi-Select', icon: '☑️', description: 'Multiple selections' },
    { value: 'boolean', label: 'Yes/No', icon: '✅', description: 'True/false checkbox' },
    { value: 'file', label: 'File', icon: '📎', description: 'File upload' },
    { value: 'url', label: 'URL', icon: '🔗', description: 'Web address' },
    { value: 'json', label: 'JSON Data', icon: '🔧', description: 'Structured data object' }
  ]

  const addCustomInput = () => {
    setNewField({ name: '', type: 'text', description: '', required: false })
    setShowInputModal(true)
  }

  const addCustomOutput = () => {
    setNewField({ name: '', type: 'text', description: '', required: false })
    setShowOutputModal(true)
  }

  const handleAddField = (type: 'input' | 'output') => {
    if (!newField.name.trim()) return

    const field = {
      name: newField.name.toLowerCase().replace(/\s+/g, '_'),
      displayName: newField.name,
      type: newField.type,
      description: newField.description,
      required: newField.required
    }

    if (type === 'input') {
      const updatedInputs = [...customInputs, field]
      setCustomInputs(updatedInputs)
      onUpdate({ customInputs: updatedInputs })
      setShowInputModal(false)
    } else {
      const updatedOutputs = [...customOutputs, field]
      setCustomOutputs(updatedOutputs)
      onUpdate({ customOutputs: updatedOutputs })
      setShowOutputModal(false)
    }

    setNewField({ name: '', type: 'text', description: '', required: false })
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

              {/* Customization Help Text */}
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Settings className="h-3 w-3 text-blue-600" />
                  </div>
                  <div>
                    <h6 className="font-medium text-blue-900 text-sm mb-1">Customize Inputs & Outputs</h6>
                    <div className="text-xs text-blue-700 space-y-1">
                      <p>• <strong>Gray fields</strong> are from the agent template (read-only)</p>
                      <p>• <strong>Colored fields</strong> are custom - you can edit and remove them</p>
                      <p>• <strong>Click "Add Field"</strong> to create custom fields with specific data types</p>
                      <p>• <strong>Support 12+ field types</strong> - text, numbers, dates, files, etc.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Input/Output Management */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {/* Inputs */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                      📥 Inputs ({allInputs.length})
                    </h5>
                    <button
                      onClick={addCustomInput}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors flex items-center gap-1 font-medium"
                      title="Add custom input field"
                    >
                      <Plus className="h-3 w-3" />
                      Add Field
                    </button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {allInputs.map((input, idx) => {
                      const isCustom = idx >= (step.selectedAgent?.inputs?.length || 0)
                      const inputName = typeof input === 'object' ? (input.displayName || input.name) : input
                      const inputDescription = typeof input === 'object' ? input.description : ''
                      const inputType = typeof input === 'object' ? input.type : 'text'
                      const isRequired = typeof input === 'object' ? input.required : false
                      
                      return (
                        <div key={idx} className="group">
                          <div className={`flex items-start gap-2 p-3 rounded-md border transition-all ${
                            isCustom ? 'bg-blue-50 border-blue-200 hover:border-blue-300' : 'bg-slate-50 border-slate-200'
                          }`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="text-sm font-medium text-slate-900 flex items-center gap-1">
                                  {inputName}
                                  {isRequired && <span className="text-red-500 text-xs">*</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                                    {fieldTypes.find(ft => ft.value === inputType)?.icon || '📝'} {fieldTypes.find(ft => ft.value === inputType)?.label || inputType}
                                  </span>
                                  {isCustom && (
                                    <span className="text-xs bg-blue-200 text-blue-700 px-2 py-0.5 rounded-full">
                                      Custom
                                    </span>
                                  )}
                                </div>
                              </div>
                              {inputDescription && (
                                <div className="text-xs text-slate-600">{inputDescription}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded-full bg-blue-500" />
                              {isCustom && (
                                <button
                                  onClick={() => removeCustomIO('input', idx - (step.selectedAgent?.inputs?.length || 0))}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded transition-all"
                                  title="Remove custom input"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {allInputs.length === 0 && (
                      <div className="text-center py-6 text-slate-500 border-2 border-dashed border-slate-300 rounded-lg">
                        <div className="text-2xl mb-2">📥</div>
                        <p className="text-sm">No input fields defined</p>
                        <p className="text-xs">Click "Add Field" to create custom inputs</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Outputs */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-medium text-slate-900 flex items-center gap-2">
                      📤 Outputs ({allOutputs.length})
                    </h5>
                    <button
                      onClick={addCustomOutput}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition-colors flex items-center gap-1 font-medium"
                      title="Add custom output field"
                    >
                      <Plus className="h-3 w-3" />
                      Add Field
                    </button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {allOutputs.map((output, idx) => {
                      const isCustom = idx >= (step.selectedAgent?.outputs?.length || 0)
                      const outputName = typeof output === 'object' ? (output.displayName || output.name) : output
                      const outputDescription = typeof output === 'object' ? output.description : ''
                      const outputType = typeof output === 'object' ? output.type : 'text'
                      const isRequired = typeof output === 'object' ? output.required : false
                      
                      return (
                        <div key={idx} className="group">
                          <div className={`flex items-start gap-2 p-3 rounded-md border transition-all ${
                            isCustom ? 'bg-green-50 border-green-200 hover:border-green-300' : 'bg-slate-50 border-slate-200'
                          }`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="text-sm font-medium text-slate-900 flex items-center gap-1">
                                  {outputName}
                                  {isRequired && <span className="text-red-500 text-xs">*</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                                    {fieldTypes.find(ft => ft.value === outputType)?.icon || '📝'} {fieldTypes.find(ft => ft.value === outputType)?.label || outputType}
                                  </span>
                                  {isCustom && (
                                    <span className="text-xs bg-green-200 text-green-700 px-2 py-0.5 rounded-full">
                                      Custom
                                    </span>
                                  )}
                                </div>
                              </div>
                              {outputDescription && (
                                <div className="text-xs text-slate-600">{outputDescription}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded-full bg-green-500" />
                              {isCustom && (
                                <button
                                  onClick={() => removeCustomIO('output', idx - (step.selectedAgent?.outputs?.length || 0))}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded transition-all"
                                  title="Remove custom output"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {allOutputs.length === 0 && (
                      <div className="text-center py-6 text-slate-500 border-2 border-dashed border-slate-300 rounded-lg">
                        <div className="text-2xl mb-2">📤</div>
                        <p className="text-sm">No output fields defined</p>
                        <p className="text-xs">Click "Add Field" to create custom outputs</p>
                      </div>
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

      {/* Add Input Field Modal */}
      {showInputModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Add Custom Input Field</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Field Name *</label>
                  <input
                    type="text"
                    value={newField.name}
                    onChange={(e) => setNewField({ ...newField, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Folder Name, Date Range, Priority Level"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Field Type *</label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {fieldTypes.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => setNewField({ ...newField, type: type.value })}
                        className={`p-3 text-left border rounded-lg transition-all ${
                          newField.type === type.value
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span>{type.icon}</span>
                          <span className="text-sm font-medium">{type.label}</span>
                        </div>
                        <div className="text-xs text-slate-600">{type.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea
                    value={newField.description}
                    onChange={(e) => setNewField({ ...newField, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    rows={2}
                    placeholder="Optional description of what this field is used for"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="required-input"
                    checked={newField.required}
                    onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="required-input" className="ml-2 text-sm text-slate-700">
                    This field is required
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowInputModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleAddField('input')}
                  disabled={!newField.name.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
                >
                  Add Input Field
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Output Field Modal */}
      {showOutputModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Add Custom Output Field</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Field Name *</label>
                  <input
                    type="text"
                    value={newField.name}
                    onChange={(e) => setNewField({ ...newField, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Filtered Emails, Match Count, Summary Report"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Field Type *</label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {fieldTypes.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => setNewField({ ...newField, type: type.value })}
                        className={`p-3 text-left border rounded-lg transition-all ${
                          newField.type === type.value
                            ? 'border-green-500 bg-green-50 text-green-900'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span>{type.icon}</span>
                          <span className="text-sm font-medium">{type.label}</span>
                        </div>
                        <div className="text-xs text-slate-600">{type.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea
                    value={newField.description}
                    onChange={(e) => setNewField({ ...newField, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    rows={2}
                    placeholder="Optional description of what this field contains"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="required-output"
                    checked={newField.required}
                    onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                    className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                  />
                  <label htmlFor="required-output" className="ml-2 text-sm text-slate-700">
                    This field is required
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowOutputModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleAddField('output')}
                  disabled={!newField.name.trim()}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
                >
                  Add Output Field
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}