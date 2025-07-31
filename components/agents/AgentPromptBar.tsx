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
  Wand2,
  MessageSquare,
  Rocket
} from 'lucide-react'

const EXAMPLE_PROMPTS = [
  "Monitor my emails for mentions of 'urgent' and send me alerts",
  "Extract invoice data from PDFs and save to spreadsheet",
  "Analyze customer feedback and categorize sentiment",
  "Schedule social media posts based on trending topics",
  "Generate weekly reports from sales data"
]

export default function AgentPromptBar() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    try {
      const encodedPrompt = encodeURIComponent(prompt.trim())
      router.push(`/agents/new?prompt=${encodedPrompt}`)
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
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create Your AI Agent</h1>
            <p className="text-gray-600">Describe what you want to automate, and we'll build it for you</p>
          </div>
        </div>
      </div>

      {/* Main Prompt Input */}
      <div className="relative">
        <form onSubmit={handleSubmit} className="relative">
          <div className="relative bg-white border-2 border-gray-200 rounded-2xl shadow-lg hover:border-blue-300 focus-within:border-blue-500 focus-within:shadow-xl transition-all duration-300">
            {/* Input Area */}
            <div className="flex items-center p-4 gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your automation idea... (e.g., 'Monitor my emails for important keywords and send me daily summaries')"
                className="flex-1 resize-none border-none focus:ring-0 bg-transparent placeholder-gray-500 text-gray-900 text-base leading-relaxed min-h-[60px] max-h-32"
                disabled={loading}
                rows={1}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 128) + 'px'
                }}
              />

              <Button
                type="submit"
                disabled={loading || !prompt.trim()}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium px-6 py-3 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Creating...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Wand2 className="w-4 h-4" />
                    <span>Create Agent</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
              </Button>
            </div>

            {/* Character Counter */}
            {prompt.length > 0 && (
              <div className="px-4 pb-2">
                <div className="text-xs text-gray-500 text-right">
                  {prompt.length} characters
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Magic Sparkles Animation */}
        <div className="absolute -top-2 -right-2 pointer-events-none">
          <div className="relative">
            <Sparkles className="w-6 h-6 text-yellow-400 animate-pulse" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full animate-ping"></div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          onClick={() => setShowExamples(!showExamples)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 border-gray-300 hover:border-gray-400"
        >
          <Lightbulb className="w-4 h-4" />
          {showExamples ? 'Hide Examples' : 'Show Examples'}
        </Button>
        
        <div className="w-px h-6 bg-gray-300"></div>
        
        <Button
          variant="outline"
          onClick={() => router.push('/agents/new')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 border-gray-300 hover:border-gray-400"
        >
          <Bot className="w-4 h-4" />
          Manual Setup
        </Button>
      </div>

      {/* Example Prompts */}
      {showExamples && (
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-6 border border-blue-100">
          <div className="flex items-center gap-2 mb-4">
            <Rocket className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-gray-900">Popular Automation Ideas</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {EXAMPLE_PROMPTS.map((example, index) => (
              <button
                key={index}
                onClick={() => handleExampleClick(example)}
                className="text-left p-4 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:from-blue-200 group-hover:to-purple-200 transition-colors">
                    <Zap className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-900 leading-relaxed">{example}</p>
                    <p className="text-xs text-blue-600 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Click to use this example →
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          
          <div className="mt-4 p-3 bg-blue-100 rounded-lg">
            <p className="text-xs text-blue-800">
              💡 <strong>Tip:</strong> Be specific about your goals. The more detail you provide, the better your agent will be!
            </p>
          </div>
        </div>
      )}

      {/* Features Preview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="text-center p-4">
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Zap className="w-6 h-6 text-green-600" />
          </div>
          <h4 className="font-medium text-gray-900 mb-2">Instant Setup</h4>
          <p className="text-sm text-gray-600">AI analyzes your prompt and configures the agent automatically</p>
        </div>
        
        <div className="text-center p-4">
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Bot className="w-6 h-6 text-purple-600" />
          </div>
          <h4 className="font-medium text-gray-900 mb-2">Smart Automation</h4>
          <p className="text-sm text-gray-600">Connects to your tools and works 24/7 without supervision</p>
        </div>
        
        <div className="text-center p-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6 text-blue-600" />
          </div>
          <h4 className="font-medium text-gray-900 mb-2">Always Learning</h4>
          <p className="text-sm text-gray-600">Gets smarter over time and adapts to your preferences</p>
        </div>
      </div>
    </div>
  )
}