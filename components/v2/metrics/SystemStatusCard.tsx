'use client'

import React from 'react'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'

interface SystemStatusCardProps {
  status: 'healthy' | 'warning' | 'critical'
  message: string
}

export function SystemStatusCard({ status, message }: SystemStatusCardProps) {
  const statusConfig = {
    healthy: {
      icon: CheckCircle2,
      label: 'Healthy',
      iconColor: 'text-[var(--v2-success)]',
      bgColor: 'bg-gradient-to-br from-green-500/10 to-emerald-500/10',
      borderColor: 'border-[var(--v2-success)]/20'
    },
    warning: {
      icon: AlertTriangle,
      label: 'Warning',
      iconColor: 'text-yellow-500',
      bgColor: 'bg-gradient-to-br from-yellow-500/10 to-orange-500/10',
      borderColor: 'border-yellow-500/20'
    },
    critical: {
      icon: XCircle,
      label: 'Critical',
      iconColor: 'text-[var(--v2-error)]',
      bgColor: 'bg-gradient-to-br from-red-500/10 to-rose-500/10',
      borderColor: 'border-[var(--v2-error)]/20'
    }
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <div className={`rounded-lg p-4 border ${config.borderColor} ${config.bgColor} transition-all duration-200`}>
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${config.bgColor}`}>
          <Icon className={`w-5 h-5 ${config.iconColor} flex-shrink-0`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[var(--v2-text-muted)]">System Status</div>
          <div className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {config.label}
          </div>
          <div className="text-xs text-[var(--v2-text-muted)] mt-0.5 line-clamp-1">
            {message}
          </div>
        </div>
      </div>
    </div>
  )
}
