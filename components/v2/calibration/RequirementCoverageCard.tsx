/**
 * @deprecated Unused/unrendered as of 2026-06-02 — superseded by the CalibrationSetup UI.
 * Slated for removal pending sign-off. See docs/Calibration/CALIBRATION_OVERVIEW.md § Dead Code / Cleanup Backlog.
 */
'use client';

// components/v2/calibration/RequirementCoverageCard.tsx
// Shows which requirements are met vs missing

import { CheckCircle, AlertTriangle } from 'lucide-react';

interface RequirementCoverage {
  totalRequirements: number;
  coveredRequirements: number;
  missingRequirements: Array<{
    requirement: string;
    reason: string;
  }>;
  enforcement: Array<{
    requirement: string;
    enforcedBy: string[];
  }>;
}

interface RequirementCoverageCardProps {
  coverage: RequirementCoverage;
}

export function RequirementCoverageCard({ coverage }: RequirementCoverageCardProps) {
  const percentage = coverage.totalRequirements > 0
    ? (coverage.coveredRequirements / coverage.totalRequirements) * 100
    : 0;

  const isComplete = percentage === 100;

  return (
    <div className="border rounded-lg p-6 bg-white shadow-sm">
      <h3 className="font-semibold text-gray-900 mb-4">Requirement Coverage</h3>

      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
          <div
            style={{ width: `${percentage}%` }}
            className={`h-full transition-all duration-500 ${
              isComplete ? 'bg-green-500' : 'bg-amber-500'
            }`}
          />
        </div>
        <div className="text-sm font-semibold text-gray-900 min-w-[60px] text-right">
          {coverage.coveredRequirements}/{coverage.totalRequirements}
          <span className="text-xs text-gray-600 ml-1">({Math.round(percentage)}%)</span>
        </div>
      </div>

      {/* Status message */}
      {isComplete ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            <div className="text-sm font-medium text-green-900">
              All requirements met!
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div className="text-sm font-medium text-amber-900">
              {coverage.missingRequirements.length} requirement
              {coverage.missingRequirements.length === 1 ? '' : 's'} not met
            </div>
          </div>
        </div>
      )}

      {/* Missing requirements */}
      {coverage.missingRequirements.length > 0 && (
        <div className="space-y-2 mb-4">
          <div className="text-sm font-medium text-red-600">
            Missing Requirements:
          </div>
          {coverage.missingRequirements.map((req, idx) => (
            <div
              key={idx}
              className="bg-red-50 border border-red-200 rounded p-3"
            >
              <div className="text-sm font-medium text-red-900">
                {req.requirement}
              </div>
              <div className="text-xs text-red-700 mt-1">
                {req.reason}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Covered requirements (collapsible) */}
      {coverage.enforcement.length > 0 && isComplete && (
        <div>
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
              Show enforcement details ({coverage.enforcement.length} requirements)
            </summary>
            <div className="mt-3 space-y-2">
              {coverage.enforcement.map((enf, idx) => (
                <div
                  key={idx}
                  className="bg-green-50 border border-green-200 rounded p-3"
                >
                  <div className="font-medium text-green-900 text-sm">
                    {enf.requirement}
                  </div>
                  <div className="text-xs text-green-700 mt-1">
                    Enforced by: {enf.enforcedBy.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
