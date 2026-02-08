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

  console.log('[CalibrationDashboard] Render - issues:', {
    critical: issues.critical.map(i => ({ id: i.id, category: i.category })),
    warnings: issues.warnings.map(i => ({ id: i.id, category: i.category })),
    autoRepairs: issues.autoRepairs.map(i => ({ id: i.id, category: i.category }))
  })

  // Calculate if all critical issues have fixes
  const allCriticalFixed = issues.critical.every(issue => {
    if (issue.category === 'parameter_error') {
      // Check by issue ID, not parameter name (different steps can have same param name)
      const paramValue = fixes.parameters?.[issue.id]
      return paramValue !== undefined && paramValue !== ''
    }
    if (issue.category === 'logic_error') {
      // Check if user has selected an option for this logic error
      const logicFix = (fixes as any).logicFixes?.[issue.id]
      return logicFix?.selectedOption !== undefined && logicFix?.selectedOption !== null
    }
    return false
  })

  const totalIssues = issues.critical.length + issues.warnings.length

  // Check if there are any parameter issues to inform other issue cards
  const hasParameterIssues = issues.critical.some(i => i.category === 'parameter_error') ||
                             issues.warnings.some(i => i.category === 'parameter_error')

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">

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
            <CardTitle className="text-base text-[var(--v2-text-primary)]">Issues to Fix</CardTitle>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
              Fix these to make your workflow run successfully
            </p>
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
          <CardHeader
            className="py-2 pb-2 cursor-pointer"
            onClick={() => setWarningsExpanded(!warningsExpanded)}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <CardTitle className="text-base text-[var(--v2-text-primary)]">
                  Optional Improvements ({issues.warnings.length})
                </CardTitle>
              </div>
              {warningsExpanded ? (
                <ChevronDown className="w-5 h-5 text-[var(--v2-text-secondary)]" />
              ) : (
                <ChevronRight className="w-5 h-5 text-[var(--v2-text-secondary)]" />
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
