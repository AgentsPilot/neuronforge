import { Library } from 'lucide-react'
import { AgentLibraryItem } from '../../types/agents'
import { AgentLibrary } from './AgentLibrary'

interface AgentRecommendationsProps {
  workflowDescription: string
  recommendedAgents: AgentLibraryItem[]
  onAssignAgent?: (agent: AgentLibraryItem) => void
}

export const AgentRecommendations = ({ 
  workflowDescription, 
  recommendedAgents, 
  onAssignAgent 
}: AgentRecommendationsProps) => {
  return (
    <AgentLibrary
      title="Recommended Agents"
      description={`Based on your workflow: "${workflowDescription}"`}
      agents={recommendedAgents}
      icon={<Library className="h-4 w-4 text-white" />}
      onAssignAgent={onAssignAgent}
    />
  )
}