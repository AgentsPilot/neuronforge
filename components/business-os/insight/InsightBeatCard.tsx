'use client';

import { Sparkles, Lightbulb, AlertTriangle, TrendingUp, DollarSign } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface InsightBeatData {
  id: string;
  type: 'insight_action' | 'insight_offer';
  title: string;
  subtitle: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  estimatedImpactUsd?: number;
  impactDirection?: 'loss' | 'opportunity' | 'savings';
  hasAction: boolean;
  affectedCount: number;
}

interface InsightBeatCardProps {
  insight: InsightBeatData;
  onClick: () => void;
}

// ===========================
// Styles
// ===========================

const BEAT_STYLES = {
  insight_action: {
    tagBg: 'rgba(34, 197, 139, 0.13)',
    tagColor: '#128a5e',
    iconBg: 'rgba(34, 197, 139, 0.13)',
    iconColor: '#22C58B',
    Icon: Sparkles,
    label: 'Handled',
  },
  insight_offer: {
    tagBg: 'rgba(249, 115, 22, 0.12)',
    tagColor: '#F97316',
    iconBg: 'rgba(249, 115, 22, 0.12)',
    iconColor: '#F97316',
    Icon: Lightbulb,
    label: 'Insight',
  },
};

const SEVERITY_COLORS = {
  low: '#6B7280',
  medium: '#F59E0B',
  high: '#EF4444',
  critical: '#DC2626',
};

// ===========================
// Component
// ===========================

export function InsightBeatCard({ insight, onClick }: InsightBeatCardProps) {
  const { isRTL } = useLanguage();
  const style = BEAT_STYLES[insight.type];
  const Icon = style.Icon;
  const isOffer = insight.type === 'insight_offer';

  const formatCurrency = (value: number) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}k`;
    }
    return `$${value}`;
  };

  return (
    <div
      onClick={onClick}
      className={`
        relative bg-[var(--v2-bg)] border border-[var(--v2-border)]
        transition-all cursor-pointer
        hover:border-[#F97316] hover:bg-[var(--v2-surface)]
        ${isOffer ? 'hover:shadow-lg' : ''}
      `}
      style={{ borderRadius: '15px', padding: '14px 15px' }}
    >
      {/* Tag */}
      <span
        className="absolute flex items-center gap-1"
        style={{
          top: '13px',
          [isRTL ? 'left' : 'right']: '13px',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          padding: '2px 6px',
          borderRadius: '5px',
          background: style.tagBg,
          color: style.tagColor,
        }}
      >
        {isOffer && (
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: style.iconColor }}
          />
        )}
        {style.label}
      </span>

      {/* Icon */}
      <div
        className="w-8 h-8 flex items-center justify-center mb-3"
        style={{ borderRadius: '9px', background: style.iconBg }}
      >
        <Icon className="w-4 h-4" style={{ color: style.iconColor }} strokeWidth={2} />
      </div>

      {/* Content */}
      <b
        className="block text-[var(--v2-text-primary)] mb-1"
        style={{ fontSize: '13.5px', fontWeight: 600, lineHeight: 1.3 }}
      >
        {insight.title}
      </b>
      <small
        className="text-[var(--v2-text-muted)] block"
        style={{ fontSize: '12px', lineHeight: 1.4 }}
      >
        {insight.subtitle}
      </small>

      {/* Impact indicator for offers */}
      {isOffer && insight.estimatedImpactUsd && (
        <div className="flex items-center gap-1.5 mt-2">
          {insight.impactDirection === 'loss' ? (
            <AlertTriangle className="w-3 h-3" style={{ color: SEVERITY_COLORS[insight.severity] }} />
          ) : (
            <TrendingUp className="w-3 h-3 text-[#22C58B]" />
          )}
          <span
            className="text-xs font-medium"
            style={{
              color: insight.impactDirection === 'loss'
                ? SEVERITY_COLORS[insight.severity]
                : '#22C58B',
            }}
          >
            {formatCurrency(insight.estimatedImpactUsd)}
            {insight.impactDirection === 'loss' ? ' at risk' : ' opportunity'}
          </span>
        </div>
      )}

      {/* Call to action for offers */}
      {isOffer && insight.hasAction && (
        <div
          className="mt-3 pt-2 border-t border-[var(--v2-border)] flex items-center justify-between"
        >
          <span className="text-xs text-[#F97316] font-medium">
            Run this for me?
          </span>
          <span className="text-xs text-[var(--v2-text-muted)]">
            →
          </span>
        </div>
      )}
    </div>
  );
}
