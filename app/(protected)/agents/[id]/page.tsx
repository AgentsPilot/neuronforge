'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import Link from 'next/link'

export default function AgentDetailsPage() {
  const { id } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [agent, setAgent] = useState<any>(null)
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
        setAgent(data)
      }
    }

    fetchAgent()
  }, [id, user])

  if (error) return <p className="text-red-500 text-center mt-6">{error}</p>
  if (!agent) return <p className="text-center mt-6">Loading agent details...</p>

  return (
    <div className="min-h-screen px-6 py-10 max-w-2xl mx-auto">
      <Link
        href="/dashboard"
        className="text-blue-600 underline mb-4 inline-block"
      >
        ← Back to Dashboard
      </Link>

      <h1 className="text-3xl font-bold mb-4">{agent.title}</h1>
      <p className="bg-white p-4 rounded shadow whitespace-pre-wrap">{agent.prompt}</p>
    </div>
  )
}