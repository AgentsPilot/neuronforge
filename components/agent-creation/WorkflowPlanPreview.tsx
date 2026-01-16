/**
 * Workflow Plan Preview Component
 *
 * Shows users a natural language preview of their workflow BEFORE execution.
 *
 * Key Features:
 * 1. Plain English description (no technical jargon)
 * 2. Visual step-by-step plan with emojis
 * 3. Edit request button for corrections
 * 4. Approve & Continue button to proceed
 * 5. Cost and time estimation
 *
 * This is the UX layer that makes Extended IR user-friendly.
 */

'use client'

import React, { useState } from 'react'
import type { NaturalLanguagePlan, PlanStep } from '@/lib/agentkit/v6/translation/IRToNaturalLanguageTranslator'

// ============================================================================
// Types
// ============================================================================

export interface WorkflowPlanPreviewProps {
  plan: NaturalLanguagePlan
  onApprove: () => void
  onRequestEdit: (editMessage: string) => void
  isLoading?: boolean
}

// ============================================================================
// Main Component
// ============================================================================

export function WorkflowPlanPreview({
  plan,
  onApprove,
  onRequestEdit,
  isLoading = false
}: WorkflowPlanPreviewProps) {
  const [showEditInput, setShowEditInput] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)

  const handleEditRequest = async () => {
    if (!editMessage.trim()) return

    setIsSubmittingEdit(true)
    try {
      await onRequestEdit(editMessage)
      setEditMessage('')
      setShowEditInput(false)
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  return (
    <div className="workflow-plan-preview max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Workflow Plan Preview
        </h2>
        <p className="text-gray-600 dark:text-gray-300">
          Review what this workflow will do before running it
        </p>
      </div>

      {/* Goal */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
          Goal
        </h3>
        <p className="text-blue-800 dark:text-blue-200">
          {plan.goal}
        </p>
      </div>

      {/* Steps */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Steps
        </h3>
        <div className="space-y-3">
          {plan.steps.map((step, index) => (
            <PlanStepCard key={index} step={step} stepNumber={index + 1} />
          ))}
        </div>
      </div>

      {/* Edge Cases */}
      {plan.edgeCases && plan.edgeCases.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            🛡️ Edge Cases Handled
          </h3>
          <div className="space-y-2">
            {plan.edgeCases.map((edgeCase, index) => (
              <div
                key={index}
                className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-900 dark:text-yellow-100"
              >
                {edgeCase}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estimation */}
      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          Estimated Performance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {plan.estimation.emails && (
            <EstimationCard
              icon="📧"
              label="Emails"
              value={plan.estimation.emails}
            />
          )}
          {plan.estimation.slackMessages && (
            <EstimationCard
              icon="💬"
              label="Slack Messages"
              value={plan.estimation.slackMessages}
            />
          )}
          {plan.estimation.time && (
            <EstimationCard
              icon="⏱️"
              label="Time"
              value={plan.estimation.time}
            />
          )}
          {plan.estimation.cost && (
            <EstimationCard
              icon="💰"
              label="Cost"
              value={plan.estimation.cost}
            />
          )}
        </div>
      </div>

      {/* Clarifications */}
      {plan.clarifications && plan.clarifications.length > 0 && (
        <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
          <h3 className="text-sm font-semibold text-orange-900 dark:text-orange-100 mb-2">
            ⚠️ Clarifications Needed
          </h3>
          <ul className="list-disc list-inside space-y-1 text-sm text-orange-800 dark:text-orange-200">
            {plan.clarifications.map((clarification, index) => (
              <li key={index}>{clarification}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Edit Input */}
      {showEditInput && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
            What would you like to change?
          </label>
          <textarea
            value={editMessage}
            onChange={(e) => setEditMessage(e.target.value)}
            placeholder='e.g., "Change filter to use stage column instead of status"'
            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white resize-none"
            rows={3}
            disabled={isSubmittingEdit}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleEditRequest}
              disabled={!editMessage.trim() || isSubmittingEdit}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmittingEdit ? 'Updating...' : 'Update Plan'}
            </button>
            <button
              onClick={() => {
                setShowEditInput(false)
                setEditMessage('')
              }}
              disabled={isSubmittingEdit}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onApprove}
          disabled={isLoading || (plan.clarifications && plan.clarifications.length > 0)}
          className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
        >
          {isLoading ? 'Processing...' : '✓ Approve & Continue'}
        </button>
        {!showEditInput && (
          <button
            onClick={() => setShowEditInput(true)}
            disabled={isLoading}
            className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold"
          >
            ✏️ Edit Request
          </button>
        )}
      </div>

      {/* Help Text */}
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
        This plan shows what the workflow will do. You can edit it using natural language before approving.
      </p>
    </div>
  )
}

// ============================================================================
// Sub-Components
// ============================================================================

function PlanStepCard({ step, stepNumber }: { step: PlanStep; stepNumber: number }) {
  const bgColor = {
    data: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    filter: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
    transform: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    ai: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    partition: 'bg-pink-50 dark:bg-pink-900/20 border-pink-200 dark:border-pink-800',
    delivery: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800',
    edge_case: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
  }[step.type]

  return (
    <div className={`p-4 rounded-lg border ${bgColor}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-white dark:bg-gray-800 rounded-full text-sm font-semibold text-gray-700 dark:text-gray-300">
          {stepNumber}
        </div>
        <div className="flex-grow">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{step.icon}</span>
            <h4 className="font-semibold text-gray-900 dark:text-white">
              {step.title}
            </h4>
          </div>
          {step.details.length > 0 && (
            <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {step.details.map((detail, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-gray-400 dark:text-gray-500">•</span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function EstimationCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
    </div>
  )
}
