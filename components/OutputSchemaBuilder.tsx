import { useState } from 'react'
import SchemaBuilder from '@/components/SchemaBuilder'

type OutputField = {
  name: string
  type: string
  description?: string
}

export default function OutputSchemaBuilder({
  onSchemaChange,
  initialSchema = [],
}: {
  onSchemaChange: (schema: OutputField[]) => void
  initialSchema?: OutputField[]
}) {
  const [fields, setFields] = useState<OutputField[]>(initialSchema)

  const handleFieldChange = (index: number, key: keyof OutputField, value: string) => {
    const updated = [...fields]
    updated[index][key] = value
    setFields(updated)
    onSchemaChange(updated)
  }

  const addField = () => {
    const updated = [...fields, { name: '', type: 'string', description: '' }]
    setFields(updated)
    onSchemaChange(updated)
  }

  const removeField = (index: number) => {
    const updated = [...fields]
    updated.splice(index, 1)
    setFields(updated)
    onSchemaChange(updated)
  }

  return (
    <div className="space-y-4">
      {fields.map((field, index) => (
        <div key={index} className="flex flex-col md:flex-row gap-4 items-center border p-3 rounded-lg bg-gray-50">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-700 mb-1" title="The key or property name in the output">
              Field Name
            </label>
            <input
              type="text"
              value={field.name}
              onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="e.g., summary"
            />
          </div>

          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-700 mb-1" title="The data type (e.g., string, number, object)">
              Type
            </label>
            <select
              value={field.type}
              onChange={(e) => handleFieldChange(index, 'type', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="object">object</option>
              <option value="array">array</option>
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-700 mb-1" title="Brief explanation of this output field">
              Description
            </label>
            <input
              type="text"
              value={field.description}
              onChange={(e) => handleFieldChange(index, 'description', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="Optional explanation"
            />
          </div>

          <button
            type="button"
            onClick={() => removeField(index)}
            className="text-red-500 hover:underline mt-2 md:mt-0"
          >
            Remove
          </button>
        </div>
      ))}

      <div className="text-right">
        <button
          type="button"
          onClick={addField}
          className="bg-blue-100 text-blue-700 px-4 py-2 rounded hover:bg-blue-200 transition"
        >
          ➕ Add Output Field
        </button>
      </div>
    </div>
  )
}