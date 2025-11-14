// components/v2/ui/stat-card.tsx
// V2 Stat Card for dashboard statistics

import * as React from 'react'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/design-system-v2'

export interface StatCardProps {
  title: string
  value: string | number
  change?: {
    value: number
    trend: 'up' | 'down'
  }
  icon?: LucideIcon
  gradient?: 'primary' | 'success' | 'warning' | 'error'
  className?: string
}

const gradientClasses = {
  primary: 'from-[#6366F1]/10 to-[#8B5CF6]/10',
  success: 'from-[#10B981]/10 to-[#059669]/10',
  warning: 'from-[#F59E0B]/10 to-[#D97706]/10',
  error: 'from-[#EF4444]/10 to-[#DC2626]/10',
}

const iconColors = {
  primary: 'text-[#6366F1]',
  success: 'text-[#10B981]',
  warning: 'text-[#F59E0B]',
  error: 'text-[#EF4444]',
}

export function StatCard({
  title,
  value,
  change,
  icon: Icon,
  gradient = 'primary',
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-gradient-to-br',
        gradientClasses[gradient],
        'rounded-[16px] p-6 border border-gray-100 dark:border-gray-800 transition-all hover:shadow-lg',
        className
      )}
    >
      <div className="flex items-start justify-between mb-4">
        {Icon && (
          <div className={cn(
            'p-3 rounded-[12px] bg-white dark:bg-slate-900 shadow-sm',
            iconColors[gradient]
          )}>
            <Icon className="h-6 w-6" />
          </div>
        )}
        {change && (
          <div className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold',
            change.trend === 'up'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
          )}>
            <span>{change.trend === 'up' ? '↑' : '↓'}</span>
            <span>{Math.abs(change.value)}%</span>
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
          {title}
        </p>
        <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {value}
        </p>
      </div>
    </div>
  )
}
