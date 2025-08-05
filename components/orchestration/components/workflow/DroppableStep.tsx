import { useState } from 'react'
import { Bot } from 'lucide-react'
import { WorkflowStep } from '../../types/workflow'
import { AgentLibraryItem } from '../../types/agents'

interface DroppableStepProps {
  step: WorkflowStep
  index: number
  children: React.ReactNode
  onAgentDrop: (agent: AgentLibraryItem, stepIndex: number) => void
}

export const DroppableStep = ({ step, index, children, onAgentDrop }: DroppableStepProps) => {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    try {
      const agentData = e.dataTransfer.getData('application/json')
      const agent = JSON.parse(agentData)
      onAgentDrop(agent, index)
    } catch (error) {
      console.error('Failed to parse dropped agent data:', error)
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative transition-all duration-200 ${
        isDragOver ? 'ring-2 ring-purple-400 bg-purple-50/30 rounded-xl' : ''
      }`}
    >
      {children}
      {isDragOver && (
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