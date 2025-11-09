import { useState } from 'react'
import { GripVertical, Plug } from 'lucide-react'
import { AgentLibraryItem } from '../../types/agents'
import { availablePlugins } from '../../constants/plugins'

interface DraggableAgentProps {
  agent: AgentLibraryItem
  onAssignToStep?: (agent: AgentLibraryItem) => void
}

export const DraggableAgent = ({ agent, onAssignToStep }: DraggableAgentProps) => {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    e.dataTransfer.setData('application/json', JSON.stringify(agent))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
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
        {onAssignToStep && (
          <button
            onClick={() => onAssignToStep(agent)}
            className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700"
          >
            Assign
          </button>
        )}
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
              {(agent.inputs?.length || 0) > 2 && '...'}
            </div>
          </div>
          <div>
            <span className="text-slate-500">Out:</span>
            <div className="text-slate-700">
              {agent.outputs?.slice(0, 2).map(output => 
                typeof output === 'object' ? output.name : output
              ).join(', ')}
              {(agent.outputs?.length || 0) > 2 && '...'}
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