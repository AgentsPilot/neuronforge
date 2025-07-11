'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import RequireAuth from '@/components/RequireAuth'

console.log('🧪 NewAgentPage rendered')

export default function NewAgentPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !prompt || !user) return

    const { error } = await supabase.from('agents').insert([
      { title, prompt, user_id: user.id },
    ])

    if (error) {
      setError(error.message)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <RequireAuth>
      <div className="min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold mb-4">Create New Agent</h1>
        <form onSubmit={handleSubmit} className="w-full max-w-md p-6 bg-white shadow rounded">
          {error && <p className="text-red-500 mb-2">{error}</p>}
          <input
            type="text"
            placeholder="Agent Name"
            className="w-full px-4 py-2 border mb-3 rounded"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            placeholder="Agent Prompt"
            className="w-full px-4 py-2 border mb-3 rounded"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
          />
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
          >
            Save Agent
          </button>
        </form>
      </div>
    </RequireAuth>
  )
}