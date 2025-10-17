import AgentPromptBar from '@/components/agents/AgentPromptBar'
import AgentList from '@/components/agents/AgentList'
import { 
  ArrowDown
} from 'lucide-react'

export default function AgentsPage() {
  return (
    <div className="min-h-screen">
      {/* Clean Header Section */}
      <div className="relative">
        <div className="max-w-7xl mx-auto px-6 py-12">
          {/* Prompt Bar */}
          <div className="mb-8">
            <AgentPromptBar />
          </div>
        </div>
      </div>

      {/* Simple transition element */}
      <div className="relative mb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-center">
            <div className="group cursor-pointer">
              <div className="border border-gray-200 rounded-full px-8 py-4 hover:border-gray-300 transition-all duration-300">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                  </div>
                  <span className="text-sm font-semibold text-slate-700">Your Automation Workspace</span>
                  <ArrowDown className="h-4 w-4 text-slate-500 group-hover:translate-y-1 transition-transform duration-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Clean agent list */}
      <div className="relative">
        <AgentList />
      </div>

      {/* Footer spacing */}
      <div className="h-20"></div>
    </div>
  )
}