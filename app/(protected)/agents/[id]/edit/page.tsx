'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import RequireAuth from '@/components/RequireAuth'

export default function EditAgentPage() {
  const { id } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !user) return

    const fetchAgent = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        setError('Agent not found.')
      } else {
        setTitle(data.title)
        setPrompt(data.prompt)
      }
    }

    fetchAgent()
  }, [id, user])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !prompt || !user) return

    const { error } = await supabase
      .from('agents')
      .update({ title, prompt })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      setError('Failed to update agent.')
    } else {
      router.push(`/agents/${id}`)
    }
  }

  return (
    <RequireAuth>
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <h1 className="text-2xl font-bold mb-4">Edit Agent</h1>
        <form onSubmit={handleUpdate} className="w-full max-w-md bg-white p-6 rounded shadow">
          {error && <p className="text-red-500 mb-2">{error}</p>}
          <input
            type="text"
            placeholder="Agent Title"
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
            className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 transition"
          >
            Update Agent
          </button>
          <button
            type="button"
            onClick={() => router.push(`/agents/${id}`)}
            className="w-full mt-2 bg-gray-300 text-gray-800 py-2 rounded hover:bg-gray-400 transition"
          >
            Cancel
          </button>
        </form>
      </div>
    </RequireAuth>
  )
}