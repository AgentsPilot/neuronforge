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
  RotateCcw
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleTemplateSelect = (template: string) => {
    onUpdate({ systemPrompt: template })
    setShowSystemTemplates(false)
  }

  const handleExampleSelect = (example: string) => {
    onUpdate({ userPrompt: example })
    setShowUserExamples(false)
    validateUserPrompt(example)
  }

  const generateSmartPrompt = () => {
    // Simple AI-like prompt generation based on context
    const examples = [
      'Analyze the provided content and extract the most important information',
      'Process the input data and provide a structured summary',
      'Review the document and identify key insights and recommendations',
      'Examine the information and generate actionable next steps'
    ]
    const randomExample = examples[Math.floor(Math.random() * examples.length)]
    handleUserPromptChange(randomExample)
  }

  const clearPrompts = () => {
    onUpdate({ systemPrompt: '', userPrompt: '' })
    setUserPromptError('')
  }

  return (
    <div className="space-y-8">
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
              value={data.systemPrompt || ''}
              onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">System Prompt Templates</span>
            </div>
            <div className="space-y-4">
              {SYSTEM_PROMPT_TEMPLATES.map((category) => (
                <div key={category.category}>
                  <h4 className="text-sm font-medium text-blue-800 mb-2">{category.category}</h4>
                  <div className="grid gap-2">
                    {category.prompts.map((template) => (
                      <button
                        key={template.name}
                        onClick={() => handleTemplateSelect(template.prompt)}
                        className="text-left p-3 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                      >
                        <div className="font-medium text-blue-900 text-sm">{template.name}</div>
                        <div className="text-xs text-blue-700 mt-1">{template.prompt}</div>
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
              className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1"
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

        <div className="space-y-2">
          <div className="relative">
            <textarea
              value={data.userPrompt || ''}
              onChange={(e) => handleUserPromptChange(e.target.value)}
              rows={5}
              required
              className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 resize-none ${
                userPromptError 
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 focus:border-green-500 focus:ring-green-500'
              }`}
              placeholder="Describe the specific task your agent will perform (e.g., 'Analyze customer feedback and categorize sentiment as positive, negative, or neutral')"
              maxLength={2000}
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              {data.userPrompt && !userPromptError && (
                <CheckCircle className="h-4 w-4 text-green-500" />
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
        </div>

        {/* User Prompt Examples */}
        {showUserExamples && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900">User Prompt Examples</span>
            </div>
            <div className="space-y-4">
              {USER_PROMPT_EXAMPLES.map((category) => (
                <div key={category.category}>
                  <h4 className="text-sm font-medium text-green-800 mb-2">{category.category}</h4>
                  <div className="grid gap-2">
                    {category.examples.map((example, index) => (
                      <button
                        key={index}
                        onClick={() => handleExampleSelect(example)}
                        className="text-left p-3 bg-white border border-green-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors text-sm"
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
            className="flex items-center gap-2 text-base font-semibold text-gray-900"
          >
            {showPreview ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            Preview Combined Prompts
          </button>
        </div>

        {showPreview && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
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
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            {data.userPrompt && !userPromptError ? (
              <CheckCircle className="h-6 w-6 text-green-500" />
            ) : (
              <div className="h-6 w-6 border-2 border-gray-300 rounded-full" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900">
              {data.userPrompt && !userPromptError ? 'Prompts configured!' : 'Configure your prompts'}
            </p>
            <p className="text-sm text-gray-600">
              {data.userPrompt && !userPromptError 
                ? 'Your agent knows what to do and how to behave' 
                : 'Add a user prompt to define what your agent will do'}
            </p>
          </div>
          {(data.systemPrompt || data.userPrompt) && (
            <button
              onClick={clearPrompts}
              className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
            >
              <RotateCcw className="h-4 w-4" />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Tips Section */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Lightbulb className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-purple-900 mb-2">💡 Writing effective prompts</p>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• <strong>Be specific:</strong> Clear instructions lead to better results</li>
              <li>• <strong>Include context:</strong> Help the agent understand the situation</li>
              <li>• <strong>Define output format:</strong> Specify how you want the response structured</li>
              <li>• <strong>Test and iterate:</strong> Refine prompts based on actual results</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}