'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'

export default function AgentHistoryBlock({ agentId }: { agentId: string }) {
  const { user } = useAuth()
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)

  useEffect(() => {
    const fetchLogs = async () => {
      const { data, error } = await supabase
        .from('agent_logs')
        .select('id, created_at, run_output, full_output')
        .eq('agent_id', agentId)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('❌ Failed to fetch logs:', error.message)
      } else {
        setLogs(data || [])
      }

      setLoading(false)
    }

    if (agentId && user) {
      fetchLogs()
    }
  }, [agentId, user])

  const toggleDetails = (logId: string) => {
    setExpandedLogId((prev) => (prev === logId ? null : logId))
  }

  const renderStructuredOutput = (output: any) => {
    if (typeof output === 'string') {
      try {
        output = JSON.parse(output)
      } catch {
        return <pre className="text-sm text-gray-700 whitespace-pre-wrap">{output}</pre>
      }
    }

    return (
      <div className="bg-gray-50 border border-gray-200 rounded p-4 mt-2 space-y-2 text-sm text-gray-700">
        {Object.entries(output).map(([key, value]) => (
          <div key={key}>
            <strong className="capitalize text-gray-800">{key.replace(/_/g, ' ')}:</strong>{' '}
            <span className="text-gray-700">
              {typeof value === 'object' ? (
                <pre className="whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>
              ) : (
                value?.toString()
              )}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow border border-gray-100 mb-8">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Agent Run History</h2>

      {loading ? (
        <p className="text-gray-500">Loading history...</p>
      ) : logs.length === 0 ? (
        <p className="text-gray-500">No runs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-gray-600 border-b">
                <th className="py-2 px-4">ID</th>
                <th className="py-2 px-4">Run Output</th>
                <th className="py-2 px-4">Created At</th>
                <th className="py-2 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4 text-gray-700">{log.id}</td>
                    <td className="py-2 px-4 text-gray-700 max-w-sm truncate" title={log.run_output}>
                      {log.run_output}
                    </td>
                    <td className="py-2 px-4 text-gray-600">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-4">
                      <button
                        onClick={() => toggleDetails(log.id)}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        {expandedLogId === log.id ? 'Hide Details' : 'View Details'}
                      </button>
                    </td>
                  </tr>
                  {expandedLogId === log.id && (
                    <tr>
                      <td colSpan={4}>{renderStructuredOutput(log.full_output)}</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}