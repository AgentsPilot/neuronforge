/**
 * CalibrationStory - Unified calibration narrative for non-technical users
 *
 * Tells the complete story of calibration in a flowing, easy-to-understand format:
 * 1. Overall result (status hero section)
 * 2. What happened during calibration (step-by-step story)
 * 3. Workflow health post-calibration (trust indicators)
 */

'use client'

import React from 'react'
import { Card } from '@/components/v2/ui/card'
import { CheckCircle2, AlertCircle, Zap, Activity, Sparkles } from 'lucide-react'
import { pluginList } from '@/lib/plugins/pluginList'
import { Database } from 'lucide-react'

interface CalibrationStoryProps {
  // Quality metrics
  qualityScore: number
  issuesFound: number
  issuesRemaining: number
  stepsFailed: number
  autoFixesApplied?: number

  // Execution summary
  executionSummary?: {
    data_sources_accessed?: Array<{ plugin: string; action: string; count: number; description: string }>
    data_written?: Array<{ plugin: string; action: string; count: number; description: string }>
    plugins_used?: Array<{ plugin: string; action: string; capability: string; count: number; description: string }>
    items_processed?: number
    items_filtered?: number
    items_delivered?: number
  }

  // Workflow health
  workflowSteps: any[]
  autoCalibration?: {
    iterations: number
    autoFixesApplied: number
    message?: string
  }
  isCalibrated?: boolean
}

// Get plugin info dynamically (no hardcoding)
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

// Calculate workflow complexity for health assessment
function calculateComplexity(steps: any[]): number {
  let score = 0

  function count(stepArray: any[]) {
    stepArray.forEach(step => {
      score++ // Each step adds to complexity

      if (step.type === 'parallel') score += 1
      if (step.type === 'llm_decision') score += 2
      if (step.branches) score += 1

      // Recurse into nested steps
      if (step.steps && Array.isArray(step.steps)) {
        count(step.steps)
      }

      // Recurse into branches
      if (step.branches) {
        Object.values(step.branches).forEach((branch: any) => {
          if (branch.steps && Array.isArray(branch.steps)) {
            count(branch.steps)
          }
        })
      }
    })
  }

  count(steps)
  return Math.min(10, Math.ceil(score / 2))
}

export function CalibrationStory({
  qualityScore,
  issuesFound,
  issuesRemaining,
  stepsFailed,
  autoFixesApplied = 0,
  executionSummary,
  workflowSteps,
  autoCalibration,
  isCalibrated = false
}: CalibrationStoryProps) {
  const isPerfect = qualityScore === 100
  const isExcellent = qualityScore >= 95
  const complexity = calculateComplexity(workflowSteps)
  const complexityLabel = complexity <= 3 ? 'Simple' : complexity <= 6 ? 'Moderate' : 'Complex'

  // Extract operations from execution summary
  const operations = executionSummary?.plugins_used?.length ? executionSummary.plugins_used : [
    ...(executionSummary?.data_sources_accessed?.map(s => ({ ...s, capability: 'read' })) || []),
    ...(executionSummary?.data_written?.map(w => ({ ...w, capability: 'write' })) || [])
  ]

  // Build story steps
  const storySteps: string[] = []
  operations.forEach(op => {
    const { name } = getPluginInfo(op.plugin)
    if (op.description) {
      storySteps.push(`${name}: ${op.description}`)
    }
  })

  // Extract execution stats
  const itemsProcessed = executionSummary?.items_processed || 0
  const itemsDelivered = executionSummary?.items_delivered || 0
  const pluginsUsed = new Set(operations.map(op => op.plugin)).size
  const totalSteps = workflowSteps.length

  return (
    <div className="space-y-4">
      {/* SECTION 1: RESULT HERO - Overall status at a glance */}
      <Card className="!p-5 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200 dark:border-green-800">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-green-900 dark:text-green-100">
              Test Complete
            </h2>
            <p className="text-sm text-green-800 dark:text-green-200">
              Your workflow has been tested and is ready to use.
            </p>
          </div>
        </div>
      </Card>

      {/* SECTION 2: THE STORY - What happened during calibration */}
      {storySteps.length > 0 && (
        <Card className="!p-4 border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[var(--v2-primary)]" />
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                What Happened
              </h3>
            </div>

            <div className="space-y-2">
              {storySteps.map((step, index) => (
                <div key={index} className="flex items-start gap-2 p-2.5 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--v2-primary)] text-white text-xs font-semibold flex-shrink-0">
                    {index + 1}
                  </div>
                  <p className="text-sm text-[var(--v2-text-secondary)] flex-1">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* SECTION 3: WORKFLOW HEALTH - Trust indicators post-calibration */}
      <Card className="!p-4 border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--v2-primary)]" />
            <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
              Workflow Health
            </h3>
          </div>

          {/* Health Indicators Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Complexity */}
            <div className="p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs text-[var(--v2-text-secondary)]">Complexity</span>
                <span className={`text-sm font-semibold ${
                  complexity <= 3 ? 'text-green-600 dark:text-green-400' :
                  complexity <= 6 ? 'text-blue-600 dark:text-blue-400' :
                  'text-amber-600 dark:text-amber-400'
                }`}>
                  {complexityLabel}
                </span>
              </div>
              <p className="text-xs text-[var(--v2-text-secondary)]">
                {complexity <= 3 ? 'Easy to maintain and debug' :
                 complexity <= 6 ? 'Manageable workflow structure' :
                 'Advanced workflow with multiple steps'}
              </p>
            </div>

            {/* Calibration Result */}
            <div className="p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs text-[var(--v2-text-secondary)]">Calibration</span>
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-xs text-[var(--v2-text-secondary)]">
                {autoCalibration?.iterations === 1
                  ? 'Worked perfectly on first try'
                  : `Converged in ${autoCalibration?.iterations || 1} ${autoCalibration?.iterations === 1 ? 'iteration' : 'iterations'}`}
              </p>
            </div>

            {/* Auto-fixes (if any) */}
            {autoFixesApplied > 0 && (
              <div className="p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs text-[var(--v2-text-secondary)]">Auto-Fixes</span>
                  <span className="text-sm font-semibold text-[var(--v2-primary)]">
                    {autoFixesApplied}
                  </span>
                </div>
                <p className="text-xs text-[var(--v2-text-secondary)]">
                  {autoFixesApplied === 1 ? 'Issue automatically resolved' : 'Issues automatically resolved'}
                </p>
              </div>
            )}

            {/* Production Ready */}
            <div className="p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs text-[var(--v2-text-secondary)]">Status</span>
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-xs text-[var(--v2-text-secondary)]">
                Ready for production use
              </p>
            </div>
          </div>

          {/* Bottom Summary */}
          {stepsFailed === 0 && (
            <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-green-800 dark:text-green-200">
                Your workflow completed without errors and is ready to automate your tasks.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
