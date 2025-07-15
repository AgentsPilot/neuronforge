'use client'

import React from 'react'

interface Props {
  data: {
    agentName: string
    description: string
  }
  onUpdate: (data: Partial<Props['data']>) => void
}

export default function Step1Basics({ data, onUpdate }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Agent Name
        </label>
        <input
          type="text"
          value={data.agentName}
          onChange={(e) => onUpdate({ agentName: e.target.value })}
          required
          className="w-full px-4 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Marketing Assistant"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Description
        </label>
        <textarea
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          rows={3}
          className="w-full px-4 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Describe what this agent does..."
        />
      </div>
    </div>
  )
}