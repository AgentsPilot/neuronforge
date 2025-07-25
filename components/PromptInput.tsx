'use client'

import { useState } from 'react'

export default function PromptInput({ onGenerate }: { onGenerate: (text: string) => void }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!input.trim()) return
    setLoading(true)
    await onGenerate(input)
    setInput('')
    setLoading(false)
  }

  return (
    <div className="w-full bg-white border border-gray-200 p-4 rounded-xl shadow mb-10 max-w-3xl mx-auto">
      <label className="block text-sm font-semibold mb-2 text-gray-600">
        Describe what you want your agent(s) to do:
      </label>

      <div className="flex flex-col sm:flex-row gap-3">
        <textarea
          className="w-full p-3 rounded-lg border border-gray-300 resize-none focus:outline-none focus:ring focus:border-blue-400"
          rows={3}
          placeholder="e.g. I want to monitor Gmail for court notices, notify clients, and add reminders."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />

        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-lg whitespace-nowrap"
          disabled={loading}
          onClick={handleSubmit}
        >
          {loading ? 'Creating...' : 'Create Agent'}
        </button>
      </div>
    </div>
  )
}