// components/v2/AgentInputFields.tsx
// Reusable component for rendering agent input parameter fields
// Used by both run agent page and calibration page

'use client'

import React from 'react'
import { DynamicSelectField } from '@/components/v2/DynamicSelectField'

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
  } | null
  // Optional: Custom wrapper className (e.g., for grid layout)
  wrapperClassName?: string
}

// Transform field name to Title Case
const formatFieldName = (name: string): string => {
  return name
    .replace(/[_-]/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function AgentInputFields({
  schema,
  values,
  onChange,
  errors = {},
  getDynamicOptions,
  wrapperClassName = 'space-y-3'
}: AgentInputFieldsProps) {
  if (!schema || schema.length === 0) {
    return null
  }

  return (
    <div className={wrapperClassName}>
      {schema.map((field) => (
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
              {(() => {
                // Check if this field should use dynamic dropdown
                const dynamicOptions = getDynamicOptions?.(field.name)

                if (dynamicOptions) {
                  // Build dependent values object if this field has dependencies
                  const dependentValues: Record<string, any> = {}
                  if (dynamicOptions.depends_on && Array.isArray(dynamicOptions.depends_on)) {
                    dynamicOptions.depends_on.forEach((depField: string) => {
                      if (values[depField]) {
                        dependentValues[depField] = values[depField]
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
              })()}
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
  )
}
