/**
 * ExecutionSummaryCard - Show what the workflow actually did during calibration
 *
 * Displays data sources accessed, data written, and processing statistics
 */

'use client'

import React from 'react'
import { Card } from '@/components/v2/ui/card'
import { Database } from 'lucide-react'
import { pluginList } from '@/lib/plugins/pluginList'

interface DataSource {
  plugin: string
  action: string
  count: number
  description: string
}

interface PluginOperation {
  plugin: string
  action: string
  capability: string
  count: number
  description: string
}

interface ExecutionSummaryCardProps {
  executionSummary?: {
    data_sources_accessed?: DataSource[]
    data_written?: DataSource[]
    plugins_used?: PluginOperation[]  // NEW: Unified plugin tracking with capabilities
    items_processed?: number
    items_filtered?: number
    items_delivered?: number
  }
}

// Dynamically get plugin info from pluginList
function getPluginInfo(pluginKey: string): { icon: React.ReactNode; name: string } {
  const plugin = pluginList.find(p => p.pluginKey.toLowerCase() === pluginKey.toLowerCase())

  if (plugin) {
    return {
      icon: plugin.icon,
      name: plugin.name
    }
  }

  // Fallback if plugin not found
  return {
    icon: <Database className="w-5 h-5 text-gray-600" />,
    name: pluginKey.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }
}

export function ExecutionSummaryCard({ executionSummary }: ExecutionSummaryCardProps) {
  if (!executionSummary) {
    return null
  }

  const {
    data_sources_accessed = [],
    data_written = [],
    plugins_used = [],  // NEW: Unified plugin tracking
    items_processed,
    items_delivered
  } = executionSummary

  // Debug logging to see what execution summary data we're receiving
  console.log('[ExecutionSummaryCard] Received execution_summary:', {
    data_sources_accessed,
    data_written,
    plugins_used,  // NEW
    items_processed,
    items_delivered
  })

  // Don't render if no meaningful data
  if (
    data_sources_accessed.length === 0 &&
    data_written.length === 0 &&
    plugins_used.length === 0 &&
    !items_processed &&
    !items_delivered
  ) {
    return null
  }

  // Use plugins_used if available (new unified tracking with capabilities)
  const operations = plugins_used.length > 0 ? plugins_used : [
    ...data_sources_accessed.map(s => ({ ...s, capability: 'read' })),
    ...data_written.map(w => ({ ...w, capability: 'write' }))
  ]

  // Build simple flow description
  const descriptions: string[] = []

  operations.forEach(op => {
    const { name } = getPluginInfo(op.plugin)
    if (op.description) {
      descriptions.push(`${name}: ${op.description}`)
    }
  })

  return (
    <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">What Happened</h3>

        {/* Simple list of what the workflow did */}
        <div className="space-y-2">
          {descriptions.map((desc, index) => (
            <div key={index} className="flex items-start gap-2 text-sm text-[var(--v2-text-secondary)]">
              <span className="text-[var(--v2-text-primary)] font-medium">{index + 1}.</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
