'use client'

import React, { useState, useEffect } from 'react'
import {
  MessageSquare,
  Settings,
  Lightbulb,
  Copy,
  Wand2,
  CheckCircle,
  AlertCircle,
  Info,
  Sparkles,
  Eye,
  EyeOff,
  RotateCcw,
  X,
  Star,
  Brain,
  Target
} from 'lucide-react'

interface Props {
  data: {
    systemPrompt: string
    userPrompt: string
  }
  onUpdate: (data: Partial<Props['data']>) => void
}

const SYSTEM_PROMPT_TEMPLATES = [
  {
    category: 'Assistant Roles',
    prompts: [
      { name: 'Professional Assistant', prompt: 'You are a professional and helpful assistant. Always provide accurate, concise, and well-structured responses.' },
      { name: 'Technical Expert', prompt: 'You are a technical expert with deep knowledge in your field. Provide detailed, accurate technical information and explanations.' },
      { name: 'Creative Writer', prompt: 'You are a creative and engaging writer. Use vivid language, storytelling techniques, and maintain an engaging tone.' },
      { name: 'Data Analyst', prompt: 'You are a data analyst. Focus on accuracy, provide insights backed by data, and present information in a clear, analytical manner.' }
    ]
  },
  {
    category: 'Behavior & Tone',
    prompts: [
      { name: 'Friendly & Casual', prompt: 'Use a friendly, conversational tone. Be approachable and warm while maintaining professionalism.' },
      { name: 'Formal & Professional', prompt: 'Maintain a formal, professional tone. Use proper business language and structured responses.' },
      { name: 'Concise & Direct', prompt: 'Be concise and direct. Provide clear, actionable information without unnecessary elaboration.' },
      { name: 'Detailed & Thorough', prompt: 'Provide comprehensive, detailed responses. Include relevant context and thorough explanations.' }
    ]
  }
]

const USER_PROMPT_EXAMPLES = [
  {
    category: 'Content Processing',
    examples: [
      'Analyze the sentiment of customer feedback and categorize it as positive, negative, or neutral',
      'Extract key information from invoices including total amount, due date, and vendor details',
      'Summarize meeting transcripts and identify action items and key decisions',
      'Review documents for compliance with company standards and flag any issues'
    ]
  },
  {
    category: 'Data Analysis',
    examples: [
      'Analyze sales data and provide insights on trends, patterns, and recommendations',
      'Review customer support tickets and categorize them by priority and department',
      'Process survey responses and generate a summary report with key findings',
      'Analyze website traffic data and identify optimization opportunities'
    ]
  },
  {
    category: 'Communication',
    examples: [
      'Draft professional email responses based on incoming customer inquiries',
      'Create social media posts based on product announcements and company news',
      'Generate personalized follow-up messages for sales prospects',
      'Write weekly newsletter content based on company updates and industry news'
    ]
  }
]

export default function Step2Prompts({ data, onUpdate }: Props) {
  const [showSystemTemplates, setShowSystemTemplates] = useState(false)
  const [showUserExamples, setShowUserExamples] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [systemCharCount, setSystemCharCount] = useState(0)
  const [userCharCount, setUserCharCount] = useState(0)
  const [userPromptError, setUserPromptError] = useState('')
  const [isEnhancing, setIsEnhancing] = useState(false)

  // AI Assistant state
  const [assistantActive, setAssistantActive] = useState(false)
  const [assistantMode, setAssistantMode] = useState<'idle' | 'thinking' | 'suggesting' | 'celebrating'>('idle')
  const [showOverlay, setShowOverlay] = useState(false)
  const [assistantMessages, setAssistantMessages] = useState<string[]>([])

  useEffect(() => {
    setSystemCharCount(data.systemPrompt?.length || 0)
    setUserCharCount(data.userPrompt?.length || 0)
  }, [data.systemPrompt, data.userPrompt])

  const validateUserPrompt = (prompt: string) => {
    if (!prompt.trim()) {
      setUserPromptError('User prompt is required')
      return false
    }
    if (prompt.length < 10) {
      setUserPromptError('User prompt should be at least 10 characters')
      return false
    }
    setUserPromptError('')
    return true
  }

  const handleUserPromptChange = (value: string) => {
    onUpdate({ userPrompt: value })
    validateUserPrompt(value)
  }

  const handleSystemPromptChange = (value: string) => {
    onUpdate({ systemPrompt: value })
  }

  const addAssistantMessage = (message: string) => {
    setAssistantMessages(prev => [...prev.slice(-2), message])
  }

  const handleSystemFocus = () => {
    setAssistantActive(true)
    setAssistantMode('suggesting')
    addAssistantMessage("The system prompt defines your agent's personality and role. Think: 'You are a professional analyst...'")
  }

  const handleUserFocus = () => {
    setAssistantActive(true)
    setAssistantMode('suggesting')
    addAssistantMessage("Be specific about the task! What exactly should your agent do with the input?")
    setTimeout(() => {
      addAssistantMessage("Try starting with an action word like 'Analyze', 'Extract', or 'Summarize'")
    }, 2000)
  }

  const activateOverlayMode = () => {
    setShowOverlay(true)
    setAssistantMode('thinking')
    addAssistantMessage("Focus mode activated! Let me highlight the key areas to complete.")
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleTemplateSelect = (template: string) => {
    handleSystemPromptChange(template)
    setShowSystemTemplates(false)
  }

  const handleExampleSelect = (example: string) => {
    handleUserPromptChange(example)
    setShowUserExamples(false)
  }

  const generateSmartPrompt = () => {
    const examples = [
      'Analyze the provided content and extract the most important information',
      'Process the input data and provide a structured summary',
      'Review the document and identify key insights and recommendations',
      'Examine the information and generate actionable next steps'
    ]
    const randomExample = examples[Math.floor(Math.random() * examples.length)]
    handleUserPromptChange(randomExample)
  }

  // Fixed ChatGPT Enhancement Function - keeps original prompt visible until success
  const enhanceUserPrompt = async () => {
    if (!data.userPrompt || data.userPrompt.length < 5) {
      addAssistantMessage("Please enter a basic prompt first, then I can enhance it for you!")
      setAssistantActive(true)
      return
    }

    // Store the original prompt but DON'T clear the textarea yet
    const originalPrompt = data.userPrompt

    setIsEnhancing(true)
    setAssistantMode('thinking')
    setAssistantActive(true)
    addAssistantMessage("Connecting to ChatGPT to enhance your prompt...")

    try {
      const response = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: originalPrompt
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API call failed: ${response.status}`)
      }

      const result = await response.json()
      
      // Only NOW replace the content with the enhanced prompt
      handleUserPromptChange(result.enhancedPrompt)
      
      setAssistantMode('celebrating')
      addAssistantMessage("ChatGPT enhanced your prompt! Not happy with the result? Click 'AI Enhance This Prompt' again to regenerate!")
      
      setTimeout(() => {
        setAssistantMode('idle')
      }, 3000)
      
    } catch (error: any) {
      // If there's an error, the original prompt remains visible (we never cleared it)
      setAssistantMode('idle')
      addAssistantMessage(`Enhancement failed: ${error.message}. Your original prompt is still there - try again!`)
      console.error('ChatGPT Enhancement Error:', error)
    } finally {
      setIsEnhancing(false)
    }
  }

  const clearPrompts = () => {
    onUpdate({ systemPrompt: '', userPrompt: '' })
    setUserPromptError('')
  }

  // Show enhancement card condition
  const shouldShowCard = data.userPrompt && data.userPrompt.length >= 5

  // AI Assistant Component
  const AIAssistant = () => {
    if (!assistantActive) return null

    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer group ${
            assistantMode === 'celebrating' 
              ? 'bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 animate-spin' 
              : assistantMode === 'thinking'
              ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 animate-pulse'
              : 'bg-gradient-to-r from-green-500 via-teal-500 to-blue-600 hover:scale-110'
          }`}
          onClick={() => activateOverlayMode()}
          >
            {assistantMode === 'celebrating' ? (
              <Star className="h-8 w-8 text-white animate-bounce" />
            ) : assistantMode === 'thinking' ? (
              <Brain className="h-8 w-8 text-white animate-pulse" />
            ) : (
              <MessageSquare className="h-8 w-8 text-white group-hover:rotate-12 transition-transform" />
            )}
          </div>

          {/* Message Bubbles */}
          {assistantMessages.length > 0 && (
            <div className="fixed bottom-6 right-24 space-y-3 z-40" style={{ width: '350px' }}>
              {assistantMessages.map((message, index) => (
                <div 
                  key={index}
                  className="bg-gradient-to-r from-white to-green-50 border-2 border-green-200 rounded-2xl shadow-xl animate-in slide-in-from-right-2 duration-300"
                  style={{ 
                    animationDelay: `${index * 100}ms`,
                    width: '350px',
                    minWidth: '350px',
                    maxWidth: '350px',
                    padding: '20px 28px',
                    boxSizing: 'border-box'
                  }}
                >
                  <p 
                    className="text-base font-semibold text-gray-800 leading-relaxed"
                    style={{
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      whiteSpace: 'normal',
                      width: '100%'
                    }}
                  >
                    {message}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Dismiss button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setAssistantActive(false)
              setShowOverlay(false)
              setAssistantMessages([])
            }}
            className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 relative">
      {/* Introduction */}
      <div className="text-center pb-6 border-b border-gray-200">
        <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="h-8 w-8 text-white" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">
          Configure your agent's prompts
        </h3>
        <p className="text-gray-600">
          Define how your agent behaves and what tasks it will perform
        </p>
        
        {!assistantActive && (
          <button
            onClick={() => setAssistantActive(true)}
            className="mt-4 inline-flex items-center gap-2 bg-gradient-to-r from-green-600 to-blue-600 text-white px-6 py-2 rounded-full hover:from-green-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg"
          >
            <MessageSquare className="h-4 w-4" />
            Activate Prompt Assistant
            <Sparkles className="h-4 w-4 animate-pulse" />
          </button>
        )}
      </div>

      {/* System Prompt Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-600" />
            System Prompt
            <span className="text-gray-400 text-sm font-normal">(Optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSystemTemplates(!showSystemTemplates)}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Lightbulb className="h-4 w-4" />
              Templates
            </button>
            {data.systemPrompt && (
              <button
                type="button"
                onClick={() => copyToClipboard(data.systemPrompt)}
                className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
              >
                <Copy className="h-4 w-4" />
                Copy
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <textarea
              id="systemPrompt"
              value={data.systemPrompt || ''}
              onChange={(e) => handleSystemPromptChange(e.target.value)}
              onFocus={handleSystemFocus}
              rows={4}
              className="w-full px-4 py-4 text-base font-medium border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:shadow-lg resize-none transition-all duration-300"
              placeholder="Define the agent's personality, role, and behavior (e.g., 'You are a professional customer service representative...')"
              maxLength={1000}
            />
            <div className="absolute bottom-3 right-3 text-xs text-gray-400">
              {systemCharCount}/1000
            </div>
          </div>
          <p className="text-sm text-gray-600 flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
            Sets the agent's personality, expertise level, and communication style. This shapes how the agent responds to all requests.
          </p>
        </div>

        {/* System Prompt Templates */}
        {showSystemTemplates && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-center animate-pulse">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-semibold text-gray-900">System Prompt Templates</span>
            </div>
            <div className="space-y-4">
              {SYSTEM_PROMPT_TEMPLATES.map((category) => (
                <div key={category.category}>
                  <h4 className="text-sm font-medium text-blue-800 mb-2">{category.category}</h4>
                  <div className="grid gap-3">
                    {category.prompts.map((template) => (
                      <button
                        key={template.name}
                        onClick={() => handleTemplateSelect(template.prompt)}
                        className="text-left p-4 bg-white border-2 border-blue-200 rounded-xl hover:bg-gradient-to-r hover:from-blue-100 hover:to-indigo-100 hover:border-indigo-300 transition-all transform hover:scale-[1.02] shadow-sm hover:shadow-md"
                      >
                        <div className="font-semibold text-blue-900 text-sm mb-1">{template.name}</div>
                        <div className="text-xs text-blue-700">{template.prompt}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Prompt Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-green-600" />
            User Prompt
            <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUserExamples(!showUserExamples)}
              className="text-sm text-green-600 hover:text-green-800 flex items-center gap-1"
            >
              <Lightbulb className="h-4 w-4" />
              Examples
            </button>
            <button
              type="button"
              onClick={generateSmartPrompt}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Wand2 className="h-4 w-4" />
              Generate
            </button>
            {data.userPrompt && (
              <button
                type="button"
                onClick={() => copyToClipboard(data.userPrompt)}
                className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
              >
                <Copy className="h-4 w-4" />
                Copy
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <textarea
              id="userPrompt"
              value={data.userPrompt || ''}
              onChange={(e) => handleUserPromptChange(e.target.value)}
              onFocus={handleUserFocus}
              rows={5}
              required
              className={`w-full px-4 py-4 text-base font-medium border rounded-lg focus:outline-none focus:ring-2 focus:shadow-lg resize-none transition-all duration-300 ${
                userPromptError 
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 focus:border-green-500 focus:ring-green-500'
              }`}
              placeholder="Describe the specific task your agent will perform (e.g., 'Analyze customer feedback and categorize sentiment as positive, negative, or neutral')"
              maxLength={2000}
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              {data.userPrompt && !userPromptError && (
                <CheckCircle className="h-4 w-4 text-green-500 animate-bounce" />
              )}
              {userPromptError && (
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
              <span className="text-xs text-gray-400">{userCharCount}/2000</span>
            </div>
          </div>
          
          {userPromptError && (
            <p className="text-red-600 text-sm flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {userPromptError}
            </p>
          )}

          <p className="text-sm text-gray-600 flex items-start gap-2">
            <Info className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
            Defines the specific task or action the agent will perform. Be clear and detailed about what you want the agent to do.
          </p>

          {/* ENHANCEMENT CARD - ALWAYS VISIBLE */}
          {shouldShowCard && (
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0 animate-pulse">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-purple-900 mb-2">Make your prompt more specific!</p>
                  <p className="text-xs text-purple-800 mb-3">
                    Your prompt could be enhanced with specific actions, output format, and context to get better results in the next steps.
                  </p>
                  
                  {isEnhancing ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-purple-700">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                        <span className="text-sm font-medium">ChatGPT is enhancing your prompt...</span>
                      </div>
                      <div className="w-full bg-purple-200 rounded-full h-3">
                        <div className="bg-gradient-to-r from-purple-600 to-pink-500 h-3 rounded-full animate-pulse transition-all duration-1000" style={{ width: '70%' }}></div>
                      </div>
                      <p className="text-xs text-purple-600 text-center">Please wait while we enhance your prompt...</p>
                    </div>
                  ) : (
                    <button
                      onClick={enhanceUserPrompt}
                      className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-full text-sm font-medium hover:from-purple-600 hover:to-pink-600 transition-all transform hover:scale-105 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isEnhancing}
                    >
                      <Sparkles className="h-4 w-4" />
                      AI Enhance This Prompt
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Prompt Examples */}
        {showUserExamples && (
          <div className="bg-gradient-to-r from-green-50 to-teal-50 border-2 border-green-200 rounded-xl p-6 animate-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-teal-500 rounded-full flex items-center justify-center animate-bounce">
                <Lightbulb className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-semibold text-gray-900">User Prompt Examples</span>
            </div>
            <div className="space-y-4">
              {USER_PROMPT_EXAMPLES.map((category) => (
                <div key={category.category}>
                  <h4 className="text-sm font-medium text-green-800 mb-2">{category.category}</h4>
                  <div className="grid gap-3">
                    {category.examples.map((example, index) => (
                      <button
                        key={index}
                        onClick={() => handleExampleSelect(example)}
                        className="text-left p-4 bg-white border-2 border-green-200 rounded-xl hover:bg-gradient-to-r hover:from-green-100 hover:to-teal-100 hover:border-teal-300 transition-all transform hover:scale-[1.02] shadow-sm hover:shadow-md text-sm font-medium"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Preview Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 text-base font-semibold text-gray-900 hover:text-blue-600 transition-colors"
          >
            {showPreview ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            Preview Combined Prompts
          </button>
        </div>

        {showPreview && (
          <div className="bg-gradient-to-r from-gray-50 to-blue-50 border-2 border-gray-200 rounded-xl p-6">
            <div className="space-y-4">
              {data.systemPrompt && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">System Prompt:</h4>
                  <div className="bg-white p-3 rounded border text-sm text-gray-800">
                    {data.systemPrompt}
                  </div>
                </div>
              )}
              
              {data.userPrompt && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">User Prompt:</h4>
                  <div className="bg-white p-3 rounded border text-sm text-gray-800">
                    {data.userPrompt}
                  </div>
                </div>
              )}

              {!data.systemPrompt && !data.userPrompt && (
                <p className="text-gray-500 text-sm italic">
                  No prompts configured yet. Add prompts above to see the preview.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="bg-gradient-to-r from-gray-50 to-green-50 border-2 border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            {data.userPrompt && !userPromptError ? (
              <div className="w-12 h-12 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full flex items-center justify-center animate-bounce">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
            ) : (
              <div className="w-12 h-12 border-4 border-gray-300 rounded-full animate-pulse" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-lg font-semibold text-gray-900">
              {data.userPrompt && !userPromptError ? 'Prompts configured!' : 'Configure your prompts'}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {data.userPrompt && !userPromptError 
                ? 'Your agent knows what to do and how to behave' 
                : 'Add a user prompt to define what your agent will do'}
            </p>
            
            <div className="mt-3 bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${data.userPrompt && !userPromptError ? '100%' : '20%'}` }}
              ></div>
            </div>
          </div>
          
          {(data.systemPrompt || data.userPrompt) && (
            <button
              onClick={clearPrompts}
              className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Tips Section */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-600 rounded-full flex items-center justify-center flex-shrink-0 animate-pulse">
            <Lightbulb className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-semibold text-purple-900 mb-3">Writing Effective Prompts</p>
            <ul className="text-sm text-purple-800 space-y-2">
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <strong>Be specific:</strong> Clear instructions lead to better results
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-pink-500 rounded-full animate-pulse"></div>
                <strong>Include context:</strong> Help the agent understand the situation
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <strong>Define output format:</strong> Specify how you want the response structured
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-pink-500 rounded-full animate-pulse"></div>
                <strong>Test and iterate:</strong> Refine prompts based on actual results
              </li>
            </ul>
          </div>
        </div>
      </div>

      <AIAssistant />

      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}