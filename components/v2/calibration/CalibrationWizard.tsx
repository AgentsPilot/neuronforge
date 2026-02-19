/**
 * CalibrationWizard - Simplified step-by-step issue resolution
 *
 * Shows one issue at a time with plain language and clear actions.
 * Auto-skips issues that can be fixed automatically.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/v2/ui/card'
import { ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react'
import type { CollectedIssue } from '@/lib/pilot/types'
import type { UserFixes } from './CalibrationDashboard'

interface CalibrationWizardProps {
  issues: CollectedIssue[]
  fixes: UserFixes
  onFixesChange: (fixes: UserFixes) => void
  onComplete: () => void
  onBack?: () => void
}

export function CalibrationWizard({
  issues,
  fixes,
  onFixesChange,
  onComplete,
  onBack
}: CalibrationWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)

  // Filter issues that need user input (skip auto-fixable ones)
  const userIssues = issues.filter(issue => {
    // Skip data shape mismatches (auto-normalized)
    if (issue.category === 'data_shape_mismatch') return false

    // Skip issues that don't require user input
    if (!issue.requiresUserInput) return false

    // Show only issues that need user decision
    return ['parameter_error', 'hardcode_detected', 'logic_error'].includes(issue.category)
  })

  const totalSteps = userIssues.length
  const currentIssue = userIssues[currentStep]
  const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 100

  // Auto-complete if no issues need user input
  useEffect(() => {
    if (totalSteps === 0) {
      onComplete()
    }
  }, [totalSteps, onComplete])

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      onComplete()
    }
  }

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    } else if (onBack) {
      onBack()
    }
  }

  const handleFixChange = (issueId: string, fix: any) => {
    const issue = currentIssue
    if (!issue) return

    if (issue.category === 'parameter_error') {
      onFixesChange({
        ...fixes,
        parameters: {
          ...fixes.parameters,
          [issueId]: fix.value
        }
      })
    } else if (issue.category === 'hardcode_detected') {
      onFixesChange({
        ...fixes,
        parameterizations: {
          ...fixes.parameterizations,
          [issueId]: fix
        }
      })
    } else if (issue.category === 'logic_error') {
      onFixesChange({
        ...fixes,
        logicFixes: {
          ...fixes.logicFixes,
          [issueId]: fix
        }
      })
    }
  }

  // Check if current step is complete
  const isStepComplete = () => {
    if (!currentIssue) return false

    if (currentIssue.category === 'parameter_error') {
      const value = fixes.parameters?.[currentIssue.id]
      return value !== undefined && value !== ''
    } else if (currentIssue.category === 'hardcode_detected') {
      return fixes.parameterizations?.[currentIssue.id]?.approved !== undefined
    } else if (currentIssue.category === 'logic_error') {
      return fixes.logicFixes?.[currentIssue.id]?.selectedOption !== undefined
    }

    return false
  }

  if (!currentIssue) {
    return null
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--v2-text-secondary)]">
            Step {currentStep + 1} of {totalSteps}
          </span>
          <span className="font-medium text-[var(--v2-primary)]">
            {Math.round(progress)}% Complete
          </span>
        </div>
        <div className="h-2 bg-[var(--v2-surface-hover)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--v2-primary)] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Issue Card */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] p-8">
        <WizardIssueCard
          issue={currentIssue}
          fixes={fixes}
          onFixChange={handleFixChange}
        />
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={handlePrevious}
          className="flex items-center gap-2 px-4 py-2.5 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors rounded-lg"
        >
          <ArrowLeft className="w-4 h-4" />
          {currentStep === 0 ? 'Back' : 'Previous'}
        </button>

        <button
          onClick={handleNext}
          disabled={!isStepComplete()}
          className="flex items-center gap-2 px-6 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity rounded-lg font-medium"
        >
          {currentStep === totalSteps - 1 ? 'Apply Fixes' : 'Next'}
          {currentStep === totalSteps - 1 ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * WizardIssueCard - Simplified single-issue display
 */
function WizardIssueCard({
  issue,
  fixes,
  onFixChange
}: {
  issue: CollectedIssue
  fixes: UserFixes
  onFixChange: (issueId: string, fix: any) => void
}) {
  if (issue.category === 'parameter_error') {
    return <ParameterWizardCard issue={issue} fixes={fixes} onFixChange={onFixChange} />
  }

  if (issue.category === 'hardcode_detected') {
    return <HardcodeWizardCard issue={issue} fixes={fixes} onFixChange={onFixChange} />
  }

  if (issue.category === 'logic_error') {
    return <LogicWizardCard issue={issue} fixes={fixes} onFixChange={onFixChange} />
  }

  return null
}

/**
 * ParameterWizardCard - Simple question with input
 */
function ParameterWizardCard({
  issue,
  fixes,
  onFixChange
}: {
  issue: CollectedIssue
  fixes: UserFixes
  onFixChange: (issueId: string, fix: any) => void
}) {
  const paramName = issue.suggestedFix?.action?.parameterName || 'value'
  const currentValue = fixes.parameters?.[issue.id] || ''
  const stepName = issue.affectedSteps[0]?.friendlyName || 'Unknown step'

  // Get friendly parameter name
  const friendlyParamName = paramName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l: string) => l.toUpperCase())

  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="w-16 h-16 mx-auto rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center">
        <span className="text-3xl">📝</span>
      </div>

      {/* Question */}
      <div className="text-center space-y-2">
        <h3 className="text-2xl font-semibold text-[var(--v2-text-primary)]">
          {friendlyParamName}
        </h3>
        <p className="text-[var(--v2-text-secondary)]">
          In: {stepName}
        </p>
      </div>

      {/* Explanation */}
      <p className="text-center text-[var(--v2-text-secondary)] max-w-md mx-auto">
        {issue.message}
      </p>

      {/* Input */}
      <div className="max-w-md mx-auto">
        <input
          type="text"
          value={currentValue}
          onChange={(e) => onFixChange(issue.id, { value: e.target.value })}
          placeholder={`Enter ${paramName}...`}
          className="w-full px-4 py-3 text-lg rounded-lg border-2 border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)] transition-colors"
          autoFocus
        />
      </div>
    </div>
  )
}

/**
 * HardcodeWizardCard - Binary choice for parameterization
 */
function HardcodeWizardCard({
  issue,
  fixes,
  onFixChange
}: {
  issue: CollectedIssue
  fixes: UserFixes
  onFixChange: (issueId: string, fix: any) => void
}) {
  const suggestedParamName = issue.suggestedFix?.action?.paramName || 'value'
  const suggestedDefault = issue.suggestedFix?.action?.defaultValue || ''
  const hardcodedValue = issue.suggestedFix?.action?.hardcodedValue || issue.technicalDetails
  const stepName = issue.affectedSteps[0]?.friendlyName || 'Unknown step'

  const currentChoice = fixes.parameterizations?.[issue.id]?.approved

  const displayValue = hardcodedValue.length > 80
    ? hardcodedValue.substring(0, 80) + '...'
    : hardcodedValue

  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="w-16 h-16 mx-auto rounded-full bg-[var(--v2-warning)]/10 flex items-center justify-center">
        <span className="text-3xl">🔧</span>
      </div>

      {/* Question */}
      <div className="text-center space-y-2">
        <h3 className="text-2xl font-semibold text-[var(--v2-text-primary)]">
          {stepName}
        </h3>
        <p className="text-sm text-[var(--v2-text-secondary)]">
          Fixed Value Setting
        </p>
      </div>

      {/* Current Value Display */}
      <div className="max-w-md mx-auto p-4 bg-[var(--v2-surface-hover)] rounded-lg">
        <p className="text-xs text-[var(--v2-text-tertiary)] mb-2">Currently uses:</p>
        <code className="text-sm font-mono text-[var(--v2-text-primary)] break-all">
          {displayValue}
        </code>
      </div>

      {/* Question */}
      <p className="text-center text-lg text-[var(--v2-text-primary)] font-medium max-w-md mx-auto">
        Should users be able to choose their own value?
      </p>

      {/* Choices */}
      <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
        <button
          onClick={() => onFixChange(issue.id, {
            approved: true,
            paramName: suggestedParamName,
            defaultValue: suggestedDefault
          })}
          className={`p-6 rounded-xl border-2 transition-all ${
            currentChoice === true
              ? 'border-[var(--v2-success)] bg-[var(--v2-success)]/10'
              : 'border-[var(--v2-border)] hover:border-[var(--v2-success)]'
          }`}
        >
          <div className="text-center space-y-2">
            <div className="text-3xl">✓</div>
            <p className="font-semibold text-[var(--v2-text-primary)]">Yes, flexible</p>
            <p className="text-xs text-[var(--v2-text-secondary)]">Let users customize</p>
          </div>
        </button>

        <button
          onClick={() => onFixChange(issue.id, {
            approved: false,
            paramName: suggestedParamName,
            defaultValue: suggestedDefault
          })}
          className={`p-6 rounded-xl border-2 transition-all ${
            currentChoice === false
              ? 'border-[var(--v2-text-secondary)] bg-[var(--v2-surface-hover)]'
              : 'border-[var(--v2-border)] hover:border-[var(--v2-text-secondary)]'
          }`}
        >
          <div className="text-center space-y-2">
            <div className="text-3xl">🔒</div>
            <p className="font-semibold text-[var(--v2-text-primary)]">No, keep fixed</p>
            <p className="text-xs text-[var(--v2-text-secondary)]">Use this value always</p>
          </div>
        </button>
      </div>
    </div>
  )
}

/**
 * LogicWizardCard - Yes/No question for logic issues
 */
function LogicWizardCard({
  issue,
  fixes,
  onFixChange
}: {
  issue: CollectedIssue
  fixes: UserFixes
  onFixChange: (issueId: string, fix: any) => void
}) {
  const issueType = (issue.suggestedFix as any)?.type || 'duplicate_data_routing'
  const currentChoice = fixes.logicFixes?.[issue.id]?.selectedOption

  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="w-16 h-16 mx-auto rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center">
        <span className="text-3xl">⚡</span>
      </div>

      {/* Title */}
      <div className="text-center space-y-2">
        <h3 className="text-2xl font-semibold text-[var(--v2-text-primary)]">
          {issue.title}
        </h3>
      </div>

      {/* Explanation */}
      <p className="text-center text-[var(--v2-text-secondary)] max-w-md mx-auto text-lg">
        {issue.message}
      </p>

      {/* Question */}
      <p className="text-center text-lg text-[var(--v2-text-primary)] font-medium">
        {issueType === 'partial_data_loss' || issueType === 'missing_destination'
          ? 'Is this intentional?'
          : 'Should we fix this automatically?'}
      </p>

      {/* Choices */}
      <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
        <button
          onClick={() => onFixChange(issue.id, {
            selectedOption: 'auto_fix',
            userInput: { issueType }
          })}
          className={`p-6 rounded-xl border-2 transition-all ${
            currentChoice === 'auto_fix'
              ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
              : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)]'
          }`}
        >
          <div className="text-center space-y-2">
            <div className="text-3xl">✓</div>
            <p className="font-semibold text-[var(--v2-text-primary)]">
              {issueType === 'partial_data_loss' || issueType === 'missing_destination' ? 'No, fix it' : 'Yes, fix it'}
            </p>
          </div>
        </button>

        <button
          onClick={() => onFixChange(issue.id, {
            selectedOption: 'leave_as_is',
            userInput: {}
          })}
          className={`p-6 rounded-xl border-2 transition-all ${
            currentChoice === 'leave_as_is'
              ? 'border-[var(--v2-text-secondary)] bg-[var(--v2-surface-hover)]'
              : 'border-[var(--v2-border)] hover:border-[var(--v2-text-secondary)]'
          }`}
        >
          <div className="text-center space-y-2">
            <div className="text-3xl">→</div>
            <p className="font-semibold text-[var(--v2-text-primary)]">
              {issueType === 'partial_data_loss' || issueType === 'missing_destination' ? 'Yes, intentional' : 'No, leave it'}
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}
