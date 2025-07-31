'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Bot,
  FileText,
  Lightbulb,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Info
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

export default function Step1Basics({ data, onUpdate, initialPrompt }: {
  data: any,
  onUpdate: (data: any) => void,
  initialPrompt?: string
}) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showDescriptionHelp, setShowDescriptionHelp] = useState(false)
  const [nameError, setNameError] = useState('')
  const [characterCount, setCharacterCount] = useState(0)

  useEffect(() => {
    if (initialPrompt && !data.userPrompt) {
      onUpdate({ userPrompt: initialPrompt })
    }
  }, [initialPrompt, data.userPrompt, onUpdate])

  useEffect(() => {
    setCharacterCount(data.description?.length || 0)
  }, [data.description])

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

  const handleNameChange = (value: string) => {
    onUpdate({ agentName: value })
    validateAgentName(value)
  }

  const handleSuggestionClick = (suggestion: string) => {
    handleNameChange(suggestion)
    setShowSuggestions(false)
  }

  const handleDescriptionExample = (example: string) => {
    onUpdate({ description: example })
    setShowDescriptionHelp(false)
  }

  const generateSmartName = () => {
    if (data.userPrompt) {
      // Simple AI-like name generation based on prompt keywords
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

  return (
    <div className="space-y-8">
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
      </div>

      {/* Agent Name Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="agentName" className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-600" />
            Agent Name
            <span className="text-red-500">*</span>
          </Label>
          <button
            type="button"
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <Lightbulb className="h-4 w-4" />
            Suggestions
          </button>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Input
              id="agentName"
              value={data.agentName || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g., Email Assistant, Invoice Processor, Data Analyzer"
              className={`text-lg font-medium ${nameError ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}`}
              maxLength={50}
            />
            {data.agentName && !nameError && (
              <CheckCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-green-500" />
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

        {/* Name Suggestions */}
        {showSuggestions && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">Name Suggestions</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {AGENT_NAME_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="text-left px-3 py-2 text-sm bg-white border border-blue-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            {data.userPrompt && (
              <div className="mt-3 pt-3 border-t border-blue-200">
                <button
                  onClick={() => handleSuggestionClick(generateSmartName())}
                  className="w-full px-3 py-2 text-sm bg-blue-100 border border-blue-300 rounded-lg hover:bg-blue-200 transition-colors flex items-center gap-2"
                >
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  Generate smart name from your prompt
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
              placeholder="Describe what your agent will do and how it will help you..."
              className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              rows={4}
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

        {/* Description Examples */}
        {showDescriptionHelp && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900">Description Examples</span>
            </div>
            <div className="space-y-2">
              {DESCRIPTION_EXAMPLES.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleDescriptionExample(example)}
                  className="w-full text-left px-3 py-2 text-sm bg-white border border-green-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            {data.agentName && !nameError ? (
              <CheckCircle className="h-6 w-6 text-green-500" />
            ) : (
              <div className="h-6 w-6 border-2 border-gray-300 rounded-full" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900">
              {data.agentName && !nameError ? 'Ready to continue!' : 'Complete the required fields'}
            </p>
            <p className="text-sm text-gray-600">
              {data.agentName && !nameError 
                ? 'Your agent has a name and is ready for the next step' 
                : 'Give your agent a name to proceed'}
            </p>
          </div>
        </div>
      </div>

      {/* Tips Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-blue-900 mb-2">💡 Tips for success</p>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Choose a name that clearly describes the agent's purpose</li>
              <li>• Include the main function or benefit in the description</li>
              <li>• Think about who will use this agent and what they need to know</li>
              <li>• Keep it simple and easy to understand</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}