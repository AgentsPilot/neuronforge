'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Copy, Trash2, Settings, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'

// Simple UUID generator replacement
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// Simple toast replacement
const toast = {
  success: (message: string) => console.log('✅ Success:', message),
  warning: (message: string) => console.log('⚠️ Warning:', message),
  error: (message: string) => console.log('❌ Error:', message)
}

const FIELD_TYPES = [
  { value: 'string', label: 'Text', icon: '📝', color: 'bg-blue-500' },
  { value: 'number', label: 'Number', icon: '🔢', color: 'bg-green-500' },
  { value: 'boolean', label: 'True/False', icon: '✅', color: 'bg-purple-500' },
  { value: 'date', label: 'Date', icon: '📅', color: 'bg-orange-500' },
  { value: 'enum', label: 'Options', icon: '📋', color: 'bg-indigo-500' },
  { value: 'file', label: 'File Upload', icon: '📎', color: 'bg-pink-500' }
]

const BLOCKED_FIELDS_BY_PLUGIN: Record<string, string[]> = {
  'google-mail': ['email', 'emailAccount'],
  'notion': ['workspace', 'workspaceName'],
}

interface Field {
  id: string
  name: string
  type: string
  required: boolean
  description?: string
  enum?: string[]
  placeholder?: string
  validation?: {
    min?: number
    max?: number
    pattern?: string
  }
}

interface Props {
  data: any
  onUpdate: (updates: any) => void
  setStepLoading: (val: boolean) => void
  onValidationChange?: (isValid: boolean, error?: string) => void
}

export default function Step4Schemas({ data, onUpdate, setStepLoading, onValidationChange }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isGenerating, setIsGenerating] = useState(false)

  // Memoize the validation to prevent unnecessary re-computations
  const validateField = useCallback((field: Field) => {
    const errors: string[] = []

    if (!field.name?.trim()) {
      errors.push('Field name is required')
    }

    if (field.name && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name.trim())) {
      errors.push('Field name must start with a letter and contain only letters, numbers, and underscores')
    }

    if (field.type === 'enum' && (!field.enum || field.enum.length === 0)) {
      errors.push('Enum type requires at least one option')
    }

    // Check for duplicate names
    const duplicates = data.inputSchema?.filter((f: Field) =>
      f.name?.toLowerCase() === field.name?.toLowerCase() && f.id !== field.id
    )
    if (duplicates?.length > 0) {
      errors.push('Field name must be unique')
    }

    return errors.join(', ')
  }, [data.inputSchema])

  // Generate schema from prompt (AI)
  useEffect(() => {
    const generateSchema = async () => {
      if (!data.userPrompt || data.inputSchema?.length > 0) return

      setIsGenerating(true)
      setStepLoading(true)

      try {
        const res = await fetch('/api/generate/input-schema', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: data.userPrompt,
            plugins: Object.keys(data.plugins || {}),
          }),
        })

        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to generate schema')

        const schemaWithIds = json.input_schema.map((field: any) => ({
          id: generateUUID(),
          ...field,
        }))

        const selectedPlugins = Object.keys(data.plugins || {})
        const blockedFields = selectedPlugins.flatMap((plugin) => BLOCKED_FIELDS_BY_PLUGIN[plugin] || [])
        const filteredSchema = schemaWithIds.filter(
          (field: Field) => !blockedFields.includes(field.name?.toLowerCase())
        )

        if (filteredSchema.length < schemaWithIds.length) {
          toast.warning('Some fields were filtered out due to plugin restrictions')
        }

        onUpdate({ inputSchema: filteredSchema })
        toast.success(`Generated ${filteredSchema.length} input fields`)
      } catch (err: any) {
        setError(err.message || 'Failed to generate schema')
        toast.error('Schema generation failed')
      } finally {
        setIsGenerating(false)
        setStepLoading(false)
      }
    }

    generateSchema()
    // eslint-disable-next-line
  }, [data.userPrompt, data.inputSchema?.length])

  const handleFieldChange = useCallback((id: string, changes: Partial<Field>) => {
    const updatedFields = data.inputSchema.map((f: Field) =>
      f.id === id ? { ...f, ...changes } : f
    )
    onUpdate({ inputSchema: updatedFields })

    // Validate the updated field
    const updatedField = updatedFields.find((f: Field) => f.id === id)
    if (updatedField) {
      const error = validateField(updatedField)
      setFieldErrors(prev => ({
        ...prev,
        [id]: error || undefined
      }))
    }
  }, [data.inputSchema, validateField])

  const handleAddField = useCallback(() => {
    const newField: Field = {
      id: generateUUID(),
      name: '',
      type: 'string',
      required: false,
      description: '',
      placeholder: ''
    }
    onUpdate({ inputSchema: [...(data.inputSchema || []), newField] })
  }, [data.inputSchema])

  const handleRemoveField = useCallback((id: string) => {
    const updated = data.inputSchema.filter((f: Field) => f.id !== id)
    onUpdate({ inputSchema: updated })
    setFieldErrors(prev => {
      const { [id]: _, ...rest } = prev
      return rest
    })
  }, [data.inputSchema])

  const handleDuplicateField = useCallback((field: Field) => {
    const duplicatedField: Field = {
      ...field,
      id: generateUUID(),
      name: `${field.name}_copy`
    }
    onUpdate({ inputSchema: [...data.inputSchema, duplicatedField] })
  }, [data.inputSchema])

  const hasErrors = Object.keys(fieldErrors).some(key => fieldErrors[key])

  // --- VALIDATION LOGIC FOR WIZARD ---
  useEffect(() => {
    let errorMsg = ''
    let isValid = true

    if (!data.inputSchema || data.inputSchema.length === 0) {
      errorMsg = 'At least one field is required.'
      isValid = false
    } else {
      for (let field of data.inputSchema) {
        const error = validateField(field)
        if (error) {
          errorMsg = error
          isValid = false
          break
        }
      }
      if (hasErrors) {
        errorMsg = 'Please fix all validation errors.'
        isValid = false
      }
    }

    if (onValidationChange) {
      onValidationChange(isValid, errorMsg)
    }
    // eslint-disable-next-line
  }, [data.inputSchema, fieldErrors, hasErrors])

  const getFieldTypeInfo = (type: string) => {
    return FIELD_TYPES.find(t => t.value === type) || FIELD_TYPES[0]
  }

  // --- UI ---
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <Settings className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            Input Schema Configuration
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Define the fields users will fill when running your agent
          </p>
          {data.inputSchema?.length > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
              <CheckCircle className="h-4 w-4" />
              {data.inputSchema.length} field{data.inputSchema.length !== 1 ? 's' : ''} configured
            </div>
          )}
        </div>

        {/* Generation Status */}
        {isGenerating && (
          <div className="mb-8 animate-in slide-in-from-top-2 duration-300">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-200 p-6">
              <div className="flex items-center justify-center gap-4 text-blue-700">
                <div className="relative">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <div className="absolute inset-0 h-8 w-8 rounded-full border-2 border-blue-200 animate-pulse"></div>
                </div>
                <div>
                  <p className="font-semibold text-lg">Generating Input Schema</p>
                  <p className="text-sm text-blue-600">Analyzing your prompt to create relevant fields...</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-8 animate-in slide-in-from-top-1 duration-300">
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-red-900 text-lg">Schema Generation Failed</p>
                  <p className="text-red-700">{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Validation Errors */}
        {hasErrors && (
          <div className="mb-8 animate-in slide-in-from-top-1 duration-300">
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-amber-900 text-lg">Validation Errors Found</p>
                  <p className="text-amber-800">Please fix all validation errors before continuing</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Fields List */}
        <div className="space-y-6 mb-8">
          {data.inputSchema?.map((field: Field, index: number) => {
            const fieldType = getFieldTypeInfo(field.type)
            const hasFieldError = fieldErrors[field.id]

            return (
              <div
                key={field.id}
                className={`bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border transition-all duration-300 hover:shadow-xl ${
                  hasFieldError ? 'border-red-300 bg-red-50/50' : 'border-white/40 hover:border-blue-200'
                }`}
              >
                {/* Field Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-200">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 ${fieldType.color} rounded-xl flex items-center justify-center text-white shadow-lg`}>
                      <span className="text-xl">{fieldType.icon}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-slate-900">Field #{index + 1}</span>
                        {field.required && (
                          <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                            Required
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600">{fieldType.label}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDuplicateField(field)}
                      className="flex items-center gap-2 px-4 py-2 text-blue-700 hover:text-blue-900 hover:bg-blue-50 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105"
                      title="Duplicate field"
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </button>
                    <button
                      onClick={() => handleRemoveField(field.id)}
                      className="flex items-center gap-2 px-4 py-2 text-red-700 hover:text-red-900 hover:bg-red-50 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105"
                      title="Remove field"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                </div>

                {/* Field Configuration */}
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Field Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        className={`w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:ring-2 transition-all duration-200 ${
                          hasFieldError?.includes('name') 
                            ? 'border-red-300 focus:border-red-500 focus:ring-red-500 bg-red-50' 
                            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500 bg-white/50'
                        }`}
                        placeholder="e.g., customerName, orderAmount"
                        value={field.name || ''}
                        onChange={(e) => handleFieldChange(field.id, { name: e.target.value })}
                      />
                      <p className="text-xs text-slate-500 mt-2">Used as the variable name in your agent</p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">Field Type</label>
                      <select
                        className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/50 transition-all duration-200"
                        value={field.type}
                        onChange={(e) => handleFieldChange(field.id, { type: e.target.value })}
                      >
                        {FIELD_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.icon} {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">Description</label>
                      <input
                        className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/50 transition-all duration-200"
                        placeholder="Brief description of this field"
                        value={field.description || ''}
                        onChange={(e) => handleFieldChange(field.id, { description: e.target.value })}
                      />
                      <p className="text-xs text-slate-500 mt-2">Help text shown to users</p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">Placeholder Text</label>
                      <input
                        className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/50 transition-all duration-200"
                        placeholder="Example value for users"
                        value={field.placeholder || ''}
                        onChange={(e) => handleFieldChange(field.id, { placeholder: e.target.value })}
                      />
                      <p className="text-xs text-slate-500 mt-2">Example shown in the input field</p>
                    </div>
                  </div>

                  <div className="flex items-center">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.required || false}
                        onChange={(e) => handleFieldChange(field.id, { required: e.target.checked })}
                        className="w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                      <span className="text-sm font-medium text-slate-700">Required field</span>
                    </label>
                  </div>

                  {/* Enum Options */}
                  {field.type === 'enum' && (
                    <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                      <label className="block text-sm font-semibold text-slate-700 mb-4">
                        Enum Options <span className="text-red-500">*</span>
                      </label>
                      <div className="space-y-3">
                        {(field.enum || []).map((option: string, idx: number) => (
                          <div key={idx} className="flex gap-3 items-center">
                            <input
                              type="text"
                              className="flex-1 px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                              placeholder={`Option ${idx + 1}`}
                              value={option}
                              onChange={(e) => {
                                const newEnum = [...(field.enum || [])]
                                newEnum[idx] = e.target.value
                                handleFieldChange(field.id, { enum: newEnum })
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const newEnum = [...(field.enum || [])]
                                newEnum.splice(idx, 1)
                                handleFieldChange(field.id, { enum: newEnum })
                              }}
                              className="px-4 py-3 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-xl font-medium transition-all duration-200"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const newEnum = [...(field.enum || []), '']
                            handleFieldChange(field.id, { enum: newEnum })
                          }}
                          className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium transition-colors duration-200"
                        >
                          <Plus className="h-4 w-4" />
                          Add Option
                        </button>
                      </div>
                    </div>
                  )}

                  {/* File Upload Notice */}
                  {field.type === 'file' && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-center gap-3 text-blue-800">
                        <span className="text-2xl">📎</span>
                        <p className="font-medium">This field will accept PDF file uploads during agent execution</p>
                      </div>
                    </div>
                  )}

                  {/* Field Error Display */}
                  {hasFieldError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-in slide-in-from-top-1 duration-200">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
                        <p className="text-red-800 font-medium">{hasFieldError}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Empty State */}
        {(!data.inputSchema || data.inputSchema.length === 0) && !isGenerating && !error && (
          <div className="text-center py-20">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-12">
              <div className="text-8xl mb-6">📝</div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">No Input Fields Yet</h3>
              <p className="text-slate-600 mb-8">Fields will be generated automatically from your prompt, or you can add them manually</p>
              <button
                onClick={handleAddField}
                className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
              >
                <Plus className="h-5 w-5" />
                Add Your First Field
              </button>
            </div>
          </div>
        )}

        {/* Add More Fields */}
        {data.inputSchema?.length > 0 && (
          <div className="mb-8">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Add More Fields</h3>
                  <p className="text-slate-600">Customize your agent's input requirements further</p>
                </div>
                <button
                  onClick={handleAddField}
                  className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
                >
                  <Plus className="h-5 w-5" />
                  Add Custom Field
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Schema Preview */}
        {data.inputSchema?.length > 0 && (
          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-8 text-white">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                <Settings className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-2xl font-bold">📋 Input Schema Preview</h4>
                <p className="text-blue-100">How users will interact with your agent</p>
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
              <p className="font-semibold text-lg mb-4 text-blue-100">Users will be prompted to fill:</p>
              <div className="space-y-3">
                {data.inputSchema.map((field: Field, index: number) => (
                  <div key={field.id} className="flex items-center gap-4 p-3 bg-white/10 rounded-lg">
                    <span className="font-mono bg-white/20 px-3 py-1 rounded-lg text-sm font-semibold">
                      {field.name || `field_${index + 1}`}
                    </span>
                    <span className="text-blue-200 text-sm">
                      ({getFieldTypeInfo(field.type).label.toLowerCase()})
                    </span>
                    {field.required && (
                      <span className="px-2 py-1 bg-red-400 text-white text-xs font-medium rounded-full">
                        required
                      </span>
                    )}
                    {field.description && (
                      <span className="text-blue-200 text-sm italic flex-1">
                        {field.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}