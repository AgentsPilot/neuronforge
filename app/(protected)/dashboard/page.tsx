'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import AgentStatsChart from '@/components/dashboard/AgentStatsChart'
import AgentStatsTable from '@/components/dashboard/AgentStatsTable'
import ScheduledAgentsCard from '@/components/dashboard/ScheduledAgentsCard'
import AlertFeed from '@/components/dashboard/AlertFeed'
import { 
  Activity, 
  TrendingUp, 
  Clock, 
  Bell,
  Zap,
  Bot,
  Calendar,
  BarChart3,
  RefreshCw
} from 'lucide-react'

export default function DashboardPage() {
  const { user } = useAuth()
  const [agentStats, setAgentStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const fetchDashboardData = async () => {
    if (!user) return
    
    setLoading(true)

    const { data: stats, error: statsError } = await supabase
      .from('agent_stats')
      .select('agent_id, run_count, last_run_at, agents (agent_name)')
      .eq('user_id', user.id)

    if (statsError) {
      console.error('❌ Failed to fetch agent stats:', statsError.message)
    } else {
      const parsedStats = stats.map((s) => ({
        name: s.agents?.agent_name ?? 'Unknown Agent',
        count: s.run_count,
        lastRun: s.last_run_at,
      }))
      setAgentStats(parsedStats)
    }

    setLastUpdated(new Date())
    setLoading(false)
  }

  useEffect(() => {
    fetchDashboardData()
    
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchDashboardData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user])

  // Quick stats calculation
  const totalRuns = agentStats.reduce((sum, stat) => sum + stat.count, 0)
  const activeAgents = agentStats.filter(stat => stat.count > 0).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-white" />
              </div>
              Dashboard
            </h1>
            <p className="text-gray-600 mt-1">
              Monitor your AI agents and automation performance
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock className="h-4 w-4" />
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Quick Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Runs</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {totalRuns.toLocaleString()}
                </p>
                <p className="text-sm text-green-600 mt-1">
                  <TrendingUp className="h-3 w-3 inline mr-1" />
                  All time
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
                <Activity className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Agents</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{activeAgents}</p>
                <p className="text-sm text-blue-600 mt-1">
                  <Zap className="h-3 w-3 inline mr-1" />
                  Currently running
                </p>
              </div>
              <div className="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center">
                <Bot className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Scheduled Tasks</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">2</p>
                <p className="text-sm text-purple-600 mt-1">
                  <Calendar className="h-3 w-3 inline mr-1" />
                  Next: Today 3PM
                </p>
              </div>
              <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center">
                <Clock className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Alerts</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">1</p>
                <p className="text-sm text-red-600 mt-1">
                  <Bell className="h-3 w-3 inline mr-1" />
                  Needs attention
                </p>
              </div>
              <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center">
                <Bell className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Chart */}
          <div className="space-y-6">
            <AgentStatsChart />
          </div>

          {/* Right Column - Stats Table */}
          <div className="space-y-6">
            <AgentStatsTable />
          </div>
        </div>

        {/* Full Width Alert Center */}
        <div className="w-full">
          <AlertFeed />
        </div>

        {/* Secondary Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Scheduled Agents */}
          <ScheduledAgentsCard />
          
          {/* Recent Activity */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-600" />
                Recent Activity
              </h3>
              <p className="text-gray-600 text-sm mt-1">Latest agent executions and system events</p>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {agentStats.slice(0, 5).map((stat, index) => (
                  <div key={index} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <div>
                        <p className="font-medium text-gray-900">{stat.name}</p>
                        <p className="text-sm text-gray-500">Completed successfully</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">{stat.count} runs</p>
                      <p className="text-xs text-gray-500">
                        {stat.lastRun ? new Date(stat.lastRun).toLocaleDateString() : 'Never'}
                      </p>
                    </div>
                  </div>
                ))}
                
                {agentStats.length === 0 && !loading && (
                  <div className="text-center py-8">
                    <Activity className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-2">No recent activity</h4>
                    <p className="text-gray-600">Your agents haven't run yet. Create and execute your first agent to see activity here.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 flex items-center gap-3">
              <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
              <p className="text-gray-700">Loading dashboard data...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}