'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import {
  Sparkles,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  MessageSquare,
  Brain,
  X,
  HelpCircle,
  Edit3,
  Save,
  Undo
} from 'lucide-react'

export default function Step2PromptEnhancement({ 
  data, 
  onUpdate, 
  userId,
  clarificationAnswers = {},
  onStepLoad,
  onEnhancementStatusChange // New prop to communicate enhancement status to parent
}: {
  data: any,
  onUpdate: (data: any) => void,
  userId?: string,
  clarificationAnswers?: Record<string, any>,
  onStepLoad?: () => void,
  onEnhancementStatusChange?: (isEnhancing: boolean) => void
}) {
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhancedPrompt, setEnhancedPrompt] = useState('')
  const [enhancementError, setEnhancementError] = useState('')
  const [enhancementComplete, setEnhancementComplete] = useState(false)
  const [userChoice, setUserChoice] = useState<'original' | 'enhanced' | null>(null)
  
  // Store the REAL original prompt that never changes
  const [trueOriginalPrompt, setTrueOriginalPrompt] = useState('')
  
  // Store rationale for backend tracking (not displayed in UI)
  const [enhancementRationale, setEnhancementRationale] = useState('')
  
  // NEW: Editing states
  const [isEditingOriginal, setIsEditingOriginal] = useState(false)
  const [isEditingEnhanced, setIsEditingEnhanced] = useState(false)
  const [editedOriginal, setEditedOriginal] = useState('')
  const [editedEnhanced, setEditedEnhanced] = useState('')
  
  // Single source of truth for preventing enhancement
  const enhancementStateRef = useRef({
    hasInitialized: false,
    isEnhancing: false,
    enhancementKey: '',
    hasAutoTriggered: false
  })

  // Get clarification questions and answers
  const clarificationData = data.clarificationData || { questions: [], answers: {} }
  const questions = clarificationData.questions || []
  const answers = clarificationData.answers || clarificationAnswers

  // Create a unique key for this prompt + clarification combination
  const enhancementKey = useMemo(() => {
    if (!data.userPrompt || Object.keys(clarificationAnswers).length === 0) return ''
    return `${data.userPrompt.slice(0, 50)}-${JSON.stringify(clarificationAnswers).slice(0, 100)}`
  }, [data.userPrompt, clarificationAnswers])

  // Communicate enhancement status to parent
  useEffect(() => {
    if (onEnhancementStatusChange) {
      onEnhancementStatusChange(isEnhancing)
    }
  }, [isEnhancing, onEnhancementStatusChange])

  // Initialize state from persisted data - ONE TIME ONLY
  useEffect(() => {
    if (enhancementStateRef.current.hasInitialized) return
    
    console.log('INIT - Step2 initialization:', {
      enhancedPrompt: data.enhancedPrompt,
      enhancementComplete: data.enhancementComplete,
      userChoice: data.userChoice,
      originalPrompt: data.originalPrompt,
      userPrompt: data.userPrompt,
      enhancementRationale: data.enhancementRationale,
      currentKey: enhancementKey
    })
    
    // Set the TRUE original prompt that should never change
    const realOriginal = data.originalPrompt || data.userPrompt
    setTrueOriginalPrompt(realOriginal)
    setEditedOriginal(realOriginal) // Initialize edit state
    console.log('INIT - Setting trueOriginalPrompt to:', realOriginal)
    
    // If we don't have originalPrompt in data yet, save it
    if (!data.originalPrompt && data.userPrompt) {
      console.log('INIT - Saving originalPrompt to data:', data.userPrompt)
      onUpdate({ 
        ...data,
        originalPrompt: data.userPrompt
      })
    }
    
    // Load persisted state
    if (data.enhancedPrompt) {
      setEnhancedPrompt(data.enhancedPrompt)
      setEditedEnhanced(data.enhancedPrompt) // Initialize edit state
    }
    if (data.enhancementComplete) setEnhancementComplete(data.enhancementComplete)
    if (data.userChoice) setUserChoice(data.userChoice)
    if (data.enhancementError) setEnhancementError(data.enhancementError)
    if (data.enhancementRationale) setEnhancementRationale(data.enhancementRationale)
    
    // Mark as initialized and set the current key
    enhancementStateRef.current = {
      hasInitialized: true,
      isEnhancing: false,
      enhancementKey: enhancementKey,
      hasAutoTriggered: data.enhancementComplete || false
    }
    
    if (onStepLoad) onStepLoad()
  }, []) // No dependencies - runs only once

  // Auto-enhancement logic - SEPARATE EFFECT with strict guards
  useEffect(() => {
    const state = enhancementStateRef.current
    
    // Guard: Must be initialized first
    if (!state.hasInitialized) return
    
    // Guard: Already enhancing
    if (state.isEnhancing || isEnhancing) return
    
    // Guard: Already completed or user made choice
    if (enhancementComplete || userChoice) return
    
    // Guard: Already auto-triggered for this key
    if (state.hasAutoTriggered && state.enhancementKey === enhancementKey) {
      console.log('AUTO - Auto-enhancement already triggered for this key')
      return
    }
    
    // Guard: Missing required data
    if (!data.userPrompt || data.userPrompt.length <= 10 || Object.keys(clarificationAnswers).length === 0) {
      return
    }
    
    // All guards passed - trigger enhancement
    console.log('AUTO - TRIGGERING enhancement for new key:', enhancementKey)
    enhancementStateRef.current.hasAutoTriggered = true
    enhancementStateRef.current.enhancementKey = enhancementKey
    handleEnhancement()
    
  }, [enhancementKey, data.userPrompt, clarificationAnswers, enhancementComplete, userChoice, isEnhancing])

  const handleEnhancement = async () => {
    if (!data.userPrompt || enhancementStateRef.current.isEnhancing) {
      console.log('ENHANCE - Skipping enhancement - no prompt or already enhancing')
      return
    }

    enhancementStateRef.current.isEnhancing = true
    setIsEnhancing(true)
    setEnhancementError('')

    try {
      console.log('ENHANCE - Sending enhancement request...')
      
      const response = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: data.userPrompt,
          clarificationAnswers: clarificationAnswers,
          userId: userId || 'anonymous'
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API call failed: ${response.status}`)
      }

      const result = await response.json()
      console.log('ENHANCE - Enhancement result received:', {
        hasEnhancedPrompt: !!result.enhancedPrompt,
        hasRationale: !!result.rationale
      })
      
      setEnhancedPrompt(result.enhancedPrompt)
      setEditedEnhanced(result.enhancedPrompt) // Initialize edit state
      setEnhancementRationale(result.rationale || '') // Store rationale but don't display
      setEnhancementComplete(true)
      
      // Persist the enhancement data including rationale for backend tracking
      onUpdate({ 
        ...data,
        enhancedPrompt: result.enhancedPrompt,
        enhancementRationale: result.rationale || '', // Store for backend/database
        enhancementComplete: true,
        enhancementError: ''
      })
      
    } catch (error: any) {
      console.error('Enhancement Error:', error)
      const errorMessage = `Enhancement failed: ${error.message}`
      setEnhancementError(errorMessage)
      
      // Persist error state
      onUpdate({ 
        ...data,
        enhancementError: errorMessage
      })
    } finally {
      setIsEnhancing(false)
      enhancementStateRef.current.isEnhancing = false
    }
  }

  // NEW: Edit handling functions
  const handleSaveOriginal = () => {
    setTrueOriginalPrompt(editedOriginal)
    setIsEditingOriginal(false)
    // Update the data with the edited original
    onUpdate({
      ...data,
      originalPrompt: editedOriginal,
      userPrompt: editedOriginal // Update userPrompt too if original was selected
    })
  }

  const handleCancelOriginal = () => {
    setEditedOriginal(trueOriginalPrompt)
    setIsEditingOriginal(false)
  }

  const handleSaveEnhanced = () => {
    setEnhancedPrompt(editedEnhanced)
    setIsEditingEnhanced(false)
    // Update the data with the edited enhanced prompt
    onUpdate({
      ...data,
      enhancedPrompt: editedEnhanced
    })
  }

  const handleCancelEnhanced = () => {
    setEditedEnhanced(enhancedPrompt)
    setIsEditingEnhanced(false)
  }

  const handleAcceptOriginal = () => {
    console.log('ORIGINAL - Accept Original clicked')
    
    setUserChoice('original')
    
    // Use the true original prompt and keep userPrompt as original for next steps
    onUpdate({ 
      ...data,
      userChoice: 'original',
      finalPrompt: trueOriginalPrompt,
      userPrompt: trueOriginalPrompt, // Reset userPrompt to original
      originalPrompt: trueOriginalPrompt // Ensure this is preserved
    })
  }

  const handleAcceptEnhanced = () => {
    console.log('ENHANCED - Accept Enhanced clicked')
    
    setUserChoice('enhanced')
    
    // Keep the true original prompt preserved, update userPrompt with enhanced
    const updatePayload = { 
      ...data,
      userChoice: 'enhanced',
      finalPrompt: enhancedPrompt,
      userPrompt: enhancedPrompt, // Update userPrompt to enhanced for next steps
      originalPrompt: trueOriginalPrompt, // Keep the true original preserved
      enhancementRationale: enhancementRationale // Preserve rationale for backend
    }
    
    console.log('ENHANCED - Updating parent with:', updatePayload)
    onUpdate(updatePayload)
  }

  const handleRegenerate = () => {
    // Reset all enhancement state
    setEnhancementComplete(false)
    setEnhancedPrompt('')
    setEnhancementRationale('')
    setUserChoice(null)
    setEnhancementError('')
    setEditedEnhanced('')
    
    // Reset the state ref
    enhancementStateRef.current.hasAutoTriggered = false
    enhancementStateRef.current.enhancementKey = ''
    
    // Clear persisted state
    onUpdate({ 
      ...data,
      enhancedPrompt: '',
      enhancementRationale: '',
      enhancementComplete: false,
      userChoice: null,
      enhancementError: ''
    })
    
    // Trigger new enhancement after state is cleared
    setTimeout(() => {
      handleEnhancement()
    }, 100)
  }

  // NEW: Render editable prompt component
  const renderEditablePrompt = (
    title: string,
    subtitle: string,
    prompt: string,
    editedPrompt: string,
    isEditing: boolean,
    onEdit: () => void,
    onSave: () => void,
    onCancel: () => void,
    onChange: (value: string) => void,
    onAccept: () => void,
    bgColor: string,
    icon: React.ReactNode,
    badgeText?: string
  ) => (
    <div className={`bg-white border ${bgColor} rounded-2xl shadow-sm overflow-hidden`}>
      <div className={`${bgColor.replace('border-', 'bg-').replace('-200', '-50')} px-6 py-4 border-b ${bgColor.replace('-200', '-100')}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 ${bgColor.replace('border-', 'bg-').replace('-200', '-100')} rounded-xl flex items-center justify-center`}>
            {icon}
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-600">{subtitle}</p>
          </div>
          {badgeText && (
            <span className={`${bgColor.replace('border-', 'bg-').replace('-200', '-100')} text-purple-800 px-3 py-1 rounded-full text-sm font-medium`}>
              {badgeText}
            </span>
          )}
        </div>
      </div>
      
      <div className="p-6">
        <div className={`${bgColor.replace('border-', 'bg-').replace('-200', '-50')} rounded-xl p-6 mb-6 ${bgColor.replace('-200', '-100')}`}>
          {isEditing ? (
            <div className="space-y-4">
              <textarea
                value={editedPrompt}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-32 p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-800 leading-relaxed"
                placeholder="Edit your prompt..."
              />
              <div className="flex gap-2">
                <button
                  onClick={onSave}
                  className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
                <button
                  onClick={onCancel}
                  className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
                >
                  <Undo className="h-4 w-4" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap text-lg flex-1">
                  {prompt}
                </p>
                <button
                  onClick={onEdit}
                  className="flex items-center gap-1 text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium flex-shrink-0"
                >
                  <Edit3 className="h-4 w-4" />
                  Edit
                </button>
              </div>
            </div>
          )}
        </div>
        
        {!isEditing && (
          <button
            onClick={onAccept}
            className={`w-full flex items-center justify-center gap-3 ${
              title.includes('Enhanced') 
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600' 
                : 'bg-blue-500 hover:bg-blue-600'
            } text-white px-6 py-4 rounded-xl transition-all font-medium text-lg shadow-sm`}
          >
            {title.includes('Enhanced') ? (
              <ArrowRight className="h-5 w-5" />
            ) : (
              <ArrowLeft className="h-5 w-5" />
            )}
            Use {title.includes('Enhanced') ? 'Enhanced' : 'Original'} Prompt
          </button>
        )}
      </div>
    </div>
  )

  // Show loading state while enhancing
  if (isEnhancing) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-3xl flex items-center justify-center mx-auto shadow-lg">
            <Brain className="h-10 w-10 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Enhancing Your Prompt</h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              AI is analyzing your prompt and incorporating clarification answers to create a more detailed and specific version
            </p>
          </div>
        </div>

        {/* Loading Card */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-6">
            <div className="flex items-center gap-4 text-white">
              <Loader2 className="h-8 w-8 animate-spin" />
              <div>
                <h3 className="text-xl font-semibold">Processing Enhancement...</h3>
                <p className="text-purple-100">
                  Incorporating {Object.keys(clarificationAnswers).length} clarification answers
                </p>
              </div>
            </div>
          </div>
          
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span>Using AI to enhance your prompt with specific details</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show error state
  if (enhancementError) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-red-100 rounded-3xl flex items-center justify-center mx-auto">
            <X className="h-10 w-10 text-red-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Enhancement Failed</h1>
            <p className="text-lg text-gray-600">There was an error enhancing your prompt</p>
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
          <p className="text-red-800 font-medium">{enhancementError}</p>
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={handleRegenerate}
            className="flex items-center gap-2 bg-purple-600 text-white px-8 py-4 rounded-xl hover:bg-purple-700 transition-colors font-medium"
          >
            <RefreshCw className="h-5 w-5" />
            Try Again
          </button>
          
          <button
            onClick={handleAcceptOriginal}
            className="flex items-center gap-2 bg-gray-600 text-white px-8 py-4 rounded-xl hover:bg-gray-700 transition-colors font-medium"
          >
            Skip Enhancement
          </button>
        </div>
      </div>
    )
  }

  // Show original vs enhanced comparison
  if (enhancementComplete && !userChoice) {
    console.log('DISPLAY - Showing comparison view')
    console.log('DISPLAY - trueOriginalPrompt:', trueOriginalPrompt)
    console.log('DISPLAY - enhancedPrompt:', enhancedPrompt)
    
    return (
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-3xl flex items-center justify-center mx-auto shadow-lg">
            <Sparkles className="h-10 w-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Choose Your Prompt</h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Review both versions and select which prompt works best for your agent. You can edit either version before choosing.
            </p>
          </div>
        </div>

        {/* Original Prompt - Now Editable */}
        {renderEditablePrompt(
          'Your Original Prompt',
          'The prompt you initially provided',
          trueOriginalPrompt,
          editedOriginal,
          isEditingOriginal,
          () => setIsEditingOriginal(true),
          handleSaveOriginal,
          handleCancelOriginal,
          setEditedOriginal,
          handleAcceptOriginal,
          'border-blue-200',
          <MessageSquare className="h-5 w-5 text-blue-600" />
        )}

        {/* Clarification Questions & Answers */}
        {questions.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-amber-50 px-6 py-4 border-b border-amber-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                  <HelpCircle className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Clarification Questions & Answers</h3>
                  <p className="text-sm text-gray-600">The answers you provided to help enhance your prompt</p>
                </div>
              </div>
            </div>
            
            <div className="p-6">
              <div className="space-y-6">
                {questions.map((question: any, index: number) => (
                  <div key={question.id} className="border-l-4 border-amber-200 pl-6">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                        <span className="text-amber-600 font-semibold text-xs">{index + 1}</span>
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 mb-2">{question.question}</h4>
                        <div className="bg-amber-50 rounded-lg p-3">
                          <p className="text-gray-700">{answers[question.id] || 'No answer provided'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Prompt - Now Editable */}
        {renderEditablePrompt(
          'AI-Enhanced Prompt',
          'Enhanced with your clarification answers',
          enhancedPrompt,
          editedEnhanced,
          isEditingEnhanced,
          () => setIsEditingEnhanced(true),
          handleSaveEnhanced,
          handleCancelEnhanced,
          setEditedEnhanced,
          handleAcceptEnhanced,
          'border-purple-200',
          <Sparkles className="h-5 w-5 text-white" />,
          'Recommended'
        )}

        {/* Actions */}
        <div className="flex justify-center">
          <button
            onClick={handleRegenerate}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-xl transition-colors font-medium"
          >
            <RefreshCw className="h-4 w-4" />
            Regenerate Enhancement
          </button>
        </div>
      </div>
    )
  }

  // Show completion state after user has made a choice
  if (userChoice) {
    console.log('COMPLETE - Showing completion state')
    console.log('COMPLETE - userChoice:', userChoice)
    console.log('COMPLETE - trueOriginalPrompt:', trueOriginalPrompt)
    console.log('COMPLETE - enhancedPrompt:', enhancedPrompt)
    
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-green-100 rounded-3xl flex items-center justify-center mx-auto">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Prompt Selected</h1>
            <p className="text-lg text-gray-600">
              You've chosen the {userChoice === 'enhanced' ? 'AI-enhanced' : 'original'} prompt. 
              Ready to proceed to the next step.
            </p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              userChoice === 'enhanced' 
                ? 'bg-gradient-to-r from-purple-100 to-pink-100' 
                : 'bg-blue-100'
            }`}>
              {userChoice === 'enhanced' ? (
                <Sparkles className="h-4 w-4 text-purple-600" />
              ) : (
                <MessageSquare className="h-4 w-4 text-blue-600" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              Selected {userChoice === 'enhanced' ? 'Enhanced' : 'Original'} Prompt
            </h3>
          </div>
          
          <div className="bg-gray-50 rounded-xl p-6">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
              {userChoice === 'enhanced' ? enhancedPrompt : trueOriginalPrompt}
            </p>
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => {
              console.log('CHANGE - Change Selection clicked')
              console.log('CHANGE - Current userChoice:', userChoice)
              console.log('CHANGE - trueOriginalPrompt:', trueOriginalPrompt)
              console.log('CHANGE - enhancedPrompt:', enhancedPrompt)
              
              setUserChoice(null)
              setEnhancementComplete(true)
              // Update persisted state but DON'T change the original prompt
              onUpdate({
                ...data,
                userChoice: null,
                originalPrompt: trueOriginalPrompt, // Ensure original is preserved
                enhancementRationale: enhancementRationale // Keep rationale for backend
              })
            }}
            className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors font-medium"
          >
            Change Selection
          </button>
        </div>
      </div>
    )
  }

  // Fallback: if no enhancement triggered yet
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mx-auto">
          <Brain className="h-10 w-10 text-gray-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Prompt Enhancement</h1>
          <p className="text-lg text-gray-600">Waiting for prompt and clarification data...</p>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
        <p className="text-yellow-800 font-medium">
          No prompt available for enhancement. Please ensure you have a user prompt and clarification answers.
        </p>
        <div className="mt-2 text-sm text-yellow-700">
          <p>Enhancement Key: {enhancementKey || 'Not generated'}</p>
          <p>User Prompt: {data.userPrompt || 'None'}</p>
          <p>Original Prompt: {data.originalPrompt || 'None'}</p>
          <p>True Original: {trueOriginalPrompt || 'None'}</p>
          <p>Enhancement Rationale: {enhancementRationale || 'None'}</p>
          <p>State: {JSON.stringify(enhancementStateRef.current)}</p>
        </div>
      </div>
    </div>
  )
}