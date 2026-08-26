'use client';

import { useState, useCallback } from 'react';
import {
  ChevronDown,
  Sparkles,
  AlertTriangle,
  BarChart2,
  DollarSign,
  TrendingDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { InsightDetailModal } from './InsightDetailModal';
import { InsightAdvisorCard } from './InsightAdvisorCard';
import { BusinessHealthSummaryCard } from './BusinessHealthSummaryCard';
import { SetupCard } from './SetupCard';
import { OnboardingTimeline } from './OnboardingTimeline';
import { VerdictCard } from './VerdictCard';
import { TipsStepper, Tip } from './TipsStepper';
import { FunnelMap, FunnelStation, FunnelGap, GhostProjection } from './FunnelMap';
import { FunnelDrawer, DrawerContent } from './FunnelDrawer';
import { FirstLightMilestones, Milestone } from './FirstLightMilestones';
import { FooterReplay, ReplayModal } from './FooterReplay';
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
  onConfigureClick?: (stepId: string) => void;
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
  onConfigureClick,
}: MyDayInsightSectionProps) {
  const { t, isRTL } = useLanguage();
  const {
    insights,
    correlatedInsights,
    healthSummary,
    vectorMaturity,
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
  const [selectedFunnelNode, setSelectedFunnelNode] = useState<string | null>(null);

  // Get pending insights (must be before mockup data that uses it)
  const pendingInsights = insights.filter((i) => i.status === 'new');

  // ===================
  // Mockup Data (placeholder until real data available)
  // ===================

  // Derive funnel state from maturity level
  const maturityLevel = vectorMaturity?.maturityLevel || 'cold_start';
  const accountAgeDays = vectorMaturity?.accountAgeDays || 1;

  // Generate funnel data based on maturity
  const funnelStations: FunnelStation[] = maturityLevel === 'cold_start'
    ? [
        { k: 'found', n: '—', lb: t('funnel.found') || 'Found you', off: true },
        { k: 'touch', n: '—', lb: t('funnel.touch') || 'Got in touch', off: true },
        { k: 'booked', n: '—', lb: t('funnel.booked') || 'Booked', off: true },
        { k: 'paid', n: '—', lb: t('funnel.paid') || 'Paid you', off: true },
      ]
    : [
        { k: 'found', n: '11', lb: t('funnel.found') || 'Found you' },
        { k: 'touch', n: '9', lb: t('funnel.touch') || 'Got in touch' },
        { k: 'booked', n: '3', lb: t('funnel.booked') || 'Booked' },
        { k: 'paid', n: '$540', lb: t('funnel.paid') || 'Paid you' },
      ];

  const funnelGaps: FunnelGap[] = maturityLevel === 'cold_start'
    ? [
        { k: 'g1', state: 'off' },
        { k: 'g2', state: 'off' },
        { k: 'g3', state: 'off' },
      ]
    : [
        { k: 'g1', state: 'ok' },
        { k: 'g2', state: 'leak', lb: t('funnel.gap.leak') || 'Where you\'re losing them' },
        { k: 'g3', state: 'ok' },
      ];

  const funnelTips: Tip[] = pendingInsights.length > 0
    ? [{ at: 'g2', n: 1, t: t('funnel.tip.title') || 'One thing I\'d do', s: pendingInsights[0]?.description || '' }]
    : [];

  const ghostProjection: GhostProjection | undefined = maturityLevel === 'cold_start'
    ? {
        t: t('ghost.title') || 'About 40 people a week search for a business like yours nearby.',
        s: t('ghost.subtitle') || 'That\'s the pool this map will fill from once you\'re live.',
        tag: t('ghost.tag') || 'My estimate from your area and category — not your numbers.',
      }
    : undefined;

  // Verdict data
  const verdictStatus: 'ok' | 'warn' = maturityLevel === 'cold_start' ? 'warn' : 'ok';
  const verdictText = maturityLevel === 'cold_start'
    ? (t('verdict.cold_start') || 'Nothing can reach you yet.')
    : (t('verdict.running') || 'You\'re live. 11 people have found you.');
  const verdictSub = maturityLevel === 'cold_start'
    ? (t('verdict.cold_start.sub') || 'Your website is built, your posts are written, your automations are armed. None of it is switched on.')
    : (t('verdict.running.sub') || 'Your first enquiry is probably about 8 visitors away.');
  const verdictWhen = maturityLevel === 'cold_start'
    ? (t('verdict.when.setup') || 'Nothing published')
    : (t('verdict.when.thisWeek') || 'This week');

  // Milestones
  const milestones: Milestone[] = [
    { t: t('milestone.firstVisitor') || 'First visitor', s: maturityLevel === 'cold_start' ? (t('milestone.waitingLive') || 'Waiting to go live.') : 'Day 1 · from Google.', w: maturityLevel === 'cold_start' ? '' : 'Day 1', lit: maturityLevel !== 'cold_start' },
    { t: t('milestone.firstEnquiry') || 'First enquiry', s: maturityLevel === 'cold_start' ? (t('milestone.waitingVisitor') || 'Waiting for first visitor.') : 'Day 9 · answered in 1 min 40s.', w: maturityLevel === 'cold_start' ? '' : 'Day 9', lit: maturityLevel === 'running' || maturityLevel === 'mature' },
    { t: t('milestone.firstBooking') || 'First booking', s: maturityLevel === 'cold_start' ? (t('milestone.waitingEnquiry') || 'Waiting for first enquiry.') : 'Day 16 · $180.', w: maturityLevel === 'cold_start' ? '' : 'Day 16', lit: maturityLevel === 'mature' },
  ];

  // Footer replay modal data
  const replayModal: ReplayModal = {
    h: t('replay.header') || 'Last night',
    s: t('replay.subtitle') || `${autonomousWork.length} things happened. You approved none of them, because you already had.`,
    rows: autonomousWork.slice(0, 6).map(work => ({
      b: work.displayTitle,
      s: work.displayMessage || `${work.outcome.itemsSucceeded} completed`,
    })),
  };

  // Drawer content based on selected funnel node
  const getDrawerContent = (): DrawerContent | null => {
    if (!selectedFunnelNode) return null;

    if (selectedFunnelNode === 'g2' && maturityLevel !== 'cold_start') {
      return {
        ey: t('drawer.g2.eyebrow') || 'Between got in touch and booked',
        t: t('drawer.g2.title') || 'Where you\'re losing them',
        p: t('drawer.g2.description') || 'Six of the nine didn\'t book straight away. Two went completely quiet after opening your booking page.',
        hero: true,
        stats: [
          { v: '9', l: t('drawer.stat.gotInTouch') || 'Got in touch', s: t('drawer.stat.allAnswered') || 'all answered' },
          { v: '3', l: t('drawer.stat.booked') || 'Booked', s: '33% — ' + (t('drawer.stat.belowAverage') || 'below average'), bad: true },
          { v: '6', l: t('drawer.stat.wentQuiet') || 'Went quiet', s: t('drawer.stat.twoRecent') || '2 in the last week' },
        ],
        conf: {
          t: t('drawer.conf.title') || 'Not enough to judge',
          p: t('drawer.conf.description') || 'I need about 25 visitors before I\'d trust what this gap is telling me.',
          cur: 11,
          need: 25,
        },
        people: [
          { n: 'Sarah Kim', s: t('drawer.people.openedBooking') || 'opened booking page', since: '2d', col: '#4F6EF7' },
          { n: 'David Chen', s: t('drawer.people.askedEvening') || 'asked about evening', since: '1d', col: '#8B5CF6' },
        ],
        pl: {
          tx: t('drawer.pilot.suggestion') || 'Both are more likely to book if I write now.',
          act: t('drawer.pilot.action') || 'Write to both',
        },
      };
    }

    if (selectedFunnelNode === 'found' && maturityLevel === 'cold_start') {
      return {
        ey: t('drawer.setup.eyebrow') || 'Getting you switched on',
        t: t('drawer.setup.title') || 'Nothing is live yet',
        p: t('drawer.setup.description') || 'Your website is built, your posts are written, your automations are armed. One button changes everything.',
        todos: [
          { t: t('drawer.todo.publish') || 'Publish your website', s: t('drawer.todo.publish.sub') || 'One button, two minutes.', done: false, action: t('drawer.todo.publish.action') || 'Publish it' },
          { t: t('drawer.todo.google') || 'Claim your Google listing', s: t('drawer.todo.google.sub') || 'I\'ll help you through it.', done: false },
          { t: t('drawer.todo.hours') || 'Set your hours', s: t('drawer.todo.hours.sub') || 'So I know when you\'re available.', done: false },
        ],
      };
    }

    return {
      ey: t('drawer.default.eyebrow') || 'Selected',
      t: t('drawer.default.title') || 'Nothing here yet',
      p: t('drawer.default.description') || 'This part of the map switches on when there\'s something real to show.',
    };
  };

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
        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] overflow-hidden flex flex-col items-center justify-center"
        style={{ borderRadius: '22px', padding: '48px 24px', minHeight: '200px' }}
      >
        <div
          className="w-12 h-12 rounded-full animate-spin mb-4 border-4 border-[var(--v2-border)] border-t-orange-500"
        />
        <span
          className="text-[var(--v2-text-secondary)] font-medium"
          style={{
            fontSize: '15px',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
          }}
        >
          {t('loading.myday') || 'Loading My Day...'}
        </span>
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
              className="text-[var(--v2-text-primary)]"
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

        {/* Onboarding Timeline (shows for first 90 days) */}
        <div className="mb-5">
          <OnboardingTimeline
            accountAgeDays={accountAgeDays}
            maturityLevel={maturityLevel}
            litVectors={vectorMaturity?.litCount || 0}
          />
        </div>

        {/* AI Summary Hero Section */}
        {healthSummary && (
          <div
            className="relative overflow-hidden mb-5"
            style={{
              background: 'linear-gradient(135deg, var(--v2-surface) 0%, var(--v2-bg) 100%)',
              border: '1px solid var(--v2-border)',
              borderRadius: '20px',
              padding: '20px 24px',
            }}
          >
            {/* Gradient overlays */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at top right, rgba(139,92,246,0.12), transparent 50%), radial-gradient(ellipse at bottom left, rgba(59,130,246,0.08), transparent 50%)',
              }}
            />
            {/* Top accent line */}
            <div
              className="absolute top-0 left-0 right-0 h-[3px]"
              style={{
                background: 'linear-gradient(90deg, #8B5CF6, #3B82F6, #06B6D4)',
                borderRadius: '20px 20px 0 0',
              }}
            />

            {/* Header */}
            <div className="relative flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #8B5CF6 0%, #3B82F6 50%, #06B6D4 100%)',
                  boxShadow: '0 6px 20px rgba(139,92,246,0.25)',
                }}
              >
                <Sparkles className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="text-[var(--v2-text-primary)] font-semibold text-[15px]"
                    style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif' }}
                  >
                    {t('insight.ai_summary') || 'AI Summary'}
                  </span>
                  <span
                    className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-md"
                    style={{
                      background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.2))',
                      border: '1px solid rgba(139,92,246,0.3)',
                      color: '#8B5CF6',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {t('insight.realtime') || 'Live'}
                  </span>
                </div>
                <span className="text-[11px] text-[var(--v2-text-muted)]">
                  {t('insight.ai_subtitle') || 'Real-time business analysis'}
                </span>
              </div>
            </div>

            {/* Narrative */}
            <p
              className="relative text-[var(--v2-text-secondary)] leading-[1.65]"
              style={{
                fontSize: '14px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
              }}
            >
              {healthSummary.summary_narrative}
            </p>

            {/* AI Summary Stats Row */}
            <div
              className="relative flex flex-wrap gap-2.5 pt-4 mt-4"
              style={{ borderTop: '1px solid var(--v2-border)' }}
            >
              {/* Critical Issues */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:translate-y-[-1px]"
                style={{ background: 'var(--v2-surface)', border: '1px solid var(--v2-border)' }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(239,68,68,0.15)' }}
                >
                  <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#EF4444' }} strokeWidth={2} />
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[14px] font-bold leading-tight"
                    style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', color: '#EF4444' }}
                  >
                    {healthSummary.critical_count || 0}
                  </span>
                  <span className="text-[10px] text-[var(--v2-text-muted)]">
                    {t('insight.stat.critical') || 'Critical'}
                  </span>
                </div>
              </div>

              {/* Total Issues */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:translate-y-[-1px]"
                style={{ background: 'var(--v2-surface)', border: '1px solid var(--v2-border)' }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(245,158,11,0.15)' }}
                >
                  <BarChart2 className="w-3.5 h-3.5" style={{ color: '#F59E0B' }} strokeWidth={2} />
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[14px] font-bold leading-tight"
                    style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', color: '#F59E0B' }}
                  >
                    {healthSummary.insight_count || insights.length}
                  </span>
                  <span className="text-[10px] text-[var(--v2-text-muted)]">
                    {t('insight.stat.total') || 'Total'}
                  </span>
                </div>
              </div>

              {/* Amount at Risk */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:translate-y-[-1px]"
                style={{ background: 'var(--v2-surface)', border: '1px solid var(--v2-border)' }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(249,115,22,0.15)' }}
                >
                  <DollarSign className="w-3.5 h-3.5" style={{ color: '#F97316' }} strokeWidth={2} />
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[14px] font-bold leading-tight"
                    style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', color: '#F97316' }}
                  >
                    {healthSummary.total_impact_usd
                      ? `$${healthSummary.total_impact_usd.toLocaleString()}`
                      : '$0'}
                  </span>
                  <span className="text-[10px] text-[var(--v2-text-muted)]">
                    {t('insight.stat.at_risk') || 'At risk'}
                  </span>
                </div>
              </div>

              {/* Weakest Category */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:translate-y-[-1px]"
                style={{ background: 'var(--v2-surface)', border: '1px solid var(--v2-border)' }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(139,92,246,0.15)' }}
                >
                  <TrendingDown className="w-3.5 h-3.5" style={{ color: '#8B5CF6' }} strokeWidth={2} />
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[14px] font-bold leading-tight"
                    style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', color: '#8B5CF6' }}
                  >
                    {healthSummary.priorities?.[0]?.category
                      ? (t(`health.category.${healthSummary.priorities[0].category}`) || healthSummary.priorities[0].category.replace(/_/g, ' '))
                      : (t('health.category.cash_flow') || 'Cash Flow')}
                  </span>
                  <span className="text-[10px] text-[var(--v2-text-muted)]">
                    {t('insight.stat.weakest') || 'Weakest'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main 2-Column Grid: Sidebar + Content */}
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
          {/* Left Sidebar */}
          <aside className="flex flex-col gap-5">
            {/* Setup Card (Day 1 Cold Start - show when no vectors lit) */}
            {vectorMaturity && vectorMaturity.maturityLevel === 'cold_start' && (
              <SetupCard
                vectorMaturity={vectorMaturity}
                onSetupClick={onConfigureClick}
              />
            )}

            {/* Health Score Card */}
            {healthSummary && (
              <BusinessHealthSummaryCard summary={healthSummary} compact />
            )}

          </aside>

          {/* Right: Main Content */}
          <main className="flex flex-col gap-5">
            {/* Insight Advisor Card (always shown - handles empty state with setup stage) */}
            <InsightAdvisorCard
              insights={pendingInsights}
              currentIndex={currentInsightIndex}
              projection={pendingInsights[currentInsightIndex]?.projection}
              automationConfig={automationConfig}
              vectorMaturity={vectorMaturity}
              handledEntries={autonomousWork.slice(0, 4).map(work => ({
                title: work.displayTitle,
                detail: work.outcome.itemsSucceeded > 0
                  ? `${work.outcome.itemsSucceeded} successful${work.outcome.itemsFailed > 0 ? `, ${work.outcome.itemsFailed} failed` : ''}`
                  : work.displayMessage,
              }))}
              stage={vectorMaturity?.maturityLevel === 'cold_start' ? 'setup' : 'run'}
              onIndexChange={setCurrentInsightIndex}
              onAction={handleCardAction}
              onAutomate={handleAutomate}
              onDeclineAutomate={handleDeclineAutomate}
            />

            {/* ===== NEW MOCKUP SECTIONS ===== */}

            {/* Verdict Card */}
            <VerdictCard
              status={verdictStatus}
              verdict={verdictText}
              verdictSub={verdictSub}
              when={verdictWhen}
            />

            {/* Tips Stepper (only show if there are tips) */}
            {funnelTips.length > 0 && (
              <TipsStepper
                tips={funnelTips}
                onSelectTip={(tip) => setSelectedFunnelNode(tip.at)}
              />
            )}

            {/* Funnel Map */}
            <FunnelMap
              stations={funnelStations}
              gaps={funnelGaps}
              tips={funnelTips.map(tip => ({ at: tip.at, n: tip.n }))}
              selectedKey={selectedFunnelNode || undefined}
              onSelectNode={setSelectedFunnelNode}
              ghost={ghostProjection}
            />

            {/* Funnel Drawer (shown when a node is selected) */}
            <FunnelDrawer
              content={getDrawerContent()}
              onAction={(action) => {
                // Handle drawer actions (e.g., "Write to both", "Publish it")
                console.log('Drawer action:', action);
              }}
            />

            {/* First Light Milestones */}
            <FirstLightMilestones milestones={milestones} />

            {/* Footer Replay (only show if there's autonomous work to display) */}
            {autonomousWork.length > 0 && (
              <FooterReplay
                label={t('replay.button') || 'Watch last night'}
                modal={replayModal}
              />
            )}
          </main>
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
