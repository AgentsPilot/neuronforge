'use client'

import React from 'react'

interface UserSubscription {
  balance: number
  total_spent: number
  status: string
  monthly_credits?: number
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
    }
  ]

  return (
    <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-4"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((stat, index) => (
          <div key={index} className="text-center">
            <div className="text-xs text-[var(--v2-text-muted)] mb-1">{stat.label}</div>
            <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
