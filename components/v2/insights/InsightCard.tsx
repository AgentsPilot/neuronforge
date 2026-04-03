/**
 * Insight Card Component
 *
 * Displays a single insight with:
 * - Title, description, severity badge
 * - Business impact section
 * - Recommendation with "Apply" button
 * - Dismiss/Snooze actions
 *
 * Uses V2 design system
 */

'use client';

import React, { useState } from 'react';
import { Card } from '@/components/v2/ui/card';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  X,
  Clock,
  Sparkles,
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

  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case 'critical':
        return {
          icon: AlertCircle,
          bg: 'bg-red-50 dark:bg-red-900/20',
          border: 'border-red-200 dark:border-red-800',
          text: 'text-red-700 dark:text-red-400',
          badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
        };
      case 'high':
        return {
          icon: AlertTriangle,
          bg: 'bg-orange-50 dark:bg-orange-900/20',
          border: 'border-orange-200 dark:border-orange-800',
          text: 'text-orange-700 dark:text-orange-400',
          badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
        };
      case 'medium':
        return {
          icon: Info,
          bg: 'bg-blue-50 dark:bg-blue-900/20',
          border: 'border-blue-200 dark:border-blue-800',
          text: 'text-blue-700 dark:text-blue-400',
          badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
        };
      default: // low
        return {
          icon: Info,
          bg: 'bg-gray-50 dark:bg-gray-800/50',
          border: 'border-gray-200 dark:border-gray-700',
          text: 'text-gray-700 dark:text-gray-400',
          badge: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400',
        };
    }
  };

  const config = getSeverityConfig(insight.severity);
  const SeverityIcon = config.icon;

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

  return (
    <Card
      className={`border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 ${compact ? 'sm:!p-4' : 'sm:!p-5'}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`flex-shrink-0 w-10 h-10 rounded-full ${config.bg} ${config.border} border flex items-center justify-center`}>
            <SeverityIcon className={`w-5 h-5 ${config.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] truncate">
                {insight.title}
              </h4>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge} whitespace-nowrap`}
              >
                {insight.severity}
              </span>
            </div>
            <p className="text-xs text-[var(--v2-text-muted)] capitalize">
              {insight.category.replace('_', ' ')} • {insight.confidence.replace('_', ' ')}
            </p>
          </div>
        </div>

        {/* Dismiss button */}
        {onDismiss && insight.status !== 'dismissed' && (
          <button
            onClick={() => onDismiss(insight.id)}
            className="flex-shrink-0 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Description */}
      <div className="mb-3">
        <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">
          {insight.description}
        </p>
      </div>

      {/* Business Impact */}
      {!compact && (
        <div className="mb-4 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg">
          <h5 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-1">
            Business Impact
          </h5>
          <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
            {insight.business_impact}
          </p>
        </div>
      )}

      {/* Recommendation */}
      <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
        <h5 className="text-xs font-semibold text-emerald-900 dark:text-emerald-200 mb-1">
          Recommendation
        </h5>
        <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
          {insight.recommendation}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {onApply && insight.status !== 'applied' && (
          <button
            onClick={handleApply}
            disabled={isApplying}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity text-xs font-medium shadow-sm disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {isApplying ? (
              <>
                <Sparkles className="w-3.5 h-3.5 animate-spin" />
                Marking...
              </>
            ) : (
              <>
                <CheckCircle className="w-3.5 h-3.5" />
                Resolved
              </>
            )}
          </button>
        )}

        {insight.status === 'applied' && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-lg">
            <CheckCircle className="w-3.5 h-3.5" />
            Resolved
          </span>
        )}

        {onSnooze && insight.status !== 'snoozed' && (
          <div className="relative">
            <button
              onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors text-xs font-medium text-[var(--v2-text-primary)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Clock className="w-3.5 h-3.5" />
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

        {/* Metadata */}
        <div className="ml-auto text-xs text-[var(--v2-text-muted)]">
          {new Date(insight.created_at).toLocaleDateString()}
        </div>
      </div>
    </Card>
  );
}
