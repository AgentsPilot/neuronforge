'use client'

import { useEffect, useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Bot,
  FileText,
  MessageSquare,
  Settings,
  Lightbulb,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Info,
  HelpCircle,
  X,
  Play,
  Target,
  BookOpen,
  ChevronRight,
  Eye,
  EyeOff,
  Zap,
  Star,
  Heart,
  Brain,
  Wand2,
  Copy,
  RotateCcw
} from 'lucide-react'

const AGENT_NAME_SUGGESTIONS = [
  'Email Assistant',
  'Data Analyzer',
  'Content Creator',
  'Invoice Processor',
  'Customer Support Bot',
  'Report Generator',
  'Meeting Scheduler',
  'Document Summarizer'
]

const DESCRIPTION_EXAMPLES = [
  'Automatically processes invoices and extracts key information',
  'Monitors emails for important keywords and sends alerts',
  'Analyzes customer feedback and generates sentiment reports',
  'Creates weekly summary reports from sales data',
  'Schedules meetings based on participant availability',
  'Generates social media content from trending topics'
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

export default function Step1BasicsPrompts({ data, onUpdate, initialPrompt, userId }: {
  data: any,
  onUpdate: (data: any) => void,
  initialPrompt?: string,
  userId?: string
}) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showDescriptionHelp, setShowDescriptionHelp] = useState(false)
  const [showUserExamples, setShowUserExamples] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  
  const [nameError, setNameError] = useState('')
  const [characterCount, setCharacterCount] = useState(0)
  const [userCharCount, setUserCharCount] = useState(0)
  const [userPromptError, setUserPromptError] = useState('')
  const [isEnhancing, setIsEnhancing] = useState(false)
  
  // AI Assistant state
  const [assistantActive, setAssistantActive] = useState(false)
  const [assistantMode, setAssistantMode] = useState<'idle' | 'thinking' | 'suggesting' | 'celebrating'>('idle')
  const [currentSuggestion, setCurrentSuggestion] = useState('')
  const [showOverlay, setShowOverlay] = useState(false)
  const [activeElement, setActiveElement] = useState<'name' | 'description' | 'user' | null>(null)
  const [assistantMessages, setAssistantMessages] = useState<string[]>([])

  useEffect(() => {
    if (initialPrompt && !data.userPrompt) {
      onUpdate({ userPrompt: initialPrompt })
    }
  }, [initialPrompt, data.userPrompt, onUpdate])

  useEffect(() => {
    setCharacterCount(data.description?.length || 0)
    setUserCharCount(data.userPrompt?.length || 0)
  }, [data.description, data.userPrompt])

  const validateAgentName = (name: string) => {
    if (!name.trim()) {
      setNameError('Agent name is required')
      return false
    }
    if (name.length < 3) {
      setNameError('Agent name must be at least 3 characters')
      return false
    }
    if (name.length > 50) {
      setNameError('Agent name must be less than 50 characters')
      return false
    }
    setNameError('')
    return true
  }

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

  const handleNameChange = (value: string) => {
    onUpdate({ agentName: value })
    validateAgentName(value)
    
    // Trigger AI assistant celebration
    if (value.length > 3 && !nameError) {
      setAssistantMode('celebrating')
      addAssistantMessage("Great choice! That's a clear, descriptive name.")
      setTimeout(() => setAssistantMode('idle'), 2000)
    }
  }

  const handleUserPromptChange = (value: string) => {
    onUpdate({ userPrompt: value })
    validateUserPrompt(value)
  }

  const handleSuggestionClick = (suggestion: string) => {
    handleNameChange(suggestion)
    setShowSuggestions(false)
  }

  const handleDescriptionExample = (example: string) => {
    onUpdate({ description: example })
    setShowDescriptionHelp(false)
  }

  const handleExampleSelect = (example: string) => {
    handleUserPromptChange(example)
    setShowUserExamples(false)
  }

  const generateSmartName = () => {
    if (data.userPrompt) {
      const prompt = data.userPrompt.toLowerCase()
      if (prompt.includes('email')) return 'Email Assistant'
      if (prompt.includes('invoice')) return 'Invoice Processor'
      if (prompt.includes('data') || prompt.includes('analyze')) return 'Data Analyzer'
      if (prompt.includes('content') || prompt.includes('write')) return 'Content Creator'
      if (prompt.includes('report')) return 'Report Generator'
      if (prompt.includes('customer')) return 'Customer Support Bot'
      if (prompt.includes('schedule')) return 'Meeting Scheduler'
      if (prompt.includes('summary') || prompt.includes('summarize')) return 'Document Summarizer'
    }
    return AGENT_NAME_SUGGESTIONS[Math.floor(Math.random() * AGENT_NAME_SUGGESTIONS.length)]
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

  const addAssistantMessage = (message: string) => {
    setAssistantMessages(prev => [...prev.slice(-2), message])
  }

  const handleNameFocus = () => {
    setActiveElement('name')
    setAssistantActive(true)
    setAssistantMode('suggesting')
    addAssistantMessage("I'll help you choose a perfect name! Think about what your agent will do.")
    setTimeout(() => {
      addAssistantMessage("Try something descriptive like 'Email Assistant' or 'Data Analyzer'")
    }, 2000)
  }

  const handleDescriptionFocus = () => {
    setActiveElement('description')
    setAssistantActive(true)
    setAssistantMode('suggesting')
    addAssistantMessage("Let's write a great description! Explain what problem your agent solves.")
  }

  const handleUserFocus = () => {
    setActiveElement('user')
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
    addAssistantMessage("Entering focus mode... Let me highlight what's important!")
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const clearPrompts = () => {
    onUpdate({ userPrompt: '' })
    setUserPromptError('')
  }

  // Fixed ChatGPT Enhancement Function
  const enhanceUserPrompt = async () => {
    if (!data.userPrompt || data.userPrompt.length < 5) {
      addAssistantMessage("Please enter a basic prompt first, then I can enhance it for you!")
      setAssistantActive(true)
      return
    }

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
          prompt: originalPrompt,
          userId: userId || data.userId || 'anonymous'
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API call failed: ${response.status}`)
      }

      const result = await response.json()
      
      handleUserPromptChange(result.enhancedPrompt)
      
      setAssistantMode('celebrating')
      addAssistantMessage("ChatGPT enhanced your prompt! Not happy with the result? Click 'AI Enhance This Prompt' again to regenerate!")
      
      setTimeout(() => {
        setAssistantMode('idle')
      }, 3000)
      
    } catch (error: any) {
      setAssistantMode('idle')
      addAssistantMessage(`Enhancement failed: ${error.message}. Your original prompt is still there - try again!`)
      console.error('ChatGPT Enhancement Error:', error)
    } finally {
      setIsEnhancing(false)
    }
  }

  // AI Assistant Component
  const AIAssistant = () => {
    if (!assistantActive) return null

    return (
      <div className="fixed bottom-6 right-6 z-50">
        {/* Assistant Avatar */}
        <div className="relative">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer group ${
            assistantMode === 'celebrating' 
              ? 'bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 animate-spin' 
              : assistantMode === 'thinking'
              ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 animate-pulse'
              : 'bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-600 hover:scale-110'
          }`}
          onClick={() => activateOverlayMode()}
          >
            {assistantMode === 'celebrating' ? (
              <Star className="h-8 w-8 text-white animate-bounce" />
            ) : assistantMode === 'thinking' ? (
              <Brain className="h-8 w-8 text-white animate-pulse" />
            ) : (
              <Bot className="h-8 w-8 text-white group-hover:rotate-12 transition-transform" />
            )}
          </div>

          {/* Floating particles around assistant */}
          <div className="absolute inset-0 animate-spin">
            <div className="absolute -top-2 -right-2 w-3 h-3 bg-yellow-400 rounded-full animate-ping"></div>
            <div className="absolute -bottom-2 -left-2 w-2 h-2 bg-pink-400 rounded-full animate-bounce"></div>
            <div className="absolute top-0 -left-3 w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          </div>

          {/* Message Bubbles - Positioned to the right of agent UI */}
          {assistantMessages.length > 0 && (
            <div className="fixed bottom-6 right-24 space-y-3 z-40" style={{ width: '350px' }}>
              {assistantMessages.map((message, index) => (
                <div 
                  key={index}
                  className="bg-gradient-to-r from-white to-blue-50 border-2 border-blue-200 rounded-2xl shadow-xl animate-in slide-in-from-right-2 duration-300"
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
                  <div 
                    className="absolute bottom-0 left-8"
                    style={{
                      width: '0',
                      height: '0',
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '6px solid white'
                    }}
                  ></div>
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

  // Overlay System
  const OverlaySystem = () => {
    if (!showOverlay) return null

    return (
      <div className="fixed inset-0 z-40 pointer-events-none">
        {/* Dimmed background */}
        <div className="absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm"></div>
        
        {/* Spotlight on active element */}
        {activeElement === 'name' && (
          <div className="absolute" style={{
            top: document.getElementById('agentName')?.getBoundingClientRect().top,
            left: document.getElementById('agentName')?.getBoundingClientRect().left,
            width: document.getElementById('agentName')?.getBoundingClientRect().width,
            height: document.getElementById('agentName')?.getBoundingClientRect().height,
          }}>
            <div className="w-full h-full border-4 border-blue-400 rounded-lg shadow-2xl animate-pulse bg-white bg-opacity-20"></div>
            <div className="absolute -top-12 left-0 bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium">
              Name your agent here! ✨
            </div>
          </div>
        )}

        {/* Floating help cards */}
        <div className="absolute top-20 right-20 space-y-4 pointer-events-auto">
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-4 rounded-2xl shadow-2xl max-w-xs animate-float">
            <div className="flex items-center gap-2 mb-2">
              <Wand2 className="h-5 w-5" />
              <span className="font-medium">Pro Tip</span>
            </div>
            <p className="text-sm">Use action words like "Assistant," "Analyzer," or "Generator"</p>
          </div>

          <div className="bg-gradient-to-r from-green-500 to-teal-500 text-white p-4 rounded-2xl shadow-2xl max-w-xs animate-float" style={{ animationDelay: '0.5s' }}>
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-5 w-5" />
              <span className="font-medium">Quick Start</span>
            </div>
            <div className="space-y-2">
              {AGENT_NAME_SUGGESTIONS.slice(0, 3).map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => {
                    handleNameChange(suggestion)
                    setShowOverlay(false)
                  }}
                  className="block w-full text-left bg-white bg-opacity-20 hover:bg-opacity-30 px-2 py-1 rounded text-sm transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Exit overlay button */}
        <button
          onClick={() => setShowOverlay(false)}
          className="absolute top-6 right-6 bg-white bg-opacity-20 backdrop-blur-sm text-white px-4 py-2 rounded-full hover:bg-opacity-30 transition-colors pointer-events-auto"
        >
          Exit Focus Mode
        </button>
      </div>
    )
  }

  // Check completion status
  const isBasicsComplete = data.agentName && !nameError
  const isPromptsComplete = data.userPrompt && !userPromptError
  const allComplete = isBasicsComplete && isPromptsComplete
  const shouldShowEnhanceCard = data.userPrompt && data.userPrompt.length >= 5

  return (
    <div className="space-y-8 relative">
      {/* Introduction */}
      <div className="text-center pb-6 border-b border-gray-200">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">
          Let's create your AI agent
        </h3>
        <p className="text-gray-600">
          Start by giving your agent a name and describing what it will do
        </p>
        
        {/* AI Assistant Activation */}
        {!assistantActive && (
          <button
            onClick={() => setAssistantActive(true)}
            className="mt-4 inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2 rounded-full hover:from-purple-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg"
          >
            <Bot className="h-4 w-4" />
            Activate AI Guide
            <Sparkles className="h-4 w-4 animate-pulse" />
          </button>
        )}
      </div>

      {/* Agent Name Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="agentName" className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-600" />
            Agent Name
            <span className="text-red-500">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSuggestions(!showSuggestions)}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Lightbulb className="h-4 w-4" />
              Suggestions
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Input
              id="agentName"
              value={data.agentName || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={handleNameFocus}
              placeholder="e.g., Email Assistant, Invoice Processor, Data Analyzer"
              className={`text-lg font-medium transition-all duration-300 ${
                nameError 
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 focus:shadow-lg'
              }`}
              maxLength={50}
            />
            {data.agentName && !nameError && (
              <CheckCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-green-500 animate-bounce" />
            )}
            {nameError && (
              <AlertCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-red-500" />
            )}
          </div>

          {nameError && (
            <p className="text-red-600 text-sm flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {nameError}
            </p>
          )}

          <p className="text-xs text-gray-500">
            Choose a clear, descriptive name that explains what your agent does
          </p>
        </div>

        {/* Enhanced Name Suggestions */}
        {showSuggestions && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 rounded-xl p-6 animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center animate-pulse">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-semibold text-gray-900">Smart Name Suggestions</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {AGENT_NAME_SUGGESTIONS.map((suggestion, index) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="text-left px-4 py-3 bg-white border-2 border-blue-200 rounded-xl hover:bg-gradient-to-r hover:from-blue-100 hover:to-purple-100 hover:border-purple-300 transition-all transform hover:scale-105 shadow-sm hover:shadow-md group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full group-hover:animate-bounce"></div>
                    <span className="font-medium text-gray-900">{suggestion}</span>
                  </div>
                </button>
              ))}
            </div>
            {data.userPrompt && (
              <div className="mt-4 pt-4 border-t border-blue-200">
                <button
                  onClick={() => handleSuggestionClick(generateSmartName())}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300 rounded-xl hover:from-purple-200 hover:to-pink-200 transition-all flex items-center gap-3 group"
                >
                  <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center group-hover:rotate-180 transition-transform">
                    <Brain className="h-4 w-4 text-white" />
                  </div>
                  <span className="font-medium text-purple-900">Generate AI-powered name from your prompt</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Description Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="description" className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Description
            <span className="text-gray-400 text-sm font-normal">(Optional)</span>
          </Label>
          <button
            type="button"
            onClick={() => setShowDescriptionHelp(!showDescriptionHelp)}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <Info className="h-4 w-4" />
            Examples
          </button>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <textarea
              id="description"
              value={data.description || ''}
              onChange={(e) => onUpdate({ description: e.target.value })}
              onFocus={handleDescriptionFocus}
              placeholder="Describe what your agent will do and how it will help you..."
              className="w-full px-4 py-4 text-base font-medium border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:shadow-lg resize-none transition-all duration-300"
              rows={5}
              maxLength={500}
            />
            <div className="absolute bottom-3 right-3 text-xs text-gray-400">
              {characterCount}/500
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Help others understand what your agent does and what problems it solves
          </p>
        </div>

        {/* Enhanced Description Examples */}
        {showDescriptionHelp && (
          <div className="bg-gradient-to-r from-green-50 to-teal-50 border-2 border-green-200 rounded-xl p-6 animate-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-teal-500 rounded-full flex items-center justify-center animate-bounce">
                <Lightbulb className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-semibold text-gray-900">Professional Description Examples</span>
            </div>
            <div className="space-y-3">
              {DESCRIPTION_EXAMPLES.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleDescriptionExample(example)}
                  className="w-full text-left px-4 py-3 bg-white border-2 border-green-200 rounded-xl hover:bg-gradient-to-r hover:from-green-100 hover:to-teal-100 hover:border-teal-300 transition-all transform hover:scale-[1.02] shadow-sm hover:shadow-md"
                >
                  <p className="text-sm font-medium text-gray-900">{example}</p>
                </button>
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
          {shouldShowEnhanceCard && (
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
            Preview User Prompt
          </button>
        </div>

        {showPreview && (
          <div className="bg-gradient-to-r from-gray-50 to-blue-50 border-2 border-gray-200 rounded-xl p-6">
            <div className="space-y-4">
              {data.userPrompt && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">User Prompt:</h4>
                  <div className="bg-white p-3 rounded border text-sm text-gray-800">
                    {data.userPrompt}
                  </div>
                </div>
              )}

              {!data.userPrompt && (
                <p className="text-gray-500 text-sm italic">
                  No user prompt configured yet. Add a prompt above to see the preview.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Progress Indicator */}
      <div className="bg-gradient-to-r from-gray-50 to-blue-50 border-2 border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            {allComplete ? (
              <div className="w-12 h-12 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full flex items-center justify-center animate-bounce">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
            ) : (
              <div className="w-12 h-12 border-4 border-gray-300 rounded-full animate-pulse" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-lg font-semibold text-gray-900">
              {allComplete ? 'Configuration complete!' : 'Complete the setup'}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {allComplete 
                ? 'Your agent has a name and task instructions - ready for the next step' 
                : !isBasicsComplete 
                ? 'Start by giving your agent a name (required)'
                : !isPromptsComplete
                ? 'Add a user prompt to define what your agent should do (required)'
                : 'Almost there! Complete any remaining fields'}
            </p>
            
            {/* Progress checklist */}
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                {isBasicsComplete ? (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                ) : (
                  <div className="h-3 w-3 border border-gray-300 rounded-full" />
                )}
                <span className={isBasicsComplete ? 'text-green-700' : 'text-gray-600'}>
                  Agent name and basic info
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {isPromptsComplete ? (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                ) : (
                  <div className="h-3 w-3 border border-gray-300 rounded-full" />
                )}
                <span className={isPromptsComplete ? 'text-green-700' : 'text-gray-600'}>
                  Task description and instructions
                </span>
              </div>
            </div>
            
            {/* Progress bar */}
            <div className="mt-3 bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${allComplete ? '100%' : (isBasicsComplete ? '50%' : '20%')}` }}
              ></div>
            </div>
          </div>
          
          {data.userPrompt && (
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
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full flex items-center justify-center flex-shrink-0 animate-pulse">
            <Info className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-semibold text-blue-900 mb-3">💡 Pro Tips for Success</p>
            <ul className="text-sm text-blue-800 space-y-2">
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                Choose a name that clearly describes the agent's purpose
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
                Include the main function or benefit in the description
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                Think about who will use this agent and what they need to know
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-pink-500 rounded-full animate-pulse"></div>
                Keep it simple and easy to understand
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant />

      {/* Overlay System */}
      <OverlaySystem />

      {/* Custom CSS for animations */}
      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-2px); }
          75% { transform: translateX(2px); }
        }
        .group:hover .group-hover\\:shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  )
}