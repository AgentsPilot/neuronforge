'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, XCircle, AlertTriangle, CheckCircle, ChevronRight } from 'lucide-react'
import type { SystemAlerts, TimeRange } from '@/types/system-health'

interface SystemAlertsCardProps {
  alerts: SystemAlerts
  timeRange: TimeRange
}

export function SystemAlertsCard({ alerts, timeRange }: SystemAlertsCardProps) {
  const router = useRouter()
  const [expandedSection, setExpandedSection] = useState<'failed' | 'warnings' | null>(null)

  const timeRangeLabels: Record<TimeRange, string> = {
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    'all': 'All time'
  }

  const handleAgentClick = (agentId: string) => {
    router.push(`/v2/agents/${agentId}`)
  }

  return (
    <div className="rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-4 h-4 text-[#06B6D4]" />
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          System Alerts
        </h3>
        <span className="ml-auto text-xs text-[var(--v2-text-muted)]">
          {timeRangeLabels[timeRange]}
        </span>
      </div>

      <div className="space-y-2">
        {/* Failed Executions */}
        {alerts.failed.length > 0 ? (
          <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
            <button
              onClick={() => setExpandedSection(expandedSection === 'failed' ? null : 'failed')}
              className="w-full flex items-start justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {alerts.failed.length} Failed Execution{alerts.failed.length > 1 ? 's' : ''}
                  </div>
                  {alerts.failed.length > 0 && !expandedSection && (
                    <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                      {alerts.failed.slice(0, 2).map(f => f.agentName).join(', ')}
                      {alerts.failed.length > 2 && ` +${alerts.failed.length - 2} more`}
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight className={`w-3 h-3 text-[var(--v2-text-muted)] transition-transform ${expandedSection === 'failed' ? 'rotate-90' : ''}`} />
            </button>

            {expandedSection === 'failed' && (
              <div className="mt-3 space-y-2 pl-7">
                {alerts.failed.map((alert, index) => (
                  <button
                    key={index}
                    onClick={() => handleAgentClick(alert.agentId)}
                    className="w-full text-left p-2 rounded hover:bg-[var(--v2-surface-hover)] transition-colors"
                  >
                    <div className="text-sm font-medium text-[var(--v2-text-primary)]">
                      "{alert.agentName}" failed {alert.count} time{alert.count > 1 ? 's' : ''}
                    </div>
                    <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                      Last failure: {new Date(alert.lastFailedAt).toLocaleString()}
                    </div>
                    {alert.errorMessage && (
                      <div className="text-xs text-red-500/80 mt-1 truncate">
                        {alert.errorMessage}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Performance Warnings */}
        {alerts.warnings.length > 0 ? (
          <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-3">
            <button
              onClick={() => setExpandedSection(expandedSection === 'warnings' ? null : 'warnings')}
              className="w-full flex items-start justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {alerts.warnings.length} Performance Warning{alerts.warnings.length > 1 ? 's' : ''}
                  </div>
                  {alerts.warnings.length > 0 && !expandedSection && (
                    <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                      {alerts.warnings.slice(0, 2).map(w => w.agentName).join(', ')}
                      {alerts.warnings.length > 2 && ` +${alerts.warnings.length - 2} more`}
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight className={`w-3 h-3 text-[var(--v2-text-muted)] transition-transform ${expandedSection === 'warnings' ? 'rotate-90' : ''}`} />
            </button>

            {expandedSection === 'warnings' && (
              <div className="mt-3 space-y-2 pl-7">
                {alerts.warnings.map((warning, index) => (
                  <button
                    key={index}
                    onClick={() => handleAgentClick(warning.agentId)}
                    className="w-full text-left p-2 rounded hover:bg-[var(--v2-surface-hover)] transition-colors"
                  >
                    <div className="text-sm font-medium text-[var(--v2-text-primary)]">
                      "{warning.agentName}"
                    </div>
                    <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                      {warning.message}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Healthy Agents */}
        {alerts.healthyCount > 0 && (
          <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {alerts.healthyCount} Agent{alerts.healthyCount > 1 ? 's' : ''} Running Smoothly
                </div>
                <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                  No issues detected
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No Alerts State */}
        {alerts.failed.length === 0 && alerts.warnings.length === 0 && alerts.healthyCount === 0 && (
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <p className="text-[var(--v2-text-primary)] font-medium mb-1">All Systems Healthy</p>
            <p className="text-sm text-[var(--v2-text-muted)]">No issues or alerts to report</p>
          </div>
        )}
      </div>
    </div>
  )
}
