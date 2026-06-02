'use client';

// components/v2/calibration/AutoFixProgress.tsx
// Shows auto-fix progress to non-technical users (NO technical details)

import { useState, useEffect } from 'react';
import { Loader, CheckCircle, AlertTriangle, HelpCircle } from 'lucide-react';
import { UserQuestionCard } from './UserQuestionCard';

interface Fix {
  issue: string;
  fix: string;
  automatic: boolean;
  confidence?: number;
}

interface UnfixableIssue {
  id: string;
  type: string;
  title: string;
  description: string;
  userQuestion: string;
  options: Array<{ label: string; value: string }>;
}

interface AutoFixResult {
  success: boolean;
  fixesApplied: Fix[];
  unfixableIssues?: UnfixableIssue[];
  finalAgent?: any;
  partialAgent?: any;
  message: string;
}

interface AutoFixProgressProps {
  agentId: string;
  onComplete?: (result: AutoFixResult) => void;
  onError?: (error: string) => void;
}

export function AutoFixProgress({
  agentId,
  onComplete,
  onError
}: AutoFixProgressProps) {
  const [status, setStatus] = useState<'fixing' | 'preview' | 'ready' | 'error'>('fixing');
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [unfixableIssues, setUnfixableIssues] = useState<UnfixableIssue[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showFixDetails, setShowFixDetails] = useState(false);

  useEffect(() => {
    runAutoFix();
  }, [agentId]);

  async function runAutoFix() {
    try {
      setStatus('fixing');

      const response = await fetch('/api/v2/calibrate/auto-fix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to auto-fix workflow');
      }

      const result: AutoFixResult = await response.json();

      setFixes(result.fixesApplied);

      if (result.success) {
        setStatus('ready');
        onComplete?.(result);
      } else if (result.unfixableIssues && result.unfixableIssues.length > 0) {
        setUnfixableIssues(result.unfixableIssues);
        setStatus('preview');
      } else {
        setStatus('error');
        setErrorMessage(result.message || 'Unknown error occurred');
        onError?.(result.message);
      }

    } catch (error: any) {
      console.error('Auto-fix failed:', error);
      setStatus('error');
      setErrorMessage(error.message || 'Failed to optimize workflow');
      onError?.(error.message);
    }
  }

  async function handleUserAnswer(issueId: string, answer: string) {
    // TODO: Send answer to backend to regenerate workflow with user input
    // For now, just remove the issue from the list
    setUnfixableIssues(prev => prev.filter(issue => issue.id !== issueId));

    // If no more unfixable issues, move to ready state
    if (unfixableIssues.length === 1) {
      setStatus('ready');
    }
  }

  return (
    <div className="space-y-4">
      {/* Auto-fix in progress */}
      {status === 'fixing' && (
        <div className="border border-[var(--v2-border)] rounded-lg p-6 bg-blue-50 dark:bg-blue-900/20 text-center">
          <Loader className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-600 dark:text-blue-400" />
          <h3 className="text-lg font-medium text-[var(--v2-text-primary)]">
            Optimizing your workflow...
          </h3>
          <p className="text-sm text-[var(--v2-text-muted)] mt-2">
            Checking for issues and applying automatic fixes
          </p>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="border-2 border-red-400 rounded-lg p-6 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h3 className="text-lg font-medium text-red-900">
                Unable to optimize workflow
              </h3>
              <p className="text-sm text-red-700 mt-2">
                {errorMessage}
              </p>
              <button
                onClick={runAutoFix}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fixes applied summary */}
      {(status === 'preview' || status === 'ready') && fixes.length > 0 && (
        <div className="border rounded-lg p-4 bg-green-50">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h3 className="font-medium text-green-900">
              Fixed {fixes.length} {fixes.length === 1 ? 'issue' : 'issues'} automatically!
            </h3>
          </div>

          {/* Collapsible details */}
          {fixes.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowFixDetails(!showFixDetails)}
                className="text-sm text-green-700 hover:text-green-800 underline"
              >
                {showFixDetails ? 'Hide' : 'Show'} what was fixed
              </button>

              {showFixDetails && (
                <div className="mt-2 space-y-1">
                  {fixes.map((fix, idx) => (
                    <div
                      key={idx}
                      className="text-sm bg-white rounded p-2 border border-green-200"
                    >
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-700">{fix.fix}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Unfixable issues - ASK USER SIMPLE QUESTIONS */}
      {status === 'preview' && unfixableIssues.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-blue-600" />
            <h3 className="font-medium text-gray-900">
              I need your help with {unfixableIssues.length}{' '}
              {unfixableIssues.length === 1 ? 'thing' : 'things'}:
            </h3>
          </div>

          {unfixableIssues.map((issue, idx) => (
            <UserQuestionCard
              key={issue.id}
              question={issue.userQuestion}
              description={issue.description}
              options={issue.options}
              onAnswer={(answer) => handleUserAnswer(issue.id, answer)}
            />
          ))}
        </div>
      )}

      {/* Ready state */}
      {status === 'ready' && (
        <div className="border-2 border-green-400 rounded-lg p-6 bg-green-50">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-medium text-green-900">
                Workflow is ready!
              </h3>
              <p className="text-sm text-green-700 mt-2">
                All issues have been resolved. You can now preview or run your workflow.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
