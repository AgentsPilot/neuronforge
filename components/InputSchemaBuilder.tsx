'use client'

import React, { useState, useEffect } from 'react'
import SchemaBuilder from '@/components/SchemaBuilder'

type SchemaField = {
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
}

type Props = {
  onSchemaChange: (schema: SchemaField[]) => void
}

export default function InputSchemaBuilder({ onSchemaChange }: Props) {
  const [fields, setFields] = useState<SchemaField[]>([])
  const [formData, setFormData] = useState<{ [key: string]: any }>({})

  useEffect(() => {
    onSchemaChange(fields)
  }, [fields, onSchemaChange])

  const handleFieldChange = (index: number, key: keyof SchemaField, value: any) => {
    const updated = [...fields]
    updated[index][key] = value
    setFields(updated)
  }

  const addField = () => {
    setFields([...fields, { name: '', type: 'string', required: false }])
  }

  const removeField = (index: number) => {
    const updated = [...fields]
    const removed = updated.splice(index, 1)[0]
    setFields(updated)
    if (removed.name) {
      const updatedForm = { ...formData }
      delete updatedForm[removed.name]
      setFormData(updatedForm)
    }
  }

  const handleFormInput = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  return (
    <div className="space-y-6">
      {/* Schema Builder */}
      <div className="space-y-4">
        <h3 className="text-md font-semibold text-gray-800">📐 Define Input Fields</h3>
        {fields.map((field, index) => (
          <div key={index} className="bg-gray-50 border rounded-lg p-4 space-y-2 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
              <input
                type="text"
                placeholder="Field name"
                value={field.name}
                onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                className="px-3 py-2 border rounded w-full"
              />
              <select
                value={field.type}
                onChange={(e) =>
                  handleFieldChange(index, 'type', e.target.value as SchemaField['type'])
                }
                className="px-3 py-2 border rounded w-full"
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
              </select>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => handleFieldChange(index, 'required', e.target.checked)}
                />
                <span className="text-sm text-gray-700">Required</span>
              </label>
            </div>
            <div className="text-right">
              <button
                type="button"
                onClick={() => removeField(index)}
                className="text-red-600 text-sm hover:underline"
              >
                🗑 Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addField}
          className="bg-blue-100 text-blue-700 text-sm px-4 py-2 rounded hover:bg-blue-200 transition"
        >
          ➕ Add Field
        </button>
      </div>

      {/* Live Form Preview */}
      {fields.length > 0 && (
        <div className="mt-6">
          <h3 className="text-md font-semibold text-gray-800 mb-2">🧪 Live Form Preview</h3>
          <div className="space-y-4 bg-white p-4 border rounded-md shadow">
            {fields.map((field) => (
              <div key={field.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.name} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={!!formData[field.name]}
                    onChange={(e) => handleFormInput(field.name, e.target.checked)}
                    className="h-4 w-4"
                  />
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={formData[field.name] || ''}
                    onChange={(e) =>
                      handleFormInput(
                        field.name,
                        field.type === 'number' ? Number(e.target.value) : e.target.value
                      )
                    }
                    className="w-full px-3 py-2 border rounded"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Optional JSON Output */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-1">📦 JSON Output</h4>
            <pre className="text-xs bg-gray-100 p-3 rounded whitespace-pre-wrap">
              {JSON.stringify(formData, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}