'use client';

import { useState, useCallback } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  X,
  ArrowRight,
  Sparkles,
  BarChart3,
  Wallet,
  Users,
  Calendar,
  Activity,
  Globe,
  Banknote,
  Tag,
  Settings,
  DollarSign,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CorrelatedInsightData } from '@/hooks/useInsights';

// ===========================
// Types
// ===========================

interface CorrelatedInsightCardProps {
  insight: CorrelatedInsightData;
  onAction?: (action: 'run' | 'snooze' | 'dismiss', insightId: string) => Promise<void>;
  onDismiss?: () => void;
}

// ===========================
// Pattern Styles - category-specific colors and icons
// ===========================

const PATTERN_STYLES: Record<string, { color: string; bg: string; glow: string; Icon: LucideIcon }> = {
  funnel_breakdown: { color: '#F97316', bg: 'rgba(249,115,22,0.12)', glow: 'rgba(249,115,22,0.08)', Icon: BarChart3 },
  revenue_at_risk: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', glow: 'rgba(239,68,68,0.08)', Icon: DollarSign },
  retention_crisis: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)', glow: 'rgba(139,92,246,0.08)', Icon: Users },
  pipeline_stall: { color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)', glow: 'rgba(14,165,233,0.08)', Icon: BarChart3 },
  capacity_mismatch: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', glow: 'rgba(245,158,11,0.08)', Icon: Calendar },
  service_health: { color: '#EC4899', bg: 'rgba(236,72,153,0.12)', glow: 'rgba(236,72,153,0.08)', Icon: Activity },
  website_crisis: { color: '#10B981', bg: 'rgba(16,185,129,0.12)', glow: 'rgba(16,185,129,0.08)', Icon: Globe },
  cash_flow_warning: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', glow: 'rgba(245,158,11,0.08)', Icon: Banknote },
  pricing_issue: { color: '#D946EF', bg: 'rgba(217,70,239,0.12)', glow: 'rgba(217,70,239,0.08)', Icon: Tag },
  ops_inefficiency: { color: '#6366F1', bg: 'rgba(99,102,241,0.12)', glow: 'rgba(99,102,241,0.08)', Icon: Settings },
};

const DEFAULT_PATTERN = { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', glow: 'rgba(239,68,68,0.08)', Icon: Wallet };

const SEVERITY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', label: 'Critical' },
  high: { color: '#F97316', bg: 'rgba(249,115,22,0.12)', label: 'High' },
  medium: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', label: 'Medium' },
  low: { color: '#22C55E', bg: 'rgba(34,197,94,0.12)', label: 'Low' },
};

// ===========================
// Component
// ===========================

export function CorrelatedInsightCard({
  insight,
  onAction,
  onDismiss,
}: CorrelatedInsightCardProps) {
  const { t, isRTL, formatCurrency } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  const pattern = PATTERN_STYLES[insight.correlation_pattern_id || ''] || DEFAULT_PATTERN;
  const severity = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.medium;
  const totalImpact = insight.total_correlated_impact_usd || insight.estimated_impact_usd || 0;
  const contributingCount = insight.contributing_insights?.length || 0;
  const PatternIcon = pattern.Icon;

  // Handle primary action
  const handleAction = useCallback(async () => {
    if (onAction) {
      await onAction('run', insight.id);
    }
  }, [insight.id, onAction]);

  // Handle dismiss
  const handleDismiss = useCallback(async () => {
    if (onAction) {
      await onAction('dismiss', insight.id);
    }
    if (onDismiss) {
      onDismiss();
    }
  }, [insight.id, onAction, onDismiss]);

  const isCritical = insight.severity === 'critical';

  return (
    <div
      className="relative overflow-hidden transition-all duration-300 hover:shadow-md"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        borderRadius: '16px',
        background: isCritical
          ? `linear-gradient(135deg, ${severity.bg} 0%, var(--v2-bg) 60%)`
          : 'var(--v2-bg)',
        border: isCritical
          ? `2px solid ${severity.color}4D`
          : '1px solid var(--v2-border)',
      }}
    >
      {/* Top accent line for critical alerts */}
      {isCritical && (
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${severity.color}, #F97316)`,
            borderRadius: '16px 16px 0 0',
          }}
        />
      )}

      {/* Side accent stripe for non-critical */}
      {!isCritical && (
        <div
          className="absolute top-0 bottom-0 w-1"
          style={{
            [isRTL ? 'right' : 'left']: 0,
            background: severity.color,
            borderRadius: isRTL ? '0 16px 16px 0' : '16px 0 0 16px',
          }}
        />
      )}

      {/* Subtle glow overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isCritical
            ? `radial-gradient(circle at ${isRTL ? 'bottom right' : 'top left'}, ${severity.color}20, transparent 60%)`
            : `radial-gradient(ellipse at ${isRTL ? 'top left' : 'top right'}, ${pattern.glow}, transparent 50%)`,
          opacity: isCritical ? 0.5 : 1,
        }}
      />

      {/* Card Content */}
      <div className="relative" style={{ padding: isCritical ? '20px' : '16px' }}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          {/* Left: Icon + Meta */}
          <div className="flex items-start gap-2.5">
            {/* Category icon */}
            <div
              className="rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                width: isCritical ? '40px' : '36px',
                height: isCritical ? '40px' : '36px',
                background: pattern.bg,
                boxShadow: isCritical ? `0 6px 16px ${severity.color}40` : undefined,
              }}
            >
              <PatternIcon
                className={isCritical ? 'w-5 h-5' : 'w-4 h-4'}
                style={{ color: pattern.color }}
                strokeWidth={2}
              />
            </div>

            {/* Title + Badges */}
            <div className="min-w-0">
              <h3
                className="text-[var(--v2-text-primary)] font-semibold mb-0.5"
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
                  fontSize: '14px',
                  lineHeight: 1.3,
                }}
              >
                {t(`insight.pattern.${insight.correlation_pattern_id}`) ||
                 insight.correlation_pattern_id?.replace(/_/g, ' ') || 'Alert'}
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Severity badge */}
                <span
                  className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded"
                  style={{ background: severity.bg, color: severity.color, letterSpacing: '0.03em', fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
                >
                  {t(`insight.severity.${insight.severity}`) || severity.label}
                </span>
                {contributingCount > 0 && (
                  <span
                    className="text-[10px] text-[var(--v2-text-muted)]"
                    style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
                  >
                    {contributingCount} {t('insight.signals') || 'signals'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:border-[var(--v2-border-hover)] transition-all flex-shrink-0"
          >
            <X className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" strokeWidth={2} />
          </button>
        </div>

        {/* Description/Story */}
        <p
          className={isCritical ? 'text-[var(--v2-text-primary)] mb-4' : 'text-[var(--v2-text-secondary)] mb-3'}
          style={{
            fontSize: isCritical ? '15px' : '13px',
            lineHeight: 1.5,
            fontWeight: isCritical ? 500 : 400,
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
          }}
          dangerouslySetInnerHTML={{
            __html: (insight.story || insight.description || '').replace(
              /(\$[\d,]+|₪[\d,]+|€[\d,]+)/g,
              `<strong style="color: ${severity.color}">$1</strong>`
            )
          }}
        />

        {/* Impact banner + Action buttons in same row */}
        <div
          className="flex items-center justify-between gap-3 p-3 rounded-lg mb-3"
          style={{
            background: severity.bg,
            border: `1px solid ${severity.color}25`,
          }}
        >
          {/* Left: Impact info */}
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${severity.color}20` }}
            >
              <AlertTriangle className="w-4 h-4" style={{ color: severity.color }} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div
                className="text-[10px] uppercase font-medium text-[var(--v2-text-muted)] mb-0.5 tracking-wide"
                style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
              >
                {t('insight.total_exposure') || 'Total exposure'}
              </div>
              <div
                className="text-xl font-bold"
                style={{ color: severity.color, fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif' }}
              >
                {totalImpact > 0 ? formatCurrency(totalImpact, { showFree: false }) : '$0'}
              </div>
            </div>
          </div>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Primary action button */}
            <button
              onClick={handleAction}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg font-semibold text-[12px] text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                background: `linear-gradient(135deg, ${pattern.color} 0%, ${pattern.color}dd 100%)`,
                boxShadow: `0 6px 16px -6px ${pattern.color}60`,
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
              }}
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
              {t('insight.action.take_action') || 'Take action'}
            </button>

            {/* Secondary action */}
            <button
              onClick={() => onAction?.('snooze', insight.id)}
              className="px-3 py-2.5 rounded-lg font-medium text-[12px] bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:border-[var(--v2-border-hover)] transition-all"
              style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
            >
              {t('insight.snooze') || 'Not now'}
            </button>
          </div>
        </div>

        {/* Contributing signals */}
        {contributingCount > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 text-[12px] font-medium px-2 py-1.5 rounded-md transition-all hover:bg-[var(--v2-surface)]"
              style={{ color: 'var(--v2-text-secondary)', fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
            >
              <ChevronDown
                className="w-3.5 h-3.5 transition-transform"
                style={{ transform: expanded ? 'rotate(0deg)' : isRTL ? 'rotate(90deg)' : 'rotate(-90deg)' }}
                strokeWidth={2}
              />
              {t('insight.contributing_signals') || 'What led to this'} ({contributingCount})
            </button>

            {expanded && (
              <div className={`mt-2 grid gap-2 ${isCritical ? 'grid-cols-1 md:grid-cols-3' : 'gap-1.5'}`}>
                {insight.contributing_insights?.map((signal, idx) => {
                  const signalSeverity = SEVERITY_STYLES[signal.severity] || SEVERITY_STYLES.medium;
                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] relative overflow-hidden"
                    >
                      {/* Severity indicator dot */}
                      <div
                        className="absolute w-1.5 h-1.5 rounded-full"
                        style={{
                          top: '10px',
                          [isRTL ? 'right' : 'left']: '10px',
                          background: signalSeverity.color,
                        }}
                      />
                      <div className="flex items-start justify-between gap-2 mb-1.5" style={{ paddingRight: isRTL ? '12px' : undefined, paddingLeft: !isRTL ? '12px' : undefined }}>
                        <span
                          className="text-[10px] font-semibold uppercase text-[var(--v2-text-muted)] tracking-wide"
                          style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
                        >
                          {t(`insight.detector.${signal.detector_id}`) || signal.detector_name}
                        </span>
                        <span
                          className="text-[8px] font-semibold uppercase px-1 py-0.5 rounded"
                          style={{ background: signalSeverity.bg, color: signalSeverity.color, fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
                        >
                          {t(`insight.severity.${signal.severity}`) || signalSeverity.label}
                        </span>
                      </div>
                      <p
                        className="text-[12px] text-[var(--v2-text-primary)] mb-1.5"
                        style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit', lineHeight: 1.4 }}
                      >
                        {signal.summary}
                      </p>
                      {signal.impact_usd > 0 && (
                        <span
                          className="text-[11px] text-[var(--v2-text-muted)]"
                          style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
                        >
                          <strong style={{ color: signalSeverity.color }}>
                            {formatCurrency(signal.impact_usd, { showFree: false })}
                          </strong>{' '}
                          {t('insight.at_risk') || 'at risk'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
