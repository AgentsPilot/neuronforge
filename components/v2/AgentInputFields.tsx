// components/v2/AgentInputFields.tsx
// Reusable component for rendering agent input parameter fields
// Used by both run agent page and calibration page

'use client'

import React from 'react'
import { DynamicSelectField } from '@/components/v2/DynamicSelectField'
import { QueryComponentsField } from '@/components/v2/QueryComponentsField'
import type { QueryComponentsConfig } from '@/lib/plugins/query-components-config'

export interface InputFieldSchema {
  name: string
  type: string
  label?: string
  description?: string
  required?: boolean
  placeholder?: string
  default_value?: any
  options?: string[]
  enum?: string[]
}

interface AgentInputFieldsProps {
  schema: InputFieldSchema[]
  values: Record<string, any>
  onChange: (name: string, value: any) => void
  errors?: Record<string, string>
  // Optional: Dynamic options configuration
  getDynamicOptions?: (fieldName: string) => {
    plugin: string
    action: string
    parameter: string
    depends_on?: string[]
    paramToFieldMap?: Record<string, string>
    queryComponents?: QueryComponentsConfig
  } | null
  // Optional: Custom wrapper className (e.g., for grid layout)
  wrapperClassName?: string
}

// Transform field name to Title Case
const formatFieldName = (name: string): string => {
  // Remove step prefix (e.g., "step2_" from "step2_range")
  const nameWithoutPrefix = name.replace(/^step\d+_/, '')

  return nameWithoutPrefix
    .replace(/[_-]/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Render the input field based on type and dynamic options
const renderFieldInput = (
  field: InputFieldSchema,
  values: Record<string, any>,
  onChange: (name: string, value: any) => void,
  getDynamicOptions?: (fieldName: string) => { plugin: string; action: string; parameter: string; depends_on?: string[]; paramToFieldMap?: Record<string, string>; queryComponents?: QueryComponentsConfig } | null,
  errors: Record<string, string> = {}
) => {
  // Check if this field should use dynamic dropdown or query components
  const dynamicOptions = getDynamicOptions?.(field.name)

  // Check if this field has query components configuration (for Gmail query, Drive query, etc.)
  if (dynamicOptions?.queryComponents) {
    return (
      <QueryComponentsField
        value={values[field.name] || ''}
        onChange={(value) => onChange(field.name, value)}
        config={dynamicOptions.queryComponents}
        label={field.label || formatFieldName(field.name)}
        description={field.description}
      />
    )
  }

  if (dynamicOptions) {
    // Build dependent values object if this field has dependencies
    const dependentValues: Record<string, any> = {}
    if (dynamicOptions.depends_on && Array.isArray(dynamicOptions.depends_on)) {
      // Extract step prefix from current field name (e.g., "step2_" from "step2_range")
      const stepPrefixMatch = field.name.match(/^(step\d+_)/)
      const stepPrefix = stepPrefixMatch ? stepPrefixMatch[1] : ''

      console.log('[AgentInputFields] Building dependentValues for', field.name, {
        depends_on: dynamicOptions.depends_on,
        paramToFieldMap: dynamicOptions.paramToFieldMap,
        stepPrefix,
        availableValues: Object.keys(values)
      })

      dynamicOptions.depends_on.forEach((paramName: string) => {
        // Map parameter name to field name using paramToFieldMap
        const fieldName = dynamicOptions.paramToFieldMap?.[paramName] || paramName

        // Try multiple lookup strategies:
        // 1. Exact match with paramToFieldMap
        // 2. Prefixed version (same step)
        // 3. Base field name (no prefix)
        // 4. Search all values for a field containing the param name
        const prefixedFieldName = stepPrefix + fieldName
        let depValue = values[prefixedFieldName] || values[fieldName] || values[paramName]

        // If still not found, search for any field that ends with the param name
        if (!depValue) {
          const matchingKey = Object.keys(values).find(key =>
            key === paramName ||
            key.endsWith(`_${paramName}`) ||
            key.replace(/^step\d+_/, '') === paramName
          )
          if (matchingKey) {
            depValue = values[matchingKey]
            console.log('[AgentInputFields] Found dependent value via search:', paramName, '→', matchingKey, '=', depValue)
          }
        }

        if (depValue) {
          // Use parameter name as key (for API), but lookup value using field name
          dependentValues[paramName] = depValue
          console.log('[AgentInputFields] Mapped dependency:', paramName, '=', depValue)
        } else {
          console.log('[AgentInputFields] Could not find value for dependency:', paramName, 'tried:', [prefixedFieldName, fieldName, paramName])
        }
      })
    }

    // Use DynamicSelectField for fields with dynamic options
    return (
      <DynamicSelectField
        plugin={dynamicOptions.plugin}
        action={dynamicOptions.action}
        parameter={dynamicOptions.parameter}
        value={values[field.name] || ''}
        onChange={(value) => onChange(field.name, value)}
        required={field.required}
        placeholder={field.placeholder || `Select ${formatFieldName(field.name).toLowerCase()}...`}
        className="w-full px-2.5 py-1.5 border text-xs focus:outline-none focus:ring-1"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
        dependentValues={dependentValues}
      />
    )
  } else if (field.type === 'select' || field.type === 'enum') {
    // Use regular select for static options
    return (
      <select
        value={values[field.name] || ''}
        onChange={(e) => onChange(field.name, e.target.value)}
        className="w-full px-2.5 py-1.5 border text-xs focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-gray-100"
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
  } else if (field.type === 'textarea') {
    // Use textarea for longer text
    return (
      <textarea
        value={values[field.name] || ''}
        onChange={(e) => onChange(field.name, e.target.value)}
        placeholder={field.placeholder || `Enter ${formatFieldName(field.name).toLowerCase()}...`}
        required={field.required}
        rows={3}
        className="w-full px-2.5 py-1.5 border text-xs focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      />
    )
  } else {
    // Use regular input for text/number/date/etc.
    return (
      <input
        type={
          field.type === 'number' ? 'number' :
          field.type === 'date' ? 'date' :
          field.type === 'email' ? 'email' :
          field.type === 'url' ? 'url' :
          field.type === 'time' ? 'time' :
          'text'
        }
        value={values[field.name] || ''}
        onChange={(e) => onChange(field.name, e.target.value)}
        placeholder={field.placeholder || `Enter ${formatFieldName(field.name).toLowerCase()}...`}
        required={field.required}
        className="w-full px-2.5 py-1.5 border text-xs focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      />
    )
  }
}

export function AgentInputFields({
  schema,
  values,
  onChange,
  errors = {},
  getDynamicOptions,
  wrapperClassName = 'space-y-3'
}: AgentInputFieldsProps) {
  console.log('[AgentInputFields] Received props:', {
    schemaFields: schema.map(s => s.name),
    values,
    valuesKeys: Object.keys(values),
    valuesCount: Object.keys(values).length,
    fieldValueMapping: schema.map(s => ({
      field: s.name,
      hasValue: !!values[s.name],
      value: values[s.name],
      placeholder: s.placeholder
    }))
  })

  if (!schema || schema.length === 0) {
    return null
  }

  // Group fields by step prefix (step2_, step7_, etc.)
  const groupedFields: Record<string, InputFieldSchema[]> = {}
  const ungroupedFields: InputFieldSchema[] = []

  schema.forEach((field) => {
    const stepMatch = field.name.match(/^(step\d+)_/)
    if (stepMatch) {
      const stepId = stepMatch[1]
      if (!groupedFields[stepId]) {
        groupedFields[stepId] = []
      }
      groupedFields[stepId].push(field)
    } else {
      ungroupedFields.push(field)
    }
  })

  // Sort ungrouped fields (config fields) to put dependent fields after their dependencies
  console.log('[AgentInputFields] Sorting ungrouped fields:', ungroupedFields.map(f => f.name))
  ungroupedFields.sort((a, b) => {
    // Get dynamic options to check for dependencies
    const aDynamicOptions = getDynamicOptions?.(a.name)
    const bDynamicOptions = getDynamicOptions?.(b.name)

    const baseNameA = a.name.replace(/^step\d+_/, '')
    const baseNameB = b.name.replace(/^step\d+_/, '')

    console.log('[AgentInputFields] Comparing:', a.name, 'vs', b.name)
    console.log('[AgentInputFields] a depends_on:', aDynamicOptions?.depends_on, 'paramToFieldMap:', aDynamicOptions?.paramToFieldMap)
    console.log('[AgentInputFields] b depends_on:', bDynamicOptions?.depends_on, 'paramToFieldMap:', bDynamicOptions?.paramToFieldMap)

    // If a depends on b, b should come first
    if (aDynamicOptions?.depends_on) {
      // Check if any of a's dependencies match b's field name (full or base)
      // depends_on contains parameter names like "spreadsheet_id"
      const dependsOnMatches = aDynamicOptions.depends_on.some((paramName: string) => {
        const mappedFieldName = aDynamicOptions.paramToFieldMap?.[paramName] || paramName
        return mappedFieldName === b.name ||
               mappedFieldName === baseNameB ||
               paramName === b.name ||
               paramName === baseNameB
      })
      console.log('[AgentInputFields] a depends on b?', dependsOnMatches, 'checking:', aDynamicOptions.depends_on, 'against', b.name, '/', baseNameB)
      if (dependsOnMatches) {
        console.log('[AgentInputFields] → a comes AFTER b')
        return 1 // a comes after b (b is the dependency)
      }
    }

    // If b depends on a, a should come first
    if (bDynamicOptions?.depends_on) {
      // Check if any of b's dependencies match a's field name (full or base)
      const dependsOnMatches = bDynamicOptions.depends_on.some((paramName: string) => {
        const mappedFieldName = bDynamicOptions.paramToFieldMap?.[paramName] || paramName
        return mappedFieldName === a.name ||
               mappedFieldName === baseNameA ||
               paramName === a.name ||
               paramName === baseNameA
      })
      console.log('[AgentInputFields] b depends on a?', dependsOnMatches, 'checking:', bDynamicOptions.depends_on, 'against', a.name, '/', baseNameA)
      if (dependsOnMatches) {
        console.log('[AgentInputFields] → a comes BEFORE b')
        return -1 // a comes before b (a is the dependency)
      }
    }

    console.log('[AgentInputFields] → no change')
    // No dependency relationship, maintain original order
    return 0
  })
  console.log('[AgentInputFields] After sorting:', ungroupedFields.map(f => f.name))

  // Sort fields within each group to put dependent fields after their dependencies
  Object.keys(groupedFields).forEach((stepId) => {
    const fields = groupedFields[stepId]

    fields.sort((a, b) => {
      // Get dynamic options to check for dependencies
      const aDynamicOptions = getDynamicOptions?.(a.name)
      const bDynamicOptions = getDynamicOptions?.(b.name)

      const baseNameA = a.name.replace(/^step\d+_/, '')
      const baseNameB = b.name.replace(/^step\d+_/, '')

      // If a depends on b, b should come first
      if (aDynamicOptions?.depends_on) {
        // Check if any of a's dependencies match b's field name (full or base)
        // depends_on contains parameter names like "spreadsheet_id"
        // We need to check both full field name and base name
        const dependsOnMatches = aDynamicOptions.depends_on.some((paramName: string) => {
          // Get mapped field name from paramToFieldMap if available
          const mappedFieldName = aDynamicOptions.paramToFieldMap?.[paramName] || paramName
          // Check against both full name and base name
          return mappedFieldName === b.name ||
                 mappedFieldName === baseNameB ||
                 paramName === b.name ||
                 paramName === baseNameB
        })
        if (dependsOnMatches) {
          return 1 // a comes after b (b is the dependency)
        }
      }

      // If b depends on a, a should come first
      if (bDynamicOptions?.depends_on) {
        // Check if any of b's dependencies match a's field name (full or base)
        const dependsOnMatches = bDynamicOptions.depends_on.some((paramName: string) => {
          const mappedFieldName = bDynamicOptions.paramToFieldMap?.[paramName] || paramName
          return mappedFieldName === a.name ||
                 mappedFieldName === baseNameA ||
                 paramName === a.name ||
                 paramName === baseNameA
        })
        if (dependsOnMatches) {
          return -1 // a comes before b (a is the dependency)
        }
      }

      // No dependency relationship, maintain original order
      return 0
    })
  })

  // Sort step groups by step number
  const sortedStepIds = Object.keys(groupedFields).sort((a, b) => {
    const numA = parseInt(a.replace('step', ''))
    const numB = parseInt(b.replace('step', ''))
    return numA - numB
  })

  return (
    <div className={wrapperClassName}>
      {/* Render ungrouped fields first */}
      {ungroupedFields.map((field) => (
        <div key={field.name}>
          <label className="block">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {field.label || formatFieldName(field.name)}
              </span>
              {field.required && (
                <span className="text-red-500 dark:text-red-400 text-xs">*</span>
              )}
            </div>

            {/* Description */}
            {field.description && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1.5">
                {field.description}
              </p>
            )}

            {/* Input Field */}
            <div className="flex-1">
              {renderFieldInput(field, values, onChange, getDynamicOptions, errors)}
            </div>

            {/* Error Message */}
            {errors[field.name] && (
              <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                {errors[field.name]}
              </p>
            )}
          </label>
        </div>
      ))}

      {/* Render grouped fields by step */}
      {sortedStepIds.map((stepId) => (
        <div key={stepId} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 capitalize">
            {stepId.replace('step', 'Step ')}
          </h4>
          <div className="space-y-3">
            {groupedFields[stepId].map((field) => (
              <div key={field.name}>
          <label className="block">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {field.label || formatFieldName(field.name)}
              </span>
              {field.required && (
                <span className="text-red-500 dark:text-red-400 text-xs">*</span>
              )}
            </div>

            {/* Description */}
            {field.description && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1.5">
                {field.description}
              </p>
            )}

            {/* Input Field */}
            <div className="flex-1">
              {renderFieldInput(field, values, onChange, getDynamicOptions, errors)}
            </div>

            {/* Error Message */}
            {errors[field.name] && (
              <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                {errors[field.name]}
              </p>
            )}
          </label>
        </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
