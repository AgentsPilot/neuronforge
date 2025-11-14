// components/orchestration/components/configuration/FieldRenderer.tsx
import React from 'react'

interface FieldConfig {
  key: string
  label: string
  type: 'text' | 'select' | 'textarea' | 'number' | 'email' | 'url'
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
  validation?: (value: string) => string | null
}

interface FieldRendererProps {
  field: FieldConfig
  value: string
  onChange: (key: string, value: string) => void
  error?: string
}

export const FieldRenderer: React.FC<FieldRendererProps> = ({
  field,
  value,
  onChange,
  error
}) => {
  const handleChange = (newValue: string) => {
    onChange(field.key, newValue)
  }

  const baseInputClasses = `w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm ${
    error ? 'border-red-300' : 'border-slate-300'
  }`

  const renderField = () => {
    switch (field.type) {
      case 'select':
        return (
          <select
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            className={baseInputClasses}
            required={field.required}
          >
            <option value="">Select...</option>
            {field.options?.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )

      case 'textarea':
        return (
          <textarea
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={field.placeholder}
            className={`${baseInputClasses} min-h-[80px] resize-y`}
            required={field.required}
          />
        )

      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={field.placeholder}
            className={baseInputClasses}
            required={field.required}
          />
        )

      case 'email':
        return (
          <input
            type="email"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={field.placeholder}
            className={baseInputClasses}
            required={field.required}
          />
        )

      case 'url':
        return (
          <input
            type="url"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={field.placeholder}
            className={baseInputClasses}
            required={field.required}
          />
        )

      default: // text
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={field.placeholder}
            className={baseInputClasses}
            required={field.required}
          />
        )
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {renderField()}
      {error && (
        <p className="text-red-600 text-xs mt-1">{error}</p>
      )}
    </div>
  )
}

// Plugin-specific field configurations
export const getPluginFields = (pluginKey: string, category: string): FieldConfig[] => {
  const commonFields: FieldConfig[] = [
    {
      key: 'settings',
      label: 'Configuration Settings',
      type: 'text',
      placeholder: `Configure ${pluginKey} settings`
    }
  ]

  switch (category) {
    case 'Email':
      return [
        ...commonFields,
        {
          key: 'filter',
          label: 'Email Filter (optional)',
          type: 'text',
          placeholder: 'e.g., from:invoices@company.com'
        },
        {
          key: 'maxResults',
          label: 'Max Results',
          type: 'number',
          placeholder: '50'
        }
      ]

    case 'CRM':
      return [
        ...commonFields,
        {
          key: 'objectType',
          label: 'Object/Entity Type',
          type: 'select',
          options: [
            { value: 'contact', label: 'Contact' },
            { value: 'lead', label: 'Lead' },
            { value: 'account', label: 'Account' },
            { value: 'opportunity', label: 'Opportunity' },
            { value: 'deal', label: 'Deal' }
          ]
        }
      ]

    case 'Documentation':
      return [
        ...commonFields,
        {
          key: 'workspaceId',
          label: 'Workspace/Database ID',
          type: 'text',
          placeholder: 'e.g., workspace-id or database-id'
        }
      ]

    case 'Communication':
      return [
        ...commonFields,
        {
          key: 'channel',
          label: 'Channel/Room',
          type: 'text',
          placeholder: 'e.g., #general or room-id'
        }
      ]

    case 'Storage':
      return [
        ...commonFields,
        {
          key: 'folderId',
          label: 'Folder ID (optional)',
          type: 'text',
          placeholder: 'Specific folder to work with'
        }
      ]

    default:
      return commonFields
  }
}