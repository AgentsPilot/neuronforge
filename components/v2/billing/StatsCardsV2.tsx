'use client'

import React from 'react'

interface UserSubscription {
  balance: number
  total_spent: number
  status: string
  monthly_credits?: number
  storage_quota_mb?: number
  storage_used_mb?: number
  executions_quota?: number | null
  executions_used?: number
}

interface StatsCardsV2Props {
  userSubscription: UserSubscription | null
  rewardCredits: number
  boostPackCredits: number
  formatCredits: (tokens: number) => string
}

export default function StatsCardsV2({
  userSubscription,
  rewardCredits,
  boostPackCredits,
  formatCredits
}: StatsCardsV2Props) {
  const isActive = userSubscription?.status === 'active' || userSubscription?.status === 'past_due'

  // Format storage display
  const formatStorage = (mb: number) => {
    if (mb >= 1000) {
      return `${(mb / 1000).toFixed(1)} GB`
    }
    return `${mb} MB`
  }

  // Format executions display
  const formatExecutions = (used: number, quota: number | null | undefined) => {
    if (quota === null || quota === undefined) {
      return `${used.toLocaleString()} / ∞`
    }
    return `${used.toLocaleString()} / ${quota.toLocaleString()}`
  }

  const stats = [
    {
      label: 'Status',
      value: (() => {
        const status = userSubscription?.status || 'inactive'
        return status.charAt(0).toUpperCase() + status.slice(1)
      })(),
      color: isActive ? 'text-green-600 dark:text-green-400' : 'text-[var(--v2-text-primary)]'
    },
    {
      label: 'Available',
      value: formatCredits(userSubscription?.balance || 0),
      color: 'text-[var(--v2-text-primary)]'
    },
    {
      label: 'Monthly',
      value: isActive ? (userSubscription?.monthly_credits || 0).toLocaleString() : '0',
      color: 'text-[var(--v2-text-primary)]'
    },
    {
      label: 'Boost Packs',
      value: formatCredits(boostPackCredits),
      color: 'text-[var(--v2-text-primary)]'
    },
    {
      label: 'Rewards',
      value: formatCredits(rewardCredits),
      color: 'text-[var(--v2-text-primary)]'
    },
    {
      label: 'Used',
      value: formatCredits(userSubscription?.total_spent || 0),
      color: 'text-[var(--v2-text-primary)]'
    },
    {
      label: 'Storage',
      value: formatStorage(userSubscription?.storage_used_mb || 0) + ' / ' + formatStorage(userSubscription?.storage_quota_mb || 1000),
      color: 'text-[var(--v2-text-primary)]'
    },
    {
      label: 'Executions',
      value: formatExecutions(userSubscription?.executions_used || 0, userSubscription?.executions_quota),
      color: 'text-[var(--v2-text-primary)]'
    }
  ]

  return (
    <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-4"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        {stats.map((stat, index) => (
          <div key={index} className="text-center">
            <div className="text-xs text-[var(--v2-text-muted)] mb-1">{stat.label}</div>
            <div className={`text-sm lg:text-base font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
