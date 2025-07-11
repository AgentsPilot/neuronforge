'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import RequireAuth from '@/components/RequireAuth'

export default function DeleteAgentPage() {
  const { id } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [agentName, setAgentName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !user) return

    const fetchAgent = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('agent_name')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        setError('Agent not found.')
      } else {
        setAgentName(data.agent_name)
      }
    }

    fetchAgent()
  }, [id, user])

  const handleDelete = async () => {
    if (!id || !user) return

    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      setError('Failed to delete agent.')
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <RequireAuth>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-bold mb-4">Delete Agent</h1>

        {error ? (
          <p className="text-red-500">{error}</p>
        ) : (
          <>
            <p className="mb-4">
              Are you sure you want to delete the agent <strong>{agentName}</strong>?
            </p>
            <div className="flex gap-4">
              <button
                onClick={handleDelete}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => router.push(`/agents/${id}`)}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 transition"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </RequireAuth>
  )
}