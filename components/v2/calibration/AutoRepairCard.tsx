/**
 * AutoRepairCard - Display auto-repair proposals with approval UI
 *
 * Shows data shape mismatch repairs that can be automatically applied:
 * - wrap_in_array: Wrap single object in array for downstream steps
 * - extract_first_item: Extract first item from array
 * - Displays confidence score and description
 * - Checkbox for user approval
 */

'use client'

import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/v2/ui/card'
import { Badge } from '@/components/v2/ui/badge'
import {
  Wrench,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Sparkles
} from 'lucide-react'
import type { CollectedIssue } from '@/lib/pilot/types'

interface AutoRepairCardProps {
  issue: CollectedIssue
  approved: boolean
  onApprove: (approved: boolean) => void
}

export function AutoRepairCard({ issue, approved, onApprove }: AutoRepairCardProps) {
  const [showTechnical, setShowTechnical] = useState(false)

  const proposal = issue.autoRepairProposal
  if (!proposal) return null

  const confidencePercent = Math.round((proposal.confidence || 0) * 100)

  return (
    <Card
      className="!border-l-4 bg-[var(--v2-surface)]"
      style={{ borderLeftColor: '#8B5CF6', borderLeftWidth: '4px', borderLeftStyle: 'solid' }}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--v2-status-warning-bg)] flex items-center justify-center flex-shrink-0">
            <Wrench className="w-5 h-5 text-[var(--v2-secondary)]" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base text-[var(--v2-text-primary)]">{issue.title}</CardTitle>
            <CardDescription className="mt-1 text-[var(--v2-text-secondary)]">
              {issue.message}
            </CardDescription>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="info" className="text-xs">
                <Sparkles className="w-3 h-3 mr-1" />
                {confidencePercent}% Confidence
              </Badge>
              <Badge variant="neutral" className="text-xs">
                {getActionLabel(proposal.action)}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Affected steps */}
        {issue.affectedSteps.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
              Will fix {issue.affectedSteps.length} step{issue.affectedSteps.length > 1 ? 's' : ''}:
            </p>
            <div className="flex flex-wrap gap-2">
              {issue.affectedSteps.map(step => (
                <Badge key={step.stepId} variant="neutral">
                  {step.friendlyName}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Proposed fix details */}
        <div className="border border-[var(--v2-border)] bg-[var(--v2-surface)] rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
              Proposed Auto-Repair:
            </p>
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {getActionDescription(proposal.action)}
            </p>
          </div>

          {proposal.description && (
            <div className="pt-2 border-t border-[var(--v2-border)]">
              <p className="text-xs text-[var(--v2-text-secondary)]">
                {proposal.description}
              </p>
            </div>
          )}

          {/* Approval checkbox */}
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-[var(--v2-bg)] hover:bg-[var(--v2-surface)] transition-colors border border-[var(--v2-border)]">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => onApprove(e.target.checked)}
              className="w-4 h-4"
            />
            <div className="flex items-center gap-2">
              <CheckCircle className={`w-4 h-4 ${approved ? 'text-[var(--v2-primary)]' : 'text-[var(--v2-text-secondary)]'}`} />
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                Approve this auto-repair
              </span>
            </div>
          </label>
        </div>

        {/* Technical details toggle */}
        <button
          onClick={() => setShowTechnical(!showTechnical)}
          className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors mt-4"
        >
          {showTechnical ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Technical Details
        </button>

        {showTechnical && (
          <div className="mt-2 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
            <div className="space-y-2 text-xs text-[var(--v2-text-secondary)]">
              <div>
                <span className="font-medium">Action:</span> {proposal.action}
              </div>
              {proposal.targetStepId && (
                <div>
                  <span className="font-medium">Target Step:</span> {proposal.targetStepId}
                </div>
              )}
              {proposal.sourceStepId && (
                <div>
                  <span className="font-medium">Source Step:</span> {proposal.sourceStepId}
                </div>
              )}
              <div>
                <span className="font-medium">Confidence:</span> {confidencePercent}%
              </div>
              <div className="pt-2 border-t border-[var(--v2-border)]">
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(proposal, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Get human-readable action label
 */
function getActionLabel(action: string): string {
  switch (action) {
    case 'wrap_in_array':
      return 'Wrap in Array'
    case 'extract_first_item':
      return 'Extract First Item'
    case 'flatten_array':
      return 'Flatten Array'
    case 'none':
      return 'No Action'
    default:
      return action
  }
}

/**
 * Get detailed action description
 */
function getActionDescription(action: string): string {
  switch (action) {
    case 'wrap_in_array':
      return 'The system will automatically wrap the single object output in an array so downstream steps expecting a list can process it correctly.'
    case 'extract_first_item':
      return 'The system will automatically extract the first item from the array output so downstream steps expecting a single object can process it correctly.'
    case 'flatten_array':
      return 'The system will flatten nested arrays into a single-level array for easier processing.'
    case 'none':
      return 'No automatic repair available for this issue.'
    default:
      return `The system will apply the "${action}" transformation to fix the data shape mismatch.`
  }
}
