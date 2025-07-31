import AgentPromptBar from '@/components/agents/AgentPromptBar'
import AgentList from '@/components/agents/AgentList'

export default function AgentsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section with Prompt Bar */}
      <div className="bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <AgentPromptBar />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200"></div>

      {/* Agent List Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AgentList />
      </div>
    </div>
  )
}