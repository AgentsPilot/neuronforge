'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Activity, CheckCircle, Pause, FileText } from 'lucide-react'
import { Card } from '@/components/v2/ui/card'
import type { AgentBreakdownItem } from '@/types/analytics'

interface AgentBreakdownGridProps {
  agents: AgentBreakdownItem[]
}

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return 'Never'

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString()
}

function formatNumber(num: number): string {
  if (num === 0) return '0'
  if (num < 1000) return num.toLocaleString()
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`
  return `${(num / 1000000).toFixed(1)}M`
}

function StatusBadge({ status }: { status: 'active' | 'paused' | 'draft' }) {
  const getStatusConfig = () => {
    switch (status) {
      case 'active':
        return {
          icon: CheckCircle,
          color: 'text-green-600 dark:text-green-400',
          bg: 'bg-green-100 dark:bg-green-900/30',
          label: 'Active'
        }
      case 'paused':
        return {
          icon: Pause,
          color: 'text-yellow-600 dark:text-yellow-400',
          bg: 'bg-yellow-100 dark:bg-yellow-900/30',
          label: 'Paused'
        }
      case 'draft':
        return {
          icon: FileText,
          color: 'text-gray-600 dark:text-gray-400',
          bg: 'bg-gray-100 dark:bg-gray-800',
          label: 'Draft'
        }
    }
  }

  const config = getStatusConfig()
  const Icon = config.icon

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

export function AgentBreakdownGrid({ agents }: AgentBreakdownGridProps) {
  const router = useRouter()

  const getSuccessColor = (rate: number) => {
    if (rate >= 95) return 'text-green-500'
    if (rate >= 90) return 'text-yellow-500'
    return 'text-red-500'
  }

  if (agents.length === 0) {
    return (
      <Card className="!p-8">
        <div className="text-center">
          <Activity className="w-12 h-12 mx-auto mb-3 text-[var(--v2-text-muted)] opacity-50" />
          <p className="text-sm text-[var(--v2-text-muted)]">
            No agent activity in this period
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      {agents.map((agent) => (
        <Card
          key={agent.agentId}
          className="!p-4 cursor-pointer hover:shadow-md hover:border-[var(--v2-primary)]/20 transition-all"
          onClick={() => router.push(`/v2/agents/${agent.agentId}`)}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-[var(--v2-text-primary)] truncate mb-2">
                {agent.agentName}
              </h4>
              <div className="flex items-center gap-2">
                <StatusBadge status={agent.status} />
                <span className="text-xs text-[var(--v2-text-muted)]">
                  {formatTimeAgo(agent.lastRun)}
                </span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)] flex-shrink-0 ml-2" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-[var(--v2-text-muted)] mb-0.5">Operations</div>
              <div className="font-semibold text-[var(--v2-text-primary)]">
                {formatNumber(agent.totalRuns)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--v2-text-muted)] mb-0.5">Reliability</div>
              <div className={`font-semibold ${getSuccessColor(agent.successRate)}`}>
                {agent.successRate}%
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-[var(--v2-text-muted)] mb-0.5">Value Generated</div>
              <div className="font-semibold text-emerald-500 text-base">
                ${formatNumber(agent.moneySaved)}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
