import { Bot } from 'lucide-react'
import { AgentLibraryItem } from '../../types/agents'
import { DraggableAgent } from './DraggableAgent'

interface AgentLibraryProps {
  title: string
  description?: string
  agents: AgentLibraryItem[]
  icon?: React.ReactNode
  onAssignAgent?: (agent: AgentLibraryItem) => void
  maxHeight?: string
}

export const AgentLibrary = ({ 
  title, 
  description, 
  agents, 
  icon, 
  onAssignAgent,
  maxHeight = 'max-h-60'
}: AgentLibraryProps) => {
  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
          {icon || <Bot className="h-4 w-4 text-white" />}
        </div>
        <h3 className="font-bold text-slate-900">{title}</h3>
      </div>
      
      {description && (
        <p className="text-sm text-slate-600 mb-4">{description}</p>
      )}
      
      <div className={`space-y-3 ${maxHeight} overflow-y-auto`}>
        {agents.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-4">
            No agents available.
          </div>
        ) : (
          agents.map((agent) => (
            <DraggableAgent 
              agent={agent} 
              key={agent.id}
              onAssignToStep={onAssignAgent}
            />
          ))
        )}
      </div>
    </div>
  )
}