import React from 'react'
import {
  Plus,
  Trash2,
  GripVertical,
  Settings,
  ChevronDown,
  ChevronUp,
  X,
  Library
} from 'lucide-react'

const StepAgentBuilder = ({
  step,
  index,
  isSelected,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate,
  agentLibrary,
}) => {
  // Prefer object, fallback to name
  let assignedAgent = null
  if (step.selectedAgent && typeof step.selectedAgent === 'object') {
    assignedAgent = step.selectedAgent
  } else if (step.selectedAgent && typeof step.selectedAgent === 'string') {
    assignedAgent = agentLibrary.find(a => a.name === step.selectedAgent)
  }

  return (
    <div
      className={`bg-white border rounded-lg shadow-sm transition-all ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'
      }`}
    >
      <div className="p-4">
        {/* --- Assigned agent badge at the top --- */}
        {assignedAgent ? (
          <div className="mb-3 flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
            <Library className="w-5 h-5 text-purple-600" />
            <div>
              <div className="font-semibold text-purple-900">{assignedAgent.name}</div>
              <div className="text-xs text-purple-700">{assignedAgent.description}</div>
              {/* Show details, e.g. */}
              <div className="flex flex-wrap gap-2 mt-1">
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                  {assignedAgent.category}
                </span>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
                  {assignedAgent.inputs?.length || 0} inputs
                </span>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
                  {assignedAgent.outputs?.length || 0} outputs
                </span>
              </div>
            </div>
            <button
              className="ml-auto text-xs text-purple-500 hover:text-red-500"
              onClick={() => onUpdate({ selectedAgent: null, inputs: [], outputs: [] })}
              title="Remove agent"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-500 text-xs italic">
            <Library className="w-4 h-4 text-gray-400" />
            Drag and drop an agent here to assign
          </div>
        )}

        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1">
            <div className="cursor-move mt-1" title="Drag to reorder">
              <GripVertical className="w-5 h-5 text-gray-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <span className="text-xs font-medium text-gray-500">STEP {index + 1}</span>
              </div>
              <input
                type="text"
                value={step.title}
                onChange={(e) => onUpdate({ title: e.target.value })}
                className="text-lg font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 py-0.5 transition-colors w-full"
                onClick={onSelect}
              />
              <input
                type="text"
                value={step.description}
                onChange={(e) => onUpdate({ description: e.target.value })}
                placeholder="Add a description..."
                className="text-sm text-gray-600 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 py-0.5 w-full mt-1 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2 ml-4">
            <button
              onClick={() => onUpdate({ expanded: !step.expanded })}
              className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
              title={step.expanded ? 'Collapse' : 'Expand'}
            >
              {step.expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
            <button
              onClick={onSelect}
              className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
              title="Configure step"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={onDuplicate}
              className="p-1 text-gray-400 hover:text-indigo-600 rounded hover:bg-indigo-50"
              title="Duplicate step"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={onRemove}
              className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
              title="Delete step"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Actions/conditions/etc. shown only if agent is assigned */}
        {assignedAgent ? (
          <div className="mt-4">
            {/* Replace with your actions/conditions UI */}
            <div className="text-sm text-gray-700 italic">
              {/* Placeholder: */}
              Actions and advanced configuration for <b>{assignedAgent.name}</b> will appear here.
            </div>
          </div>
        ) : (
          <div className="mt-4 text-xs text-gray-400 italic">
            Assign an agent to this step to configure actions and settings.
          </div>
        )}
      </div>
    </div>
  )
}

export default StepAgentBuilder