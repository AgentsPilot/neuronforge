'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, CheckCircle, DollarSign, ArrowRight, Crown, Award, Medal } from 'lucide-react'
import type { TopPerformer } from '@/types/system-health'

interface TopPerformersListProps {
  performers: TopPerformer[]
}

export function TopPerformersList({ performers }: TopPerformersListProps) {
  const router = useRouter()

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-500" />
      case 2:
        return <Award className="w-5 h-5 text-slate-400" />
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />
      default:
        return <span className="text-sm font-semibold text-[var(--v2-text-muted)]">{rank}</span>
    }
  }

  return (
    <div className="rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-4 h-4 text-yellow-500" />
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          Top Performers
        </h3>
      </div>

      {performers.length > 0 ? (
        <div className="space-y-2">
          {performers.map((performer) => (
            <button
              key={performer.agentId}
              onClick={() => router.push(`/v2/agents/${performer.agentId}`)}
              className="w-full p-3 rounded-lg bg-[var(--v2-background)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] hover:border-[var(--v2-primary)]/30 transition-all duration-200 text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0">
                  {getRankIcon(performer.rank)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--v2-text-primary)] truncate mb-1">
                    {performer.agentName}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1 text-green-500">
                      <CheckCircle className="w-3 h-3" />
                      <span>{performer.successRate}%</span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-500">
                      <span>{performer.totalRuns} runs</span>
                    </div>
                    <div className="flex items-center gap-1 text-emerald-500">
                      <DollarSign className="w-3 h-3" />
                      <span>${performer.moneySaved.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[var(--v2-text-muted)] group-hover:text-[var(--v2-primary)] group-hover:translate-x-1 transition-all flex-shrink-0" />
              </div>
            </button>
          ))}

          <button
            onClick={() => router.push('/v2/agent-list')}
            className="w-full py-3 text-sm text-[var(--v2-primary)] hover:text-[var(--v2-primary)]/80 font-medium transition-colors"
          >
            View All Agents →
          </button>
        </div>
      ) : (
        <div className="text-center py-8">
          <Trophy className="w-12 h-12 text-[var(--v2-text-muted)] mx-auto mb-3 opacity-50" />
          <p className="text-sm text-[var(--v2-text-muted)]">
            No top performers yet
          </p>
          <p className="text-xs text-[var(--v2-text-muted)] mt-1">
            Run agents to see performance metrics
          </p>
        </div>
      )}
    </div>
  )
}
