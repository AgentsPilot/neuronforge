'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
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
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')

  useEffect(() => {
    const fetchStats = async () => {
      let query = supabase
        .from('agent_stats')
        .select('agent_id, run_count, success_count, last_run_at, agents(agent_name)')
        .order('run_count', { ascending: false })

      if (agentId) {
        query = query.eq('agent_id', agentId)
      }

      const { data, error } = await query

      if (error) {
        console.error('❌ Error fetching agent stats:', error.message)
        setStats([])
      } else {
        const parsedStats = data.map((row) => ({
          agent_id: row.agent_id,
          run_count: row.run_count,
          success_count: row.success_count,
          last_run_at: row.last_run_at,
          agent_name: row.agents?.agent_name ?? 'Unknown',
        }))
        setStats(parsedStats)
      }

      setLoading(false)
    }

    fetchStats()
  }, [agentId])

  const calculateSuccessRate = (successCount: number, runCount: number) => {
    if (runCount === 0) return 0
    return Math.round((successCount / runCount) * 100)
  }

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return 'text-green-600 bg-green-50'
    if (rate >= 70) return 'text-yellow-600 bg-yellow-50'
    return 'text-red-600 bg-red-50'
  }

  const getActivityStatus = (lastRunAt: string) => {
    const now = new Date()
    const lastRun = new Date(lastRunAt)
    const hoursSince = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60)
    
    if (hoursSince < 1) return { status: 'active', color: 'text-green-600', label: 'Active' }
    if (hoursSince < 24) return { status: 'recent', color: 'text-blue-600', label: 'Recent' }
    if (hoursSince < 168) return { status: 'idle', color: 'text-yellow-600', label: 'Idle' }
    return { status: 'inactive', color: 'text-gray-600', label: 'Inactive' }
  }

  const formatTimeAgo = (dateString: string) => {
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
  const averageSuccessRate = stats.length > 0 ? Math.round((totalSuccesses / totalRuns) * 100) || 0 : 0
  const activeAgents = stats.filter(stat => getActivityStatus(stat.last_run_at).status === 'active').length

  if (loading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-8 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading agent statistics...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-600" />
              Agent Performance
            </h2>
            <p className="text-gray-600 mt-1">Monitor agent execution statistics and performance metrics</p>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                viewMode === 'cards' 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                viewMode === 'table' 
                  ? 'bg-blue-100 text-blue-700' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Table
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">Total Runs</span>
            </div>
            <div className="text-2xl font-bold text-blue-700">{totalRuns.toLocaleString()}</div>
          </div>
          
          <div className="bg-green-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900">Success Rate</span>
            </div>
            <div className="text-2xl font-bold text-green-700">{averageSuccessRate}%</div>
          </div>
          
          <div className="bg-purple-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium text-purple-900">Active Agents</span>
            </div>
            <div className="text-2xl font-bold text-purple-700">{activeAgents}</div>
          </div>
          
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-900">Total Agents</span>
            </div>
            <div className="text-2xl font-bold text-gray-700">{stats.length}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {stats.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No agent statistics</h3>
            <p className="text-gray-600">No agents have been executed yet.</p>
          </div>
        ) : viewMode === 'cards' ? (
          /* Cards View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {stats.map((stat) => {
              const successRate = calculateSuccessRate(stat.success_count, stat.run_count)
              const activityStatus = getActivityStatus(stat.last_run_at)
              
              return (
                <div key={stat.agent_id} className="border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">{stat.agent_name}</h3>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${activityStatus.color} bg-current bg-opacity-10`}>
                          {activityStatus.label}
                        </span>
                      </div>
                    </div>
                    <div className={`text-right px-3 py-1 rounded-full text-sm font-medium ${getSuccessRateColor(successRate)}`}>
                      {successRate}%
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PlayCircle className="h-4 w-4 text-gray-500" />
                        <span className="text-sm text-gray-600">Total Runs</span>
                      </div>
                      <span className="font-medium text-gray-900">{stat.run_count.toLocaleString()}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-sm text-gray-600">Successes</span>
                      </div>
                      <span className="font-medium text-green-600">{stat.success_count.toLocaleString()}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-sm text-gray-600">Failures</span>
                      </div>
                      <span className="font-medium text-red-600">{(stat.run_count - stat.success_count).toLocaleString()}</span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-600">Last Run</span>
                      </div>
                      <span className="text-sm text-gray-500">{formatTimeAgo(stat.last_run_at)}</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-4">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${successRate}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Agent</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Runs</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Success Rate</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Last Run</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat) => {
                  const successRate = calculateSuccessRate(stat.success_count, stat.run_count)
                  const activityStatus = getActivityStatus(stat.last_run_at)
                  
                  return (
                    <tr key={stat.agent_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="font-medium text-gray-900">{stat.agent_name}</div>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${activityStatus.color} bg-current bg-opacity-10`}>
                          <div className={`w-2 h-2 rounded-full ${activityStatus.color} bg-current`}></div>
                          {activityStatus.label}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-gray-900">{stat.run_count.toLocaleString()}</div>
                        <div className="text-sm text-gray-500">{stat.success_count} successful</div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium px-2 py-1 rounded ${getSuccessRateColor(successRate)}`}>
                            {successRate}%
                          </span>
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full"
                              style={{ width: `${successRate}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-gray-900">{formatTimeAgo(stat.last_run_at)}</div>
                        <div className="text-sm text-gray-500">{new Date(stat.last_run_at).toLocaleDateString()}</div>
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