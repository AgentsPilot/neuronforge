import { ConfigurationField } from '../../types/configuration'

interface FieldRendererProps {
  field: ConfigurationField
  value: any
  onChange: (value: any) => void
}

export const FieldRenderer = ({ field, value, onChange }: FieldRendererProps) => {
  const baseClasses = "w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
  
  switch (field.type) {
    case 'email':
      return (
        <div key={field.id}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {field.label} {field.required && '*'}
          </label>
          <input
            type="email"
            placeholder={field.placeholder}
            className={baseClasses}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.description && (
            <p className="text-xs text-slate-500 mt-1">{field.description}</p>
          )}
        </div>
      )
    
    case 'textarea':
      return (
        <div key={field.id}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {field.label} {field.required && '*'}
          </label>
          <textarea
            placeholder={field.placeholder}
            rows={3}
            className={baseClasses}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.description && (
            <p className="text-xs text-slate-500 mt-1">{field.description}</p>
          )}
        </div>
      )
    
    case 'select':
      return (
        <div key={field.id}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {field.label} {field.required && '*'}
          </label>
          <select
            className={baseClasses}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select...</option>
            {field.options?.map((option: string) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          {field.description && (
            <p className="text-xs text-slate-500 mt-1">{field.description}</p>
          )}
        </div>
      )

    case 'url':
      return (
        <div key={field.id}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {field.label} {field.required && '*'}
          </label>
          <input
            type="url"
            placeholder={field.placeholder}
            className={baseClasses}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.description && (
            <p className="text-xs text-slate-500 mt-1">{field.description}</p>
          )}
        </div>
      )

    case 'checkbox':
      return (
        <div key={field.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            id={field.id}
            className="rounded border-slate-300"
            checked={value || false}
            onChange={(e) => onChange(e.target.checked)}
          />
          <label htmlFor={field.id} className="text-sm text-slate-700">
            {field.label} {field.required && '*'}
          </label>
          {field.description && (
            <p className="text-xs text-slate-500 ml-6">{field.description}</p>
          )}
        </div>
      )
    
    default:
      return (
        <div key={field.id}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {field.label} {field.required && '*'}
          </label>
          <input
            type="text"
            placeholder={field.placeholder}
            className={baseClasses}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.description && (
            <p className="text-xs text-slate-500 mt-1">{field.description}</p>
          )}
        </div>
      )
  }
}