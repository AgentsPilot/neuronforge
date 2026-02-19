/**
 * CalibrationSuccess - Success state after fixes are tested and verified
 *
 * V2 theme design with proper:
 * - V2 Card components with hoverable effects
 * - V2 Button variants (primary, secondary)
 * - Clean typography and spacing
 * - Clear action hierarchy
 */

'use client'

import React from 'react'
import { Card } from '@/components/v2/ui/card'
import {
  CheckCircle2,
  Sparkles
} from 'lucide-react'

interface CalibrationSuccessProps {
  agent: {
    id: string
    agent_name: string
    production_ready?: boolean
  }
  fixesSummary?: {
    parameters?: number
    parameterizations?: number
    autoRepairs?: number
  }
  onRunAgent: () => void
  onParameterizeWorkflow?: () => void // Optional callback to open parameterization wizard
  onApproveForProduction?: () => void // Callback to mark agent as production-ready
  hasHardcodedValues?: boolean // Whether workflow has hardcoded values
  userDeclinedParameterization?: boolean // User said NO to parameterization
  onDeclineParameterization?: () => void // User clicks NO to parameterization
  calibrationInputValues?: Record<string, any> // Input values from calibration run
  hasParameterizedWorkflow?: boolean // Whether workflow now has parameters after fixes
  configurationSaved?: boolean // Whether configuration has been saved
  onSaveConfiguration?: () => Promise<void> // Callback to save configuration
}

export function CalibrationSuccess({
  agent,
  fixesSummary = {},
  onRunAgent,
  onApproveForProduction
}: CalibrationSuccessProps) {
  const totalFixes = (fixesSummary.parameters || 0) +
                     (fixesSummary.parameterizations || 0) +
                     (fixesSummary.autoRepairs || 0)

  console.log('[CalibrationSuccess] Render with:', {
    hasAgent: !!agent,
    productionReady: agent?.production_ready,
    hasApproveCallback: !!onApproveForProduction,
    shouldShowButton: !!onApproveForProduction && !agent?.production_ready
  })

  return (
    <div className="max-w-2xl mx-auto">
      {/* Simplified Success Card */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-8 text-center">
        <div className="space-y-6">
          {/* Success Icon */}
          <div className="w-20 h-20 mx-auto rounded-full bg-[var(--v2-success)]/10 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-[var(--v2-success)]" strokeWidth={2.5} />
          </div>

          {/* Success Message */}
          <div>
            <h3 className="text-3xl font-bold text-[var(--v2-text-primary)] mb-2">
              All Set!
            </h3>
            <p className="text-lg text-[var(--v2-text-secondary)]">
              Your workflow is ready to use
            </p>
          </div>

          {/* Stats Summary */}
          {totalFixes > 0 && (
            <div className="inline-flex flex-col gap-2">
              <p className="text-sm text-[var(--v2-text-secondary)]">What we did:</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {fixesSummary.autoRepairs !== undefined && fixesSummary.autoRepairs > 0 && (
                  <span className="text-sm text-[var(--v2-text-primary)]">
                    ✓ Fixed <span className="font-semibold">{fixesSummary.autoRepairs}</span> issues automatically
                  </span>
                )}
                {fixesSummary.parameters !== undefined && fixesSummary.parameters > 0 && (
                  <span className="text-sm text-[var(--v2-text-primary)]">
                    ✓ Applied <span className="font-semibold">{fixesSummary.parameters}</span> {fixesSummary.parameters === 1 ? 'fix' : 'fixes'}
                  </span>
                )}
                {fixesSummary.parameterizations !== undefined && fixesSummary.parameterizations > 0 && (
                  <span className="text-sm text-[var(--v2-text-primary)]">
                    ✓ Made <span className="font-semibold">{fixesSummary.parameterizations}</span> {fixesSummary.parameterizations === 1 ? 'value' : 'values'} flexible
                  </span>
                )}
              </div>
            </div>
          )}

          {/* No Issues */}
          {totalFixes === 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-success)]/10 border border-[var(--v2-success)]/20 rounded-full">
              <Sparkles className="w-5 h-5 text-[var(--v2-success)]" />
              <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                No issues found
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Approve for Production Button - Only show if not already production ready */}
            {onApproveForProduction && !agent.production_ready && (
              <button
                onClick={onApproveForProduction}
                className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 px-8 py-4 bg-[var(--v2-success)] text-white hover:opacity-90 transition-opacity font-semibold text-lg shadow-lg rounded-xl"
              >
                <CheckCircle2 className="w-6 h-6" />
                Approve for Production
              </button>
            )}

            {/* Done Button */}
            <button
              onClick={onRunAgent}
              className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 px-8 py-4 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-semibold text-lg shadow-lg rounded-xl"
            >
              <CheckCircle2 className="w-6 h-6" />
              Done
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
