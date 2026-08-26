'use client';

import {
  Heart,
  TrendingUp,
  TrendingDown,
  Target,
  RefreshCw,
  Briefcase,
  Wallet,
  Users,
  Settings,
  Tag,
  Globe,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { BusinessHealthSummaryData } from '@/hooks/useInsights';

// ===========================
// Types
// ===========================

interface BusinessHealthSummaryCardProps {
  summary: BusinessHealthSummaryData;
  compact?: boolean;
}

// ===========================
// Category Config
// ===========================

const CATEGORY_CONFIG: Record<string, { icon: LucideIcon; labelKey: string; color: string }> = {
  acquisition: { icon: Target, labelKey: 'health.category.acquisition', color: '#F97316' },
  conversion: { icon: RefreshCw, labelKey: 'health.category.conversion', color: '#8B5CF6' },
  sales: { icon: Briefcase, labelKey: 'health.category.sales', color: '#3B82F6' },
  cash_flow: { icon: Wallet, labelKey: 'health.category.cash_flow', color: '#EF4444' },
  retention: { icon: Users, labelKey: 'health.category.retention', color: '#06B6D4' },
  operations: { icon: Settings, labelKey: 'health.category.operations', color: '#22C55E' },
  pricing: { icon: Tag, labelKey: 'health.category.pricing', color: '#EC4899' },
  website: { icon: Globe, labelKey: 'health.category.website', color: '#6366F1' },
};

// ===========================
// Helper Functions
// ===========================

function getScoreColor(score: number): string {
  if (score >= 80) return '#22C55E';
  if (score >= 60) return '#F59E0B';
  if (score >= 40) return '#F97316';
  return '#EF4444';
}

function getScoreGradient(score: number): { start: string; mid: string; end: string } {
  if (score >= 80) return { start: '#22C55E', mid: '#10B981', end: '#059669' };
  if (score >= 60) return { start: '#F59E0B', mid: '#D97706', end: '#B45309' };
  if (score >= 40) return { start: '#F97316', mid: '#EA580C', end: '#C2410C' };
  return { start: '#EF4444', mid: '#DC2626', end: '#B91C1C' };
}

function getScoreLabel(score: number, t: (key: string) => string): string {
  if (score >= 80) return t('health.excellent') || 'Excellent';
  if (score >= 60) return t('health.fair') || 'Good';
  if (score >= 40) return t('health.needs_work') || 'Needs work';
  return t('health.critical') || 'Critical';
}

// ===========================
// Component
// ===========================

export function BusinessHealthSummaryCard({
  summary,
  compact = false,
}: BusinessHealthSummaryCardProps) {
  const { t, isRTL } = useLanguage();

  const scoreColor = getScoreColor(summary.health_score);
  const scoreGradient = getScoreGradient(summary.health_score);
  const scoreLabel = getScoreLabel(summary.health_score, t);

  // Calculate score change indicator
  const hasChange = summary.score_change !== undefined && summary.score_change !== 0;
  const isImproving = (summary.score_change || 0) > 0;

  // Get category scores as array (8 categories to fill 2 rows of 4)
  const categoryScores = [
    { key: 'acquisition', score: summary.acquisition_score },
    { key: 'conversion', score: summary.conversion_score },
    { key: 'sales', score: summary.sales_score },
    { key: 'cash_flow', score: summary.cash_flow_score },
    { key: 'retention', score: summary.retention_score },
    { key: 'operations', score: summary.operations_score },
    { key: 'pricing', score: summary.pricing_score },
    { key: 'website', score: (summary as Record<string, number>).website_score ?? 70 },
  ];

  // Generate unique gradient ID
  const gradientId = `scoreGradient-${summary.health_score}`;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-bg)',
        border: '1px solid var(--v2-border)',
        borderRadius: '24px',
        padding: '28px',
      }}
    >
      {/* Subtle glow overlay */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-60%',
          [isRTL ? 'right' : 'left']: '-30%',
          width: '200%',
          height: '200%',
          background: `radial-gradient(circle at 30% 30%, ${scoreColor}12, transparent 50%)`,
        }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center"
            style={{ background: `${scoreColor}20` }}
          >
            <Heart className="w-5 h-5" style={{ color: scoreColor }} strokeWidth={2.5} />
          </div>
          <span
            className="text-[var(--v2-text-primary)] font-semibold text-[16px]"
            style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif' }}
          >
            {t('health.title') || 'Business Health'}
          </span>
        </div>
        {hasChange && (
          <span
            className="text-[13px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-full"
            style={{
              color: isImproving ? '#22C55E' : '#EF4444',
              background: isImproving ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            }}
          >
            {isImproving ? <TrendingUp className="w-3.5 h-3.5" strokeWidth={2.5} /> : <TrendingDown className="w-3.5 h-3.5" strokeWidth={2.5} />}
            {isImproving ? '+' : ''}{summary.score_change} {t('health.pts') || 'pts'}
          </span>
        )}
      </div>

      {/* Score Ring */}
      <div className="relative flex justify-center mb-6">
        <div className="relative w-[160px] h-[160px]">
          <svg viewBox="0 0 160 160" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={scoreGradient.start} />
                <stop offset="50%" stopColor={scoreGradient.mid} />
                <stop offset="100%" stopColor={scoreGradient.end} />
              </linearGradient>
            </defs>
            <circle cx="80" cy="80" r="65" fill="none" stroke="var(--v2-surface)" strokeWidth="12" />
            <circle
              cx="80" cy="80" r="65"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray="408"
              strokeDashoffset={408 - (408 * summary.health_score / 100)}
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="text-[48px] font-bold leading-none"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                background: `linear-gradient(135deg, ${scoreGradient.start}, ${scoreGradient.mid})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {summary.health_score}
            </span>
            <span className="text-[13px] font-medium text-[var(--v2-text-muted)] mt-1">
              {scoreLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Category Grid - 4 columns */}
      <div className="relative grid grid-cols-4 gap-2">
        {categoryScores.slice(0, 8).map(({ key, score }) => {
          const config = CATEGORY_CONFIG[key];
          if (!config) return null;
          const color = getScoreColor(score);
          const IconComponent = config.icon;
          return (
            <div
              key={key}
              className="flex flex-col items-center gap-1 p-3 rounded-xl transition-all cursor-pointer hover:scale-[1.02]"
              style={{ background: 'var(--v2-surface)' }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center mb-1"
                style={{ background: `${config.color}15` }}
              >
                <IconComponent className="w-3.5 h-3.5" style={{ color: config.color }} strokeWidth={2} />
              </div>
              <span
                className="text-[18px] font-bold"
                style={{ color, fontFamily: '"Space Grotesk", system-ui, sans-serif' }}
              >
                {score}
              </span>
              <span
                className="text-[10px] font-medium text-[var(--v2-text-muted)] text-center leading-tight"
                style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif' }}
              >
                {t(config.labelKey) || key.replace(/_/g, ' ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
