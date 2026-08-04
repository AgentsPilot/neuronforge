'use client';

import { useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { InsightDetailModal } from './InsightDetailModal';
import { InsightAdvisorCard } from './InsightAdvisorCard';
import { OperationalStatusCard } from './OperationalStatusCard';
import { useInsights } from '@/hooks/useInsights';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

interface MyDayInsightSectionProps {
  userName: string;
  greeting: 'morning' | 'afternoon' | 'evening';
  loading?: boolean;
  isFullyCollapsed?: boolean;
  onFullyCollapsedChange?: (collapsed: boolean) => void;
}

// ===========================
// Component
// ===========================

export function MyDayInsightSection({
  userName,
  greeting,
  loading: baseLoading = false,
  isFullyCollapsed = false,
  onFullyCollapsedChange,
}: MyDayInsightSectionProps) {
  const { t, isRTL } = useLanguage();
  const {
    insights,
    autonomousWork,
    loading: insightsLoading,
    selectedInsight,
    selectedProjection,
    selectedProcess,
    selectInsight,
    clearSelection,
    runAction,
    refresh,
  } = useInsights();

  const [modalOpen, setModalOpen] = useState(false);
  const [currentInsightIndex, setCurrentInsightIndex] = useState(0);
  const [automationConfig, setAutomationConfig] = useState<{
    processId: string;
    suggestedParams: Record<string, unknown>;
  } | undefined>(undefined);

  // Get pending insights
  const pendingInsights = insights.filter((i) => i.status === 'new');

  // Handle insight selection (for modal)
  const handleInsightClick = useCallback(async (insightId: string) => {
    await selectInsight(insightId);
    setModalOpen(true);
  }, [selectInsight]);

  // Handle action from InsightAdvisorCard
  const handleCardAction = useCallback(async (
    action: 'run' | 'snooze' | 'dismiss',
    insightId: string,
    params?: Record<string, unknown>
  ) => {
    const success = await runAction(insightId, action, params);
    if (success && action === 'run') {
      // After running, offer automation
      const insight = pendingInsights.find(i => i.id === insightId);
      if (insight?.paired_process_id && insight.eligible_for_automation) {
        setAutomationConfig({
          processId: insight.paired_process_id,
          suggestedParams: insight.process_parameters || {},
        });
      }
    }
    if (success && (action === 'dismiss' || action === 'snooze')) {
      // Move to next insight
      if (currentInsightIndex >= pendingInsights.length - 1) {
        setCurrentInsightIndex(0);
      }
    }
  }, [runAction, pendingInsights, currentInsightIndex]);

  // Handle automate action
  const handleAutomate = useCallback(async (insightId: string, params: Record<string, unknown>) => {
    const success = await runAction(insightId, 'automate', params);
    if (success) {
      setAutomationConfig(undefined);
      await refresh();
    }
  }, [runAction, refresh]);

  // Handle decline automate
  const handleDeclineAutomate = useCallback(() => {
    setAutomationConfig(undefined);
  }, []);

  // Handle action from modal
  const handleModalAction = async (action: 'run' | 'automate' | 'snooze' | 'dismiss', params?: Record<string, unknown>) => {
    if (!selectedInsight) return;
    const success = await runAction(selectedInsight.id, action, params);
    if (success && (action === 'run' || action === 'dismiss')) {
      setModalOpen(false);
      clearSelection();
    }
  };

  // Close modal
  const handleCloseModal = () => {
    setModalOpen(false);
    clearSelection();
  };

  // Handle toggling the collapse state
  const handleToggleCollapse = () => {
    if (onFullyCollapsedChange) {
      onFullyCollapsedChange(!isFullyCollapsed);
    }
  };

  // Calculate total time saved (estimate ~15 min per item)
  const totalTimeSaved = autonomousWork.reduce((acc, work) => {
    return acc + (work.outcome.itemsSucceeded * 15);
  }, 0);

  // Date formatting
  const now = new Date();
  const dayKeys = ['day.sunday', 'day.monday', 'day.tuesday', 'day.wednesday', 'day.thursday', 'day.friday', 'day.saturday'];
  const monthKeys = ['month.jan', 'month.feb', 'month.mar', 'month.apr', 'month.may', 'month.jun', 'month.jul', 'month.aug', 'month.sep', 'month.oct', 'month.nov', 'month.dec'];
  const dayName = t(dayKeys[now.getDay()]);
  const monthName = t(monthKeys[now.getMonth()]);
  const dateStr = `${now.getDate()} ${monthName}`;

  const greetingText = t(`myday.greeting.${greeting}`) || {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening'
  }[greeting];

  const loading = baseLoading || insightsLoading;

  // Loading state
  if (loading) {
    return (
      <div
        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] overflow-hidden animate-pulse"
        style={{ borderRadius: '22px', padding: '22px 24px' }}
      >
        <div className="h-6 bg-[var(--v2-surface)] rounded w-48 mb-4" />
        <div className="h-4 bg-[var(--v2-surface)] rounded w-96 mb-6" />
        <div className="h-32 bg-[var(--v2-surface)] rounded-2xl" />
      </div>
    );
  }

  // Fully collapsed state - show minimal bar
  if (isFullyCollapsed) {
    return (
      <section
        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] relative overflow-hidden transition-all duration-300"
        style={{
          borderRadius: '22px',
          padding: '12px 24px',
          boxShadow: '0 10px 30px -20px rgba(20, 26, 43, 0.3)'
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Live pulse */}
            <span className="relative">
              <span className="block w-2 h-2 rounded-full bg-[#22C58B]" />
              <span className="absolute inset-0 rounded-full bg-[#22C58B] opacity-40 animate-ping" />
            </span>
            <span
              className="text-[var(--v2-text-primary)]"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontWeight: 600,
                fontSize: '15px',
              }}
            >
              {greetingText}, {userName}
            </span>
            <span className="text-[var(--v2-text-muted)] text-sm">
              · {dayName}, {dateStr}
            </span>
          </div>
          <button
            onClick={handleToggleCollapse}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--v2-border)] bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] hover:border-[#F97316] text-[var(--v2-text-muted)] hover:text-[#F97316] transition-all"
            style={{ fontSize: '12px', fontWeight: 500 }}
          >
            <span>{t('myday.show_details') || 'Show details'}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* Main MyDay Card - contains everything */}
      <section
        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] relative overflow-hidden transition-all duration-300"
        style={{
          borderRadius: '22px',
          padding: '22px 24px',
          boxShadow: '0 20px 50px -34px rgba(20, 26, 43, 0.4)',
          direction: isRTL ? 'rtl' : 'ltr',
        }}
      >
        {/* Background glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: '-40%',
            [isRTL ? 'left' : 'right']: '-6%',
            width: '280px',
            height: '280px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255, 180, 84, 0.16), transparent 68%)'
          }}
        />

        {/* Header row */}
        <div className="flex items-start gap-4 mb-5 relative">
          <div className="flex-1">
            {/* Eyebrow */}
            <div
              className="flex items-center gap-2 mb-2"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#F97316'
              }}
            >
              {/* Live pulse */}
              <span className="relative">
                <span className="block w-2 h-2 rounded-full bg-[#22C58B]" />
                <span className="absolute inset-0 rounded-full bg-[#22C58B] opacity-40 animate-ping" />
              </span>
              {t('myday.eyebrow') || 'Your day, so far'}
            </div>

            {/* Greeting */}
            <h1
              className="mb-2 text-[var(--v2-text-primary)]"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontWeight: 600,
                fontSize: '25px',
                letterSpacing: '-0.025em',
                lineHeight: 1.15,
              }}
            >
              {greetingText}, {userName}
            </h1>

            {/* Summary */}
            <p
              className="text-[var(--v2-text-secondary)]"
              style={{ fontSize: '14.5px', lineHeight: 1.55, maxWidth: '44rem' }}
            >
              {t('myday.summary.default')}
            </p>
          </div>

          {/* Date */}
          <div className={`flex-none ${isRTL ? 'text-start' : 'text-end'}`}>
            <b
              className="block text-[var(--v2-text-primary)]"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {dayName}
            </b>
            <span className="text-xs text-[var(--v2-text-muted)]">{dateStr}</span>
          </div>
        </div>

        {/* Inner cards - side by side layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: OperationalStatusCard - shows setup status and business metrics */}
          <OperationalStatusCard
            onConfigureClick={(stepId) => {
              // TODO: Open configuration dialog for the step
              console.log('Configure:', stepId);
            }}
          />

          {/* Right: InsightAdvisorCard (if pending insights exist) */}
          {pendingInsights.length > 0 && (
            <InsightAdvisorCard
              insights={pendingInsights}
              currentIndex={currentInsightIndex}
              projection={pendingInsights[currentInsightIndex]?.projection}
              automationConfig={automationConfig}
              onIndexChange={setCurrentInsightIndex}
              onAction={handleCardAction}
              onAutomate={handleAutomate}
              onDeclineAutomate={handleDeclineAutomate}
            />
          )}
        </div>

        {/* Bottom collapse toggle */}
        <div className={`flex pt-4 mt-2 ${isRTL ? 'justify-start' : 'justify-end'}`}>
          <button
            onClick={handleToggleCollapse}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--v2-border)] bg-[var(--v2-surface)] hover:bg-[var(--v2-bg)] hover:border-[#F97316] text-[var(--v2-text-muted)] hover:text-[#F97316] transition-all"
            style={{ fontSize: '12px', fontWeight: 500 }}
          >
            <span>{t('myday.hide_details') || 'Hide details'}</span>
            <ChevronDown
              className="w-3.5 h-3.5 transition-transform duration-200"
              style={{ transform: 'rotate(180deg)' }}
            />
          </button>
        </div>
      </section>

      {/* Detail Modal (for clicking on individual insights) */}
      {selectedInsight && (
        <InsightDetailModal
          insight={selectedInsight}
          projection={selectedProjection || undefined}
          process={selectedProcess}
          isOpen={modalOpen}
          onClose={handleCloseModal}
          onAction={handleModalAction}
        />
      )}
    </>
  );
}
