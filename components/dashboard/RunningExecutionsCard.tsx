'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { calculateNextRun } from '@/lib/utils/scheduleFormatter'
import {
  Play,
  CheckCircle,
  Clock,
  Loader2,
  ChevronRight,
  HandMetal,
  Calendar,
  BarChart3
} from 'lucide-react'

interface RunningExecution {
  execution_id: string
  agent_id: string
  agent_name: string
  status: string
  current_step: string | null
  step_title: string
  step_order: number
  total_steps: number
  completed_steps: string[]
  created_at: string
  has_pending_approval: boolean
  approval_id?: string
  mode?: string
}

interface ScheduledAgent {
  agent_id: string
  agent_name: string
  schedule: string
  next_run: Date
  last_run?: Date
  status: string
}

export function RunningExecutionsCard({ userId }: { userId: string }) {
  const router = useRouter()
  const [executions, setExecutions] = useState<RunningExecution[]>([])
  const [scheduledAgents, setScheduledAgents] = useState<ScheduledAgent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRunningExecutions = async () => {
    try {
      // Fetch running executions from queue
      const { data: executionData, error: execError } = await supabase
        .from('agent_executions')
        .select('id, agent_id, status, progress, started_at, created_at')
        .eq('user_id', userId)
        .in('status', ['pending', 'queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(20)

      if (execError) {
        console.error('Failed to fetch running executions:', execError)
        setExecutions([])
      } else {
        console.log(`[RunningExecutionsCard] Found ${executionData?.length || 0} running executions`, executionData)

        if (executionData && executionData.length > 0) {
          // Fetch agent details for all executions
          const agentIds = [...new Set(executionData.map(e => e.agent_id))]
          const { data: agentData } = await supabase
            .from('agents')
            .select('id, agent_name, mode')
            .in('id', agentIds)

          const agentMap = new Map(agentData?.map(a => [a.id, a]) || [])

          // Process executions
          const processedExecutions: RunningExecution[] = executionData.map(exec => {
            const agent = agentMap.get(exec.agent_id)
            const progress = exec.progress || 0

            return {
              execution_id: exec.id,
              agent_id: exec.agent_id,
              agent_name: agent?.agent_name || 'Unknown Agent',
              status: exec.status,
              current_step: null,
              step_title: exec.status === 'queued' ? 'Queued' : exec.status === 'pending' ? 'Starting...' : 'Running',
              step_order: 1,
              total_steps: 1,
              completed_steps: [],
              created_at: exec.created_at,
              has_pending_approval: false,
              approval_id: undefined,
              mode: agent?.mode
            }
          })

          console.log(`[RunningExecutionsCard] Processed ${processedExecutions.length} executions`, processedExecutions)
          setExecutions(processedExecutions)
        } else {
          setExecutions([])
        }
      }

      // Fetch scheduled agents
      const { data: scheduledData, error: schedError } = await supabase
        .from('agents')
        .select('id, agent_name, schedule_cron, status, last_run, timezone')
        .eq('user_id', userId)
        .eq('mode', 'scheduled')
        .eq('status', 'active')
        .order('agent_name', { ascending: true})

      // Get IDs of agents currently running to exclude from scheduled list
      const runningAgentIds = new Set(executionData?.map(e => e.agent_id) || [])

      if (schedError) {
        console.error('Failed to fetch scheduled agents:', schedError)
      } else if (scheduledData) {
        const processedScheduled = scheduledData
          .filter(agent => !runningAgentIds.has(agent.id)) // Exclude agents currently running
          .map(agent => {
            if (!agent.schedule_cron) {
              console.warn(`Agent ${agent.agent_name} has no schedule_cron despite being in scheduled mode`)
              return null;
            }

            const nextRunDate = calculateNextRun(agent.schedule_cron, agent.timezone || 'UTC')
            if (!nextRunDate) {
              console.warn(`Failed to calculate next run for agent ${agent.agent_name} with cron: ${agent.schedule_cron}`)
              return null;
            }

            return {
              agent_id: agent.id,
              agent_name: agent.agent_name,
              schedule: agent.schedule_cron,
              next_run: nextRunDate,
              last_run: agent.last_run ? new Date(agent.last_run) : undefined,
              status: agent.status
            }
          })
          .filter((agent): agent is NonNullable<typeof agent> => agent !== null)
          .sort((a, b) => a.next_run.getTime() - b.next_run.getTime())

        console.log(`Found ${scheduledData.length} scheduled agents, ${processedScheduled.length} valid after processing`)
        setScheduledAgents(processedScheduled)
      }
    } catch (error) {
      console.error('Failed to fetch running executions:', error)
    } finally {
      setLoading(false)
    }
  }

  const getTimeUntil = (targetDate: Date): string => {
    const now = new Date()
    const diff = targetDate.getTime() - now.getTime()

    if (diff < 0) return 'Running now'

    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m`
    return 'Less than 1m'
  }

  useEffect(() => {
    fetchRunningExecutions()

    // Poll every 5 seconds for updates
    const interval = setInterval(fetchRunningExecutions, 5000)
    return () => clearInterval(interval)
  }, [userId])

  const getStatusIcon = (status: string, hasPendingApproval: boolean) => {
    if (hasPendingApproval) {
      return <HandMetal className="h-5 w-5 text-orange-500 animate-pulse" />
    }

    switch (status) {
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
      case 'waiting_approval':
        return <HandMetal className="h-5 w-5 text-orange-500" />
      case 'paused':
        return <Clock className="h-5 w-5 text-yellow-500" />
      default:
        return <Play className="h-5 w-5 text-gray-500" />
    }
  }

  const handleExecutionClick = (execution: RunningExecution) => {
    if (execution.has_pending_approval && execution.approval_id) {
      // Redirect to approval page
      router.push(`/approvals/${execution.approval_id}`)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            <span className="text-sm font-medium text-gray-600">Loading agent activity...</span>
          </div>
        </div>
      </div>
    )
  }

  const runningCount = executions.length
  const scheduledCount = scheduledAgents.length
  const totalCount = runningCount + scheduledCount

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-slate-50 to-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-700 to-gray-800 rounded-xl flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Agent Activity</h2>
              <p className="text-xs text-gray-600">
                {runningCount} running · {scheduledCount} scheduled
              </p>
            </div>
          </div>
          {runningCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-100 rounded-md border border-green-200">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-green-700 font-semibold text-xs uppercase tracking-wide">Live</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {totalCount === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">No Agent Activity</h3>
            <p className="text-xs text-gray-500">No running executions or scheduled agents at this time</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Running Executions Section */}
            {runningCount > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Play className="h-3.5 w-3.5 text-blue-600" />
                    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Running Now</h3>
                  </div>
                  <div className="flex-1 h-px bg-gray-200"></div>
                </div>
                <div className="space-y-3">
                  {executions.map((execution) => {
                    const progressPercentage = execution.total_steps > 0
                      ? (execution.completed_steps.length / execution.total_steps) * 100
                      : 0

                    return (
                      <div
                        key={execution.execution_id}
                        onClick={() => handleExecutionClick(execution)}
                        className={`border rounded-lg p-4 transition-all duration-200 ${
                          execution.has_pending_approval
                            ? 'bg-orange-50 border-orange-200 cursor-pointer hover:shadow-md hover:border-orange-300'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            {getStatusIcon(execution.status, execution.has_pending_approval)}
                            <div>
                              <h3 className="text-sm font-semibold text-gray-900">{execution.agent_name}</h3>
                              <p className="text-xs text-gray-600">
                                Started {new Date(execution.created_at).toLocaleTimeString()}
                                {execution.mode === 'scheduled' && (
                                  <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Scheduled</span>
                                )}
                              </p>
                            </div>
                          </div>
                          {execution.has_pending_approval && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-100 rounded-md border border-orange-200">
                              <HandMetal className="h-3.5 w-3.5 text-orange-600" />
                              <span className="text-orange-700 font-semibold text-xs">Action Required</span>
                              <ChevronRight className="h-3.5 w-3.5 text-orange-600" />
                            </div>
                          )}
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-gray-600">
                              Step {execution.step_order} of {execution.total_steps}
                            </span>
                            <span className="text-xs font-bold text-gray-900">
                              {progressPercentage.toFixed(0)}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                execution.has_pending_approval
                                  ? 'bg-orange-500'
                                  : 'bg-blue-500'
                              }`}
                              style={{ width: `${progressPercentage}%` }}
                            />
                          </div>
                        </div>

                        {/* Current Step */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-md border border-gray-200">
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            execution.has_pending_approval ? 'bg-orange-500 animate-pulse' : 'bg-blue-500 animate-pulse'
                          }`}></div>
                          <span className="text-xs text-gray-700 font-medium">
                            {execution.has_pending_approval ? 'Waiting for approval' : `Processing: ${execution.step_title}`}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Scheduled Agents Section */}
            {scheduledCount > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-indigo-600" />
                    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Scheduled</h3>
                  </div>
                  <div className="flex-1 h-px bg-gray-200"></div>
                </div>
                <div className="space-y-3">
                  {scheduledAgents.map((agent) => (
                    <div
                      key={agent.agent_id}
                      className="border border-slate-200 rounded-lg p-4 bg-gradient-to-r from-slate-50 to-gray-50 hover:shadow-md transition-all duration-200"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                            <Calendar className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900">{agent.agent_name}</h3>
                            <p className="text-xs text-gray-600 capitalize">{agent.schedule} schedule</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500 font-medium">Next Run</p>
                          <p className="text-sm font-bold text-blue-600">{getTimeUntil(agent.next_run)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white rounded-md px-3 py-2 border border-gray-200">
                          <p className="text-xs text-gray-500 font-medium mb-0.5">Next Scheduled</p>
                          <p className="text-xs font-semibold text-gray-900">
                            {agent.next_run.toLocaleDateString()} at {agent.next_run.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="bg-white rounded-md px-3 py-2 border border-gray-200">
                          <p className="text-xs text-gray-500 font-medium mb-0.5">Last Run</p>
                          <p className="text-xs font-semibold text-gray-900">
                            {agent.last_run ? agent.last_run.toLocaleDateString() : 'Never'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
