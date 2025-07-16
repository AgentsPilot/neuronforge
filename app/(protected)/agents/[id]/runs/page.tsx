'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'

export default function AgentRunsPage() {
  const params = useParams()
  const agentId = params?.id as string

  const [logs, setLogs] = useState<any[]>([])
  const [agentName, setAgentName] = useState('')
  const [stats, setStats] = useState<{
    run_count: number
    success_count: number
    last_run_at: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      if (!agentId) return

      const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('agent_name')
        .eq('id', agentId)
        .single()

      if (!agentError && agent) setAgentName(agent.agent_name)

      const { data: logData, error: logError } = await supabase
        .from('agent_logs')
        .select('id, run_output, full_output, created_at')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })

      if (!logError && logData) setLogs(logData)

      const { data: statData, error: statError } = await supabase
        .from('agent_stats')
        .select('run_count, success_count, last_run_at')
        .eq('agent_id', agentId)
        .single()

      if (!statError && statData) setStats(statData)

      setLoading(false)
    }

    fetchData()
  }, [agentId])

  return (
    <div className="min-h-screen px-6 py-10 bg-white">
      <Link
        href="/dashboard"
        className="text-sm text-blue-600 mb-4 inline-block hover:underline"
      >
        &larr; Back to Dashboard
      </Link>

      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        Run History for “{agentName}”
      </h1>

      {stats && (
        <div className="bg-gray-100 border p-4 rounded-xl mb-6 text-sm text-gray-700 shadow-sm grid gap-1">
          <div><strong>Total Runs:</strong> {stats.run_count}</div>
          <div><strong>Successful Runs:</strong> {stats.success_count}</div>
          <div>
            <strong>Last Run:</strong>{' '}
            {stats.last_run_at
              ? new Date(stats.last_run_at).toLocaleString()
              : 'N/A'}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : logs.length === 0 ? (
        <p className="text-gray-500">No run history found.</p>
      ) : (
        <div className="space-y-4">
          {logs.map((log) => {
            let parsed: any = {}
            try {
              parsed = JSON.parse(log.full_output)
            } catch {
              parsed = { message: 'Failed to parse full_output' }
            }

            return (
              <div
                key={log.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-500">
                    Run time: {new Date(log.created_at).toLocaleString()}
                  </span>
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                    Success
                  </span>
                </div>

                <div className="text-gray-800 font-semibold mb-2">
                  {log.run_output}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-700">
                  <div>
                    <strong>Agent Name:</strong> {parsed.agent_name}
                  </div>
                  <div>
                    <strong>Agent ID:</strong> {parsed.agent_id}
                  </div>
                  <div className="col-span-2">
                    <strong>Message:</strong>
                    <div className="bg-gray-100 border rounded mt-1 p-2 text-gray-800 whitespace-pre-wrap">
                      {parsed.message}
                    </div>
                  </div>
                  <div>
                    <strong>Timestamp:</strong>{' '}
                    {parsed.timestamp
                      ? new Date(parsed.timestamp).toLocaleString()
                      : 'N/A'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}