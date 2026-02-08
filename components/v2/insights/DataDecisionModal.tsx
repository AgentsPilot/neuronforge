/**
 * DataDecisionModal — User interface for data decision requests
 *
 * Shown when calibration status polling detects status='paused_for_decision'.
 * Presents options to user, submits choice via API.
 *
 * Options (based on Phase 4 spec):
 * - Stop workflow and alert me
 * - Continue with empty data (process 0 items)
 * - Skip remaining steps
 *
 * [☑] Remember my choice for future runs
 *
 * @module components/v2/insights/DataDecisionModal
 */

'use client';

import { useState } from 'react';
import type { DataDecisionRequest } from '@/lib/pilot/shadow/types';

interface DataDecisionModalProps {
  decisionRequest: DataDecisionRequest;
  onDecisionMade: (decision: 'continue' | 'stop' | 'skip', remember: boolean) => void;
  onClose: () => void;
}

export function DataDecisionModal({
  decisionRequest,
  onDecisionMade,
  onClose,
}: DataDecisionModalProps) {
  const [selectedAction, setSelectedAction] = useState<'continue' | 'stop' | 'skip'>('stop');
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const context = decisionRequest.decision_context;
  const dataFieldLabel = context.dataField || 'data';
  const operatorLabel = context.operator === 'empty' ? 'returned no results' :
                        context.operator === 'missing' ? 'is missing' :
                        'is null';

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Call API to respond to decision request
      const response = await fetch(`/api/v6/data-decisions/${decisionRequest.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: selectedAction,
          remember,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit decision');
      }

      // Notify parent component
      onDecisionMade(selectedAction, remember);
    } catch (err) {
      console.error('[DataDecisionModal] Error submitting decision:', err);
      alert('Failed to submit decision. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Data Unavailable
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Step: <span className="font-medium">{decisionRequest.step_name}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            disabled={isSubmitting}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Problem description */}
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                The step <span className="font-medium">{decisionRequest.step_name}</span> {operatorLabel}.
                Field: <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900 px-1 py-0.5 rounded">{dataFieldLabel}</span>
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                The workflow is paused. How would you like to proceed?
              </p>
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3 mb-6">
          {/* Option 1: Stop */}
          <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
            style={{
              borderColor: selectedAction === 'stop' ? '#3b82f6' : '#e5e7eb',
              backgroundColor: selectedAction === 'stop' ? '#eff6ff' : 'transparent'
            }}
          >
            <input
              type="radio"
              name="action"
              value="stop"
              checked={selectedAction === 'stop'}
              onChange={(e) => setSelectedAction(e.target.value as 'stop')}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            <div className="ml-3 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Stop workflow and alert me
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                The workflow will stop here. You can review the issue and manually restart if needed.
              </div>
            </div>
          </label>

          {/* Option 2: Continue */}
          <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
            style={{
              borderColor: selectedAction === 'continue' ? '#3b82f6' : '#e5e7eb',
              backgroundColor: selectedAction === 'continue' ? '#eff6ff' : 'transparent'
            }}
          >
            <input
              type="radio"
              name="action"
              value="continue"
              checked={selectedAction === 'continue'}
              onChange={(e) => setSelectedAction(e.target.value as 'continue')}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            <div className="ml-3 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Continue with empty data
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                The workflow will proceed, processing 0 items. Subsequent steps will handle the empty data.
              </div>
            </div>
          </label>

          {/* Option 3: Skip */}
          <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
            style={{
              borderColor: selectedAction === 'skip' ? '#3b82f6' : '#e5e7eb',
              backgroundColor: selectedAction === 'skip' ? '#eff6ff' : 'transparent'
            }}
          >
            <input
              type="radio"
              name="action"
              value="skip"
              checked={selectedAction === 'skip'}
              onChange={(e) => setSelectedAction(e.target.value as 'skip')}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            <div className="ml-3 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Skip remaining steps
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                The workflow will skip all steps after this one and complete immediately.
              </div>
            </div>
          </label>
        </div>

        {/* Remember checkbox */}
        <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
          <label className="flex items-start cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
            />
            <div className="ml-3 flex-1">
              <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Remember my choice for future runs
              </div>
              <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                This decision will be saved as a behavior rule. When the same pattern is detected in future calibration runs,
                your choice will be applied automatically without pausing.
              </div>
            </div>
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Submitting...
              </>
            ) : (
              'Submit Decision'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
