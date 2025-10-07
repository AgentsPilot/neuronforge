import AgentPromptBar from '@/components/agents/AgentPromptBar'
import AgentList from '@/components/agents/AgentList'
import { 
  Bot, 
  Sparkles, 
  Zap, 
  ArrowDown,
  Users,
  TrendingUp,
  Shield,
  Rocket,
  Plus,
  Layers,
  Globe,
  Clock,
  Activity
} from 'lucide-react'
import Link from 'next/link'

export default function AgentsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Ultra Modern Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-white via-blue-50/30 to-indigo-50/50">
        
        {/* Floating geometric elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-24 left-12 w-64 h-64 bg-gradient-to-br from-blue-400/5 to-purple-400/5 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute top-48 right-16 w-48 h-48 bg-gradient-to-br from-indigo-400/5 to-pink-400/5 rounded-full blur-2xl animate-pulse" style={{animationDelay: '2s'}}></div>
          <div className="absolute bottom-32 left-1/3 w-32 h-32 bg-gradient-to-br from-purple-400/5 to-blue-400/5 rounded-full blur-xl animate-pulse" style={{animationDelay: '4s'}}></div>
        </div>

        <div className="relative max-w-7xl mx-auto px-6 py-12">
          {/* Enhanced Prompt Bar with better spacing */}
          <div className="mb-8">
            <AgentPromptBar />
          </div>
        </div>

        {/* Subtle transition to next section */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-gray-50 to-transparent"></div>
      </div>

      {/* Elegant transition element */}
      <div className="relative -mt-10 mb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-center">
            <div className="group cursor-pointer">
              <div className="bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-full px-8 py-4 shadow-lg hover:shadow-xl transition-all duration-300 group-hover:scale-105">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" style={{animationDelay: '0.5s'}}></div>
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" style={{animationDelay: '1s'}}></div>
                  </div>
                  <span className="text-sm font-semibold text-slate-700">Your Automation Workspace</span>
                  <ArrowDown className="h-4 w-4 text-slate-500 group-hover:translate-y-1 transition-transform duration-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Clean agent list integration */}
      <div className="relative">
        <AgentList />
      </div>

      {/* Minimal footer spacing */}
      <div className="h-20"></div>
    </div>
  )
}