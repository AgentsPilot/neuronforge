'use client'

import React from 'react'

interface Props {
  data: {
    systemPrompt: string
    userPrompt: string
  }
  onUpdate: (data: Partial<Props['data']>) => void
}

export default function Step2Prompts({ data, onUpdate }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          System Prompt <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <textarea
          value={data.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          rows={3}
          className="w-full px-4 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Instructions that shape the agent’s behavior (e.g., act like a travel advisor)"
        />
        <p className="text-xs text-gray-500 mt-1">
          Used to guide the tone or behavior of the agent.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          User Prompt
        </label>
        <textarea
          value={data.userPrompt}
          onChange={(e) => onUpdate({ userPrompt: e.target.value })}
          rows={4}
          required
          className="w-full px-4 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Prompt the agent will act on (e.g., summarize this article...)"
        />
      </div>
    </div>
  )
}