/**
 * Insight Card Component
 *
 * Accordion-style insight display with:
 * - Collapsible header with severity/category badges
 * - Expandable content showing business impact and recommendations
 * - Action buttons (Apply, Snooze, Dismiss)
 *
 * Matches ExecutionDetailPanel design
 */

'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  X,
  Clock,
  ChevronRight,
  ChevronDown,
  Target,
} from 'lucide-react';
import { ExecutionInsight } from '@/lib/pilot/insight/types';

interface InsightCardProps {
  insight: ExecutionInsight;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string, days: number) => void;
  onApply?: (id: string) => void;
  compact?: boolean;
}

export function InsightCard({
  insight,
  onDismiss,
  onSnooze,
  onApply,
  compact = false,
}: InsightCardProps) {
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Severity color helpers (EXACT match to ExecutionDetailPanel lines 235-251)
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-500'
      case 'high': return 'text-orange-500'
      case 'medium': return 'text-yellow-500'
      default: return 'text-blue-500'
    }
  }

  const getSeverityBg = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/10 border-red-500/30'
      case 'high': return 'bg-orange-500/10 border-orange-500/30'
      case 'medium': return 'bg-yellow-500/10 border-yellow-500/30'
      default: return 'bg-blue-500/10 border-blue-500/30'
    }
  }

  const handleApply = async () => {
    if (!onApply) return;
    setIsApplying(true);
    try {
      await onApply(insight.id);
    } finally {
      setIsApplying(false);
    }
  };

  const handleSnooze = (days: number) => {
    if (onSnooze) {
      onSnooze(insight.id, days);
    }
    setShowSnoozeMenu(false);
  };

  // Get metrics for display
  const affectedRuns = (insight.execution_ids?.length || 0);
  const frequency = (insight.metrics?.pattern_frequency || 0);

  return (
    <div className={`rounded-lg border overflow-hidden ${getSeverityBg(insight.severity)}`}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Severity Icon */}
          <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${getSeverityColor(insight.severity)}`} />

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title with badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                {insight.title}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getSeverityBg(insight.severity)} ${getSeverityColor(insight.severity)}`}>
                {insight.severity}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--v2-surface)] text-[var(--v2-text-muted)]">
                {insight.category}
              </span>
            </div>

            {/* Description */}
            <p className="text-xs text-[var(--v2-text-muted)] leading-relaxed">
              {insight.description}
            </p>

            {/* Metrics */}
            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--v2-text-muted)]">
              <span>{affectedRuns} affected runs</span>
              <span>•</span>
              <span>{(frequency * 100).toFixed(0)}% frequency</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 border-t border-[var(--v2-border)] space-y-4">
        {/* Business Impact */}
        {insight.business_impact && (
          <div className="mt-3">
            <h5 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-1 flex items-center gap-1">
              <Target className="w-3 h-3" /> Business Impact
            </h5>
            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
              {insight.business_impact}
            </p>
          </div>
        )}

        {/* Recommendation */}
        {insight.recommendation && (
          <div className="p-3 bg-[var(--v2-surface)] border-l-4 border-l-emerald-500 rounded">
            <h5 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-1">
              Recommendation
            </h5>
            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
              {insight.recommendation}
            </p>
          </div>
        )}

        {/* Pattern Data */}
        {insight.pattern_data && (
          <div className="text-xs text-[var(--v2-text-muted)]">
            <span className="font-medium">Pattern:</span>{' '}
            {(insight.pattern_data as any).occurrences || 0} occurrences in {((insight.pattern_data as any).affected_steps?.length || 0)} steps
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--v2-border)]">
          {onApply && insight.status !== 'applied' && (
            <button
              onClick={handleApply}
              disabled={isApplying}
              className="text-xs px-3 py-1.5 rounded bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isApplying ? 'Marking...' : 'Mark Resolved'}
            </button>
          )}

          {insight.status === 'applied' && (
            <span className="text-xs px-3 py-1.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Resolved
            </span>
          )}

          {onSnooze && insight.status !== 'snoozed' && (
            <div className="relative">
              <button
                onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
                className="text-xs px-3 py-1.5 rounded hover:bg-[var(--v2-surface-hover)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors flex items-center gap-1"
              >
                <Clock className="w-3 h-3" />
                Snooze
              </button>

              {showSnoozeMenu && (
                <div className="absolute top-full left-0 mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg z-10 min-w-[120px]">
                  <button
                    onClick={() => handleSnooze(1)}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] first:rounded-t-lg"
                  >
                    1 day
                  </button>
                  <button
                    onClick={() => handleSnooze(7)}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)]"
                  >
                    1 week
                  </button>
                  <button
                    onClick={() => handleSnooze(30)}
                    className="w-full text-left px-3 py-2 text-xs text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] last:rounded-b-lg"
                  >
                    1 month
                  </button>
                </div>
              )}
            </div>
          )}

          {onDismiss && insight.status !== 'dismissed' && (
            <button
              onClick={() => onDismiss(insight.id)}
              className="text-xs px-3 py-1.5 rounded hover:bg-[var(--v2-surface-hover)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors flex items-center gap-1"
              title="Dismiss insight"
            >
              <X className="w-3 h-3" />
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
