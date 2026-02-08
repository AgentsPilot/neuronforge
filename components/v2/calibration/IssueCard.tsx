/**
 * IssueCard - Display individual calibration issues with fix UI
 *
 * Specialized cards for different issue types:
 * - Parameter errors: Input field for corrected value
 * - Hardcode detections: Parameterization checkbox with config
 * - Data shape mismatches: Display with auto-repair info
 * - Other issues: Display-only with technical details
 */

'use client'

import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/v2/ui/card'
import { Badge } from '@/components/v2/ui/badge'
import { Button } from '@/components/v2/ui/button'
import {
  XCircle,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lightbulb
} from 'lucide-react'
import { DynamicSelectField } from '@/components/v2/DynamicSelectField'
import type { CollectedIssue } from '@/lib/pilot/types'
import type { UserFixes } from './CalibrationDashboard'

interface IssueCardProps {
  issue: CollectedIssue
  fixes: UserFixes
  onFixChange: (issueId: string, fix: any) => void
  hasParameterIssues?: boolean // Whether there are parameter issues in the same batch
}

export function IssueCard({ issue, fixes, onFixChange, hasParameterIssues = false }: IssueCardProps) {
  console.log('[IssueCard] Rendering with onFixChange type:', typeof onFixChange, 'for issue:', issue.id)

  // Render based on issue category
  if (issue.category === 'parameter_error') {
    return <ParameterErrorCard issue={issue} fixes={fixes} onFixChange={onFixChange} />
  }

  if (issue.category === 'hardcode_detected') {
    return <HardcodeCard issue={issue} fixes={fixes} onFixChange={onFixChange} />
  }

  if (issue.category === 'logic_error') {
    // Determine which logic card to show based on issue type
    const logicIssueType = (issue.suggestedFix as any)?.type || 'duplicate_data_routing';

    // Issues that need user decision
    const needsUserDecision = [
      'duplicate_data_routing',
      'partial_data_loss',
      'missing_destination',
      'sequential_to_parallel',
      'unnecessary_loop',
      'missing_validation',
      'missing_error_handling',
      'excessive_ai_processing'
    ];

    if (needsUserDecision.includes(logicIssueType)) {
      return <ActionableLogicErrorCard issue={issue} fixes={fixes} onFixChange={onFixChange} />;
    }

    // Informational issues (just show, no action needed)
    return <InformationalLogicCard issue={issue} />;
  }

  // Generic issue card for other types (data issues, logic errors, etc.)
  const borderColor = getSeverityBorderColorValue(issue.severity)

  // Determine if this issue might be cascading from parameter issues
  const isPotentiallyCascading = hasParameterIssues && (
    issue.category === 'data_shape_mismatch' ||
    issue.category === 'data_unavailable' ||
    issue.category === 'execution_error' ||
    issue.category === 'logic_error'
  )

  return (
    <Card
      className="!border-l-4"
      style={{ borderLeftColor: borderColor, borderLeftWidth: '4px', borderLeftStyle: 'solid' }}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getSeverityBgColor(issue.severity)}`}>
            {getSeverityIcon(issue.severity)}
          </div>
          <div className="flex-1">
            <CardTitle className="text-base text-[var(--v2-text-primary)]">{issue.title}</CardTitle>
            <CardDescription className="mt-1 text-[var(--v2-text-secondary)]">
              {issue.message}
            </CardDescription>
          </div>
          <Badge variant={getSeverityBadgeVariant(issue.severity)}>
            {issue.severity}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {/* Relationship indicator - shown when this might be caused by parameter issues */}
        {isPotentiallyCascading && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-1">
                  This might fix itself
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  This problem could be happening because of the other issues above. Fix those first, then test again—this one might disappear on its own.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Independent issue indicator - shown when NO parameter issues exist */}
        {!hasParameterIssues && issue.category !== 'parameter_error' && issue.category !== 'hardcode_detected' && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-blue-900 dark:text-blue-200 mb-1">
                  Needs your attention
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  This needs to be fixed manually in your workflow. Review the steps and adjust how they work together.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Affected steps */}
        {issue.affectedSteps.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-sm font-medium text-[var(--v2-text-secondary)]">
                Affects {issue.affectedSteps.length} step{issue.affectedSteps.length > 1 ? 's' : ''}:
              </span>
              {issue.affectedSteps.map(step => (
                <Badge key={step.stepId} variant="neutral">
                  {step.friendlyName}
                </Badge>
              ))}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  )
}

/**
 * Smart Parameter Input - uses DynamicSelectField for plugin dropdowns
 */
function SmartParameterInput({
  issue,
  paramName,
  currentValue,
  expectedFormat,
  onChange
}: {
  issue: CollectedIssue
  paramName: string
  currentValue: string
  expectedFormat: string
  onChange: (value: string) => void
}) {
  const stepPlugin = issue.suggestedFix?.action?.stepPlugin
  const stepAction = issue.suggestedFix?.action?.stepAction
  const stepConfig = issue.suggestedFix?.action?.stepConfig

  // Check if we can use plugin dropdown (need plugin + action metadata)
  const canUseDropdown = stepPlugin && stepAction

  return (
    <div className="space-y-2">
      <div className={canUseDropdown ? "flex items-center gap-3" : "space-y-2"}>
        <label className={`text-sm font-medium text-[var(--v2-text-primary)] ${canUseDropdown ? 'min-w-fit' : 'block'}`}>
          {canUseDropdown ? `Select correct ${paramName}:` : `Enter the correct "${paramName}" value:`}
        </label>

        {canUseDropdown ? (
          <div className="flex-1">
            <DynamicSelectField
              plugin={stepPlugin}
              action={stepAction}
              parameter={paramName}
              value={currentValue}
              onChange={(value) => {
                console.log('[SmartParameterInput] DynamicSelectField onChange:', value)
                onChange(value)
              }}
              placeholder={`Select ${paramName}...`}
              dependentValues={stepConfig || {}}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>
        ) : (
          <input
            type="text"
            value={currentValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={expectedFormat}
            className="w-full px-4 py-2 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
          />
        )}
      </div>

      {!canUseDropdown && expectedFormat && (
        <p className="text-xs text-[var(--v2-text-muted)] flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Expected format: {expectedFormat}
        </p>
      )}
    </div>
  )
}

/**
 * Parameter Error Card - with input field for correction
 */
function ParameterErrorCard({ issue, fixes, onFixChange }: IssueCardProps) {
  const paramName = extractParameterName(issue)
  const expectedFormat = issue.suggestedFix?.action?.expectedFormat || 'corrected value'
  // Use issue ID to get the value (not parameter name - different steps can have same param name)
  const currentValue = fixes.parameters?.[issue.id] || ''

  console.log('[ParameterErrorCard] Render:', {
    issueId: issue.id,
    paramName,
    currentValue,
    allFixesParameters: fixes.parameters
  })

  return (
    <Card
      className="!border-l-4 bg-[var(--v2-surface)]"
      style={{ borderLeftColor: '#DC2626', borderLeftWidth: '4px', borderLeftStyle: 'solid' }}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-10 h-10 rounded-full bg-[var(--v2-error-bg)] flex items-center justify-center flex-shrink-0">
              <XCircle className="w-5 h-5 text-[var(--v2-error-icon)]" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base text-[var(--v2-text-primary)]">{issue.title}</CardTitle>
                {/* Affected steps on same line */}
                {issue.affectedSteps.length > 0 && issue.affectedSteps.map(step => (
                  <Badge key={step.stepId} variant="neutral">
                    {step.friendlyName}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Badge variant="error">Critical</Badge>
        </div>
      </CardHeader>

      <CardContent>
        {/* Simple explanation paragraph */}
        <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
          {issue.message}
        </p>

        {/* Direct input without wrapping box */}
        <div className="mb-4">
          <SmartParameterInput
            issue={issue}
            paramName={paramName}
            currentValue={currentValue}
            expectedFormat={expectedFormat}
            onChange={(value) => {
              console.log('[ParameterErrorCard] onChange called with value:', value)
              console.log('[ParameterErrorCard] onFixChange is:', typeof onFixChange, onFixChange)
              console.log('[ParameterErrorCard] Calling onFixChange with issueId:', issue.id, 'fix:', { value })
              onFixChange(issue.id, { value })
              console.log('[ParameterErrorCard] onFixChange returned')
            }}
          />
        </div>

      </CardContent>
    </Card>
  )
}

/**
 * Hardcode Card - with parameterization option
 */
function HardcodeCard({ issue, fixes, onFixChange }: IssueCardProps) {
  const [wantsParameterization, setWantsParameterization] = useState(false)
  const suggestedParamName = issue.suggestedFix?.action?.paramName || 'value'
  const suggestedDefault = issue.suggestedFix?.action?.defaultValue || ''

  const currentFix = fixes.parameterizations?.[issue.id] || {
    approved: false,
    paramName: suggestedParamName,
    defaultValue: suggestedDefault
  }

  return (
    <Card
      className="!border-l-4 bg-[var(--v2-surface)]"
      style={{ borderLeftColor: '#F59E0B', borderLeftWidth: '4px', borderLeftStyle: 'solid' }}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--v2-status-warning-bg)] flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-[var(--v2-status-warning-text)]" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base text-[var(--v2-text-primary)]">{issue.title}</CardTitle>
            {issue.affectedSteps.length > 0 && (
              <p className="text-xs text-[var(--v2-text-secondary)] mt-1">
                In step: {issue.affectedSteps.map(step => step.friendlyName).join(', ')}
              </p>
            )}
          </div>
          <Badge variant="warning">{issue.severity}</Badge>
        </div>
      </CardHeader>

      <CardContent>
        {/* Explanation - What was detected */}
        <div className="mb-4 p-3 bg-[var(--v2-status-warning-bg)] border border-[var(--v2-status-warning-border)] rounded-lg">
          <p className="text-sm text-[var(--v2-status-warning-text)]">
            <span className="font-semibold">What we found:</span> A hardcoded value was detected in this step.
          </p>
        </div>

        {/* Recommendation - Why parameterize */}
        <div className="mb-4 p-3 border-2 border-[var(--v2-primary)] bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-2 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-[var(--v2-primary)]" />
            Recommended action:
          </p>
          <p className="text-sm text-[var(--v2-text-secondary)]">
            Convert this to an input parameter so users can provide their own values when running the workflow.
          </p>
        </div>

        {/* Parameterization option with toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors">
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--v2-text-primary)]">Convert to input parameter</p>
            <p className="text-xs text-[var(--v2-text-secondary)] mt-1">
              Make this value dynamic so users can provide their own input
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wantsParameterization}
            onClick={() => {
              const newValue = !wantsParameterization
              setWantsParameterization(newValue)
              onFixChange(issue.id, {
                approved: newValue,
                paramName: suggestedParamName,
                defaultValue: suggestedDefault
              })
            }}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:ring-offset-2 ${
              wantsParameterization ? 'bg-[var(--v2-primary)]' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                wantsParameterization ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Actionable Logic Error Card - requires user decision (fix or leave as-is)
 */
function ActionableLogicErrorCard({ issue, fixes, onFixChange }: IssueCardProps) {
  const [userDecision, setUserDecision] = useState<'fix' | 'leave' | null>(null)

  const evidence = (issue.suggestedFix as any)?.evidence || {}
  const issueType = (issue.suggestedFix as any)?.type || 'duplicate_data_routing'

  const handleDecision = (decision: 'fix' | 'leave') => {
    setUserDecision(decision)

    if (decision === 'fix') {
      onFixChange(issue.id, {
        selectedOption: 'auto_fix',
        userInput: { issueType }
      })
    } else {
      onFixChange(issue.id, {
        selectedOption: 'leave_as_is',
        userInput: {}
      })
    }
  }

  // Get issue-specific explanation
  const getExplanation = () => {
    switch (issueType) {
      case 'duplicate_data_routing':
        return `Both steps are sending all data to different destinations. We can automatically add filters based on the "${evidence.suggestedFilterField || 'classification'}" field.`

      case 'partial_data_loss':
        return `This filter reduced data from ${evidence.inputCount} to ${evidence.outputCount} rows (${evidence.reductionPercent}% reduction). This may be too restrictive.`

      case 'missing_destination':
        return `Your workflow processed ${evidence.processedRows} rows but doesn't send them anywhere. The data will be lost.`

      case 'sequential_to_parallel':
        return `These ${evidence.stepCount} steps use the same input and could run simultaneously, saving ~${Math.round(evidence.timeSaved / 1000)} seconds.`

      case 'unnecessary_loop':
        return `Processing ${evidence.itemCount} items one-by-one with "${evidence.singleItemAction}". Using "${evidence.batchAlternative}" would be ${evidence.estimatedSpeedup}.`

      case 'missing_validation':
        return `${evidence.rowsNeedingReview} out of ${evidence.totalRows} extracted rows have missing fields, but are being sent directly without validation.`

      case 'missing_error_handling':
        return `This critical operation (${evidence.action}) has no error handling. It failed ${evidence.failures} out of ${evidence.total} times.`

      case 'excessive_ai_processing':
        return `Running AI on ${evidence.totalItems} items but only ${evidence.applicableItems} are relevant. Wasting ${evidence.wastePercentage}% of calls (${evidence.wastedCalls} items).`

      default:
        return issue.message
    }
  }

  const getSeverityColor = () => {
    const severity = issue.severity as string
    if (severity === 'critical' || severity === 'high') {
      return '#DC2626'
    }
    if (severity === 'medium' || severity === 'warning') {
      return '#F59E0B'
    }
    return '#3B82F6'
  }

  const getSeverityBadge = () => {
    const severity = issue.severity as string
    if (severity === 'critical' || severity === 'high') {
      return <Badge variant="error">Critical</Badge>
    }
    if (severity === 'medium' || severity === 'warning') {
      return <Badge variant="warning">Warning</Badge>
    }
    return <Badge variant="info">Optimization</Badge>
  }

  return (
    <Card
      className="!border-l-4 bg-[var(--v2-surface)]"
      style={{ borderLeftColor: getSeverityColor(), borderLeftWidth: '4px', borderLeftStyle: 'solid' }}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--v2-error-bg)] flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-[var(--v2-error-icon)]" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base text-[var(--v2-text-primary)]">{issue.title}</CardTitle>
            <CardDescription className="mt-1 text-[var(--v2-text-secondary)]">
              {issue.message}
            </CardDescription>
          </div>
          {getSeverityBadge()}
        </div>
      </CardHeader>

      <CardContent>
        {/* Simple explanation */}
        <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
          {getExplanation()}
        </p>

        {/* User Decision - Compact inline buttons */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--v2-text-secondary)]">
            {issueType === 'partial_data_loss' || issueType === 'missing_destination'
              ? 'Is this intentional?'
              : 'Fix this automatically?'}
          </span>
          <button
            onClick={() => handleDecision('fix')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
              userDecision === 'fix'
                ? 'bg-[var(--v2-primary)] text-white'
                : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:border-[var(--v2-primary)]'
            }`}
          >
            {issueType === 'partial_data_loss' || issueType === 'missing_destination' ? 'No, fix it' : 'Yes'}
          </button>
          <button
            onClick={() => handleDecision('leave')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
              userDecision === 'leave'
                ? 'bg-gray-500 text-white'
                : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:border-gray-400'
            }`}
          >
            {issueType === 'partial_data_loss' || issueType === 'missing_destination' ? 'Yes, intentional' : 'No'}
          </button>
        </div>

        {/* Simple confirmation */}
        {userDecision === 'fix' && (
          <p className="mt-3 text-xs text-green-600 dark:text-green-400">
            ✓ Will apply fix automatically
          </p>
        )}
        {userDecision === 'leave' && (
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            ✓ Workflow will remain unchanged
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Informational Logic Card - just displays info, no action needed
 */
function InformationalLogicCard({ issue }: { issue: CollectedIssue }) {
  const evidence = (issue.suggestedFix as any)?.evidence || {}
  const issueType = (issue.suggestedFix as any)?.type

  return (
    <Card className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
            <Lightbulb className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base text-[var(--v2-text-primary)]">{issue.title}</CardTitle>
            <CardDescription className="mt-1 text-[var(--v2-text-secondary)]">
              {issue.message}
            </CardDescription>
          </div>
          <Badge variant="info">Info</Badge>
        </div>
      </CardHeader>

      {/* Show relevant evidence based on type */}
      {(evidence.suggestion || evidence.batchAlternative || evidence.failureRate) && (
        <CardContent>
          <div className="text-sm text-[var(--v2-text-secondary)]">
            {evidence.suggestion && <p>💡 {evidence.suggestion}</p>}
            {evidence.batchAlternative && (
              <p>💡 Consider using <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs">{evidence.batchAlternative}</code> instead</p>
            )}
            {evidence.failureRate && <p>📊 Failure rate: {evidence.failureRate}</p>}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

/**
 * Helper functions
 */

function extractParameterName(issue: CollectedIssue): string {
  // Use suggestedFix data if available
  if (issue.suggestedFix?.action?.parameterName) {
    return issue.suggestedFix.action.parameterName
  }

  // Fallback: try to extract from technical details
  const match = issue.technicalDetails.match(/['"]([^'"]+)['"]/);
  if (match) {
    return match[1]
  }

  // Fallback to 'value' as a generic parameter name (must match CalibrationDashboard's getParameterName)
  return 'value'
}

function getSeverityBorderColorValue(severity: string): string {
  switch (severity) {
    case 'critical': return '#DC2626' // red-600
    case 'high': return '#DC2626' // red-600
    case 'medium': return '#F59E0B' // amber-500
    case 'low': return '#3B82F6' // blue-500
    default: return '#9CA3AF' // gray-400
  }
}

function getSeverityBgColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-[var(--v2-error-bg)]'
    case 'high': return 'bg-[var(--v2-error-bg)]'
    case 'medium': return 'bg-[var(--v2-status-warning-bg)]'
    case 'low': return 'bg-[var(--v2-status-executing-bg)]'
    default: return 'bg-[var(--v2-surface)]'
  }
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case 'critical':
      return <XCircle className="w-5 h-5 text-[var(--v2-error-icon)]" />
    case 'high':
      return <AlertCircle className="w-5 h-5 text-[var(--v2-error-icon)]" />
    case 'medium':
      return <AlertTriangle className="w-5 h-5 text-[var(--v2-status-warning-text)]" />
    default:
      return <AlertCircle className="w-5 h-5 text-[var(--v2-status-executing-text)]" />
  }
}

function getSeverityBadgeVariant(severity: string): 'error' | 'warning' | 'info' | 'neutral' {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    case 'low':
      return 'info'
    default:
      return 'neutral'
  }
}
