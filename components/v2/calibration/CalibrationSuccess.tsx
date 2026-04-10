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
  Sparkles,
  Loader2
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
  onParameterizeWorkflow,
  onApproveForProduction,
  hasHardcodedValues = false,
  userDeclinedParameterization = false,
  onDeclineParameterization,
  calibrationInputValues = {},
  hasParameterizedWorkflow = false,
  configurationSaved = false,
  onSaveConfiguration
}: CalibrationSuccessProps) {
  const [isSaving, setIsSaving] = React.useState(false)

  const totalFixes = (fixesSummary.parameters || 0) +
                     (fixesSummary.parameterizations || 0) +
                     (fixesSummary.autoRepairs || 0)

  const hasInputValues = Object.keys(calibrationInputValues).length > 0

  const handleSaveConfiguration = async () => {
    if (!onSaveConfiguration) return

    setIsSaving(true)
    try {
      await onSaveConfiguration()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">

      {/* Success Header */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6 text-center">
        {/* Success Icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 bg-[var(--v2-success-bg)] border border-[var(--v2-success-border)]">
          <CheckCircle2 className="w-8 h-8 text-[var(--v2-success-icon)]" strokeWidth={2.5} />
        </div>

        {/* Success Message */}
        <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] mb-1">
          All Set!
        </h3>
        <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
          <span className="font-medium text-[var(--v2-text-primary)]">{agent.agent_name}</span> is ready to run
        </p>

        {/* Stats Summary */}
        {totalFixes > 0 && (
          <div className="inline-flex flex-wrap items-center justify-center gap-4 px-4 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg">
            {fixesSummary.parameters !== undefined && fixesSummary.parameters > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[var(--v2-primary)]" />
                <span className="text-xs text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{fixesSummary.parameters}</span> corrected
                </span>
              </div>
            )}
            {fixesSummary.parameterizations !== undefined && fixesSummary.parameterizations > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                <span className="text-xs text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{fixesSummary.parameterizations}</span> flexible
                </span>
              </div>
            )}
            {fixesSummary.autoRepairs !== undefined && fixesSummary.autoRepairs > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[var(--v2-secondary)]" />
                <span className="text-xs text-[var(--v2-text-secondary)]">
                  <span className="font-semibold text-[var(--v2-text-primary)]">{fixesSummary.autoRepairs}</span> auto-fixed
                </span>
              </div>
            )}
          </div>
        )}

        {/* No Issues Badge */}
        {totalFixes === 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--v2-success-bg)] border border-[var(--v2-success-border)] rounded-full">
            <Sparkles className="w-4 h-4 text-[var(--v2-success-icon)]" />
            <span className="text-xs font-semibold text-[var(--v2-success-text)]">
              Perfect Workflow
            </span>
          </div>
        )}
      </Card>

      {/* Step 0: Save Configuration (required if workflow has parameters and config not saved) */}
      {hasInputValues && hasParameterizedWorkflow && !configurationSaved && onSaveConfiguration && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/10">
              <CheckCircle2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                Save Configuration for Next Run
              </h3>
              <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
                Your workflow now has configurable parameters. Save the input values you provided during this calibration so they can be reused in your next calibration run.
              </p>
              <div className="bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg p-3">
                <p className="text-xs font-medium text-[var(--v2-text-primary)] mb-2">Input values to save:</p>
                <div className="space-y-1">
                  {Object.entries(calibrationInputValues).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="text-[var(--v2-text-secondary)]">{key}:</span>
                      <span className="font-mono text-[var(--v2-text-primary)] truncate max-w-[200px]">
                        {typeof value === 'string' ? value : JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveConfiguration}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving Configuration...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Save Configuration
              </>
            )}
          </button>

          <div className="mt-3 pt-3 border-t border-[var(--v2-border)]">
            <p className="text-xs text-[var(--v2-text-secondary)]">
              <span className="font-medium text-[var(--v2-text-primary)]">Why save?</span> These values will be automatically pre-filled in your next calibration run, saving you time. You can always change them later.
            </p>
          </div>
        </Card>
      )}

      {/* Step 1: Ask if user wants to parameterize (only if has hardcoded values and hasn't decided yet) */}
      {hasHardcodedValues && !userDeclinedParameterization && !agent.production_ready && onParameterizeWorkflow && onDeclineParameterization && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/10">
              <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                Make Your Workflow Configurable?
              </h3>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                Your workflow has some hardcoded values (like ranges, IDs, or settings). Would you like to convert them to input parameters so you can easily change them without editing the workflow?
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={onParameterizeWorkflow}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Sparkles className="w-4 h-4" />
              Yes, Parameterize
            </button>
            <button
              onClick={onDeclineParameterization}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              No, Continue As-Is
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-[var(--v2-border)]">
            <p className="text-xs text-[var(--v2-text-secondary)]">
              <span className="font-medium text-[var(--v2-text-primary)]">Note:</span> Parameterizing makes your workflow reusable across different scenarios (e.g., test vs. production). You can always add parameters later.
            </p>
          </div>
        </Card>
      )}

      {/* Step 2: Show Approve button (after user declined parameterization OR no hardcoded values OR after parameterization complete) */}
      {!agent.production_ready && onApproveForProduction && (userDeclinedParameterization || !hasHardcodedValues) && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6">
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-2">
            Ready to Go Live?
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
            Your workflow has been tested and is ready for production. Click below to approve this agent and make it available for live use.
          </p>

          <button
            onClick={onApproveForProduction}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <CheckCircle2 className="w-4 h-4" />
            Approve for Production
          </button>

          <div className="mt-4 pt-4 border-t border-[var(--v2-border)]">
            <p className="text-xs text-[var(--v2-text-secondary)]">
              <span className="font-medium text-[var(--v2-text-primary)]">What happens next:</span> The agent will be marked as production-ready and you'll be guided through activating it.
            </p>
          </div>
        </Card>
      )}

      {/* Already production ready - just show go to agent */}
      {agent.production_ready && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6">
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-2">
            Agent Approved!
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
            This agent is production-ready. Return to your agent page to activate it.
          </p>

          <button
            onClick={onRunAgent}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <CheckCircle2 className="w-4 h-4" />
            Go to Agent
          </button>
        </Card>
      )}

    </div>
  )
}
