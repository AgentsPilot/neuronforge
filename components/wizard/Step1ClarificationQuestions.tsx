'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  MessageSquare, 
  Sparkles, 
  ArrowRight, 
  CheckCircle, 
  Loader2,
  HelpCircle,
  Brain,
  Lightbulb,
  AlertCircle,
  RefreshCw,
  ChevronRight
} from 'lucide-react'

interface ClarificationQuestion {
  id: string
  question: string
  placeholder?: string
  required?: boolean
  type?: 'text' | 'textarea' | 'select'
  options?: string[]
}

interface ClarificationData {
  questions: ClarificationQuestion[]
  answers: Record<string, string>
  questionsGenerated: boolean
  questionsSkipped: boolean
  aiReasoning?: string
  confidence?: number
}

interface Step1ClarificationQuestionsProps {
  data: {
    agentName?: string
    description?: string
    userPrompt: string
    clarificationData?: ClarificationData
    connectedPlugins?: Record<string, any>
  }
  onUpdate: (data: any) => void
  onValidationChange?: (isValid: boolean, errorMsg?: string) => void
  userId?: string
}

export default function Step1ClarificationQuestions({ 
  data, 
  onUpdate, 
  onValidationChange,
  userId 
}: Step1ClarificationQuestionsProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<any>(null) // NEW: Debug info
  const [answers, setAnswers] = useState<Record<string, string>>(
    data.clarificationData?.answers || {}
  )

  const clarificationData = data.clarificationData || {
    questions: [],
    answers: {},
    questionsGenerated: false,
    questionsSkipped: false
  }

  // Auto-generate questions when component mounts with a userPrompt
  useEffect(() => {
    if (data.userPrompt?.trim() && !clarificationData.questionsGenerated && !loading) {
      console.log('Auto-generating questions for prompt:', data.userPrompt)
      generateQuestions()
    }
  }, [data.userPrompt]) // Only depend on userPrompt to avoid infinite loops

  // Validation effect
  useEffect(() => {
    const hasGeneratedQuestions = clarificationData.questionsGenerated
    const hasSkippedQuestions = clarificationData.questionsSkipped
    const hasAnsweredRequired = clarificationData.questions.length === 0 || 
      clarificationData.questions.every(q => 
        !q.required || (answers[q.id]?.trim() || '').length > 0
      )
    
    const isValid = hasGeneratedQuestions && (hasSkippedQuestions || hasAnsweredRequired)
    
    onValidationChange?.(isValid, 
      !hasGeneratedQuestions ? 'Generating clarification questions...' :
      !hasAnsweredRequired ? 'Please answer all required questions' :
      undefined
    )
  }, [clarificationData, answers, onValidationChange])

  const generateQuestions = async () => {
    if (!data.userPrompt?.trim()) {
      setError('User prompt is required to generate clarification questions')
      return
    }

    setLoading(true)
    setError(null)
    setDebugInfo(null)

    try {
      // Prepare payload with validation - use 'original_prompt' field as expected by API
      const payload = {
        original_prompt: data.userPrompt.trim(), // ✅ Fixed: Changed from 'prompt' to 'original_prompt'
        agent_name: data.agentName?.trim() || '',
        description: data.description?.trim() || '',
        connected_plugins: data.connectedPlugins || {},
        user_id: userId || 'anonymous'
      }

      console.log('🚀 Sending request to /api/generate-clarification-questions')
      console.log('📝 Payload:', JSON.stringify(payload, null, 2))

      const response = await fetch('/api/generate-clarification-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      })

      console.log('📊 Response status:', response.status)
      console.log('📊 Response headers:', Object.fromEntries(response.headers.entries()))

      // Get response text first for debugging
      const responseText = await response.text()
      console.log('📄 Raw response:', responseText)

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        
        // Try to parse error details
        try {
          const errorData = JSON.parse(responseText)
          errorMessage = errorData.error || errorData.message || errorMessage
          setDebugInfo({
            status: response.status,
            statusText: response.statusText,
            errorData: errorData,
            payload: payload
          })
        } catch (parseError) {
          setDebugInfo({
            status: response.status,
            statusText: response.statusText,
            rawResponse: responseText,
            payload: payload
          })
        }
        
        throw new Error(errorMessage)
      }

      // Parse successful response
      let result
      try {
        result = JSON.parse(responseText)
      } catch (parseError) {
        throw new Error('Invalid JSON response from server')
      }

      console.log('✅ Parsed result:', result)

      const newClarificationData: ClarificationData = {
        questions: result.questions || [],
        answers: {},
        questionsGenerated: true,
        questionsSkipped: false,
        aiReasoning: result.reasoning,
        confidence: result.confidence
      }

      onUpdate({
        clarificationData: newClarificationData
      })

      setAnswers({})

    } catch (err: any) {
      console.error('❌ Error generating clarification questions:', err)
      setError(err.message || 'Failed to generate clarification questions. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleAnswerChange = (questionId: string, value: string) => {
    const newAnswers = { ...answers, [questionId]: value }
    setAnswers(newAnswers)
    
    // Update the parent component
    onUpdate({
      clarificationData: {
        ...clarificationData,
        answers: newAnswers
      }
    })
  }

  const skipQuestions = () => {
    const newClarificationData: ClarificationData = {
      ...clarificationData,
      questionsSkipped: true,
      questionsGenerated: true
    }

    onUpdate({
      clarificationData: newClarificationData
    })
  }

  const regenerateQuestions = async () => {
    // Reset state and regenerate
    onUpdate({
      clarificationData: {
        questions: [],
        answers: {},
        questionsGenerated: false,
        questionsSkipped: false
      }
    })
    setAnswers({})
    setError(null)
    setDebugInfo(null)
    await generateQuestions()
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 rounded-2xl flex items-center justify-center mx-auto">
          <Brain className="w-8 h-8 text-purple-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">AI Clarification Questions</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Our AI will analyze your prompt and ask clarifying questions to better understand your automation needs. 
            This helps create a more accurate and tailored agent for you.
          </p>
        </div>
      </div>

      {/* User Prompt Review */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-100">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-2">Your Automation Request</h3>
            <p className="text-gray-700 leading-relaxed">{data.userPrompt}</p>
            {!data.agentName && (
              <p className="text-sm text-gray-500 mt-2">
                You'll set the agent name and details in the next step
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Auto-generating Questions Loading State */}
      {!clarificationData.questionsGenerated && loading && (
        <div className="text-center space-y-6">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-100 to-blue-100 rounded-xl flex items-center justify-center mx-auto">
              <Loader2 className="w-6 h-6 text-purple-600 animate-spin" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Analyzing Your Request</h3>
              <p className="text-gray-600 max-w-lg mx-auto">
                Our AI is analyzing your automation request and generating targeted clarification questions...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Questions Section */}
      {clarificationData.questionsGenerated && (
        <div className="space-y-6">
          {/* AI Analysis Header */}
          {clarificationData.aiReasoning && (
            <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl p-6 border border-amber-100">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-gray-900">AI Analysis</h3>
                    {clarificationData.confidence && (
                      <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded-full">
                        {clarificationData.confidence}% confidence
                      </span>
                    )}
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed">
                    {clarificationData.aiReasoning}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Questions */}
          {clarificationData.questions.length > 0 ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  Clarification Questions ({clarificationData.questions.length})
                </h3>
                <button
                  onClick={regenerateQuestions}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate
                </button>
              </div>

              <div className="space-y-6">
                {clarificationData.questions.map((question, index) => (
                  <div key={question.id} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 font-semibold text-sm">{index + 1}</span>
                      </div>
                      <div className="flex-1 space-y-4">
                        <div className="flex items-start gap-2">
                          <h4 className="font-medium text-gray-900 leading-relaxed">
                            {question.question}
                          </h4>
                          {question.required && (
                            <span className="text-red-500 text-sm">*</span>
                          )}
                        </div>

                        {question.type === 'select' || question.type === 'enum' ? (
                          <select
                            value={answers[question.id] || ''}
                            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">Select an option...</option>
                            {question.options?.map((option, idx) => (
                              <option key={idx} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : question.type === 'multiselect' ? (
                          <div className="space-y-2">
                            {question.options?.map((option, idx) => (
                              <label key={idx} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={answers[question.id]?.split(',').includes(option) || false}
                                  onChange={(e) => {
                                    const currentAnswers = answers[question.id]?.split(',').filter(Boolean) || []
                                    const newAnswers = e.target.checked
                                      ? [...currentAnswers, option]
                                      : currentAnswers.filter(a => a !== option)
                                    handleAnswerChange(question.id, newAnswers.join(','))
                                  }}
                                  className="rounded focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">{option}</span>
                              </label>
                            ))}
                          </div>
                        ) : question.type === 'date' ? (
                          <input
                            type="date"
                            value={answers[question.id] || ''}
                            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                        ) : question.type === 'textarea' ? (
                          <textarea
                            value={answers[question.id] || ''}
                            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                            placeholder={question.placeholder}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                            rows={3}
                          />
                        ) : (
                          <input
                            type="text"
                            value={answers[question.id] || ''}
                            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                            placeholder={question.placeholder}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Progress Indicator */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    Progress: {clarificationData.questions.filter(q => answers[q.id]?.trim()).length} of {clarificationData.questions.length} questions answered
                  </span>
                  <div className="flex items-center gap-2">
                    {clarificationData.questions.every(q => !q.required || answers[q.id]?.trim()) ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        <span className="text-green-600 font-medium">All required questions answered</span>
                      </>
                    ) : (
                      <>
                        <HelpCircle className="w-4 h-4 text-amber-600" />
                        <span className="text-amber-600">Answer required questions to continue</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Additional Questions Needed</h3>
                <p className="text-gray-600 max-w-lg mx-auto">
                  Your original prompt was clear enough. Our AI doesn't need any additional clarification to proceed.
                </p>
              </div>
            </div>
          )}

          {/* Skip Questions Option */}
          {clarificationData.questions.length > 0 && !clarificationData.questionsSkipped && (
            <div className="text-center">
              <button
                onClick={skipQuestions}
                className="text-gray-500 hover:text-gray-700 text-sm font-medium"
              >
                Skip clarification questions and proceed
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-medium text-red-900">Error</h4>
              <p className="text-red-700 text-sm mt-1">{error}</p>
              
              {/* Debug Information */}
              {debugInfo && (
                <details className="mt-3">
                  <summary className="text-red-700 text-sm cursor-pointer">Debug Information</summary>
                  <div className="mt-2 p-3 bg-red-100 rounded-lg">
                    <pre className="text-xs text-red-800 whitespace-pre-wrap">
                      {JSON.stringify(debugInfo, null, 2)}
                    </pre>
                  </div>
                </details>
              )}
              
              <div className="mt-3 flex gap-2">
                <button
                  onClick={generateQuestions}
                  disabled={loading}
                  className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                >
                  Try Again
                </button>
                <button
                  onClick={skipQuestions}
                  className="text-sm bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700"
                >
                  Skip Questions
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Lightbulb className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Tips for Better Results</h4>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Answer questions as specifically as possible</li>
              <li>• Include relevant context about your workflow</li>
              <li>• Mention any specific tools or formats you prefer</li>
              <li>• Think about edge cases or special conditions</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}