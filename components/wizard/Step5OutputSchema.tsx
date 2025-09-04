'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Trash2, Plus, Mail, AlertTriangle, FileText, Database, CheckCircle, Copy, MessageSquare, Sparkles, Star, Brain, X, Target, Info, Lightbulb } from 'lucide-react'
import { OUTPUT_TYPES, OutputSchemaType, OutputField, AI_ASSISTANCE_MESSAGES } from './outputSchemaTypes'
import { EmailDraftConfig, AlertConfig, DecisionConfig, ReportConfig } from './outputTypeConfigs'

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

interface Props {
  data?: any
  onUpdate: (updates: any) => void
  onValidationChange?: (isValid: boolean, error?: string) => void
}

export default function Step5OutputSchema({ data = {}, onUpdate, onValidationChange }: Props) {
  const defaultOutput = data.outputSchema || {}

  // State management
  const [type, setType] = useState<OutputSchemaType>(defaultOutput?.type || '')
  
  // Email Draft states
  const [to, setTo] = useState(defaultOutput?.to || '')
  const [subject, setSubject] = useState(defaultOutput?.subject || '')
  const [includePdf, setIncludePdf] = useState(defaultOutput?.includePdf || false)
  
  // Alert states
  const [alertTitle, setAlertTitle] = useState(defaultOutput?.title || '')
  const [alertMessage, setAlertMessage] = useState(defaultOutput?.message || '')
  const [alertSeverity, setAlertSeverity] = useState(defaultOutput?.severity || '')
  
  // Decision states
  const [decisionAnswer, setDecisionAnswer] = useState(defaultOutput?.answer || '')
  const [decisionConfidence, setDecisionConfidence] = useState(defaultOutput?.confidence || 80)
  const [decisionReasoning, setDecisionReasoning] = useState(defaultOutput?.reasoning || '')
  
  // Report states
  const [reportTitle, setReportTitle] = useState(defaultOutput?.reportTitle || '')
  const [reportSections, setReportSections] = useState<string[]>(defaultOutput?.reportSections || [''])
  
  // JSON Data states
  const [fields, setFields] = useState<OutputField[]>(defaultOutput?.fields || [])

  // Validation states
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // AI Assistant state
  const [assistantActive, setAssistantActive] = useState(false)
  const [assistantMode, setAssistantMode] = useState<'idle' | 'thinking' | 'suggesting' | 'celebrating'>('idle')
  const [assistantMessages, setAssistantMessages] = useState<string[]>([])

  // Refs for callback stability
  const onUpdateRef = useRef(onUpdate)
  const onValidationChangeRef = useRef(onValidationChange)
  
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])
  
  useEffect(() => {
    onValidationChangeRef.current = onValidationChange
  }, [onValidationChange])

  // Validation logic
  const isValidForSubmission = useMemo(() => {
    if (!type) return false
    
    switch (type) {
      case 'alert':
        return !!(alertTitle.trim() && alertMessage.trim() && alertSeverity)
      case 'emailDraft':
        return !!(to.trim() && subject.trim())
      case 'decision':
        return !!(decisionAnswer.trim() && decisionReasoning.trim())
      case 'report':
        return !!(reportTitle.trim() && reportSections.some(section => section.trim()))
      case 'jsonData':
        return fields.length > 0 && fields.every(f => f.name.trim())
      default:
        return true
    }
  }, [type, alertTitle, alertMessage, alertSeverity, to, subject, decisionAnswer, decisionReasoning, reportTitle, reportSections, fields])

  // Schema object
  const schema = useMemo(() => {
    const newSchema: any = { type }

    switch (type) {
      case 'emailDraft':
        Object.assign(newSchema, { to, subject, includePdf })
        break
      case 'alert':
        Object.assign(newSchema, { title: alertTitle, message: alertMessage, severity: alertSeverity })
        break
      case 'decision':
        Object.assign(newSchema, { answer: decisionAnswer, confidence: decisionConfidence, reasoning: decisionReasoning })
        break
      case 'report':
        Object.assign(newSchema, { reportTitle, reportSections: reportSections.filter(s => s.trim()) })
        break
      case 'jsonData':
        Object.assign(newSchema, { fields })
        break
    }
    
    return newSchema
  }, [type, to, subject, includePdf, alertTitle, alertMessage, alertSeverity, decisionAnswer, decisionConfidence, decisionReasoning, reportTitle, reportSections, fields])

  // Update parent
  useEffect(() => {
    onUpdateRef.current({ outputSchema: schema })
  }, [schema])

  useEffect(() => {
    const errorMessage = !type ? 'Please select an output type' : 
                        !isValidForSubmission ? 'Please complete all required fields' : ''
    
    if (onValidationChangeRef.current) {
      onValidationChangeRef.current(isValidForSubmission, errorMessage)
    }
  }, [isValidForSubmission, type])

  // Event handlers
  const addAssistantMessage = (message: string) => {
    setAssistantMessages(prev => [...prev.slice(-2), message])
  }

  const handleTypeSelection = (selectedType: OutputSchemaType) => {
    setType(selectedType)
    setTouched(prev => ({ ...prev, type: true }))
    setErrors({})

    if (selectedType && AI_ASSISTANCE_MESSAGES[selectedType]) {
      setAssistantMode('celebrating')
      addAssistantMessage(AI_ASSISTANCE_MESSAGES[selectedType][0])
      
      setTimeout(() => {
        if (AI_ASSISTANCE_MESSAGES[selectedType][1]) {
          addAssistantMessage(AI_ASSISTANCE_MESSAGES[selectedType][1])
        }
        setAssistantMode('idle')
      }, 2000)
    }
  }

  const handleFieldBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }))
  }

  const handleConfigFocus = () => {
    setAssistantActive(true)
    setAssistantMode('suggesting')
    
    const messages = AI_ASSISTANCE_MESSAGES[type as keyof typeof AI_ASSISTANCE_MESSAGES]
    if (messages && messages[2]) {
      addAssistantMessage(messages[2])
    }
  }

  const selectedType = OUTPUT_TYPES.find(t => t.value === type)

  // Get icon component
  const getIconComponent = (iconName: string) => {
    const icons: Record<string, any> = {
      Mail, AlertTriangle, CheckCircle, Plus, FileText, Database, MessageSquare, Sparkles
    }
    return icons[iconName] || FileText
  }

  // Render configuration based on type
  const renderConfiguration = () => {
    const commonProps = { errors, touched, onFieldBlur: handleFieldBlur, onConfigFocus: handleConfigFocus }

    switch (type) {
      case 'emailDraft':
        return <EmailDraftConfig {...commonProps} {...{ to, setTo, subject, setSubject, includePdf, setIncludePdf }} />
      case 'alert':
        return <AlertConfig {...commonProps} {...{ alertTitle, setAlertTitle, alertMessage, setAlertMessage, alertSeverity, setAlertSeverity, setTouched }} />
      case 'decision':
        return <DecisionConfig {...commonProps} {...{ decisionAnswer, setDecisionAnswer, decisionConfidence, setDecisionConfidence, decisionReasoning, setDecisionReasoning }} />
      case 'report':
        return <ReportConfig {...commonProps} {...{ reportTitle, setReportTitle, reportSections, setReportSections }} />
      case 'jsonData':
        return (
          <div className="text-center py-8">
            <Sparkles className="h-16 w-16 text-purple-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">JSON Data Structure</h3>
            <p className="text-slate-600 mb-6">Configure structured fields for your JSON output.</p>
            <button
              onClick={() => setFields([{ id: generateUUID(), name: '', type: 'string', required: false, description: '' }])}
              className="inline-flex items-center gap-2 bg-purple-600 text-white px-6 py-3 rounded-xl hover:bg-purple-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              Add First Field
            </button>
          </div>
        )
      default:
        return null
    }
  }

  // AI Assistant Component
  const AIAssistant = () => {
    if (!assistantActive) return null

    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer group ${
            assistantMode === 'celebrating' 
              ? 'bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 animate-spin' 
              : 'bg-gradient-to-r from-green-500 via-teal-500 to-blue-600 hover:scale-110'
          }`}>
            {assistantMode === 'celebrating' ? (
              <Star className="h-8 w-8 text-white animate-bounce" />
            ) : (
              <MessageSquare className="h-8 w-8 text-white group-hover:rotate-12 transition-transform" />
            )}
          </div>

          {assistantMessages.length > 0 && (
            <div className="fixed bottom-6 right-24 space-y-3 z-40 max-w-sm">
              {assistantMessages.map((message, index) => (
                <div key={index} className="bg-white border-2 border-green-200 rounded-2xl shadow-xl p-4 animate-in slide-in-from-right-2 duration-300">
                  <p className="text-sm font-semibold text-gray-800">{message}</p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              setAssistantActive(false)
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <FileText className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Output Schema Configuration
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Define how your agent will format and deliver results to users with plugin routing
          </p>

          {!assistantActive && (
            <button
              onClick={() => setAssistantActive(true)}
              className="mt-4 inline-flex items-center gap-2 bg-gradient-to-r from-green-600 to-blue-600 text-white px-6 py-2 rounded-full hover:from-green-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg"
            >
              <MessageSquare className="h-4 w-4" />
              Activate Schema Assistant
              <Sparkles className="h-4 w-4 animate-pulse" />
            </button>
          )}
        </div>

        <div className="space-y-8">
          {/* Output Type Selection */}
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
            <div className="mb-6">
              <h3 className="text-2xl font-semibold text-slate-900 mb-2">Choose Output Type</h3>
              <p className="text-slate-600">Select how your agent will format and deliver results</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {OUTPUT_TYPES.map((outputType) => {
                const IconComponent = getIconComponent(outputType.icon)
                const isSelected = type === outputType.value
                return (
                  <div
                    key={outputType.value}
                    onClick={() => handleTypeSelection(outputType.value as OutputSchemaType)}
                    className={`relative cursor-pointer rounded-2xl border-2 p-6 transition-all duration-200 hover:scale-[1.02] ${
                      isSelected 
                        ? `border-blue-400 ${outputType.bgColor} shadow-lg` 
                        : 'border-slate-200 bg-white/50 hover:border-slate-300 hover:shadow-md'
                    }`}
                  >
                    {/* Plugin routing indicator */}
                    <div className="absolute top-3 right-3">
                      <div className={`w-3 h-3 rounded-full ${outputType.requiresRouting ? 'bg-green-500' : 'bg-yellow-500'}`} 
                           title={outputType.requiresRouting ? "Requires plugin routing" : "Optional plugin routing"} />
                    </div>
                    
                    <div className="flex flex-col space-y-4">
                      <div className={`p-3 rounded-xl bg-gradient-to-r ${outputType.color} shadow-lg w-fit`}>
                        <IconComponent className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className={`font-semibold text-lg mb-2 ${isSelected ? outputType.textColor : 'text-slate-900'}`}>
                          {outputType.label}
                        </h3>
                        <p className={`text-sm mb-3 ${isSelected ? outputType.textColor : 'text-slate-600'}`}>
                          {outputType.description}
                        </p>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`px-2 py-1 rounded-full ${
                            outputType.requiresRouting ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {outputType.requiresRouting ? 'Plugin Required' : 'Plugin Optional'}
                          </span>
                          <span className="text-slate-500 truncate">{outputType.examplePlugin}</span>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="text-blue-600 self-end">
                          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                            <CheckCircle className="h-5 w-5 text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Configuration Section */}
          {type && selectedType && (
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center gap-4 mb-8">
                <div className={`w-12 h-12 bg-gradient-to-r ${selectedType.color} rounded-xl flex items-center justify-center shadow-lg`}>
                  {React.createElement(getIconComponent(selectedType.icon), { className: "h-6 w-6 text-white" })}
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-slate-900">{selectedType.label} Configuration</h3>
                  <p className="text-slate-600">{selectedType.description}</p>
                </div>
              </div>

              {renderConfiguration()}
            </div>
          )}

          {/* Validation Status */}
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 rounded-2xl border border-blue-200 p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0">
                  {isValidForSubmission ? (
                    <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle className="h-6 w-6 text-white" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 border-2 border-slate-300 rounded-full flex items-center justify-center">
                      <AlertTriangle className="h-6 w-6 text-slate-400" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-900">
                    {isValidForSubmission ? 'Output schema configured!' : 'Complete the configuration'}
                  </p>
                  <p className="text-slate-600">
                    {isValidForSubmission 
                      ? 'Your agent knows how to format and deliver results with plugin routing' 
                      : 'Fill in all required fields to proceed'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <AIAssistant />
      </div>
    </div>
  )
}