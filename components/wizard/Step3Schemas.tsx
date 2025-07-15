'use client'

import React from 'react'
import VisualSchemaBuilder from '@/components/VisualSchemaBuilder'

interface Props {
  data: {
    inputSchema: any[]
    outputSchema: any[]
  }
  onUpdate: (data: Partial<Props['data']>) => void
}

export default function Step3Schemas({ data, onUpdate }: Props) {
  return (
    <div className="space-y-10">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Input Schema</label>
        <VisualSchemaBuilder
          schema={data.inputSchema}
          onSchemaChange={(newSchema) => onUpdate({ inputSchema: newSchema })}
        />
        <p className="text-xs text-gray-500 mt-1">
          Define structured inputs your agent expects using fields and types.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Output Schema</label>
        <VisualSchemaBuilder
          schema={data.outputSchema}
          onSchemaChange={(newSchema) => onUpdate({ outputSchema: newSchema })}
        />
        <p className="text-xs text-gray-500 mt-1">
          Define the structure of your agent's expected response.
        </p>
      </div>
    </div>
  )
}