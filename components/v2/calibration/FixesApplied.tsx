/**
 * FixesApplied - Intermediate state after fixes are applied but before verification
 *
 * V2 theme design:
 * - Shows what was fixed
 * - Prompts user to test the workflow
 * - Clear call-to-action to verify fixes work
 */

'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/v2/ui/card'
import { DynamicSelectField } from '@/components/v2/DynamicSelectField'
import InputHelpButton from '@/components/v2/InputHelpButton'
import {
  Play,
  AlertCircle,
  Wrench,
  ArrowLeft,
  CheckCircle2,
  Loader2
} from 'lucide-react'

type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'file' | 'email' | 'time' | 'select'
  label?: string
  enum?: string[]
  options?: string[]
  description?: string
  required?: boolean
  placeholder?: string
}

interface FixesAppliedProps {
  agent: {
    id: string
    agent_name: string
    input_schema?: Field[]
    plugins_required?: string[]
  }
  fixesSummary: {
    parameters?: number
    parameterizations?: number
    autoRepairs?: number
  }
  onRunTest: (inputValues?: Record<string, any>) => void
  onBackToDashboard?: () => void
  isRunning?: boolean
  initialInputValues?: Record<string, any>
  schemaMetadata?: Record<string, any[]> | null
  onOpenChatbot?: (context: any) => void
  configurationSaved?: boolean
  onSaveConfiguration?: (values: Record<string, any>) => Promise<void>
  onConfigurationChanged?: () => void // Callback when user changes values after saving
  parameterErrorFields?: string[] // Field names that had parameter errors (should not be pre-filled)
}

export function FixesApplied({
  agent,
  fixesSummary,
  onRunTest,
  onBackToDashboard,
  isRunning = false,
  initialInputValues = {},
  schemaMetadata = null,
  onOpenChatbot,
  configurationSaved = false,
  onSaveConfiguration,
  onConfigurationChanged,
  parameterErrorFields = []
}: FixesAppliedProps) {
  const totalFixes = (fixesSummary.parameters || 0) +
                     (fixesSummary.parameterizations || 0) +
                     (fixesSummary.autoRepairs || 0)

  // Check if agent has parameters that need values
  const hasParameters = agent.input_schema && agent.input_schema.length > 0

  // State for parameter input values
  const [inputValues, setInputValues] = useState<Record<string, any>>(initialInputValues)

  // State for save configuration
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Initialize input values with initialInputValues (e.g., from previous calibration)
  // Don't clear them - preserve any saved configuration values
  useEffect(() => {
    if (hasParameters && initialInputValues && Object.keys(initialInputValues).length > 0) {
      setInputValues(initialInputValues)
      console.log('[FixesApplied] Pre-filled input values from saved configuration:', initialInputValues)
    }
  }, [agent.input_schema, hasParameters, initialInputValues])

  // Check if all required parameters have values
  const allRequiredFieldsFilled = !hasParameters || agent.input_schema!.every(param => {
    if (param.required === false) return true
    return inputValues[param.name] !== undefined && inputValues[param.name] !== ''
  })

  // Check if there are any input values (for showing save button)
  const hasInputValues = Object.keys(inputValues).length > 0

  // Check if configuration must be saved before running test
  // If there are input values and onSaveConfiguration exists, require save before test
  const mustSaveBeforeTest = hasParameters && hasInputValues && onSaveConfiguration && !configurationSaved

  const handleRunTest = () => {
    if (hasParameters) {
      onRunTest(inputValues)
    } else {
      onRunTest()
    }
  }

  const handleInputChange = (name: string, value: any) => {
    console.log('[FixesApplied handleInputChange]', { name, value, type: typeof value })
    setInputValues(prev => ({ ...prev, [name]: value }))

    // Notify parent that configuration has changed and needs to be saved again
    if (configurationSaved && onConfigurationChanged) {
      onConfigurationChanged()
    }
  }

  const handleSaveConfiguration = async () => {
    if (!onSaveConfiguration) return

    // Validate that all required fields are filled
    if (!allRequiredFieldsFilled) {
      const emptyFields: string[] = []
      agent.input_schema?.forEach(param => {
        if (param.required !== false) {
          const value = inputValues[param.name]
          if (value === undefined || value === '') {
            emptyFields.push(param.label || param.name)
          }
        }
      })

      const errorMsg = emptyFields.length > 0
        ? `Please fill in all required fields: ${emptyFields.join(', ')}`
        : 'Please fill in all required fields before saving.'

      setSaveError(errorMsg)
      setSaveSuccess(false)
      return
    }

    setIsSaving(true)
    setSaveError(null) // Clear any previous errors
    setSaveSuccess(false) // Clear any previous success
    try {
      // Pass the current inputValues to the parent's save handler
      await onSaveConfiguration(inputValues)
      // Show success message
      setSaveSuccess(true)
      // Auto-hide success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false)
      }, 3000)
    } catch (error: any) {
      console.error('[FixesApplied] Save configuration failed:', error)
      // Set user-friendly error message
      setSaveError('Unable to save your configuration. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  // Helper to format field name into user-friendly label
  // Strips step ID prefixes (step8_, step9_) and formats remaining text
  const formatFieldName = (name: string): string => {
    // Strip step ID prefix if present (e.g., step8_spreadsheet_id -> spreadsheet_id)
    const nameWithoutPrefix = name.replace(/^step\d+_/, '')

    return nameWithoutPrefix
      .replace(/[_-]/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => {
        // Preserve common acronyms in uppercase
        if (word.toLowerCase() === 'id') return 'ID'
        if (word.toLowerCase() === 'url') return 'URL'
        if (word.toLowerCase() === 'api') return 'API'
        // Capitalize first letter, lowercase rest
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      })
      .join(' ')
  }

  // Helper to get field dependencies from schemaMetadata
  const getFieldDependencies = (fieldName: string): string[] => {
    if (!schemaMetadata) return []

    // Try exact match first
    let matchingParams = schemaMetadata[fieldName]

    // If no exact match, try stripping common prefixes (including step ID prefixes)
    if (!matchingParams || matchingParams.length === 0) {
      const prefixes = [/^step\d+_/, 'source_', 'target_', 'input_', 'output_', 'from_', 'to_']
      for (const prefix of prefixes) {
        let baseFieldName: string
        if (prefix instanceof RegExp) {
          // Handle regex for step ID prefix (step8_, step9_, etc.)
          const match = fieldName.match(prefix)
          if (match) {
            baseFieldName = fieldName.substring(match[0].length)
          } else {
            continue
          }
        } else {
          // Handle string prefix
          if (fieldName.startsWith(prefix)) {
            baseFieldName = fieldName.substring(prefix.length)
          } else {
            continue
          }
        }
        matchingParams = schemaMetadata[baseFieldName]
        if (matchingParams && matchingParams.length > 0) break
      }
    }

    if (matchingParams && matchingParams.length > 0) {
      const firstMatch = matchingParams[0]
      return firstMatch.depends_on || []
    }

    return []
  }

  // Calculate dependency depth for ordering (fields with no dependencies come first)
  const calculateDependencyDepth = (fieldName: string, visited: Set<string> = new Set()): number => {
    // Prevent circular dependencies
    if (visited.has(fieldName)) return 0

    const dependencies = getFieldDependencies(fieldName)
    if (dependencies.length === 0) return 0

    visited.add(fieldName)

    // Find max depth of dependencies + 1
    let maxDepth = 0
    for (const dep of dependencies) {
      // Try to find the actual field that matches this dependency
      // dep might be like "spreadsheet_id" but actual field is "source_spreadsheet_id"
      const matchingField = agent.input_schema?.find(f => {
        if (f.name === dep) return true
        // Check if field name ends with the dependency
        if (f.name.endsWith(`_${dep}`)) return true
        return false
      })

      if (matchingField) {
        const depDepth = calculateDependencyDepth(matchingField.name, visited)
        maxDepth = Math.max(maxDepth, depDepth)
      }
    }

    return maxDepth + 1
  }

  // Sort input schema by dependency depth (no dependencies first, then their dependents)
  const sortedInputSchema = hasParameters
    ? [...agent.input_schema!].sort((a, b) => {
        const depthA = calculateDependencyDepth(a.name)
        const depthB = calculateDependencyDepth(b.name)

        // If same depth, maintain original order (stable sort)
        if (depthA === depthB) return 0

        return depthA - depthB
      })
    : []

  // Infer plugin from field name
  const inferPluginFromFieldName = (fieldName: string): string | undefined => {
    const fieldLower = fieldName.toLowerCase()

    if (
      fieldLower.includes('sheet') ||
      fieldLower.includes('spreadsheet') ||
      fieldLower.includes('range') ||
      fieldLower.includes('cell') ||
      fieldLower.includes('row') ||
      fieldLower.includes('column')
    ) {
      return 'google-sheets'
    }

    if (
      fieldLower.includes('email') ||
      fieldLower.includes('gmail') ||
      fieldLower.includes('message') ||
      fieldLower.includes('inbox')
    ) {
      return 'google-mail'
    }

    if (
      fieldLower.includes('drive') ||
      fieldLower.includes('file') ||
      fieldLower.includes('folder')
    ) {
      return 'google-drive'
    }

    return agent?.plugins_required?.[0]
  }

  // Get dynamic options for input field
  const getDynamicOptionsForInput = (fieldName: string): { plugin: string; action: string; parameter: string; depends_on?: string[] } | null => {
    if (!schemaMetadata) return null

    // First try exact match
    let matchingParams = schemaMetadata[fieldName]

    // If no exact match, try stripping common prefixes (including step ID prefixes)
    if (!matchingParams || matchingParams.length === 0) {
      const prefixes = [/^step\d+_/, 'source_', 'target_', 'input_', 'output_', 'from_', 'to_']
      for (const prefix of prefixes) {
        let baseFieldName: string
        if (prefix instanceof RegExp) {
          // Handle regex for step ID prefix (step8_, step9_, etc.)
          const match = fieldName.match(prefix)
          if (match) {
            baseFieldName = fieldName.substring(match[0].length)
          } else {
            continue
          }
        } else {
          // Handle string prefix
          if (fieldName.startsWith(prefix)) {
            baseFieldName = fieldName.substring(prefix.length)
          } else {
            continue
          }
        }
        matchingParams = schemaMetadata[baseFieldName]
        if (matchingParams && matchingParams.length > 0) {
          console.log('[FixesApplied] Matched prefixed field:', fieldName, '->', baseFieldName)
          break
        }
      }
    }

    if (matchingParams && matchingParams.length > 0) {
      const match = matchingParams[0]
      return {
        plugin: match.plugin,
        action: match.action,
        parameter: match.parameter,
        depends_on: match.depends_on
      }
    }

    return null
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">

      {/* Status Header Card */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <CardContent className="!p-4 sm:!p-6 text-center">
          {/* Header with Icon */}
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--v2-primary)]/10">
              <Wrench className="w-4 h-4 text-[var(--v2-primary)]" strokeWidth={2.5} />
            </div>
            <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
              Fixes Applied
            </h3>
          </div>

          {/* Status Message */}
          <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
            {totalFixes} {totalFixes === 1 ? 'fix has' : 'fixes have'} been applied to <span className="font-medium text-[var(--v2-text-primary)]">{agent.agent_name}</span>
          </p>

          {/* Stats Summary */}
          <div className="inline-flex flex-wrap items-center justify-center gap-4 px-4 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg">
            {fixesSummary.parameters !== undefined && fixesSummary.parameters > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[var(--v2-primary)]" />
                <span className="text-xs text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{fixesSummary.parameters}</span> {fixesSummary.parameters === 1 ? 'issue fixed' : 'issues fixed'}
                </span>
              </div>
            )}
            {fixesSummary.parameterizations !== undefined && fixesSummary.parameterizations > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                <span className="text-xs text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{fixesSummary.parameterizations}</span> made customizable
                </span>
              </div>
            )}
            {fixesSummary.autoRepairs !== undefined && fixesSummary.autoRepairs > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[var(--v2-secondary)]" />
                <span className="text-xs text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{fixesSummary.autoRepairs}</span> {fixesSummary.autoRepairs === 1 ? 'improvement' : 'improvements'}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Parameter Input Form (if parameters exist) */}
      {hasParameters && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <CardContent className="!p-4 sm:!p-6">
            <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
              Provide Parameter Values
            </h3>
            <p className="text-sm text-[var(--v2-text-secondary)] mb-6">
              Your workflow now uses parameters. Please provide values before testing.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sortedInputSchema.map((field) => (
                <div key={field.name} className="flex flex-col">
                  <label className="block">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                        {field.label || formatFieldName(field.name)}
                      </span>
                      {field.required !== false && (
                        <span className="text-red-500 dark:text-red-400 text-sm font-medium">*</span>
                      )}
                    </div>

                    {/* Description */}
                    {field.description && (
                      <p className="text-xs text-[var(--v2-text-secondary)] mb-2.5 leading-relaxed">
                        {field.description}
                      </p>
                    )}

                    {/* Input Field with Help Button */}
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        {(() => {
                          // Check if this field should use dynamic dropdown
                          const dynamicOptions = getDynamicOptionsForInput(field.name)

                          console.log('[FixesApplied] Field:', field.name, 'dynamicOptions:', dynamicOptions)

                          if (dynamicOptions) {
                            // Build dependent values object from formData if this field has dependencies
                            const dependentValues: Record<string, any> = {}
                            if (dynamicOptions.depends_on && Array.isArray(dynamicOptions.depends_on)) {
                              dynamicOptions.depends_on.forEach((depField: string) => {
                                // Try exact match first
                                if (inputValues[depField]) {
                                  dependentValues[depField] = inputValues[depField]
                                } else {
                                  // If no exact match, try to find a prefixed version
                                  // e.g., if depField is "spreadsheet_id", look for "step8_spreadsheet_id", "source_spreadsheet_id", etc.
                                  const prefixes = [/^step\d+_/, 'source_', 'target_', 'input_', 'output_', 'from_', 'to_']

                                  // Check all input values for any that match the dependent field after stripping prefix
                                  for (const [inputKey, inputValue] of Object.entries(inputValues)) {
                                    // Try stripping each prefix pattern
                                    for (const prefix of prefixes) {
                                      let baseFieldName: string
                                      if (prefix instanceof RegExp) {
                                        const match = inputKey.match(prefix)
                                        if (match) {
                                          baseFieldName = inputKey.substring(match[0].length)
                                        } else {
                                          continue
                                        }
                                      } else {
                                        if (inputKey.startsWith(prefix as string)) {
                                          baseFieldName = inputKey.substring((prefix as string).length)
                                        } else {
                                          continue
                                        }
                                      }

                                      // If base name matches the dependency, use it
                                      if (baseFieldName === depField) {
                                        dependentValues[depField] = inputValue
                                        console.log('[FixesApplied] Mapped dependent field:', depField, '<-', inputKey, '=', inputValue)
                                        break
                                      }
                                    }
                                    if (dependentValues[depField]) break
                                  }
                                }
                              })
                            }

                            // Use DynamicSelectField for fields with dynamic options
                            return (
                              <DynamicSelectField
                                plugin={dynamicOptions.plugin}
                                action={dynamicOptions.action}
                                parameter={dynamicOptions.parameter}
                                value={inputValues[field.name] || ''}
                                onChange={(value) => handleInputChange(field.name, value)}
                                required={field.required}
                                placeholder={field.placeholder || `Select ${formatFieldName(field.name).toLowerCase()}...`}
                                className="w-full px-3.5 py-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]/20 transition-all duration-200"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                                dependentValues={dependentValues}
                              />
                            )
                          } else if (field.type === 'select' || field.type === 'enum') {
                            // Use regular select for static options
                            return (
                              <select
                                value={inputValues[field.name] || ''}
                                onChange={(e) => handleInputChange(field.name, e.target.value)}
                                className="w-full px-3.5 py-2.5 border text-sm focus:outline-none focus:ring-2 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)]/20 focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)] transition-all duration-200"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                                required={field.required}
                              >
                                <option value="">
                                  {field.placeholder || 'Select an option...'}
                                </option>
                                {(field.options || field.enum || []).map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            )
                          } else {
                            // Use regular input for text/number/date/etc.
                            return (
                              <input
                                type={
                                  field.type === 'number' ? 'number' :
                                  field.type === 'date' ? 'date' :
                                  field.type === 'email' ? 'email' :
                                  field.type === 'time' ? 'time' :
                                  'text'
                                }
                                value={inputValues[field.name] || ''}
                                onChange={(e) => handleInputChange(field.name, e.target.value)}
                                placeholder={field.placeholder || `Enter ${formatFieldName(field.name).toLowerCase()}...`}
                                required={field.required}
                                className="w-full px-3.5 py-2.5 border text-sm focus:outline-none focus:ring-2 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)]/20 focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] transition-all duration-200"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              />
                            )
                          }
                        })()}
                      </div>

                      {/* InputHelpButton */}
                      {onOpenChatbot && (
                        <div className="flex-shrink-0">
                          <InputHelpButton
                            agentId={agent.id}
                            fieldName={field.name}
                            plugin={inferPluginFromFieldName(field.name)}
                            expectedType={field.type}
                            onClick={() => onOpenChatbot({
                              mode: 'input_help',
                              agentId: agent.id,
                              fieldName: field.name,
                              fieldLabel: field.label || formatFieldName(field.name),
                              plugin: inferPluginFromFieldName(field.name),
                              expectedType: field.type
                            })}
                          />
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              ))}
            </div>

            {/* Save Configuration Button and Messages */}
            {onSaveConfiguration && (
              <div className="mt-4 pt-4 border-t border-[var(--v2-border)]">
                {/* Error message display */}
                {saveError && (
                  <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm text-red-800 dark:text-red-200">
                          {saveError}
                        </p>
                      </div>
                      <button
                        onClick={() => setSaveError(null)}
                        className="flex-shrink-0 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
                        aria-label="Dismiss error"
                      >
                        <span className="text-lg leading-none">&times;</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Success message display */}
                {saveSuccess && (
                  <div className="mb-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm text-green-800 dark:text-green-200">
                          Configuration saved successfully! Your input values have been stored.
                        </p>
                      </div>
                      <button
                        onClick={() => setSaveSuccess(false)}
                        className="flex-shrink-0 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200"
                        aria-label="Dismiss success message"
                      >
                        <span className="text-lg leading-none">&times;</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Save Configuration Button - Always visible so users can update values */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                      {configurationSaved ? 'Update These Values' : 'Save These Values'}
                    </h4>
                    <p className="text-xs text-[var(--v2-text-secondary)]">
                      {configurationSaved
                        ? 'Make changes and save again to update your configuration.'
                        : 'Save these values so you don\'t have to enter them again next time.'}
                    </p>
                  </div>

                  <button
                    onClick={handleSaveConfiguration}
                    disabled={isSaving}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 transition-colors font-medium text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                      configurationSaved
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-amber-500 hover:bg-amber-600 text-white'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Saving...
                      </>
                    ) : configurationSaved ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        Update Values
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        Save Values
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Next Step Card */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <CardContent className="!p-4 sm:!p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                Test Your Workflow
              </h3>
              <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
                {hasParameters
                  ? 'Provide values for all required parameters, then run a test to verify everything works correctly.'
                  : 'The fixes have been saved to your workflow. Run a test to verify everything works correctly.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={handleRunTest}
              disabled={isRunning || !allRequiredFieldsFilled || mustSaveBeforeTest}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={mustSaveBeforeTest ? 'Save configuration first before running test' : undefined}
            >
              {isRunning ? (
                <>
                  <Wrench className="w-3.5 h-3.5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Run Test
                </>
              )}
            </button>

            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                disabled={isRunning}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Dashboard
              </button>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
