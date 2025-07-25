import AgentPromptBar from '@/components/agents/AgentPromptBar'
import AgentList from '@/components/agents/AgentList'

export default function AgentsPage() {
  return (
    <div className="flex flex-col gap-6 py-8 px-4">
      <div className="max-w-3xl mx-auto w-full">
        <AgentPromptBar />
      </div>
      <div className="max-w-3xl mx-auto w-full">
        <AgentList />
      </div>
    </div>
  )
}