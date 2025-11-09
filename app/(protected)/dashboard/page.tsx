'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import AgentStatsChart from '@/components/dashboard/AgentStatsChart'
import AgentStatsTable from '@/components/dashboard/AgentStatsTable'
import ScheduledAgentsCard from '@/components/dashboard/ScheduledAgentsCard'
import AlertFeed from '@/components/dashboard/AlertFeed'
import LearningAnalyticsCard from '@/components/dashboard/LearningAnalyticsCard'
import { UserPendingApprovals } from '@/components/approvals/UserPendingApprovals'
import { PilotTestButton } from '@/components/dev/PilotTestButton'
import { RunningExecutionsCard } from '@/components/dashboard/RunningExecutionsCard'
import {
  Activity,
  Bell,
  Bot,
  Calendar,
  BarChart3,
  RefreshCw,
  Sparkles,
  CheckCircle,
  Brain
} from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [agentStats, setAgentStats] = useState<any[]>([])
  const [scheduledCount, setScheduledCount] = useState(0)
  const [alertsCount, setAlertsCount] = useState(0)
  const [totalMemories, setTotalMemories] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const fetchDashboardData = async () => {
    if (!user) return

    // Don't set loading true on refresh - only on initial load
    // This prevents flickering by keeping old data visible
    if (agentStats.length === 0) {
      setLoading(true)
    }

    // Fetch agent stats
    const { data: stats, error: statsError } = await supabase
      .from('agent_stats')
      .select('agent_id, run_count, last_run_at, agents (agent_name)')
      .eq('user_id', user.id)

    if (statsError) {
      console.error('❌ Failed to fetch agent stats:', statsError.message)
    } else {
      const parsedStats = stats.map((s) => {
        const agentData = s.agents as any
        return {
          name: agentData?.agent_name ?? 'Unknown Agent',
          count: s.run_count,
          lastRun: s.last_run_at,
        }
      })
      setAgentStats(parsedStats)
    }

    // Fetch scheduled agents count
    const { count: scheduledAgentsCount, error: scheduledError } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('mode', 'scheduled')
      .eq('status', 'active')

    if (scheduledError) {
      console.error('❌ Failed to fetch scheduled agents:', scheduledError.message)
    } else {
      setScheduledCount(scheduledAgentsCount || 0)
    }

    // Fetch failed executions (alerts) from last 24 hours
    const oneDayAgo = new Date()
    oneDayAgo.setDate(oneDayAgo.getDate() - 1)

    const { count: failedCount, error: alertsError } = await supabase
      .from('agent_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'failed')
      .gte('created_at', oneDayAgo.toISOString())

    if (alertsError) {
      console.error('❌ Failed to fetch alerts:', alertsError.message)
    } else {
      setAlertsCount(failedCount || 0)
    }

    // Fetch total memories count
    const { count: memoriesCount, error: memoriesError } = await supabase
      .from('run_memories')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (memoriesError) {
      console.error('❌ Failed to fetch memories count:', memoriesError.message)
    } else {
      setTotalMemories(memoriesCount || 0)
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
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 rounded-3xl shadow-xl mb-4">
            <BarChart3 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            Dashboard
          </h1>
          <p className="text-gray-600 font-medium">Monitor your AI agents and automation performance</p>
        </div>

        <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 rounded-3xl shadow-xl mb-6">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">Loading Dashboard</h3>
          <p className="text-slate-500 font-medium">Gathering your AI agent performance data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Welcome Header - More Personal */}
      <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 rounded-3xl p-8 text-white shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-xl">
                <BarChart3 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Welcome Back!</h1>
                <p className="text-violet-100 font-medium">Here's what's happening with your automations</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm text-violet-100 font-medium">Last updated</p>
              <p className="text-white font-semibold">{lastUpdated.toLocaleTimeString()}</p>
            </div>
            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 text-sm font-semibold disabled:opacity-50 disabled:transform-none"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Pending Approvals Notification */}
      {user && <UserPendingApprovals userId={user.id} />}

      {/* Pilot Test Button (Development) */}
      <PilotTestButton />

      {/* Quick Stats - Simplified Language */}
      <div>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">Quick Overview</h2>
          <p className="text-gray-600">A snapshot of your automation activity</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="group relative overflow-hidden bg-gradient-to-br from-violet-50 to-purple-50 p-5 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border-2 border-violet-100">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Activity className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-gray-900">{totalRuns.toLocaleString()}</div>
              </div>
              <div>
                <p className="text-sm text-violet-700 font-semibold">Tasks Completed</p>
                <p className="text-xs text-violet-600 font-medium mt-1">Total automations run</p>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden bg-gradient-to-br from-emerald-50 to-green-50 p-5 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border-2 border-emerald-100">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 via-green-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Bot className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-gray-900">{activeAgents}</div>
              </div>
              <div>
                <p className="text-sm text-emerald-700 font-semibold">Active Automations</p>
                <p className="text-xs text-emerald-600 font-medium mt-1">Working for you right now</p>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 p-5 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border-2 border-amber-100">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-orange-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-gradient-to-br from-amber-500 via-orange-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Calendar className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-gray-900">{scheduledCount}</div>
              </div>
              <div>
                <p className="text-sm text-amber-700 font-semibold">On Schedule</p>
                <p className="text-xs text-amber-600 font-medium mt-1">{scheduledCount > 0 ? 'Running automatically' : 'No scheduled tasks yet'}</p>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden bg-gradient-to-br from-slate-50 to-gray-50 p-5 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border-2 border-slate-100">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-500/10 to-gray-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-gradient-to-br from-slate-500 via-gray-500 to-zinc-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Bell className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-gray-900">{alertsCount}</div>
              </div>
              <div>
                <p className="text-sm text-slate-700 font-semibold">Needs Attention</p>
                <p className="text-xs text-slate-600 font-medium mt-1">{alertsCount > 0 ? 'Issues in last 24 hours' : 'Everything looks good!'}</p>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-50 p-5 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border-2 border-purple-100">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 via-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Brain className="h-6 w-6 text-white" />
                </div>
                <div className="text-3xl font-bold text-gray-900">{totalMemories}</div>
              </div>
              <div>
                <p className="text-sm text-purple-700 font-semibold">Learning Progress</p>
                <p className="text-xs text-purple-600 font-medium mt-1">{totalMemories > 0 ? 'Agents are learning' : 'Start learning today'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Running Executions Card */}
      {user && <RunningExecutionsCard userId={user.id} />}

      {/* Upcoming Tasks and Recent Activity - Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Tasks */}
        <div className="flex flex-col">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900">Upcoming Tasks</h2>
            <p className="text-gray-600">Automations scheduled to run soon</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl flex-1">
            <ScheduledAgentsCard />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="flex flex-col">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900">Recent Activity</h2>
            <p className="text-gray-600">Latest automations that completed successfully</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl flex-1 flex flex-col">
            <div className="p-6 border-b border-gray-200/50 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
                  <Activity className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Completed Tasks</h3>
                  <p className="text-sm text-slate-600 font-medium">Tasks that finished running</p>
                </div>
              </div>
            </div>

            <div className="p-6 flex-1">
              <div className="space-y-4">
                {agentStats.slice(0, 5).map((stat, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0 hover:bg-slate-50 rounded-lg px-3 transition-colors duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-xl flex items-center justify-center">
                        <CheckCircle className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{stat.name}</p>
                        <p className="text-sm text-slate-600">Successfully completed</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-slate-900">{stat.count}</p>
                      <p className="text-xs text-slate-500 font-medium">times run</p>
                    </div>
                  </div>
                ))}

                {agentStats.length === 0 && !loading && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gradient-to-br from-slate-400 to-slate-500 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-4">
                      <Activity className="w-8 h-8 text-white" />
                    </div>
                    <h4 className="text-lg font-bold text-slate-700 mb-2">No activity yet</h4>
                    <p className="text-slate-500 font-medium mb-4">Create your first automation to get started!</p>
                    <button className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl hover:from-violet-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold">
                      <Bot className="w-5 h-5" />
                      Create Your First Automation
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* What Needs Your Attention */}
      <div>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">What Needs Your Attention</h2>
          <p className="text-gray-600">Tasks that didn't complete successfully</p>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <AlertFeed />
        </div>
      </div>

      {/* Performance Details - For Advanced Users */}
      <div>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">Performance Details</h2>
          <p className="text-gray-600">Detailed charts and statistics</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
            <AgentStatsChart />
          </div>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
            <AgentStatsTable />
          </div>
        </div>
      </div>

      {/* Learning Analytics Card */}
      {user && <LearningAnalyticsCard userId={user.id} />}

      {/* Quick Actions - Compact */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-2xl p-6 text-white shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Everything Running Smoothly</h3>
              <p className="text-indigo-100 text-sm">Your automations are working in the background</p>
            </div>
          </div>
          <button
            onClick={() => router.push('/agents')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            <Bot className="w-4 w-4" />
            View Agents
          </button>
        </div>
      </div>
    </div>
  )
}