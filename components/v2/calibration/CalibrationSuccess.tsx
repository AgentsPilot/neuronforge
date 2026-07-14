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
  Loader2,
  Lightbulb,
  X
} from 'lucide-react'
import type { PassSuggestion } from '@/lib/calibration/finishGate'

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
  hasHardcodedValues?: boolean // Whether workflow has hardcoded values
  userDeclinedParameterization?: boolean // User said NO to parameterization
  onDeclineParameterization?: () => void // User clicks NO to parameterization
  calibrationInputValues?: Record<string, any> // Input values from calibration run
  hasParameterizedWorkflow?: boolean // Whether workflow now has parameters after fixes
  configurationSaved?: boolean // Whether configuration has been saved
  onSaveConfiguration?: () => Promise<void> // Callback to save configuration
  // A3 (UI half): optional, non-blocking cosmetic suggestions surfaced on a
  // passed-with-suggestions run. Sourced from the verdict result (never
  // re-derived). Empty for a clean pass → the "Perfect Workflow" badge shows.
  optionalSuggestions?: PassSuggestion[]
}

export function CalibrationSuccess({
  agent,
  fixesSummary = {},
  onRunAgent,
  onParameterizeWorkflow,
  hasHardcodedValues = false,
  userDeclinedParameterization = false,
  onDeclineParameterization,
  calibrationInputValues = {},
  hasParameterizedWorkflow = false,
  configurationSaved = false,
  onSaveConfiguration,
  optionalSuggestions = []
}: CalibrationSuccessProps) {
  const [isSaving, setIsSaving] = React.useState(false)
  const [suggestionsDismissed, setSuggestionsDismissed] = React.useState(false)

  const totalFixes = (fixesSummary.parameters || 0) +
                     (fixesSummary.parameterizations || 0) +
                     (fixesSummary.autoRepairs || 0)

  // A3: a passing run may still carry provably-cosmetic, OPTIONAL suggestions
  // (e.g. "the value 500 could be a reusable parameter"). Surface them as
  // non-blocking notes — the run is passed, so the user can finish regardless.
  const hasSuggestions = optionalSuggestions.length > 0

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

        {/* No Issues Badge — only a genuinely clean pass (no optional suggestions) */}
        {totalFixes === 0 && !hasSuggestions && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--v2-success-bg)] border border-[var(--v2-success-border)] rounded-full">
            <Sparkles className="w-4 h-4 text-[var(--v2-success-icon)]" />
            <span className="text-xs font-semibold text-[var(--v2-success-text)]">
              Perfect Workflow
            </span>
          </div>
        )}

        {/* Passed-with-suggestions badge — the run passed AND has optional notes */}
        {hasSuggestions && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--v2-success-bg)] border border-[var(--v2-success-border)] rounded-full">
            <CheckCircle2 className="w-4 h-4 text-[var(--v2-success-icon)]" />
            <span className="text-xs font-semibold text-[var(--v2-success-text)]">
              Passed — {optionalSuggestions.length} optional suggestion{optionalSuggestions.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </Card>

      {/* A3: Optional, non-blocking cosmetic suggestions (dismissible). Visually
          distinct from a blocking issue (info/amber, not red), and NEVER gates
          the finish — the run is passed. */}
      {hasSuggestions && !suggestionsDismissed && (
        <Card className="border-amber-500/30 bg-amber-500/5 !p-4 sm:!p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-500/10">
                <Lightbulb className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
                  Optional suggestion{optionalSuggestions.length === 1 ? '' : 's'}
                </h3>
                <p className="text-xs text-[var(--v2-text-secondary)]">
                  These are optional — your agent passed and is ready to run. You can act on them now or ignore them.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSuggestionsDismissed(true)}
              aria-label="Dismiss suggestions"
              className="flex-shrink-0 p-1 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <ul className="space-y-2">
            {optionalSuggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg p-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#F59E0B' }} />
                <div>
                  <p className="text-sm font-medium text-[var(--v2-text-primary)]">{s.title}</p>
                  {s.message && <p className="text-xs text-[var(--v2-text-secondary)] mt-0.5">{s.message}</p>}
                </div>
              </li>
            ))}
          </ul>

          {/* FIX 2: the card's copy offers "act on them now or ignore" — so it must
              render the ACT affordance, not just the dismiss (×). Reuse the EXISTING
              wired parameterization handler (opens AgentSetupWizard); no new flow.
              Shown whenever the action is available (a hardcode/parameterization
              suggestion → `onParameterizeWorkflow` provided). NOT gated on
              `production_ready`: a passing run sets production_ready=true, but the
              user may still choose to turn the value into a reusable parameter. A
              suggestion with no supported action simply has no `onParameterizeWorkflow`
              → the card stays informational (dismiss-only). Non-blocking. */}
          {onParameterizeWorkflow && (
            <button
              type="button"
              onClick={onParameterizeWorkflow}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Sparkles className="w-4 h-4" />
              Make it a reusable parameter
            </button>
          )}
        </Card>
      )}

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

      {/* Step 2: Show Go to Agent button (after user declined parameterization OR no hardcoded values OR after parameterization complete) */}
      {(userDeclinedParameterization || !hasHardcodedValues) && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-6">
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-2">
            Ready to Go!
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
            Your workflow has been calibrated and is ready for production. Return to your agent page to activate it.
          </p>

          <button
            onClick={onRunAgent}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <CheckCircle2 className="w-4 h-4" />
            Go to Agent Page
          </button>
        </Card>
      )}

    </div>
  )
}
