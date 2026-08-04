'use client';

import { useState, useCallback } from 'react';
import { Sparkles, X, ChevronDown, ArrowRight, Loader2, Check, Pause, Settings, Minus } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { BeforeAfterPanel } from './BeforeAfterPanel';
import type { InsightData, InsightProjection } from './InsightDetailModal';

// ===========================
// Types
// ===========================

// Re-export for convenience
export type { InsightData, InsightProjection };

export interface AutomationConfig {
  processId: string;
  suggestedParams: Record<string, unknown>;
}

export type InsightCardState = 'default' | 'running' | 'completed' | 'automate_offer' | 'automated';

// Define the type for pending insights which includes a projection
interface PendingInsight extends Omit<InsightData, 'eligible_for_automation'> {
  projection?: InsightProjection;
  eligible_for_automation?: boolean;
  process_parameters?: Record<string, unknown>;
}

interface InsightAdvisorCardProps {
  insights: PendingInsight[];
  currentIndex: number;
  projection?: InsightProjection;
  automationConfig?: AutomationConfig;
  onIndexChange: (index: number) => void;
  onAction: (action: 'run' | 'snooze' | 'dismiss', insightId: string, params?: Record<string, unknown>) => Promise<void>;
  onAutomate: (insightId: string, params: Record<string, unknown>) => Promise<void>;
  onDeclineAutomate: () => void;
}

// ===========================
// Category Styles
// ===========================

const CATEGORY_STYLES: Record<string, { accent: string; tint: string; glow: string; labelKey: string }> = {
  cash_flow: { accent: '#F5A623', tint: 'rgba(245,166,35,.15)', glow: 'rgba(255,178,77,.16)', labelKey: 'insight.category.cash_flow' },
  retention: { accent: '#4F6EF7', tint: 'rgba(79,110,247,.12)', glow: 'rgba(79,110,247,.14)', labelKey: 'insight.category.retention' },
  growth: { accent: '#F97316', tint: 'rgba(249,115,22,.12)', glow: 'rgba(249,115,22,.14)', labelKey: 'insight.category.growth' },
  leads: { accent: '#8B5CF6', tint: 'rgba(139,92,246,.13)', glow: 'rgba(139,92,246,.14)', labelKey: 'insight.category.leads' },
  pricing: { accent: '#D14E97', tint: 'rgba(209,78,151,.12)', glow: 'rgba(209,78,151,.13)', labelKey: 'insight.category.pricing' },
  operations: { accent: '#0EA5E9', tint: 'rgba(14,165,233,.12)', glow: 'rgba(14,165,233,.13)', labelKey: 'insight.category.operations' },
  sales: { accent: '#8B5CF6', tint: 'rgba(139,92,246,.13)', glow: 'rgba(139,92,246,.14)', labelKey: 'insight.category.sales' },
  win: { accent: '#22C58B', tint: 'rgba(34,197,139,.14)', glow: 'rgba(34,197,139,.13)', labelKey: 'insight.category.win' },
};

const DEFAULT_STYLE = { accent: '#F97316', tint: 'rgba(249,115,22,.12)', glow: 'rgba(249,115,22,.14)', labelKey: 'insight.category.cash_flow' };

// ===========================
// Running Steps (using translation keys)
// ===========================

const RUNNING_STEP_KEYS: Record<string, string[]> = {
  cash_ar_overdue: ['insight.step.cash_ar_overdue.1', 'insight.step.cash_ar_overdue.2', 'insight.step.cash_ar_overdue.3'],
  sales_stalled: ['insight.step.sales_stalled.1', 'insight.step.sales_stalled.2', 'insight.step.sales_stalled.3'],
  ret_no_show_spike: ['insight.step.ret_no_show_spike.1', 'insight.step.ret_no_show_spike.2', 'insight.step.ret_no_show_spike.3'],
  default: ['insight.step.default.1', 'insight.step.default.2', 'insight.step.default.3'],
};

// ===========================
// Component
// ===========================

export function InsightAdvisorCard({
  insights,
  currentIndex,
  projection,
  automationConfig,
  onIndexChange,
  onAction,
  onAutomate,
  onDeclineAutomate,
}: InsightAdvisorCardProps) {
  const { t, isRTL } = useLanguage();
  const [cardState, setCardState] = useState<InsightCardState>('default');
  const [baExpanded, setBaExpanded] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [runningStep, setRunningStep] = useState(0);
  // Default automation threshold value
  const defaultThreshold = (automationConfig?.suggestedParams?.days_threshold as number) || 7;
  const [autoValue, setAutoValue] = useState(defaultThreshold);

  const insight = insights[currentIndex];
  if (!insight) return null;

  const style = CATEGORY_STYLES[insight.category] || DEFAULT_STYLE;
  const stepKeys = RUNNING_STEP_KEYS[insight.detector_id] || RUNNING_STEP_KEYS.default;
  const steps = stepKeys.map(key => t(key));
  const canAutomate = insight.eligible_for_automation && automationConfig;

  // Get translated content based on detector_id
  const getTranslatedTitle = () => {
    const titleKey = `insight.${insight.detector_id}.title`;
    const translated = t(titleKey);
    if (translated !== titleKey) {
      // Replace placeholders with actual values
      return translated
        .replace('{amount}', insight.estimated_impact_usd ? `$${insight.estimated_impact_usd.toLocaleString()}` : '')
        .replace('{count}', String(insight.affected_count || 0));
    }
    return insight.title;
  };

  const getTranslatedDescription = () => {
    const descKey = `insight.${insight.detector_id}.description`;
    const translated = t(descKey);
    if (translated !== descKey) {
      // Replace placeholders with actual values
      return translated
        .replace('{weeks}', '3')
        .replace('{percent}', '12')
        .replace('{days}', '21');
    }
    return insight.description;
  };

  const getCategoryLabel = () => {
    return t(style.labelKey);
  };

  // Get primary action text
  const getPrimaryAction = () => {
    switch (insight.detector_id) {
      case 'cash_ar_overdue': return t('insight.action.chase') || 'Chase them for me';
      case 'sales_stalled': return t('insight.action.followup') || 'Follow up for me';
      case 'ret_no_show_spike': return t('insight.action.remind') || 'Set up reminders';
      default: return t('insight.action.handle') || 'Handle this for me';
    }
  };

  // Handle run action
  const handleRun = useCallback(async () => {
    setCardState('running');
    setRunningStep(0);

    // Simulate progress
    const interval = setInterval(() => {
      setRunningStep(prev => {
        if (prev >= steps.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            setCardState(canAutomate ? 'automate_offer' : 'completed');
          }, 500);
          return prev;
        }
        return prev + 1;
      });
    }, 800);

    await onAction('run', insight.id);
  }, [insight.id, onAction, steps.length, canAutomate]);

  // Handle snooze
  const handleSnooze = useCallback(async (_duration: 'tomorrow' | 'week' | 'never') => {
    setSnoozeOpen(false);
    await onAction('snooze', insight.id);
  }, [insight.id, onAction]);

  // Handle dismiss
  const handleDismiss = useCallback(async () => {
    await onAction('dismiss', insight.id);
  }, [insight.id, onAction]);

  // Handle automate
  const handleAutomate = useCallback(async () => {
    await onAutomate(insight.id, { days_threshold: autoValue });
    setCardState('automated');
  }, [insight.id, autoValue, onAutomate]);

  // Handle decline automate
  const handleDeclineAutomate = useCallback(() => {
    setCardState('completed');
    onDeclineAutomate();
  }, [onDeclineAutomate]);

  // Step value for automation config
  const stepAutoValue = (delta: number) => {
    if (!canAutomate) return;
    // Default range: 1-30 days
    const min = 1;
    const max = 30;
    setAutoValue(Math.max(min, Math.min(max, autoValue + delta)));
  };

  return (
    <div
      className="relative overflow-hidden transition-all bg-[var(--v2-bg)]"
      style={{
        borderRadius: '16px',
        borderLeft: `4px solid ${style.accent}`,
        background: `linear-gradient(135deg, ${style.tint} 0%, var(--v2-bg) 100%)`,
      }}
    >
      {/* Background glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-30%',
          [isRTL ? 'left' : 'right']: '-4%',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${style.glow}, transparent 68%)`,
        }}
      />

      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-1 relative">
        {/* Badge */}
        <div className="flex items-center gap-2">
          <span
            className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{
              background: 'rgba(249, 115, 22, 0.12)',
            }}
          >
            <Sparkles className="w-3.5 h-3.5" style={{ color: '#F97316' }} strokeWidth={2} />
          </span>
          <span
            className="text-xs font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]"
            style={{ letterSpacing: '0.08em' }}
          >
            {t('insight.badge') || 'Your advisor noticed'}
          </span>
        </div>

        {/* Category Tag */}
        <span
          className="text-xs font-bold uppercase px-2.5 py-1 rounded-full"
          style={{
            background: style.tint,
            color: style.accent,
            letterSpacing: '0.04em',
          }}
        >
          {getCategoryLabel()}
        </span>

        {/* Navigation */}
        <div className={`flex items-center gap-3 ${isRTL ? 'mr-auto' : 'ml-auto'}`}>
          {insights.length > 1 && (
            <>
              <span className="text-xs text-[#697187] font-medium">
                {currentIndex + 1} of {insights.length}
              </span>
              <div className="flex gap-1.5">
                {insights.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => onIndexChange(i)}
                    className="transition-all"
                    style={{
                      width: i === currentIndex ? '14px' : '6px',
                      height: '6px',
                      borderRadius: i === currentIndex ? '4px' : '50%',
                      background: i === currentIndex ? style.accent : '#D6DAE6',
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <button
            onClick={handleDismiss}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#FAFAFC] transition-colors"
          >
            <X className="w-4 h-4 text-[#697187]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex gap-5 px-5 pt-2 pb-4 relative">
        {/* Body */}
        <div className="flex-1 min-w-0">
          <h2
            className="mb-2 text-[var(--v2-text-primary)]"
            style={{
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontWeight: 600,
              fontSize: '20px',
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
            }}
          >
            {getTranslatedTitle()}
          </h2>
          <p
            className="mb-3 text-[var(--v2-text-secondary)]"
            style={{ fontSize: '14px', lineHeight: 1.55 }}
            dangerouslySetInnerHTML={{ __html: getTranslatedDescription() }}
          />

          {/* Evidence Chips */}
          {insight.affected_count > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              <span
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)]"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.accent }} />
                {t(`insight.${insight.detector_id}.chip.invoices`).replace('{count}', String(insight.affected_count)) !== `insight.${insight.detector_id}.chip.invoices`
                  ? t(`insight.${insight.detector_id}.chip.invoices`).replace('{count}', String(insight.affected_count))
                  : `${insight.affected_count} ${insight.detector_id === 'cash_ar_overdue' ? t('myday.insight.overdue_invoices').replace('{count}', '') : 'items'}`
                }
              </span>
              {insight.estimated_impact_usd && insight.estimated_impact_usd > 0 && (
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)]"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.accent }} />
                  {t(`insight.${insight.detector_id}.chip.total`).replace('{amount}', `$${insight.estimated_impact_usd.toLocaleString()}`) !== `insight.${insight.detector_id}.chip.total`
                    ? t(`insight.${insight.detector_id}.chip.total`).replace('{amount}', `$${insight.estimated_impact_usd.toLocaleString()}`)
                    : `$${insight.estimated_impact_usd.toLocaleString()} total`
                  }
                </span>
              )}
            </div>
          )}

          {/* Before/After Toggle */}
          {projection && cardState === 'default' && (
            <button
              onClick={() => setBaExpanded(!baExpanded)}
              className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
              style={{ background: style.tint, color: style.accent }}
            >
              <ChevronDown
                className="w-4 h-4 transition-transform"
                style={{ transform: baExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                strokeWidth={2.2}
              />
              {t('insight.compare') || "See what happens if you do vs. don't"}
            </button>
          )}
        </div>

        {/* Action Column */}
        {cardState === 'default' && (
          <div className="flex-none w-52 flex flex-col gap-2 pt-1">
            <button
              onClick={handleRun}
              className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-semibold text-sm text-white transition-transform active:scale-[0.98]"
              style={{
                background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                boxShadow: '0 12px 24px -10px rgba(249,115,22,.5)',
              }}
            >
              <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
              {getPrimaryAction()}
            </button>

            <div className="relative">
              <button
                onClick={() => setSnoozeOpen(!snoozeOpen)}
                className="flex items-center justify-center w-full py-3 px-4 rounded-xl font-semibold text-sm transition-colors bg-[var(--v2-surface)] border-[1.5px] border-[var(--v2-border)] text-[var(--v2-text-primary)]"
              >
                {t('insight.snooze') || 'Not now'} ▾
              </button>

              {snoozeOpen && (
                <div
                  className="absolute top-full left-0 right-0 mt-1.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-xl shadow-lg p-1 z-10"
                  style={{ boxShadow: '0 14px 30px -12px rgba(20,26,43,.3)' }}
                >
                  <button
                    onClick={() => handleSnooze('tomorrow')}
                    className="block w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-[var(--v2-surface)] text-[var(--v2-text-primary)]"
                  >
                    {t('insight.snooze.tomorrow') || 'Remind me tomorrow'}
                  </button>
                  <button
                    onClick={() => handleSnooze('week')}
                    className="block w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-[var(--v2-surface)] text-[var(--v2-text-primary)]"
                  >
                    {t('insight.snooze.week') || 'Remind me next week'}
                  </button>
                  <button
                    onClick={() => handleSnooze('never')}
                    className="block w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-[var(--v2-surface)] text-[var(--v2-text-primary)]"
                  >
                    {t('insight.snooze.never') || 'Not a problem — mute this'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Running State */}
        {cardState === 'running' && (
          <div className="flex-none w-52 pt-1">
            <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2.5 text-sm font-semibold" style={{ marginTop: i > 0 ? '10px' : 0 }}>
                  {i < runningStep ? (
                    <span className="w-5 h-5 rounded-full bg-[#22C58B] flex items-center justify-center flex-none">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </span>
                  ) : i === runningStep ? (
                    <Loader2 className="w-5 h-5 text-[#F97316] animate-spin flex-none" strokeWidth={2.5} />
                  ) : (
                    <span className="w-5 h-5 rounded-full border-2 border-[var(--v2-border)] flex-none opacity-40" />
                  )}
                  <span className={i <= runningStep ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed State */}
        {cardState === 'completed' && (
          <div className="flex-none w-52 pt-1">
            <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl p-4">
              <div className="flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#22C58B] flex items-center justify-center flex-none">
                  <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </span>
                <span className="text-sm font-bold text-[var(--v2-text-primary)]">
                  {t('insight.done') || 'Done'}
                </span>
              </div>
              <p className="text-xs text-[var(--v2-text-muted)] mt-2 ml-7">
                {insight.recommendation || "I'll keep watching this."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Before/After Panel */}
      {projection && (
        <BeforeAfterPanel
          expanded={baExpanded}
          doNothingPoints={[
            t(`insight.${insight.detector_id}.do_nothing`) !== `insight.${insight.detector_id}.do_nothing`
              ? t(`insight.${insight.detector_id}.do_nothing`)
                  .replace('{amount}', insight.estimated_impact_usd ? `$${insight.estimated_impact_usd.toLocaleString()}` : '')
                  .replace('{count}', String(insight.affected_count || 0))
              : projection.doNothing.summary,
            ...(t(`insight.${insight.detector_id}.do_nothing_detail`) !== `insight.${insight.detector_id}.do_nothing_detail`
              ? [t(`insight.${insight.detector_id}.do_nothing_detail`).replace('{hours}', '2')]
              : projection.doNothing.details ? [projection.doNothing.details] : []),
          ]}
          handlePoints={[
            t(`insight.${insight.detector_id}.handle_it`) !== `insight.${insight.detector_id}.handle_it`
              ? t(`insight.${insight.detector_id}.handle_it`)
                  .replace('{count}', String(insight.affected_count || 0))
                  .replace('{days}', '7')
              : projection.letMeHandleIt.summary,
            ...(t(`insight.${insight.detector_id}.handle_it_detail`) !== `insight.${insight.detector_id}.handle_it_detail`
              ? [t(`insight.${insight.detector_id}.handle_it_detail`).replace('{days}', '7')]
              : projection.letMeHandleIt.details ? [projection.letMeHandleIt.details] : []),
          ]}
        />
      )}

      {/* Automate Offer Panel */}
      {cardState === 'automate_offer' && canAutomate && (
        <div
          className="mx-5 mb-4 rounded-2xl p-4 transition-all border-[1.5px] border-[rgba(249,115,22,.25)]"
          style={{
            background: 'linear-gradient(180deg, rgba(249,115,22,0.08) 0%, var(--v2-bg) 100%)',
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <span
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: 'rgba(249, 115, 22, 0.12)',
              }}
            >
              <Sparkles className="w-4 h-4" style={{ color: '#F97316' }} strokeWidth={2} />
            </span>
            <div>
              <b className="block text-sm font-semibold text-[var(--v2-text-primary)]" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
                {t('insight.automate.title') || 'Want me to handle this for you from now on?'}
              </b>
              <span className="text-xs text-[var(--v2-text-muted)]">
                {t('insight.automate.subtitle') || "I'll do it on my own — you won't need to ask each time"}
              </span>
            </div>
          </div>

          {/* Config */}
          <div className="flex items-center gap-3 flex-wrap bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-xl p-3 mb-3">
            <span className="text-sm font-medium text-[var(--v2-text-primary)]">{t('insight.automate.after')}</span>
            <div className="inline-flex items-center bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg overflow-hidden">
              <button
                onClick={() => stepAutoValue(-1)}
                className="w-8 h-9 flex items-center justify-center text-lg font-semibold text-[#F97316] hover:bg-[rgba(249,115,22,0.08)]"
              >
                −
              </button>
              <span
                className="min-w-[50px] text-center text-sm font-bold border-x border-[var(--v2-border)] h-9 flex items-center justify-center text-[var(--v2-text-primary)]"
                style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}
              >
                {autoValue}
              </span>
              <button
                onClick={() => stepAutoValue(1)}
                className="w-8 h-9 flex items-center justify-center text-lg font-semibold text-[#F97316] hover:bg-[rgba(249,115,22,0.08)]"
              >
                +
              </button>
            </div>
            <span className="text-sm font-bold text-[var(--v2-text-primary)]">{t('insight.automate.days')}</span>
          </div>

          {/* Note */}
          <p className="flex items-start gap-2 text-xs text-[var(--v2-text-muted)] mb-3">
            <span className="w-4 h-4 flex-none mt-0.5 text-[#F97316]">ℹ</span>
            {t('insight.automate.note') || "This runs by itself in the background — I'll do it without asking. You'll see everything I do in your daily summary, and you can pause it anytime."}
          </p>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleDeclineAutomate}
              className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm transition-colors bg-[var(--v2-surface)] border-[1.5px] border-[var(--v2-border)] text-[var(--v2-text-primary)]"
            >
              {t('insight.automate.decline') || 'No, just this once'}
            </button>
            <button
              onClick={handleAutomate}
              className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm text-white transition-transform active:scale-[0.98]"
              style={{
                background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                boxShadow: '0 10px 20px -8px rgba(249,115,22,.5)',
              }}
            >
              {t('insight.automate.confirm') || 'Yes, automate it'}
            </button>
          </div>
        </div>
      )}

      {/* Automated Confirmation Panel */}
      {cardState === 'automated' && (
        <div
          className="mx-5 mb-4 rounded-2xl p-4 transition-all"
          style={{
            background: 'rgba(34,197,139,.07)',
            border: '1.5px solid rgba(34,197,139,.3)',
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="w-9 h-9 rounded-xl bg-[#22C58B] flex items-center justify-center flex-none"
              style={{ boxShadow: '0 7px 16px -6px rgba(34,197,139,.5)' }}
            >
              <Check className="w-5 h-5 text-white" strokeWidth={2.4} />
            </span>
            <div className="flex-1">
              <b className="block text-sm font-semibold text-[var(--v2-text-primary)]" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
                {t('insight.automated.title') || 'Automation created'}
              </b>
              <span className="text-xs text-[var(--v2-text-muted)]">
                {t('insight.automated.subtitle') || "I'll handle this automatically from now on"}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[rgba(34,197,139,.15)] text-[#128a5e]">
              New
            </span>
          </div>

          <div className="flex gap-2 mt-3">
            <button className="inline-flex items-center gap-2 text-sm font-semibold bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg px-3 py-2 hover:border-[var(--v2-border-hover)] transition-colors text-[var(--v2-text-primary)]">
              <Pause className="w-3.5 h-3.5" strokeWidth={2} /> Pause
            </button>
            <button className="inline-flex items-center gap-2 text-sm font-semibold bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg px-3 py-2 hover:border-[var(--v2-border-hover)] transition-colors text-[var(--v2-text-primary)]">
              <Settings className="w-3.5 h-3.5" strokeWidth={2} /> Manage
            </button>
            <button
              onClick={handleDismiss}
              className="inline-flex items-center gap-2 text-sm font-semibold bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg px-3 py-2 hover:border-[var(--v2-border-hover)] transition-colors text-[var(--v2-text-primary)]"
            >
              <Minus className="w-3.5 h-3.5" strokeWidth={2} /> Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
