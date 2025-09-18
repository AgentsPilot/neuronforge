'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { 
  Sparkles, 
  Zap, 
  ArrowRight, 
  Bot, 
  Lightbulb,
  MessageSquare,
  Rocket
} from 'lucide-react'

const EXAMPLE_PROMPTS = [
  "Monitor emails for 'urgent' mentions and alert me",
  "Extract invoice data from PDFs to spreadsheet",
  "Analyze customer feedback sentiment",
  "Schedule social posts from trending topics",
  "Generate weekly sales reports"
]

export default function AgentPromptBar() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const router = useRouter()

  const clearAgentBuilderStorage = () => {
    try {
      localStorage.removeItem('agent_builder_conversational_state')
      localStorage.removeItem('agent_builder_smart_state')
      localStorage.removeItem('agent_builder_current_phase')
      localStorage.removeItem('agent_builder_user_view_preference')
      localStorage.removeItem('agent_builder_session_key')
      console.log('✅ Cleared agent builder storage')
    } catch (error) {
      console.error('❌ Error clearing storage:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedPrompt = prompt.trim()
    
    // Minimum length validation (10 characters is reasonable for meaningful automation ideas)
    if (trimmedPrompt.length < 10) {
      return
    }

    setLoading(true)
    try {
      clearAgentBuilderStorage()
      const encodedPrompt = encodeURIComponent(trimmedPrompt)
      router.push(`/agents/new/chat?prompt=${encodedPrompt}`)
    } catch (err) {
      console.error('🚨 Redirect failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleExampleClick = (example: string) => {
    setPrompt(example)
    setShowExamples(false)
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      {/* Modern Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-2xl shadow-lg mb-3">
          <Bot className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-purple-800 bg-clip-text text-transparent">
          Describe Your Task
        </h1>
        <p className="text-gray-600 text-sm font-medium">Chat with AI to build your automation</p>
      </div>

      {/* Modern Chat Interface */}
      <form onSubmit={handleSubmit}>
        <div className="relative group">
          {/* Animated background gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-2xl blur-xl group-hover:blur-lg transition-all duration-300"></div>
          
          <div className="relative bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl shadow-xl hover:shadow-2xl focus-within:shadow-2xl transition-all duration-300">
            <div className="flex items-center p-4 gap-4">
              {/* Modern chat bubble icon */}
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <MessageSquare className="h-5 w-5 text-white" />
                </div>
                {/* Pulse animation */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl animate-ping opacity-20"></div>
              </div>
              
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your automation idea and I'll help you build it..."
                className="flex-1 border-none focus:ring-0 bg-transparent placeholder-gray-400 text-gray-900 text-base font-medium resize-none min-h-[60px] max-h-32"
                disabled={loading}
                rows={3}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 128) + 'px'
                }}
              />

              <Button
                type="submit"
                disabled={loading || prompt.trim().length < 10}
                className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:transform-none"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Starting...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>Start Chat</span>
                    <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center">
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                )}
              </Button>
            </div>
            
            {/* Enhanced typing indicator with character count */}
            {prompt.length > 0 && (
              <div className="px-4 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="flex gap-1">
                      <div className="w-1 h-1 bg-blue-400 rounded-full animate-bounce"></div>
                      <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-1 h-1 bg-pink-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                    <span>AI is ready to chat</span>
                  </div>
                  <div className="text-xs">
                    <span className={`font-medium ${
                      prompt.trim().length < 10 
                        ? 'text-red-500' 
                        : 'text-green-600'
                    }`}>
                      {prompt.length}
                    </span>
                    <span className="text-gray-400 mx-1">/</span>
                    <span className="text-gray-500">10 min</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Modern Controls */}
      <div className="flex justify-center">
        <button
          onClick={() => setShowExamples(!showExamples)}
          className={`group flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all duration-300 ${
            showExamples
              ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg transform scale-105'
              : 'bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 hover:border-blue-200 shadow-lg hover:shadow-xl'
          }`}
        >
          <div className="relative">
            <Lightbulb className={`w-4 h-4 transition-all duration-300 ${showExamples ? 'text-white' : 'text-blue-500 group-hover:scale-110'}`} />
            {!showExamples && (
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full animate-pulse"></div>
            )}
          </div>
          <span className="text-sm">{showExamples ? 'Hide Examples' : 'Examples'}</span>
        </button>
      </div>

      {/* Modern Examples */}
      {showExamples && (
        <div className="relative group">
          {/* Glassmorphism background */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-blue-50/40 to-purple-50/40 backdrop-blur-lg rounded-2xl"></div>
          <div className="relative bg-white/60 backdrop-blur-sm rounded-2xl p-5 border border-white/20 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
                <Rocket className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900">Popular Automation Ideas</h3>
            </div>
            
            <div className="space-y-3">
              {EXAMPLE_PROMPTS.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="w-full group relative overflow-hidden bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-white/30 hover:border-blue-300/50 transition-all duration-300 hover:shadow-lg hover:transform hover:scale-[1.02]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-purple-100 group-hover:from-blue-200 group-hover:to-purple-200 rounded-lg flex items-center justify-center transition-all duration-300">
                      <Zap className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="text-sm text-gray-900 font-medium text-left flex-1">{example}</span>
                    <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transform group-hover:translate-x-1 transition-all duration-300 opacity-0 group-hover:opacity-100" />
                  </div>
                  
                  {/* Subtle hover effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </button>
              ))}
            </div>
            
            <div className="mt-4 p-3 bg-gradient-to-r from-blue-50/80 to-purple-50/80 backdrop-blur-sm rounded-xl border border-blue-200/30">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
                <p className="text-xs text-gray-700 font-medium">
                  <strong>Tip:</strong> Don't worry about being perfect - I'll ask questions to understand your needs!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern Features */}
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center group">
          <div className="flex justify-center mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-300">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
          </div>
          <h4 className="font-semibold text-gray-900 text-sm mb-1">Chat Setup</h4>
          <p className="text-xs text-gray-600 leading-relaxed">Natural conversation with AI</p>
        </div>
        
        <div className="text-center group">
          <div className="flex justify-center mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-300">
              <Bot className="w-5 h-5 text-white" />
            </div>
          </div>
          <h4 className="font-semibold text-gray-900 text-sm mb-1">Smart Questions</h4>
          <p className="text-xs text-gray-600 leading-relaxed">AI guides the process</p>
        </div>
        
        <div className="text-center group">
          <div className="flex justify-center mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-300">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
          </div>
          <h4 className="font-semibold text-gray-900 text-sm mb-1">Auto-Enhanced</h4>
          <p className="text-xs text-gray-600 leading-relaxed">Technical details added automatically</p>
        </div>
      </div>
    </div>
  )
}