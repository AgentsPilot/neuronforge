'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Trash2, Plus, Mail, AlertTriangle, FileText, Database, CheckCircle, Copy } from 'lucide-react'

type OutputSchemaType = 'SummaryBlock' | 'EmailDraft' | 'Alert' | 'StructuredData' | ''

type OutputField = {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description?: string
}

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const OUTPUT_TYPES = [
  {
    value: 'SummaryBlock',
    label: 'Summary Block',
    description: 'Generate a formatted text summary',
    icon: FileText,
    color: 'from-blue-500 to-cyan-600',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200'
  },
  {
    value: 'EmailDraft',
    label: 'Email Draft',
    description: 'Create a ready-to-send email',
    icon: Mail,
    color: 'from-green-500 to-emerald-600',
    bgColor: 'bg-green-50',
    textColor: 'text-green-700',
    borderColor: 'border-green-200'
  },
  {
    value: 'Alert',
    label: 'Dashboard Alert',
    description: 'Send notifications with severity levels',
    icon: AlertTriangle,
    color: 'from-orange-500 to-red-600',
    bgColor: 'bg-orange-50',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-200'
  },
  {
    value: 'StructuredData',
    label: 'Structured Data',
    description: 'Custom fields with defined schema',
    icon: Database,
    color: 'from-purple-500 to-indigo-600',
    bgColor: 'bg-purple-50',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200'
  }
]

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low Priority', color: 'bg-blue-100 text-blue-800 border-blue-300', emoji: '💙', gradient: 'from-blue-400 to-blue-600' },
  { value: 'medium', label: 'Medium Priority', color: 'bg-yellow-100 text-yellow-800 border-yellow-300', emoji: '⚠️', gradient: 'from-yellow-400 to-orange-500' },
  { value: 'high', label: 'High Priority', color: 'bg-red-100 text-red-800 border-red-300', emoji: '🚨', gradient: 'from-red-400 to-red-600' }
]

const FIELD_TYPES = [
  { value: 'string', label: 'Text', icon: '📝', color: 'bg-blue-500' },
  { value: 'number', label: 'Number', icon: '🔢', color: 'bg-green-500' },
  { value: 'boolean', label: 'True/False', icon: '✅', color: 'bg-purple-500' }
]

interface Props {
  data?: any
  onUpdate: (updates: any) => void
  onValidationChange?: (isValid: boolean, error?: string) => void
}

export default function Step5OutputSchema({ data = {}, onUpdate, onValidationChange }: Props) {
  const defaultOutput = data.outputSchema || {}

  const [type, setType] = useState<OutputSchemaType>(defaultOutput?.type || '')
  const [to, setTo] = useState(defaultOutput?.to || '')
  const [subject, setSubject] = useState(defaultOutput?.subject || '')
  const [includePdf, setIncludePdf] = useState(defaultOutput?.includePdf || false)
  const [alertTitle, setAlertTitle] = useState(defaultOutput?.title || '')
  const [alertMessage, setAlertMessage] = useState(defaultOutput?.message || '')
  const [alertSeverity, setAlertSeverity] = useState(defaultOutput?.severity || '')
  const [fields, setFields] = useState<OutputField[]>(defaultOutput?.fields || [])

  // Validation states
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Use refs to track the latest values and prevent infinite loops
  const onUpdateRef = useRef(onUpdate)
  const onValidationChangeRef = useRef(onValidationChange)
  
  // Update refs when props change
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])
  
  useEffect(() => {
    onValidationChangeRef.current = onValidationChange
  }, [onValidationChange])  // Field validation for structured data - memoized properly
  const validateStructuredFields = useCallback(() => {
    const fieldErrors: Record<string, string> = {}
    
    fields.forEach((field, index) => {
      if (!field.name.trim()) {
        fieldErrors[`field_${index}_name`] = 'Field name is required'
      } else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name.trim())) {
        fieldErrors[`field_${index}_name`] = 'Field name must start with a letter and contain only letters, numbers, and underscores'
      }
      
      // Check for duplicate names
      const duplicates = fields.filter((f, i) => 
        f.name?.toLowerCase() === field.name?.toLowerCase() && i !== index
      )
      if (duplicates.length > 0) {
        fieldErrors[`field_${index}_name`] = 'Field name must be unique'
      }
    })
    
    return fieldErrors
  }, [fields])

  // Overall validation - only validate fields that have been interacted with or are required for the current type
  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {}
    
    // Only validate if user has started interacting with the form
    if (!type && touched.type) {
      newErrors.type = 'Output type is required'
    }
    
    // Only validate alert fields if Alert type is selected and fields have been touched
    if (type === 'Alert') {
      if (touched.alertTitle && !alertTitle.trim()) {
        newErrors.alertTitle = 'Alert title is required'
      }
      if (touched.alertMessage && !alertMessage.trim()) {
        newErrors.alertMessage = 'Alert message is required'
      }
      if (touched.alertSeverity && !alertSeverity) {
        newErrors.alertSeverity = 'Severity level is required'
      }
    }
    
    // Only validate email fields if EmailDraft type is selected and fields have been touched
    if (type === 'EmailDraft') {
      if (touched.to && !to.trim()) {
        newErrors.to = 'Email recipient is required'
      }
      if (touched.subject && !subject.trim()) {
        newErrors.subject = 'Email subject is required'
      }
    }
    
    // Only validate structured data if type is selected and user has interacted
    if (type === 'StructuredData') {
      if (fields.length === 0 && touched.fields) {
        newErrors.fields = 'At least one field is required for structured data'
      } else if (fields.length > 0) {
        const fieldErrors = validateStructuredFields()
        // Only show field errors for fields that have been touched
        Object.keys(fieldErrors).forEach(key => {
          if (touched[key]) {
            newErrors[key] = fieldErrors[key]
          }
        })
      }
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [type, alertTitle, alertMessage, alertSeverity, to, subject, fields, validateStructuredFields, touched])

  // Check if form is valid for submission (stricter validation) - memoized with stable dependencies
  const isValidForSubmission = useMemo(() => {
    if (!type) return false
    
    if (type === 'Alert') {
      return !!(alertTitle.trim() && alertMessage.trim() && alertSeverity)
    }
    
    if (type === 'EmailDraft') {
      return !!(to.trim() && subject.trim())
    }
    
    if (type === 'StructuredData') {
      if (fields.length === 0) return false
      const fieldErrors = validateStructuredFields()
      return Object.keys(fieldErrors).length === 0
    }
    
    return true
  }, [type, alertTitle, alertMessage, alertSeverity, to, subject, fields, validateStructuredFields])

  // Memoize the schema object to prevent unnecessary updates
  const schema = useMemo(() => {
    const newSchema: any = { type }

    if (type === 'EmailDraft') {
      newSchema.to = to
      newSchema.subject = subject
      newSchema.includePdf = includePdf
    }

    if (type === 'Alert') {
      newSchema.title = alertTitle
      newSchema.message = alertMessage
      newSchema.severity = alertSeverity
    }

    if (type === 'StructuredData') {
      newSchema.fields = fields
    }
    
    return newSchema
  }, [type, to, subject, includePdf, alertTitle, alertMessage, alertSeverity, fields])

  // Update parent with schema - use refs to prevent infinite loops
  useEffect(() => {
    onUpdateRef.current({ outputSchema: schema })
  }, [schema])

  // Update parent with validation status - use refs to prevent infinite loops  
  useEffect(() => {
    const getErrorMessage = () => {
      if (!type) return 'Please select an output type'
      if (type === 'Alert' && (!alertTitle.trim() || !alertMessage.trim() || !alertSeverity)) {
        return 'Please complete all alert fields'
      }
      if (type === 'EmailDraft' && (!to.trim() || !subject.trim())) {
        return 'Please complete all email fields'
      }
      if (type === 'StructuredData') {
        if (fields.length === 0) return 'Please add at least one field'
        const fieldErrors = validateStructuredFields()
        if (Object.keys(fieldErrors).length > 0) return 'Please fix field validation errors'
      }
      return ''
    }
    
    const errorMessage = getErrorMessage()
    
    if (onValidationChangeRef.current) {
      onValidationChangeRef.current(isValidForSubmission, errorMessage)
    }
  }, [isValidForSubmission, type, alertTitle, alertMessage, alertSeverity, to, subject, fields, validateStructuredFields])

  const handleFieldBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }))
    // Delay validation slightly to allow for smooth UX
    setTimeout(() => validateForm(), 100)
  }

  const handleTypeSelection = (selectedType: OutputSchemaType) => {
    setType(selectedType)
    setTouched(prev => ({ ...prev, type: true }))
    // Clear errors when switching types
    setErrors({})
    
    // Mark fields as needing interaction for the new type
    if (selectedType === 'StructuredData' && fields.length === 0) {
      setTouched(prev => ({ ...prev, fields: true }))
    }
  }

  const updateField = useCallback((index: number, updated: Partial<OutputField>) => {
    setFields(prevFields => {
      const newFields = [...prevFields]
      newFields[index] = { ...newFields[index], ...updated }
      return newFields
    })
  }, [])

  const removeField = useCallback((index: number) => {
    setFields(prevFields => prevFields.filter((_, i) => i !== index))
  }, [])

  const addField = useCallback(() => {
    setFields(prevFields => [
      ...prevFields,
      { id: generateUUID(), name: '', type: 'string', required: false, description: '' },
    ])
  }, [])

  const duplicateField = useCallback((index: number) => {
    setFields(prevFields => {
      const fieldToDuplicate = prevFields[index]
      const duplicated = {
        ...fieldToDuplicate,
        id: generateUUID(),
        name: `${fieldToDuplicate.name}_copy`
      }
      return [...prevFields, duplicated]
    })
  }, [])

  const selectedType = OUTPUT_TYPES.find(t => t.value === type)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <FileText className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Output Schema Configuration
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Define how your agent will format and deliver results to users
          </p>
        </div>

        {/* Validation Errors Summary - Only show if user has interacted */}
        {Object.keys(errors).length > 0 && Object.keys(touched).length > 0 && (
          <div className="mb-8 animate-in slide-in-from-top-1 duration-300">
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-red-900 text-lg">Validation Errors</p>
                  <p className="text-red-700">Please fix the following issues to continue:</p>
                  <ul className="mt-2 text-sm text-red-600 list-disc list-inside">
                    {Object.values(errors).map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-8">
          {/* Output Type Selection */}
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
            <div className="mb-6">
              <h3 className="text-2xl font-semibold text-slate-900 mb-2">Choose Output Type</h3>
              <p className="text-slate-600">Select how your agent will format and deliver results</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {OUTPUT_TYPES.map((outputType) => {
                const IconComponent = outputType.icon
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
                    <div className="flex items-start space-x-4">
                      <div className={`p-3 rounded-xl bg-gradient-to-r ${outputType.color} shadow-lg`}>
                        <IconComponent className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className={`font-semibold text-lg mb-2 ${
                          isSelected ? outputType.textColor : 'text-slate-900'
                        }`}>
                          {outputType.label}
                        </h3>
                        <p className={`text-sm ${
                          isSelected ? outputType.textColor : 'text-slate-600'
                        }`}>
                          {outputType.description}
                        </p>
                      </div>
                      {isSelected && (
                        <div className="text-blue-600">
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
                  <selectedType.icon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-slate-900">{selectedType.label} Configuration</h3>
                  <p className="text-slate-600">{selectedType.description}</p>
                </div>
              </div>

              {/* ALERT FIELDS */}
              {type === 'Alert' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Alert Title <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={alertTitle}
                        onChange={e => setAlertTitle(e.target.value)}
                        onBlur={() => handleFieldBlur('alertTitle')}
                        placeholder="Enter alert title"
                        className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
                          errors.alertTitle && touched.alertTitle
                            ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
                            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
                        }`}
                      />
                      {errors.alertTitle && touched.alertTitle && (
                        <p className="text-red-600 text-sm mt-2 font-medium">{errors.alertTitle}</p>
                      )}
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Severity Level <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-3 gap-3">
                        {SEVERITY_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => {
                              setAlertSeverity(option.value)
                              setTouched(prev => ({ ...prev, alertSeverity: true }))
                            }}
                            className={`p-4 rounded-xl border-2 text-sm font-medium transition-all duration-200 hover:scale-105 ${
                              alertSeverity === option.value
                                ? `border-blue-400 bg-gradient-to-r ${option.gradient} text-white shadow-lg`
                                : 'border-slate-200 bg-white/50 hover:border-slate-300 text-slate-700'
                            }`}
                          >
                            <div className="flex flex-col items-center gap-2">
                              <span className="text-2xl">{option.emoji}</span>
                              <span className="text-xs leading-tight">{option.label}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      {errors.alertSeverity && touched.alertSeverity && (
                        <p className="text-red-600 text-sm mt-2 font-medium">{errors.alertSeverity}</p>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-3">
                      Alert Message <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={alertMessage}
                      onChange={e => setAlertMessage(e.target.value)}
                      onBlur={() => handleFieldBlur('alertMessage')}
                      placeholder="Enter detailed alert message"
                      rows={4}
                      className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 resize-none ${
                        errors.alertMessage && touched.alertMessage
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
                          : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
                      }`}
                    />
                    {errors.alertMessage && touched.alertMessage && (
                      <p className="text-red-600 text-sm mt-2 font-medium">{errors.alertMessage}</p>
                    )}
                  </div>
                </div>
              )}

              {/* EMAIL DRAFT FIELDS */}
              {type === 'EmailDraft' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        To (Email Address) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={to}
                        onChange={e => setTo(e.target.value)}
                        onBlur={() => handleFieldBlur('to')}
                        placeholder="recipient@example.com"
                        className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
                          errors.to
                            ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
                            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
                        }`}
                      />
                      {errors.to && (
                        <p className="text-red-600 text-sm mt-2 font-medium">{errors.to}</p>
                      )}
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Subject <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        onBlur={() => handleFieldBlur('subject')}
                        placeholder="Email subject line"
                        className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
                          errors.subject
                            ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
                            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
                        }`}
                      />
                      {errors.subject && (
                        <p className="text-red-600 text-sm mt-2 font-medium">{errors.subject}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includePdf}
                        onChange={e => setIncludePdf(e.target.checked)}
                        className="w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                      <span className="text-sm font-medium text-slate-700">Include PDF attachment</span>
                    </label>
                  </div>
                </div>
              )}

              {/* STRUCTURED DATA FIELDS */}
              {type === 'StructuredData' && (
                <div className="space-y-6">
                  {errors.fields && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                      <p className="text-red-800 font-medium">{errors.fields}</p>
                    </div>
                  )}
                  
                  <div className="space-y-4">
                    {fields.map((field, index) => {
                      const fieldType = FIELD_TYPES.find(t => t.value === field.type) || FIELD_TYPES[0]
                      const nameError = errors[`field_${index}_name`]
                      
                      return (
                        <div
                          key={field.id}
                          className={`bg-white/50 backdrop-blur-sm rounded-xl border-2 p-6 transition-all duration-200 ${
                            nameError ? 'border-red-300 bg-red-50/50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 ${fieldType.color} rounded-xl flex items-center justify-center text-white shadow-lg`}>
                                <span className="text-lg">{fieldType.icon}</span>
                              </div>
                              <div>
                                <span className="text-lg font-semibold text-slate-900">Field #{index + 1}</span>
                                <p className="text-sm text-slate-600">{fieldType.label}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => duplicateField(index)}
                                className="flex items-center gap-2 px-3 py-2 text-blue-700 hover:text-blue-900 hover:bg-blue-50 rounded-lg text-sm font-medium transition-all duration-200"
                              >
                                <Copy className="h-4 w-4" />
                                Copy
                              </button>
                              <button
                                onClick={() => removeField(index)}
                                className="flex items-center gap-2 px-3 py-2 text-red-700 hover:text-red-900 hover:bg-red-50 rounded-lg text-sm font-medium transition-all duration-200"
                              >
                                <Trash2 className="h-4 w-4" />
                                Remove
                              </button>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Field Name <span className="text-red-500">*</span>
                              </label>
                              <input
                                value={field.name}
                                onChange={e => updateField(index, { name: e.target.value })}
                                onBlur={() => handleFieldBlur(`field_${index}_name`)}
                                placeholder="fieldName"
                                className={`w-full px-3 py-2 rounded-lg border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
                                  nameError
                                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
                                    : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white'
                                }`}
                              />
                              {nameError && (
                                <p className="text-red-600 text-xs mt-1">{nameError}</p>
                              )}
                            </div>
                            
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">Type</label>
                              <select
                                value={field.type}
                                onChange={e => updateField(index, { type: e.target.value as 'string' | 'number' | 'boolean' })}
                                className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                              >
                                {FIELD_TYPES.map(type => (
                                  <option key={type.value} value={type.value}>
                                    {type.icon} {type.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                              <input
                                value={field.description || ''}
                                onChange={e => updateField(index, { description: e.target.value })}
                                placeholder="Field description"
                                className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                              />
                            </div>
                          </div>
                          
                          <div className="mt-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={e => updateField(index, { required: e.target.checked })}
                                className="w-4 h-4 text-blue-600 border-2 border-slate-300 rounded focus:ring-blue-500"
                              />
                              <span className="text-sm font-medium text-slate-700">Required field</span>
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  
                  <button
                    onClick={addField}
                    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-[1.02] shadow-lg hover:shadow-xl"
                  >
                    <Plus className="h-5 w-5" />
                    Add Field
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Preview Section */}
          {type && (
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-8 text-white">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-2xl font-bold">📋 Output Preview</h4>
                  <p className="text-blue-100">Preview how your output will look</p>
                </div>
              </div>
              
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
                {type === 'Alert' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{SEVERITY_OPTIONS.find(s => s.value === alertSeverity)?.emoji || '⚠️'}</span>
                      <strong className="text-lg">{alertTitle || 'Alert Title'}</strong>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium bg-white/20 text-white border border-white/30`}>
                        {SEVERITY_OPTIONS.find(s => s.value === alertSeverity)?.label || 'Select Severity'}
                      </span>
                    </div>
                    <div className="text-blue-100 bg-white/10 rounded-lg p-4">
                      {alertMessage || 'Alert message will appear here'}
                    </div>
                  </div>
                )}
                
                {type === 'EmailDraft' && (
                  <div className="space-y-3">
                    <div className="bg-white/10 rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        <span className="font-medium">To:</span>
                        <span>{to || 'recipient@example.com'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Subject:</span>
                        <span>{subject || 'Email subject line'}</span>
                      </div>
                      {includePdf && (
                        <div className="flex items-center gap-2 text-blue-200">
                          <span className="text-sm">📎 PDF attachment included</span>
                        </div>
                      )}
                    </div>
                    <div className="text-blue-100 bg-white/10 rounded-lg p-4">
                      Email content will be generated by your agent...
                    </div>
                  </div>
                )}
                
                {type === 'SummaryBlock' && (
                  <div className="bg-white/10 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="h-5 w-5" />
                      <span className="font-medium">Summary Report</span>
                    </div>
                    <div className="text-blue-100">
                      Your agent will generate a formatted summary based on the input data...
                    </div>
                  </div>
                )}
                
                {type === 'StructuredData' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-4">
                      <Database className="h-5 w-5" />
                      <span className="font-medium">Structured Output</span>
                    </div>
                    {fields.length > 0 ? (
                      <div className="bg-white/10 rounded-lg p-4 space-y-2">
                        {fields.map((field, index) => (
                          <div key={field.id} className="flex items-center gap-3">
                            <span className="font-mono bg-white/20 px-2 py-1 rounded text-sm">
                              {field.name || `field_${index + 1}`}
                            </span>
                            <span className="text-blue-200 text-sm">
                              ({FIELD_TYPES.find(t => t.value === field.type)?.label || 'Text'})
                            </span>
                            {field.required && (
                              <span className="px-2 py-1 bg-red-400/80 text-white text-xs rounded-full">
                                required
                              </span>
                            )}
                            {field.description && (
                              <span className="text-blue-200 text-sm italic">
                                - {field.description}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-blue-200 bg-white/10 rounded-lg p-4 text-center">
                        Add fields to see the structure preview
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                      ? 'Your agent knows how to format and deliver results' 
                      : 'Fill in all required fields to proceed'}
                  </p>
                </div>
              </div>
              
              {/* Progress indicator */}
              <div className="text-right">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-slate-600">Completion:</span>
                  <span className={`text-sm font-semibold ${isValidForSubmission ? 'text-green-600' : 'text-orange-600'}`}>
                    {isValidForSubmission ? '100%' : `${Math.round((type ? 50 : 0) + (Object.keys(errors).length === 0 ? 50 : 0))}%`}
                  </span>
                </div>
                <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${isValidForSubmission ? 'bg-green-500' : 'bg-orange-500'}`}
                    style={{ 
                      width: `${isValidForSubmission ? 100 : Math.round((type ? 50 : 0) + (Object.keys(errors).length === 0 ? 50 : 0))}%` 
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Tips Section */}
          <div className="bg-gradient-to-r from-purple-500 to-indigo-600 rounded-2xl p-8 text-white">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-xl font-semibold mb-4">💡 Output Schema Best Practices</h4>
                <div className="grid md:grid-cols-2 gap-4 text-purple-100">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Choose the right format</p>
                      <p className="text-sm">Match output type to your use case and audience</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Clear field names</p>
                      <p className="text-sm">Use descriptive names for structured data fields</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Set appropriate severity</p>
                      <p className="text-sm">Use alert levels that match importance</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Test your schema</p>
                      <p className="text-sm">Verify outputs meet your requirements</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}