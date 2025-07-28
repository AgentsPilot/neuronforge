'use client'

import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'

const FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum']

const BLOCKED_FIELDS_BY_PLUGIN: Record<string, string[]> = {
  'google-mail': ['email', 'emailAccount'],
  'notion': ['workspace', 'workspaceName'],
}

export default function Step3Schema({
  data,
  onUpdate,
  setStepLoading,
}: {
  data: any
  onUpdate: (updates: any) => void
  setStepLoading: (val: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const generateSchema = async () => {
      if (!data.userPrompt || data.inputSchema?.length > 0) return

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
          id: uuidv4(),
          ...field,
        }))

        // 🔒 Filter out blocked fields if plugin is selected
        const selectedPlugins = Object.keys(data.plugins || {})
        const blockedFields = selectedPlugins.flatMap((plugin) => BLOCKED_FIELDS_BY_PLUGIN[plugin] || [])
        const filteredSchema = schemaWithIds.filter(
          (field: any) => !blockedFields.includes(field.name?.toLowerCase())
        )

        if (filteredSchema.length < schemaWithIds.length) {
          toast.warning('Account identifier fields (e.g. emailAccount) were removed due to selected plugins.')
        }

        onUpdate({ inputSchema: filteredSchema })
      } catch (err: any) {
        setError(err.message || 'Unexpected error')
      } finally {
        setStepLoading(false)
      }
    }

    generateSchema()
  }, [data.userPrompt, data.inputSchema, onUpdate, setStepLoading])

  const handleFieldChange = (id: string, changes: Partial<any>) => {
    const updatedFields = data.inputSchema.map((f: any) =>
      f.id === id ? { ...f, ...changes } : f
    )
    onUpdate({ inputSchema: updatedFields })

    if ('name' in changes && changes.name?.trim() === '') {
      setFieldErrors((prev) => ({ ...prev, [id]: 'Field name is required' }))
    } else {
      setFieldErrors((prev) => {
        const { [id]: _, ...rest } = prev
        return rest
      })
    }
  }

  const handleAddField = () => {
    const newField = {
      id: uuidv4(),
      name: '',
      type: 'string',
      required: false,
    }
    onUpdate({ inputSchema: [...data.inputSchema, newField] })
  }

  const handleRemoveField = (id: string) => {
    const updated = data.inputSchema.filter((f: any) => f.id !== id)
    onUpdate({ inputSchema: updated })
    setFieldErrors((prev) => {
      const { [id]: _, ...rest } = prev
      return rest
    })
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">🧩 Input Schema</h2>

      {data.inputSchema.length === 0 && (
        <div className="flex items-center justify-center gap-2 p-4 text-blue-600 bg-blue-50 border border-blue-200 rounded mb-4">
          <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Generating input schema from your prompt...</span>
        </div>
      )}

      {error && <p className="text-red-500">Error: {error}</p>}

      {data.inputSchema.map((field: any) => (
        <div
          key={field.id}
          className="flex flex-col gap-2 mb-6 p-4 border rounded shadow-sm bg-white"
        >
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                className="border rounded px-3 py-2 w-full"
                placeholder="Field name"
                value={field.name}
                onChange={(e) =>
                  handleFieldChange(field.id, { name: e.target.value })
                }
              />
              {fieldErrors[field.id] && (
                <p className="text-red-500 text-sm mt-1">{fieldErrors[field.id]}</p>
              )}
            </div>

            <select
              className="border rounded px-3 py-2"
              value={field.type}
              onChange={(e) => handleFieldChange(field.id, { type: e.target.value })}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) =>
                  handleFieldChange(field.id, { required: e.target.checked })
                }
              />
              Required
            </label>

            <button
              onClick={() => handleRemoveField(field.id)}
              className="text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>

          {field.type === 'enum' && (
            <div className="mt-2 space-y-2">
              <label className="block text-sm font-medium">Enum Options</label>
              {(field.enum || []).map((option: string, index: number) => (
                <div key={index} className="flex gap-2 items-center">
                  <input
                    type="text"
                    className="border rounded px-2 py-1 w-full"
                    value={option}
                    onChange={(e) => {
                      const newEnum = [...(field.enum || [])]
                      newEnum[index] = e.target.value
                      handleFieldChange(field.id, { enum: newEnum })
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const newEnum = [...(field.enum || [])]
                      newEnum.splice(index, 1)
                      handleFieldChange(field.id, { enum: newEnum })
                    }}
                    className="text-red-600 hover:underline text-sm"
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
                className="text-blue-600 hover:underline text-sm mt-1"
              >
                ➕ Add Option
              </button>
            </div>
          )}
        </div>
      ))}

      {data.inputSchema.length > 0 && (
        <button onClick={handleAddField} className="text-blue-600 hover:underline mt-2">
          ➕ Add Field
        </button>
      )}
    </div>
  )
}