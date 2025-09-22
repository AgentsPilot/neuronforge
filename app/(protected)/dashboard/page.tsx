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
  RefreshCw,
  Sparkles,
  Globe,
  CheckCircle
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

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Loading Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
            <BarChart3 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-indigo-800 to-purple-800 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-gray-600 font-medium">Monitor your AI agents and automation performance</p>
        </div>

        <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-3xl shadow-xl mb-6">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">Loading Dashboard</h3>
          <p className="text-slate-500 font-medium">Gathering your AI agent performance data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Modern Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
          <BarChart3 className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-indigo-800 to-purple-800 bg-clip-text text-transparent">
          Dashboard
        </h1>
        <p className="text-gray-600 font-medium">Monitor your AI agents and automation performance</p>
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Total Runs</p>
              <p className="text-2xl font-bold text-purple-900">{totalRuns.toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-purple-600 font-medium mt-3 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            All time performance
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Bot className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Active Agents</p>
              <p className="text-2xl font-bold text-indigo-900">{activeAgents}</p>
            </div>
          </div>
          <p className="text-xs text-indigo-600 font-medium mt-3 flex items-center gap-1">
            <Zap className="h-3 w-3" />
            Currently running
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Scheduled</p>
              <p className="text-2xl font-bold text-purple-900">2</p>
            </div>
          </div>
          <p className="text-xs text-purple-600 font-medium mt-3 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Next: Today 3PM
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Bell className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Alerts</p>
              <p className="text-2xl font-bold text-indigo-900">1</p>
            </div>
          </div>
          <p className="text-xs text-indigo-600 font-medium mt-3 flex items-center gap-1">
            <Bell className="h-3 w-3" />
            Needs attention
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Dashboard Overview</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Real-time monitoring of your AI automation ecosystem
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
              <Clock className="h-4 w-4" />
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 text-sm font-semibold disabled:opacity-50 disabled:transform-none"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Chart */}
        <div className="space-y-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
            <AgentStatsChart />
          </div>
        </div>

        {/* Right Column - Stats Table */}
        <div className="space-y-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
            <AgentStatsTable />
          </div>
        </div>
      </div>

      {/* Full Width Alert Center */}
      <div className="w-full">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <AlertFeed />
        </div>
      </div>

      {/* Secondary Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scheduled Agents */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <ScheduledAgentsCard />
        </div>
        
        {/* Recent Activity */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <div className="p-6 border-b border-gray-200/50 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Recent Activity</h3>
                <p className="text-sm text-slate-600 font-medium">Latest agent executions and system events</p>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <div className="space-y-4">
              {agentStats.slice(0, 5).map((stat, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0 hover:bg-slate-50 rounded-lg px-3 transition-colors duration-200"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full shadow-sm"></div>
                    <div>
                      <p className="font-semibold text-slate-900">{stat.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <CheckCircle className="w-3 h-3 text-purple-600" />
                        <p className="text-sm text-purple-700 font-medium">Completed successfully</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{stat.count} runs</p>
                    <p className="text-xs text-slate-500 font-medium">
                      {stat.lastRun ? new Date(stat.lastRun).toLocaleDateString() : 'Never'}
                    </p>
                  </div>
                </div>
              ))}
              
              {agentStats.length === 0 && !loading && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gradient-to-br from-slate-400 to-slate-500 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-4">
                    <Activity className="w-8 w-8 text-white" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-700 mb-2">No recent activity</h4>
                  <p className="text-slate-500 font-medium">Your agents haven't run yet. Create and execute your first agent to see activity here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* System Status Footer */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-3xl p-8 text-white shadow-2xl">
        <div className="text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl shadow-xl mb-2">
            <Globe className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold">System Status: All Systems Operational</h3>
          <p className="text-indigo-100 font-medium max-w-2xl mx-auto leading-relaxed">
            Your AI agents are running smoothly. All integrations are connected and automation workflows are processing normally.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <button className="inline-flex items-center gap-2 px-6 py-3 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105">
              <Sparkles className="w-4 h-4" />
              View System Health
            </button>
            <button className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105">
              Performance Reports
              <BarChart3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}