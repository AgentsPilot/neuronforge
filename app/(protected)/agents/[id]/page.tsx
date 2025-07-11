'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import Link from 'next/link'

export default function AgentDetailsPage() {
  const { id } = useParams()
  const agentId = Array.isArray(id) ? id[0] : id
  const router = useRouter()
  const { user } = useAuth()
  const [agent, setAgent] = useState<any>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [logsFetched, setLogsFetched] = useState(false)

  useEffect(() => {
    if (!agentId || !user) return

    const fetchAgent = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .single()

      if (error) {
        setError('Agent not found.')
      } else {
        setAgent(data)
      }
    }

    const fetchStats = async () => {
      const { data, error } = await supabase
        .from('agent_stats')
        .select('*')
        .eq('agent_id', agentId)
        .eq('user_id', user.id)
        .single()

      if (!error) {
        setStats(data)
      } else {
        console.error('❌ Failed to fetch stats:', error)
      }
    }

    fetchAgent()
    fetchStats()
  }, [agentId, user])

  const fetchLogs = async () => {
    if (!agent || logsFetched) return

    const { data, error } = await supabase
      .from('agent_logs')
      .select('*')
      .eq('agent_id', agent.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (!error) {
      setLogs(data)
      setLogsFetched(true)
      setShowHistory(true)
    } else {
      console.error('Failed to fetch logs:', error)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this agent?')) return

    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', agentId)
      .eq('user_id', user.id)

    if (error) {
      alert('Failed to delete agent.')
    } else {
      router.push('/dashboard')
    }
  }

  const handleCopy = () => {
    if (agent?.prompt) {
      navigator.clipboard.writeText(agent.prompt)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    }
  }

  const handleRunAgent = async () => {
    if (!agent?.prompt || !user?.id || !agent?.id) return

    setLoading(true)
    setResponse(null)
    setRunError(null)

    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: agent.prompt,
          user_id: user.id,
          agent_id: agent.id,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setResponse(data.result)

        if (showHistory) {
          setLogs((prev) => [
            {
              id: Date.now(),
              created_at: new Date().toISOString(),
              prompt: agent.prompt,
              output: data.result,
            },
            ...prev,
          ])
        }
      } else {
        setRunError(data.error || 'Error running agent.')
      }
    } catch (err) {
      setRunError('Unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  if (error) return <p className="text-red-500 text-center mt-6">{error}</p>
  if (!agent) return <p className="text-center mt-6">Loading agent details...</p>

  return (
    <div className="min-h-screen px-6 py-10 max-w-2xl mx-auto">
      <Link href="/dashboard" className="text-blue-600 underline mb-4 inline-block">
        ← Back to Dashboard
      </Link>

      <h1 className="text-3xl font-bold mb-4">{agent.title}</h1>
      <p className="bg-white p-4 rounded shadow whitespace-pre-wrap">{agent.prompt}</p>

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <div className="bg-white rounded shadow p-4 text-center">
            <div className="text-gray-500 text-sm">Total Runs</div>
            <div className="text-xl font-semibold">{stats.run_count}</div>
          </div>
          <div className="bg-white rounded shadow p-4 text-center">
            <div className="text-gray-500 text-sm">Success Rate</div>
            <div className="text-xl font-semibold">
              {(stats.success_rate * 100).toFixed(0)}%
            </div>
          </div>
          <div className="bg-white rounded shadow p-4 text-center">
            <div className="text-gray-500 text-sm">Last Run</div>
            <div className="text-sm">{new Date(stats.last_run).toLocaleString()}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4 mt-6">
        <button onClick={handleCopy} className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 transition">
          {copySuccess ? '✅ Copied!' : '📋 Copy'}
        </button>

        <Link href={`/agents/${agent.id}/edit`} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
          ✏️ Edit
        </Link>

        <button onClick={handleDelete} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition">
          🗑️ Delete
        </button>

        <button onClick={handleRunAgent} disabled={loading} className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition">
          {loading ? 'Running...' : '▶️ Run Agent'}
        </button>

        <Link href={`/agents/${agent.id}/history`} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition">
          🔗 Full History Page
        </Link>
      </div>

      {runError && (
        <p className="mt-4 text-red-500 font-medium">⚠️ {runError}</p>
      )}

      {response && (
        <div className="bg-gray-100 p-4 rounded shadow mt-6 whitespace-pre-wrap">
          <h2 className="font-semibold mb-2">🧠 Agent Response:</h2>
          <p>{response}</p>
        </div>
      )}

      {showHistory && logs.length > 0 && (
        <div className="mt-10">
          <h2 className="text-xl font-semibold mb-4">📜 Run History</h2>
          <ul className="space-y-4">
            {logs.map((log) => (
              <li key={log.id} className="bg-gray-50 p-4 rounded shadow">
                <p className="text-sm text-gray-500 mb-2">{new Date(log.created_at).toLocaleString()}</p>
                <p className="font-medium whitespace-pre-wrap mb-2">
                  <span className="text-gray-700">Prompt:</span> {log.prompt}
                </p>
                <p className="whitespace-pre-wrap">
                  <span className="text-gray-700 font-medium">Output:</span> {log.output}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}