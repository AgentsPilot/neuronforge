'use client';

import { useState } from 'react';
import { X, AlertTriangle, TrendingUp, DollarSign, Clock, Zap, ChevronRight, Sparkles } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface InsightProjection {
  doNothing: {
    summary: string;
    details: string;
    projectedLoss?: number;
    projectedEffort?: string;
  };
  letMeHandleIt: {
    summary: string;
    details: string;
    projectedOutcome: {
      cashRecovered?: number;
      timeSaved?: number;
      leadsContacted?: number;
      remindersSet?: number;
    };
  };
  confidence: 'low' | 'medium' | 'high';
  basis: string;
}

export interface InsightProcess {
  id: string;
  name: string;
  description: string;
  parameters: Array<{
    id: string;
    label: string;
    type: string;
    default: unknown;
    options?: Array<{ value: string; label: string }>;
  }>;
  eligibleForAutomation: boolean;
  estimatedTimeSaved: number;
}

export interface InsightData {
  id: string;
  detector_id: string;
  title: string;
  description: string;
  recommendation?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  status: 'new' | 'viewed' | 'snoozed' | 'dismissed' | 'acted' | 'automated';
  current_value?: number;
  baseline_value?: number;
  percent_change?: number;
  affected_count: number;
  estimated_impact_usd?: number;
  impact_direction?: 'loss' | 'opportunity' | 'savings';
  paired_process_id?: string;
  eligible_for_automation: boolean;
  process_parameters?: Record<string, unknown>;
  priority_score: number;
  surface_count: number;
  detected_at: string;
  created_at: string;
  updated_at: string;
}

interface InsightDetailModalProps {
  insight: InsightData;
  projection?: InsightProjection;
  process?: InsightProcess | null;
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: 'run' | 'automate' | 'snooze' | 'dismiss', params?: Record<string, unknown>) => Promise<void>;
  loading?: boolean;
}

// ===========================
// Severity Styles
// ===========================

const SEVERITY_STYLES = {
  low: {
    bg: 'rgba(107, 114, 128, 0.1)',
    color: '#6B7280',
    label: 'Low Priority',
  },
  medium: {
    bg: 'rgba(245, 158, 11, 0.1)',
    color: '#F59E0B',
    label: 'Medium Priority',
  },
  high: {
    bg: 'rgba(239, 68, 68, 0.1)',
    color: '#EF4444',
    label: 'High Priority',
  },
  critical: {
    bg: 'rgba(220, 38, 38, 0.15)',
    color: '#DC2626',
    label: 'Critical',
  },
};

// ===========================
// Component
// ===========================

export function InsightDetailModal({
  insight,
  projection,
  process,
  isOpen,
  onClose,
  onAction,
  loading = false,
}: InsightDetailModalProps) {
  const { t, isRTL } = useLanguage();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (!isOpen) return null;

  const severityStyle = SEVERITY_STYLES[insight.severity];

  const handleAction = async (action: 'run' | 'automate' | 'snooze' | 'dismiss') => {
    setActionLoading(action);
    try {
      await onAction(action);
      if (action === 'run' || action === 'dismiss') {
        onClose();
      }
    } finally {
      setActionLoading(null);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatMinutes = (minutes: number) => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${minutes}m`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}
        onClick={(e) => e.stopPropagation()}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] p-4 flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="px-2 py-0.5 text-xs font-semibold rounded-full"
                style={{ background: severityStyle.bg, color: severityStyle.color }}
              >
                {severityStyle.label}
              </span>
              <span className="text-xs text-[var(--v2-text-muted)] capitalize">
                {insight.category.replace('_', ' ')}
              </span>
            </div>
            <h2
              className="text-lg font-semibold text-[var(--v2-text-primary)]"
              style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}
            >
              {insight.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--v2-bg)] text-[var(--v2-text-muted)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Description */}
          <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">
            {insight.description}
          </p>

          {/* Impact Stats */}
          {(insight.estimated_impact_usd || insight.affected_count > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {insight.estimated_impact_usd && (
                <div
                  className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3"
                  style={{ borderRadius: '12px' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-[#22C58B]" />
                    <span className="text-xs text-[var(--v2-text-muted)]">
                      {insight.impact_direction === 'loss' ? 'Potential Loss' :
                       insight.impact_direction === 'opportunity' ? 'Opportunity' : 'Potential Savings'}
                    </span>
                  </div>
                  <span className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {formatCurrency(insight.estimated_impact_usd)}
                  </span>
                </div>
              )}
              {insight.affected_count > 0 && (
                <div
                  className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3"
                  style={{ borderRadius: '12px' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
                    <span className="text-xs text-[var(--v2-text-muted)]">Affected Items</span>
                  </div>
                  <span className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {insight.affected_count}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Before/After Projection */}
          {projection && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                What happens next?
              </h3>

              {/* Do Nothing */}
              <div
                className="bg-[rgba(239,68,68,0.05)] border border-[rgba(239,68,68,0.2)] p-3"
                style={{ borderRadius: '12px' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-[#EF4444]">DO NOTHING</span>
                </div>
                <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {projection.doNothing.summary}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                  {projection.doNothing.details}
                </p>
              </div>

              {/* Let Me Handle It */}
              <div
                className="bg-[rgba(34,197,139,0.05)] border border-[rgba(34,197,139,0.3)] p-3"
                style={{ borderRadius: '12px' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-[#22C58B]" />
                  <span className="text-xs font-semibold text-[#22C58B]">LET ME HANDLE IT</span>
                </div>
                <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {projection.letMeHandleIt.summary}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                  {projection.letMeHandleIt.details}
                </p>

                {/* Projected Outcome */}
                {(projection.letMeHandleIt.projectedOutcome.cashRecovered ||
                  projection.letMeHandleIt.projectedOutcome.timeSaved) && (
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[rgba(34,197,139,0.2)]">
                    {projection.letMeHandleIt.projectedOutcome.cashRecovered && (
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-[#22C58B]" />
                        <span className="text-xs text-[#22C58B] font-medium">
                          ~{formatCurrency(projection.letMeHandleIt.projectedOutcome.cashRecovered)} recovered
                        </span>
                      </div>
                    )}
                    {projection.letMeHandleIt.projectedOutcome.timeSaved && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#22C58B]" />
                        <span className="text-xs text-[#22C58B] font-medium">
                          {formatMinutes(projection.letMeHandleIt.projectedOutcome.timeSaved)} saved
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Confidence */}
              <p className="text-xs text-[var(--v2-text-muted)] italic">
                {projection.basis}
              </p>
            </div>
          )}

          {/* Recommendation */}
          {insight.recommendation && !projection && (
            <div
              className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3"
              style={{ borderRadius: '12px' }}
            >
              <h3 className="text-xs font-semibold text-[var(--v2-text-muted)] mb-2">
                RECOMMENDATION
              </h3>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                {insight.recommendation}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-[var(--v2-surface)] border-t border-[var(--v2-border)] p-4">
          <div className="flex flex-col gap-2">
            {/* Primary Action */}
            {insight.paired_process_id && (
              <button
                onClick={() => handleAction('run')}
                disabled={loading || actionLoading !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #22C58B 0%, #1BA97A 100%)' }}
              >
                {actionLoading === 'run' ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Run this for me</span>
                  </>
                )}
              </button>
            )}

            {/* Secondary Actions */}
            <div className="flex gap-2">
              {insight.eligible_for_automation && (
                <button
                  onClick={() => handleAction('automate')}
                  disabled={loading || actionLoading !== null}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Automate</span>
                </button>
              )}
              <button
                onClick={() => handleAction('snooze')}
                disabled={loading || actionLoading !== null}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-50"
              >
                <Clock className="w-4 h-4" />
                <span>Snooze</span>
              </button>
              <button
                onClick={() => handleAction('dismiss')}
                disabled={loading || actionLoading !== null}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                <span>Dismiss</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
