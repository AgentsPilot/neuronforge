'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Alert = {
  id: string
  created_at: string
  title: string
  message: string
  severity: 'High' | 'Medium' | 'Low'
}

export default function AlertFeed({ userId }: { userId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [filter, setFilter] = useState<'All' | 'High' | 'Medium' | 'Low'>('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAlerts = async () => {
      const { data, error } = await supabase
        .from('agent_logs')
        .select('id, created_at, full_output')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) {
        console.error('❌ Error fetching alerts:', error.message)
        return
      }

      const parsed = data
        .map((log) => {
          try {
            const output = JSON.parse(log.full_output)
            if (output?.parsed_output?.severity && output.parsed_output.title && output.parsed_output.message) {
              return {
                id: log.id,
                created_at: log.created_at,
                title: output.parsed_output.title,
                message: output.parsed_output.message,
                severity: output.parsed_output.severity as 'High' | 'Medium' | 'Low',
              }
            }
          } catch (err) {
            console.warn('Failed to parse full_output:', err)
          }
          return null
        })
        .filter(Boolean) as Alert[]

      setAlerts(parsed)
      setLoading(false)
    }

    fetchAlerts()
  }, [userId])

  const filteredAlerts = filter === 'All'
    ? alerts
    : alerts.filter((a) => a.severity === filter)

  const getBadgeColor = (severity: string) => {
    switch (severity) {
      case 'High':
        return 'bg-red-100 text-red-800'
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800'
      case 'Low':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="bg-white border rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">🔔 Alerts</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="border px-2 py-1 rounded text-sm"
        >
          <option value="All">All</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading alerts...</p>
      ) : filteredAlerts.length === 0 ? (
        <p className="text-gray-500">No alerts found.</p>
      ) : (
        <ul className="space-y-4">
          {filteredAlerts.map((alert) => (
            <li key={alert.id} className="border p-4 rounded hover:bg-gray-50">
              <div className="flex justify-between items-center">
                <h3 className="font-medium text-gray-900">{alert.title}</h3>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${getBadgeColor(alert.severity)}`}>
                  {alert.severity}
                </span>
              </div>
              <p className="text-sm text-gray-700 mt-1">{alert.message}</p>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(alert.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}