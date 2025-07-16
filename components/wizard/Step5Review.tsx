'use client'

import { FC } from 'react'

interface SchemaField {
  name: string
  type: string
  description?: string
  required?: boolean
}

interface Step5ReviewProps {
  data: {
    agentName: string
    description: string
    systemPrompt: string
    userPrompt: string
    inputSchema: SchemaField[]
    outputSchema: SchemaField[]
    plugins: Record<string, any>
    mode: string
    schedule_cron: string
    trigger_conditions: string
  }
  onEditStep: (step: number) => void
}

const renderSchemaTable = (schema: SchemaField[]) => {
  if (!schema || schema.length === 0) {
    return <p className="text-sm text-gray-500">No fields defined.</p>
  }

  return (
    <div className="overflow-auto rounded border">
      <table className="w-full text-sm table-auto border-collapse">
        <thead className="bg-gray-100 border-b">
          <tr>
            <th className="text-left px-4 py-2">Name</th>
            <th className="text-left px-4 py-2">Type</th>
            <th className="text-left px-4 py-2">Description</th>
            <th className="text-left px-4 py-2">Required</th>
          </tr>
        </thead>
        <tbody>
          {schema.map((field, index) => (
            <tr key={index} className="border-b hover:bg-gray-50">
              <td className="px-4 py-2">{field.name}</td>
              <td className="px-4 py-2">{field.type}</td>
              <td className="px-4 py-2">{field.description || '—'}</td>
              <td className="px-4 py-2">{field.required ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Step5Review: FC<Step5ReviewProps> = ({ data, onEditStep }) => {
  const renderModeDetails = () => {
    switch (data.mode) {
      case 'scheduled':
        return <p><strong>Cron Schedule:</strong> {data.schedule_cron || '—'}</p>
      case 'triggered':
        return (
          <div>
            <p><strong>Trigger Conditions:</strong></p>
            <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
              {data.trigger_conditions || '{}'}
            </pre>
          </div>
        )
      default:
        return <p>This agent runs manually when you trigger it.</p>
    }
  }

  return (
    <div className="space-y-8">
      {/* Agent Info */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">📝 Agent Info</h2>
        <button onClick={() => onEditStep(1)} className="text-blue-600 text-sm underline">Edit</button>
      </div>
      <div className="bg-gray-50 p-4 rounded border space-y-2">
        <p><strong>Name:</strong> {data.agentName}</p>
        <p><strong>Description:</strong> {data.description}</p>
      </div>

      {/* Prompts */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">📜 Prompts</h2>
        <button onClick={() => onEditStep(2)} className="text-blue-600 text-sm underline">Edit</button>
      </div>
      <div className="bg-gray-50 p-4 rounded border space-y-2">
        <p><strong>System Prompt:</strong> {data.systemPrompt || '—'}</p>
        <p><strong>User Prompt:</strong> {data.userPrompt}</p>
      </div>

      {/* Input Schema */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">🔧 Input Schema</h2>
        <button onClick={() => onEditStep(3)} className="text-blue-600 text-sm underline">Edit</button>
      </div>
      {renderSchemaTable(data.inputSchema)}

      {/* Output Schema */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">📤 Output Schema</h2>
        <button onClick={() => onEditStep(3)} className="text-blue-600 text-sm underline">Edit</button>
      </div>
      {renderSchemaTable(data.outputSchema)}

      {/* Plugins */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">🔌 Plugins</h2>
        <button onClick={() => onEditStep(4)} className="text-blue-600 text-sm underline">Edit</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        {Object.keys(data.plugins).length > 0 ? (
          Object.entries(data.plugins).map(([key]) => (
            <span key={key} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
              {key}
            </span>
          ))
        ) : (
          <span className="text-gray-500 text-sm">No plugins connected</span>
        )}
      </div>

      {/* Mode */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">⚙️ Execution Mode</h2>
        <button onClick={() => onEditStep(5)} className="text-blue-600 text-sm underline">Edit</button>
      </div>
      <div className="bg-gray-50 p-4 rounded border space-y-2">
        <p><strong>Mode:</strong> {data.mode}</p>
        {renderModeDetails()}
      </div>
    </div>
  )
}

export default Step5Review