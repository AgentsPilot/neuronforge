'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import Link from 'next/link'

export default function AgentHistoryPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchLogs = async () => {
      if (!id || !user?.id) return

      const { data, error } = await supabase
        .from('agent_logs')
        .select('*')
        .eq('agent_id', id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        setError('Failed to load logs.')
      } else {
        setLogs(data)
      }
      setLoading(false)
    }

    fetchLogs()
  }, [id, user])

  if (loading) return <p className="text-center mt-6">Loading history...</p>
  if (error) return <p className="text-red-500 text-center mt-6">{error}</p>
  if (logs.length === 0) return <p className="text-center mt-6">No history yet.</p>

  return (
    <div className="min-h-screen px-6 py-10 max-w-2xl mx-auto">
      <Link
        href={`/agents/${id}`}
        className="text-blue-600 underline mb-4 inline-block"
      >
        ← Back to Agent
      </Link>

      <h1 className="text-2xl font-bold mb-6">📜 Run History</h1>

      <ul className="space-y-4">
        {logs.map((log) => (
          <li key={log.id} className="bg-gray-50 p-4 rounded shadow">
            <p className="text-sm text-gray-500 mb-2">
              {new Date(log.created_at).toLocaleString()}
            </p>
            <p className="font-medium whitespace-pre-wrap mb-2">
              <span className="text-gray-700">Prompt:</span> {log.prompt}
            </p>
            <p className="whitespace-pre-wrap">
              <span className="text-gray-700 font-medium">Output:</span>{' '}
              {log.output}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}