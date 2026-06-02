/**
 * @deprecated Unused/unrendered as of 2026-06-02 — superseded by the CalibrationSetup UI.
 * Slated for removal pending sign-off. See docs/Calibration/CALIBRATION_OVERVIEW.md § Dead Code / Cleanup Backlog.
 *
 * WorkflowHealthCard - Display workflow complexity and calibration health metrics
 *
 * Shows complexity score, step breakdown, and calibration history
 */

'use client'

import React from 'react'
import { Card } from '@/components/v2/ui/card'
import { Activity, CheckCircle2, Zap, GitBranch, Shuffle, XCircle } from 'lucide-react'
import { calculateWorkflowComplexity, wasFirstExecutionSuccessful } from '@/lib/utils/calibrationMetrics'

interface WorkflowHealthCardProps {
  workflowSteps: any[]
  autoCalibration?: {
    iterations: number
    autoFixesApplied: number
    message?: string
  }
  isCalibrated?: boolean
}

function getComplexityLabel(score: number): { label: string; color: string } {
  if (score <= 3) {
    return { label: 'Low', color: 'text-green-600 dark:text-green-400' }
  } else if (score <= 6) {
    return { label: 'Medium', color: 'text-blue-600 dark:text-blue-400' }
  } else {
    return { label: 'High', color: 'text-amber-600 dark:text-amber-400' }
  }
}

function countStepTypes(steps: any[]): {
  total: number
  actions: number
  transforms: number
  parallels: number
  llmDecisions: number
  conditionals: number
} {
  let total = 0
  let actions = 0
  let transforms = 0
  let parallels = 0
  let llmDecisions = 0
  let conditionals = 0

  function count(stepArray: any[]) {
    stepArray.forEach(step => {
      total++

      switch (step.type) {
        case 'action':
          actions++
          break
        case 'transform':
          transforms++
          break
        case 'parallel':
          parallels++
          break
        case 'llm_decision':
          llmDecisions++
          break
      }

      // Check for conditionals (has branches)
      if (step.branches) {
        conditionals++
      }

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

  return { total, actions, transforms, parallels, llmDecisions, conditionals }
}

export function WorkflowHealthCard({
  workflowSteps,
  autoCalibration,
  isCalibrated = false
}: WorkflowHealthCardProps) {
  const complexityScore = calculateWorkflowComplexity(workflowSteps)
  const { label: complexityLabel, color: complexityColor } = getComplexityLabel(complexityScore)
  const stepCounts = countStepTypes(workflowSteps)

  const firstExecSuccessful = autoCalibration
    ? wasFirstExecutionSuccessful(autoCalibration.iterations, autoCalibration.autoFixesApplied)
    : false

  return (
    <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[var(--v2-primary)]" />
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
            Workflow Health
          </h3>
        </div>

        {/* Complexity Score */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--v2-text-secondary)]">
              Complexity:
            </span>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold ${complexityColor}`}>
                {complexityLabel}
              </span>
              <span className="text-sm text-[var(--v2-text-secondary)]">
                ({complexityScore}/10)
              </span>
            </div>
          </div>

          {/* Step Type Breakdown */}
          <div className="grid grid-cols-2 gap-2 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg">
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--v2-text-secondary)]" />
              <span className="text-[var(--v2-text-secondary)]">
                <span className="font-semibold text-[var(--v2-text-primary)]">{stepCounts.total}</span> total steps
              </span>
            </div>

            {stepCounts.actions > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Zap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{stepCounts.actions}</span> actions
                </span>
              </div>
            )}

            {stepCounts.transforms > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Shuffle className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                <span className="text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{stepCounts.transforms}</span> transforms
                </span>
              </div>
            )}

            {stepCounts.parallels > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <GitBranch className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                <span className="text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{stepCounts.parallels}</span> parallel
                </span>
              </div>
            )}

            {stepCounts.conditionals > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <GitBranch className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{stepCounts.conditionals}</span> conditionals
                </span>
              </div>
            )}

            {stepCounts.llmDecisions > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Activity className="w-3.5 h-3.5 text-pink-600 dark:text-pink-400" />
                <span className="text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{stepCounts.llmDecisions}</span> LLM decisions
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Calibration History */}
        {autoCalibration && (
          <div className="space-y-3 pt-3 border-t border-[var(--v2-border)]">
            <h4 className="text-sm font-medium text-[var(--v2-text-secondary)]">
              Calibration History:
            </h4>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-[var(--v2-primary)]" />
                <span className="text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">
                    {autoCalibration.iterations}
                  </span>{' '}
                  {autoCalibration.iterations === 1 ? 'iteration' : 'iterations'} to converge
                </span>
              </div>

              {autoCalibration.autoFixesApplied > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Zap className="w-4 h-4 text-[var(--v2-success)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    <span className="font-semibold text-[var(--v2-text-primary)]">
                      {autoCalibration.autoFixesApplied}
                    </span>{' '}
                    {autoCalibration.autoFixesApplied === 1 ? 'issue' : 'issues'} auto-fixed
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                {firstExecSuccessful ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                ) : (
                  <XCircle className="w-4 h-4 text-[var(--v2-warning)]" />
                )}
                <span className="text-[var(--v2-text-secondary)]">
                  First execution: {firstExecSuccessful ? 'Perfect' : 'Needed fixes'}
                </span>
              </div>

              {isCalibrated && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    Workflow calibrated successfully
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
