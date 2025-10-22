'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Calendar, Clock, Bot, CheckCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'

interface ScheduledAgent {
  id: string
  agent_name: string
  schedule_cron?: string
  next_run?: string
  timezone?: string
  status: string
}

const formatSchedule = (cron?: string) => {
  if (!cron) return 'Not scheduled'

  // Simple cron parser for common patterns
  const parts = cron.split(' ')
  if (parts.length < 5) return cron

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Daily at midnight'
  }
  if (minute === '0' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour}:00`
  }
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour}:${minute}`
  }
  if (dayOfWeek !== '*' && dayOfWeek !== '?') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayNum = parseInt(dayOfWeek)
    return `Weekly on ${days[dayNum] || 'Unknown'} at ${hour}:${minute || '00'}`
  }

  return cron
}

const formatNextRun = (nextRun?: string, timezone?: string) => {
  if (!nextRun) return 'Not scheduled'

  try {
    const date = new Date(nextRun)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 0) return 'Overdue'
    if (diffMins < 60) return `In ${diffMins} min`
    if (diffHours < 24) return `In ${diffHours}h`
    if (diffDays === 1) return 'Tomorrow'
    if (diffDays < 7) return `In ${diffDays} days`

    return date.toLocaleDateString()
  } catch {
    return 'Invalid date'
  }
}

const ScheduledAgentsCard = () => {
  const { user } = useAuth()
  const [scheduledAgents, setScheduledAgents] = useState<ScheduledAgent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchScheduledAgents = async () => {
      if (!user) return

      // Only show loading on initial load to prevent flicker
      if (scheduledAgents.length === 0) {
        setLoading(true)
      }
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, schedule_cron, next_run, timezone, status')
        .eq('user_id', user.id)
        .eq('mode', 'scheduled')
        .eq('status', 'active')
        .order('next_run', { ascending: true, nullsFirst: false })
        .limit(5)

      if (error) {
        console.error('Error fetching scheduled agents:', error)
      } else {
        setScheduledAgents(data || [])
      }
      setLoading(false)
    }

    fetchScheduledAgents()

    // Auto-refresh every 30 seconds without flickering
    const interval = setInterval(fetchScheduledAgents, 30000)
    return () => clearInterval(interval)
  }, [user, scheduledAgents.length])

  return (
    <div className="p-6 border-b border-gray-200/50 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-t-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
          <Calendar className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">Scheduled Agents</h3>
          <p className="text-sm text-slate-600 font-medium">Agents running on autopilot</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
        </div>
      ) : scheduledAgents.length === 0 ? (
        <div className="text-center py-8 bg-white/70 rounded-xl border border-purple-200/50">
          <Calendar className="w-12 h-12 text-purple-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium mb-2">No scheduled agents yet</p>
          <p className="text-sm text-slate-500 mb-4">Create agents with schedules to automate your workflows</p>
          <Link
            href="/agents/new/chat"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 font-medium text-sm shadow-lg"
          >
            <Bot className="w-4 h-4" />
            Create Agent
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {scheduledAgents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="block p-4 bg-white/70 backdrop-blur-sm rounded-xl border border-purple-200/50 hover:border-purple-300 hover:shadow-lg transition-all duration-200 group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-500 via-purple-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-slate-900 truncate group-hover:text-purple-700 transition-colors">
                      {agent.agent_name}
                    </h4>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1 text-xs text-purple-600 font-medium">
                        <Clock className="w-3 h-3" />
                        {formatSchedule(agent.schedule_cron)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                    <CheckCircle className="w-3 h-3" />
                    {formatNextRun(agent.next_run, agent.timezone)}
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {scheduledAgents.length >= 5 && (
            <div className="text-center pt-2">
              <Link
                href="/agents?filter=scheduled"
                className="text-sm text-purple-600 hover:text-purple-800 font-semibold"
              >
                View all scheduled agents →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ScheduledAgentsCard