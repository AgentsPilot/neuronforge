/**
 * CalibrationDashboard - Comprehensive view of all calibration issues
 *
 * The main dashboard for batch calibration that displays:
 * - Summary statistics (total steps, completed, failed, issues found)
 * - Critical issues (must fix)
 * - Auto-repairs (can be applied automatically)
 * - Warnings (should fix but not blocking)
 *
 * Uses V2 theme design for clean, game-changing UX.
 */

'use client'

import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/v2/ui/card'
import { Button } from '@/components/v2/ui/button'
import {
  Activity,
  CheckCircle,
  AlertCircle,
  Wrench,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { IssueCard } from './IssueCard'
import { AutoRepairCard } from './AutoRepairCard'
import { CalibrationWizard } from './CalibrationWizard'
import type { CollectedIssue } from '@/lib/pilot/types'

export interface IssueGroups {
  critical: CollectedIssue[]
  warnings: CollectedIssue[]
  autoRepairs: CollectedIssue[]
}

export interface UserFixes {
  parameters?: Record<string, string>
  parameterizations?: Record<string, { approved: boolean; paramName?: string; defaultValue?: string }>
  autoRepairs?: Record<string, { approved: boolean }>
  logicFixes?: Record<string, { selectedOption: string; userInput: Record<string, any> }>
}

export interface CalibrationSession {
  id: string
  agentId: string
  status: string
  executionId?: string
  totalSteps: number
  completedSteps: number
  failedSteps: number
  skippedSteps: number
  execution_summary?: {
    data_sources_accessed?: Array<{
      plugin: string
      action: string
      count: number
      description: string
    }>
    data_written?: Array<{
      plugin: string
      action: string
      count: number
      description: string
    }>
    items_processed?: number
    items_filtered?: number
    items_delivered?: number
  }
  autoCalibration?: {
    iterations: number
    autoFixesApplied: number
    message: string
  }
}

interface CalibrationDashboardProps {
  session: CalibrationSession
  issues: IssueGroups
  fixes: UserFixes
  onFixesChange: (fixes: UserFixes) => void
  onApplyFixes: () => void
  isApplying?: boolean
  onBackToCalibration?: () => void
}

export function CalibrationDashboard({
  session,
  issues,
  fixes,
  onFixesChange,
  onApplyFixes,
  isApplying = false,
  onBackToCalibration
}: CalibrationDashboardProps) {
  const [warningsExpanded, setWarningsExpanded] = useState(false)
  const [useWizard, setUseWizard] = useState(true) // Default to simplified wizard mode

  console.log('[CalibrationDashboard] Render - issues:', {
    critical: issues.critical.map(i => ({ id: i.id, category: i.category })),
    warnings: issues.warnings.map(i => ({ id: i.id, category: i.category })),
    autoRepairs: issues.autoRepairs.map(i => ({ id: i.id, category: i.category }))
  })

  // Combine all issues for wizard
  const allIssues = [...issues.critical, ...issues.warnings, ...issues.autoRepairs]

  // Calculate if all critical issues have fixes
  const allCriticalFixed = issues.critical.every(issue => {
    console.log('[CalibrationDashboard] Checking critical issue:', {
      id: issue.id,
      category: issue.category,
      requiresUserInput: issue.requiresUserInput
    })

    // Skip issues that might auto-resolve after fixing other issues
    if (!issue.requiresUserInput || issue.category === 'data_shape_mismatch') {
      console.log('[CalibrationDashboard] Skipping auto-fixable issue:', issue.id)
      return true // Don't block "Apply Fixes" for auto-fixable issues
    }

    if (issue.category === 'parameter_error') {
      // Check by issue ID, not parameter name (different steps can have same param name)
      const paramValue = fixes.parameters?.[issue.id]
      const isFixed = paramValue !== undefined && paramValue !== ''
      console.log('[CalibrationDashboard] Parameter error check:', {
        issueId: issue.id,
        paramValue,
        isFixed,
        allParams: fixes.parameters
      })
      return isFixed
    }
    if (issue.category === 'logic_error') {
      // Check if user has selected an option for this logic error
      const logicFix = (fixes as any).logicFixes?.[issue.id]
      const isFixed = logicFix?.selectedOption !== undefined && logicFix?.selectedOption !== null
      console.log('[CalibrationDashboard] Logic error check:', {
        issueId: issue.id,
        logicFix,
        isFixed
      })
      return isFixed
    }
    if (issue.category === 'configuration_missing') {
      // Check if all required config keys have values
      const configKeys = issue.suggestedFix?.action?.configKeys || []
      const allConfigProvided = configKeys.every((key: string) => {
        const configValue = fixes.parameters?.[`${issue.id}_${key}`]
        return configValue !== undefined && configValue !== ''
      })
      console.log('[CalibrationDashboard] Configuration missing check:', {
        issueId: issue.id,
        configKeys,
        allConfigProvided,
        allParams: fixes.parameters
      })
      return allConfigProvided
    }
    console.log('[CalibrationDashboard] Issue not handled, returning false:', issue.id, issue.category)
    return false
  })

  console.log('[CalibrationDashboard] allCriticalFixed result:', allCriticalFixed, 'Total critical issues:', issues.critical.length)

  const totalIssues = issues.critical.length + issues.warnings.length

  // Check if there are any parameter issues to inform other issue cards
  const hasParameterIssues = issues.critical.some(i => i.category === 'parameter_error') ||
                             issues.warnings.some(i => i.category === 'parameter_error')

  // Use wizard mode if enabled
  if (useWizard && totalIssues > 0) {
    return (
      <div className="space-y-4">
        {/* Toggle between wizard and classic view */}
        <div className="flex justify-end">
          <button
            onClick={() => setUseWizard(false)}
            className="text-xs text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] underline"
          >
            Switch to detailed view
          </button>
        </div>

        <CalibrationWizard
          issues={allIssues}
          fixes={fixes}
          onFixesChange={onFixesChange}
          onComplete={onApplyFixes}
          onBack={onBackToCalibration}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">

      {/* Toggle to wizard view */}
      {totalIssues > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => setUseWizard(true)}
            className="text-sm text-[var(--v2-primary)] hover:opacity-80 font-medium"
          >
            ✨ Try simplified mode
          </button>
        </div>
      )}

      {/* Summary Card */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <CardHeader className="py-1.5 pb-0">
          <p className="text-sm text-[var(--v2-text-primary)]">
            {totalIssues === 0 ? 'No issues found - your workflow is ready!' : `Found ${totalIssues} ${totalIssues === 1 ? 'issue' : 'issues'} to fix`}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

            {/* Total Steps */}
            <div className="flex flex-col p-3 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-[var(--v2-primary)]" />
                <span className="text-xs font-medium text-[var(--v2-text-secondary)]">Steps</span>
              </div>
              <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                {session.totalSteps}
              </div>
            </div>

            {/* Completed */}
            <div className="flex flex-col p-3 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-[var(--v2-primary)]" />
                <span className="text-xs font-medium text-[var(--v2-text-secondary)]">Passed</span>
              </div>
              <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                {session.completedSteps}
              </div>
            </div>

            {/* Issues Found */}
            <div className="flex flex-col p-3 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-[var(--v2-primary)]" />
                <span className="text-xs font-medium text-[var(--v2-text-secondary)]">Issues</span>
              </div>
              <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                {totalIssues}
              </div>
            </div>

            {/* Auto-Repairs */}
            <div className="flex flex-col p-3 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="w-4 h-4 text-[var(--v2-primary)]" />
                <span className="text-xs font-medium text-[var(--v2-text-secondary)]">Auto-Fix</span>
              </div>
              <div className="text-2xl font-bold text-[var(--v2-text-primary)]">
                {issues.autoRepairs.length}
              </div>
            </div>

          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-[var(--v2-text-secondary)]">Progress</span>
              <span className="font-medium text-[var(--v2-text-primary)]">
                {session.completedSteps + session.failedSteps + session.skippedSteps} / {session.totalSteps}
              </span>
            </div>
            <div className="h-1.5 bg-[var(--v2-border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--v2-primary)] transition-all duration-500"
                style={{
                  width: `${((session.completedSteps + session.failedSteps + session.skippedSteps) / session.totalSteps) * 100}%`
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Critical Issues Section */}
      {issues.critical.length > 0 && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <CardHeader className="py-2 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base text-[var(--v2-text-primary)]">Issues to Fix</CardTitle>
                <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
                  Fix these to make your workflow run successfully
                </p>
              </div>

              {/* Bulk Parameterize All button for hardcode issues */}
              {issues.critical.filter(i => i.category === 'hardcode_detected').length > 0 && (
                <button
                  onClick={() => {
                    // Find all hardcode issues and approve them all
                    const hardcodeIssues = issues.critical.filter(i => i.category === 'hardcode_detected')
                    const newParameterizations = { ...fixes.parameterizations }

                    hardcodeIssues.forEach(issue => {
                      const suggestedParamName = issue.suggestedFix?.action?.paramName || 'value'
                      const suggestedDefault = issue.suggestedFix?.action?.defaultValue || ''
                      newParameterizations[issue.id] = {
                        approved: true,
                        paramName: suggestedParamName,
                        defaultValue: suggestedDefault
                      }
                    })

                    onFixesChange({
                      ...fixes,
                      parameterizations: newParameterizations
                    })
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity rounded-lg"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  Parameterize All ({issues.critical.filter(i => i.category === 'hardcode_detected').length})
                </button>
              )}
            </div>
          </CardHeader>

          <CardContent>
            <div className="space-y-3">
            {issues.critical.map(issue => {
              console.log('[CalibrationDashboard] Rendering CRITICAL issue:', issue.id, issue.category)
              const issueCategory = issue.category
              const issueForParamName = issue
              return (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  fixes={fixes}
                  hasParameterIssues={hasParameterIssues}
                  onFixChange={(issueId, fix) => {
                    console.log('[CalibrationDashboard] CRITICAL onFixChange called:', { issueId, fix, category: issueCategory })
                    if (issueCategory === 'parameter_error') {
                      const paramName = getParameterName(issueForParamName)
                      console.log('[CalibrationDashboard] Parameter error - paramName:', paramName, 'issueId:', issueId, 'value:', fix.value)
                      // Store by issue ID, not parameter name (different steps can need different values)
                      const newFixes = {
                        ...fixes,
                        parameters: {
                          ...fixes.parameters,
                          [issueId]: fix.value  // Use issue ID as key
                        }
                      }
                      console.log('[CalibrationDashboard] Calling onFixesChange with:', newFixes)
                      onFixesChange(newFixes)
                    } else if (issueCategory === 'hardcode_detected') {
                      onFixesChange({
                        ...fixes,
                        parameterizations: {
                          ...fixes.parameterizations,
                          [issueId]: fix
                        }
                      })
                    } else if (issueCategory === 'logic_error') {
                      console.log('[CalibrationDashboard] Logic error fix:', { issueId, fix })
                      onFixesChange({
                        ...fixes,
                        logicFixes: {
                          ...fixes.logicFixes,
                          [issueId]: fix
                        }
                      })
                    } else if (issueCategory === 'configuration_missing') {
                      console.log('[CalibrationDashboard] Configuration missing fix:', { issueId, fix })
                      // Config values are stored with keys like: ${issueId}_${configKey}
                      // The IssueCard component sends them this way
                      onFixesChange({
                        ...fixes,
                        parameters: {
                          ...fixes.parameters,
                          [issueId]: fix.value
                        }
                      })
                    }
                  }}
                />
              )
            })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-Repairs Section */}
      {issues.autoRepairs.length > 0 && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <CardHeader className="py-2 pb-2">
            <CardTitle className="text-base text-[var(--v2-text-primary)]">Suggested Auto-Fixes</CardTitle>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
              Review and approve these automatic fixes
            </p>
          </CardHeader>
          <CardContent>
          <div className="space-y-4">
            {issues.autoRepairs.map(issue => (
              <AutoRepairCard
                key={issue.id}
                issue={issue}
                approved={fixes.autoRepairs?.[issue.id]?.approved ?? false}
                onApprove={(approved) => {
                  onFixesChange({
                    ...fixes,
                    autoRepairs: {
                      ...fixes.autoRepairs,
                      [issue.id]: { approved }
                    }
                  })
                }}
              />
            ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warnings Section (Collapsible) */}
      {issues.warnings.length > 0 && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <CardHeader className="py-2 pb-2">
            <div className="flex items-center justify-between">
              <div
                className="flex-1 cursor-pointer"
                onClick={() => setWarningsExpanded(!warningsExpanded)}
              >
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base text-[var(--v2-text-primary)]">
                    Optional Improvements ({issues.warnings.length})
                  </CardTitle>
                  {warningsExpanded ? (
                    <ChevronDown className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  )}
                </div>
              </div>

              {/* Bulk Parameterize All button for hardcode warnings */}
              {issues.warnings.filter(i => i.category === 'hardcode_detected').length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // Find all hardcode warnings and approve them all
                    const hardcodeIssues = issues.warnings.filter(i => i.category === 'hardcode_detected')
                    const newParameterizations = { ...fixes.parameterizations }

                    hardcodeIssues.forEach(issue => {
                      const suggestedParamName = issue.suggestedFix?.action?.paramName || 'value'
                      const suggestedDefault = issue.suggestedFix?.action?.defaultValue || ''
                      newParameterizations[issue.id] = {
                        approved: true,
                        paramName: suggestedParamName,
                        defaultValue: suggestedDefault
                      }
                    })

                    onFixesChange({
                      ...fixes,
                      parameterizations: newParameterizations
                    })
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity rounded-lg"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  Parameterize All ({issues.warnings.filter(i => i.category === 'hardcode_detected').length})
                </button>
              )}
            </div>
          </CardHeader>
          {warningsExpanded && (
            <CardContent className="space-y-3">
              {issues.warnings.map(issue => {
                console.log('[CalibrationDashboard] Rendering WARNING issue:', issue.id, issue.category)
                const issueCategory = issue.category
                const issueForParamName = issue
                return (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    fixes={fixes}
                    hasParameterIssues={hasParameterIssues}
                    onFixChange={(issueId, fix) => {
                      console.log('[CalibrationDashboard] WARNING onFixChange called:', { issueId, fix, category: issueCategory })
                      if (issueCategory === 'parameter_error') {
                        const paramName = getParameterName(issueForParamName)
                        console.log('[CalibrationDashboard] Parameter error - paramName:', paramName, 'issueId:', issueId, 'value:', fix.value)
                        // Store by issue ID, not parameter name (different steps can need different values)
                        const newFixes = {
                          ...fixes,
                          parameters: {
                            ...fixes.parameters,
                            [issueId]: fix.value  // Use issue ID as key
                          }
                        }
                        console.log('[CalibrationDashboard] Calling onFixesChange with:', newFixes)
                        onFixesChange(newFixes)
                      } else if (issueCategory === 'hardcode_detected') {
                        onFixesChange({
                          ...fixes,
                          parameterizations: {
                            ...fixes.parameterizations,
                            [issueId]: fix
                          }
                        })
                      } else if (issueCategory === 'logic_error') {
                        console.log('[CalibrationDashboard] Logic error fix:', { issueId, fix })
                        onFixesChange({
                          ...fixes,
                          logicFixes: {
                            ...fixes.logicFixes,
                            [issueId]: fix
                          }
                        })
                      } else if (issueCategory === 'configuration_missing') {
                        console.log('[CalibrationDashboard] Configuration missing fix:', { issueId, fix })
                        // Config values are stored with keys like: ${issueId}_${configKey}
                        // The IssueCard component sends them this way
                        onFixesChange({
                          ...fixes,
                          parameters: {
                            ...fixes.parameters,
                            [issueId]: fix.value
                          }
                        })
                      }
                    }}
                  />
                )
              })}
            </CardContent>
          )}
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center gap-3 pt-2">
        <button
          onClick={onBackToCalibration || (() => window.history.back())}
          disabled={isApplying}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          Back to Calibration
        </button>

        <div className="flex items-center gap-3">
          {!allCriticalFixed && issues.critical.length > 0 && (
            <span className="text-xs text-[var(--v2-text-secondary)]">
              Fix all issues first
            </span>
          )}

          <button
            onClick={onApplyFixes}
            disabled={!allCriticalFixed || isApplying}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {isApplying ? (
              <>
                <Wrench className="w-4 h-4 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Apply Fixes
              </>
            )}
          </button>
        </div>
      </div>

    </div>
  )
}

/**
 * Extract parameter name from issue
 */
function getParameterName(issue: CollectedIssue): string {
  // First try suggestedFix data (most reliable)
  if (issue.suggestedFix?.action?.parameterName) {
    return issue.suggestedFix.action.parameterName
  }

  // Try to extract from technical details
  const match = issue.technicalDetails.match(/['"]([^'"]+)['"]/);
  if (match) {
    return match[1]
  }

  // Fallback to 'value' as a generic parameter name
  return 'value'
}
