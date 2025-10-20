'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { 
  Activity, 
  CheckCircle, 
  XCircle, 
  Clock, 
  TrendingUp, 
  BarChart3,
  Zap,
  AlertTriangle,
  Calendar,
  PlayCircle,
  Target,
  Timer
} from 'lucide-react'

type AgentStat = {
  agent_id: string
  run_count: number
  success_count: number
  last_run_at: string
  agent_name: string
}

export default function AgentStatsTable({ agentId }: { agentId?: string }) {
  const [stats, setStats] = useState<AgentStat[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table')
  const { user } = useAuth()

  useEffect(() => {
    const fetchStats = async () => {
      if (!user?.id) {
        setLoading(false)
        return
      }

      let query = supabase
        .from('agent_stats')
        .select(`
          agent_id, 
          run_count, 
          success_count, 
          last_run_at,
          agents (
            agent_name
          )
        `)
        .eq('user_id', user.id)
        .order('run_count', { ascending: false })

      if (agentId) {
        query = query.eq('agent_id', agentId)
      }

      const { data, error } = await query

      if (error) {
        console.error('❌ Error fetching agent stats:', error.message)
        setStats([])
      } else if (data) {
        const parsedStats = data
          .filter(row => row.agents) // Filter out rows where agent join failed
          .map((row) => ({
            agent_id: row.agent_id,
            run_count: row.run_count || 0,
            success_count: row.success_count || 0,
            last_run_at: row.last_run_at,
            agent_name: row.agents?.agent_name || 'Unknown Agent',
          }))
        setStats(parsedStats)
      } else {
        setStats([])
      }

      setLoading(false)
    }

    fetchStats()
  }, [agentId, user?.id])

  const calculateSuccessRate = (successCount: number, runCount: number) => {
    if (runCount === 0) return 0
    return Math.round((successCount / runCount) * 100)
  }

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return 'text-green-600 bg-green-50'
    if (rate >= 70) return 'text-yellow-600 bg-yellow-50'
    return 'text-red-600 bg-red-50'
  }

  const getActivityStatus = (lastRunAt: string | null) => {
    if (!lastRunAt) {
      return { status: 'never', color: 'text-gray-600', label: 'Never Run' }
    }
    
    const now = new Date()
    const lastRun = new Date(lastRunAt)
    const hoursSince = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60)
    
    if (hoursSince < 6) return { status: 'active', color: 'text-green-600', label: 'Active' }
    if (hoursSince < 48) return { status: 'recent', color: 'text-blue-600', label: 'Recent' }
    if (hoursSince < 168) return { status: 'idle', color: 'text-yellow-600', label: 'Idle' }
    return { status: 'inactive', color: 'text-gray-600', label: 'Inactive' }
  }

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never'
    
    const now = new Date()
    const date = new Date(dateString)
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
    return date.toLocaleDateString()
  }

  // Calculate summary statistics
  const totalRuns = stats.reduce((sum, stat) => sum + stat.run_count, 0)
  const totalSuccesses = stats.reduce((sum, stat) => sum + stat.success_count, 0)
  const averageSuccessRate = totalRuns > 0 ? Math.round((totalSuccesses / totalRuns) * 100) : 0
  const activeAgents = stats.filter(stat => {
    const status = getActivityStatus(stat.last_run_at)
    return status.status === 'active' || status.status === 'recent'
  }).length

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-6 text-center">
          <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-gray-500 text-sm">Loading agent statistics...</p>
        </div>
      </div>
    )
  }

  if (!user?.id) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-yellow-500 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Please log in to view agent statistics.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-200/50 bg-gradient-to-r from-emerald-50 to-green-50 rounded-t-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl flex items-center justify-center shadow-lg">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Agent Performance</h2>
              <p className="text-gray-600 text-sm font-medium">Execution statistics and metrics</p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-white rounded-xl px-2 py-2 shadow-md border border-gray-200">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                viewMode === 'cards'
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                viewMode === 'table'
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Table
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 border border-blue-200 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="h-3.5 w-3.5 text-blue-600" />
              <span className="text-xs font-semibold text-blue-900">Total Runs</span>
            </div>
            <div className="text-xl font-bold text-blue-700">{totalRuns.toLocaleString()}</div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 border border-green-200 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle className="h-3.5 w-3.5 text-green-600" />
              <span className="text-xs font-semibold text-green-900">Success Rate</span>
            </div>
            <div className="text-xl font-bold text-green-700">{averageSuccessRate}%</div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 border border-purple-200 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-3.5 w-3.5 text-purple-600" />
              <span className="text-xs font-semibold text-purple-900">Active</span>
            </div>
            <div className="text-xl font-bold text-purple-700">{activeAgents}</div>
          </div>

          <div className="bg-gradient-to-br from-gray-50 to-slate-100 rounded-xl p-3 border border-gray-200 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1">
              <Target className="h-3.5 w-3.5 text-gray-600" />
              <span className="text-xs font-semibold text-gray-900">Total</span>
            </div>
            <div className="text-xl font-bold text-gray-700">{stats.length}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex-1">
        {stats.length === 0 ? (
          <div className="text-center py-8">
            <BarChart3 className="h-10 w-10 text-gray-400 mx-auto mb-3" />
            <h3 className="text-base font-medium text-gray-900 mb-1">No agent statistics</h3>
            <p className="text-gray-600 text-sm">Your agents haven't been executed yet. Run an agent to see statistics here.</p>
          </div>
        ) : viewMode === 'cards' ? (
          /* Compact Cards View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stats.map((stat) => {
              const successRate = calculateSuccessRate(stat.success_count, stat.run_count)
              const activityStatus = getActivityStatus(stat.last_run_at)
              
              return (
                <div key={stat.agent_id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-sm mb-1 truncate" title={stat.agent_name}>
                        {stat.agent_name}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${activityStatus.color} bg-current bg-opacity-10`}>
                          {activityStatus.label}
                        </span>
                      </div>
                    </div>
                    <div className={`text-right px-2 py-1 rounded-full text-xs font-medium ${getSuccessRateColor(successRate)} ml-2 flex-shrink-0`}>
                      {successRate}%
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <PlayCircle className="h-3 w-3 text-gray-500" />
                        <span className="text-xs text-gray-600">Total Runs</span>
                      </div>
                      <span className="font-medium text-gray-900 text-sm">{stat.run_count.toLocaleString()}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        <span className="text-xs text-gray-600">Successes</span>
                      </div>
                      <span className="font-medium text-green-600 text-sm">{stat.success_count.toLocaleString()}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <XCircle className="h-3 w-3 text-red-500" />
                        <span className="text-xs text-gray-600">Failures</span>
                      </div>
                      <span className="font-medium text-red-600 text-sm">{(stat.run_count - stat.success_count).toLocaleString()}</span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <Timer className="h-3 w-3 text-gray-400" />
                        <span className="text-xs text-gray-600">Last Run</span>
                      </div>
                      <span className="text-xs text-gray-500">{formatTimeAgo(stat.last_run_at)}</span>
                    </div>
                  </div>

                  {/* Compact Progress Bar */}
                  <div className="mt-3">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div 
                        className="bg-gradient-to-r from-green-500 to-green-600 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${successRate}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* Compact Table View */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-sm">Agent</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-sm">Status</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-sm">Runs</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-sm">Success Rate</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-sm">Last Run</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat) => {
                  const successRate = calculateSuccessRate(stat.success_count, stat.run_count)
                  const activityStatus = getActivityStatus(stat.last_run_at)
                  
                  return (
                    <tr key={stat.agent_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-3">
                        <div className="font-medium text-gray-900 truncate max-w-xs text-sm" title={stat.agent_name}>
                          {stat.agent_name}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${activityStatus.color} bg-current bg-opacity-10`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${activityStatus.color} bg-current`}></div>
                          {activityStatus.label}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-gray-900 text-sm">{stat.run_count.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">{stat.success_count} successful</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${getSuccessRateColor(successRate)}`}>
                            {successRate}%
                          </span>
                          <div className="w-12 bg-gray-200 rounded-full h-1.5">
                            <div 
                              className="bg-gradient-to-r from-green-500 to-green-600 h-1.5 rounded-full"
                              style={{ width: `${successRate}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-gray-900 text-sm">{formatTimeAgo(stat.last_run_at)}</div>
                        {stat.last_run_at && (
                          <div className="text-xs text-gray-500">{new Date(stat.last_run_at).toLocaleDateString()}</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}