'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { resolveGap, gapStateFor, pickLeak, type FunnelWindow } from '@/lib/business-os/insight/funnelGap';
import { localizeStageLabel } from '@/lib/business-os/stageLabels';
import {
  resolveSetup,
  isReadyForClients,
  UNKNOWN_SHAPE,
  type BusinessShape,
} from '@/lib/business-os/setup/setupGraph';
import { useInsights } from '@/hooks/useInsights';
import { VerdictCard } from './VerdictCard';
import { TipsStepper, Tip } from './TipsStepper';
import { FunnelMap, FunnelStation, FunnelGap, GhostProjection } from './FunnelMap';
import { FunnelDrawer, type DrawerContent } from './FunnelDrawer';
import { SystemReadiness } from './SystemReadiness';
import { UsageCard } from '@/components/business-os/UsageCard';
import { CHANNEL_LABELS, type ChannelRow } from './ChannelSourcesSection';
import { ChannelsOverviewCard } from './ChannelsOverviewCard';
import { useCapabilities } from '@/components/business-os/CapabilitiesProvider';
import { FirstLightMilestones, Milestone } from './FirstLightMilestones';
import { FooterReplay, ReplayModal } from './FooterReplay';
import { VectorsStrip } from './VectorsStrip';
import { HandledSection, HandledEntry } from './HandledSection';
import { InsightAdvisorCard } from './InsightAdvisorCard';

// ===========================
// Types
// ===========================

type DayKey = 'd1' | 'd4' | 'd18' | 'd60' | 'd90';

interface TimelineStage {
  key: DayKey;
  day: number;
  label: string;
  sublabel: string;
}

/** Where a visit landed. Not where it came from — that is the channel. */
export type VisitSurface = 'website' | 'landing' | 'smart_links' | 'analytics';

/** Shape returned by /api/business-os/channel-insights. */
export interface ChannelPerformance {
  rows: ChannelRow[];
  totals: { leads: number; bookings: number; revenue: number };
  untracked: { leads: number; bookings: number; revenue: number };
  /**
   * Everyone who arrived at anything the business owns, and where they landed.
   * The funnel's first station shows the total; the channels card breaks it
   * down by surface.
   */
  visits?: { total: number; bySurface: { surface: VisitSurface; visits: number }[] };
}

export interface SetupItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action?: string;
  /**
   * false = recommended, not required. The business can still take a client
   * end to end without it, so it never blocks the "all set" state — but it is
   * still shown, because the user asked to see everything left to configure.
   */
  required?: boolean;
  /**
   * Exactly what is still missing, in the user's words.
   *
   * A step that says only "not configured" leaves the user to guess which
   * field it wanted — someone who filled in a company name, a tax id and their
   * bank details, and left the address blank, was told nothing at all about
   * why the step stayed open.
   */
  missing?: string[];
}

/**
 * Funnel numbers. The windows genuinely differ and the card labels them rather
 * than pretending otherwise.
 */
export interface FunnelStats {
  /** Website visitors, rolling 30 days. */
  found: number;
  /** Contacts in the CRM, all-time — a snapshot of who exists, not a flow. */
  touch: number;
  /** Bookings within the stats period (a month by default). */
  booked: number;
  /** Payments received within the stats period. */
  paid: number;
  /** Money received within the stats period. */
  paidAmount: number;
}

// Real CRM pipeline stage from crm_pipeline_stages table
export interface PipelineStage {
  stage_key: string;
  stage_label: string;
  color: string;
  count: number;
}

export interface MilestoneData {
  firstVisitor?: { date: string; source: string };
  firstEnquiry?: { date: string; responseTime: string };
  firstBooking?: { date: string; amount: number };
}

// ===========================
// Props
// ===========================

interface LiveDashboardProps {
  userName: string;
  greeting?: 'morning' | 'afternoon' | 'evening';
  // Real data from parent
  setupItems?: SetupItem[];
  /**
   * What the onboarding chat learned about this business. Decides which setup
   * steps apply at all — a business paid in person is never asked about a card
   * processor — so it has to travel with the items themselves.
   */
  setupShape?: BusinessShape;
  /** Where clients came from — leads, bookings and revenue per channel. */
  channelPerformance?: ChannelPerformance;
  /** Readiness actions currently in flight, e.g. an OAuth round trip. */
  pendingActions?: string[];
  /** Refetch hook for when a channel is connected, paused or removed. */
  onChannelsChanged?: () => void;
  /** Failure from the last readiness action, shown under the chip row. */
  actionError?: { action: string; message: string } | null;
  /**
   * Whether a client can actually reach this business right now.
   *
   * `stats.website.is_reachable`: a published site, a published landing page,
   * OR an active smart link — any one will do, because a business can sell
   * without ever building a website. This has to be told to the dashboard
   * rather than guessed from the setup list, which is a list of things to do,
   * not a record of what is live.
   */
  isReachable?: boolean;
  /** How that reach is achieved, so the verdict can name the right thing. */
  reachSurfaces?: { livePages: boolean; smartLinks: boolean };
  funnelStats?: FunnelStats;
  pipelineStages?: PipelineStage[];  // Real CRM pipeline stages
  milestoneData?: MilestoneData;
  autonomousWorkData?: HandledEntry[];
  onConfigureClick?: (stepId: string) => void;
  onAction?: (action: string, data?: unknown) => void;
  // Collapse state
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/**
 * The advisor card when the engine has nothing pending.
 *
 * Two states, and no stage narration between them. Before the business is
 * published there is one thing worth doing and a button that does it. After
 * that, the honest line is that nothing has been found — the vectors strip
 * directly below already says how much of the business can be read yet.
 */
function AdvisorIdleCard({
  isSetup,
  isRTL,
  t,
  onPublish,
}: {
  isSetup: boolean;
  isRTL: boolean;
  t: (key: string) => string | undefined;
  onPublish: () => void;
}) {
  return (
    <div
      className="adv"
      style={{
        marginTop: '16px',
        background: '#FFFFFF',
        border: '1px solid #E7E9F1',
        borderRadius: '18px',
        padding: isSetup ? '20px 22px' : '16px 22px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div
          style={{
            width: isSetup ? '42px' : '32px',
            height: isSetup ? '42px' : '32px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #FED7AA 0%, #FDBA74 50%, #FB923C 100%)',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 4px 12px -4px rgba(249, 115, 22, 0.4)',
          }}
        >
          <svg viewBox="0 0 24 24" style={{ width: isSetup ? '20px' : '16px', height: isSetup ? '20px' : '16px', fill: '#FFFFFF' }}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#F97316', letterSpacing: '0.02em' }}>
            {t('advisor.eyebrow') || 'Your advisor'}
          </div>

          {isSetup ? (
            <>
              <h3
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '19px',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  color: '#131A2B',
                  margin: '6px 0 8px',
                }}
              >
                {t('advisor.headline.setup') || 'Everything is built. None of it is on.'}
              </h3>
              <p style={{ fontSize: '14px', color: '#697187', lineHeight: 1.55, marginBottom: '16px' }}>
                {t('advisor.desc.setup') || 'I can\'t tell you anything about your business until your business is reachable. One button changes that, and I\'ve done the rest.'}
              </p>
              <button
                onClick={onPublish}
                style={{
                  background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px -4px rgba(249, 115, 22, 0.4)',
                }}
              >
                {t('advisor.action.publish') || 'Publish it'}
              </button>
            </>
          ) : (
            <div style={{ fontSize: '13px', color: '#697187', marginTop: '2px' }}>
              {t('advisor.eyebrow.waiting') || 'Watching, nothing to flag right now'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper to get current date info
function useDateInfo(t: (key: string) => string | undefined) {
  const now = new Date();
  const dayKeys = ['day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat'];
  const monthKeys = ['month.jan', 'month.feb', 'month.mar', 'month.apr', 'month.may', 'month.jun', 'month.jul', 'month.aug', 'month.sep', 'month.oct', 'month.nov', 'month.dec'];
  const dayName = t(dayKeys[now.getDay()]) || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const monthName = t(monthKeys[now.getMonth()]) || ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][now.getMonth()];
  const dateStr = `${now.getDate()} ${monthName}`;
  return { dayName, dateStr };
}

// ===========================
// Component
// ===========================

export function LiveDashboard({
  userName,
  greeting = 'morning',
  setupItems = [],
  setupShape = UNKNOWN_SHAPE,
  channelPerformance,
  pendingActions,
  actionError,
  onChannelsChanged,
  isReachable,
  reachSurfaces,
  funnelStats,
  pipelineStages = [],
  milestoneData,
  autonomousWorkData = [],
  onConfigureClick,
  onAction,
  collapsed = false,
  onToggleCollapse,
}: LiveDashboardProps) {
  const { t, isRTL, formatCurrency, language } = useLanguage();

  // Format date with proper locale (Hebrew months for Hebrew, etc.)
  const formatMilestoneDate = useCallback((dateStr: string | undefined): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }, [language]);
  const { dayName, dateStr } = useDateInfo(t);

  // Greeting text based on time of day
  const greetingText = t(`myday.greeting.${greeting}`) || {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening'
  }[greeting];
  const { insights, vectorMaturity, autonomousWork, runAction, refresh: refreshInsights } = useInsights();

  // What the detection engine currently has to say. Anything already acted on,
  // snoozed or dismissed is not pending, so it never reaches the card.
  const pendingInsights = useMemo(
    () => insights.filter(insight => insight.status === 'new' || insight.status === 'viewed'),
    [insights]
  );
  const [currentInsightIndex, setCurrentInsightIndex] = useState(0);
  const [automationConfig, setAutomationConfig] = useState<{
    processId: string;
    suggestedParams: Record<string, unknown>;
  } | undefined>(undefined);

  // Insights come and go as the engine runs; keep the pointer inside the list.
  useEffect(() => {
    if (currentInsightIndex >= pendingInsights.length) {
      setCurrentInsightIndex(0);
    }
  }, [pendingInsights.length, currentInsightIndex]);

  const handleInsightAction = useCallback(async (
    action: 'run' | 'snooze' | 'dismiss',
    insightId: string,
    params?: Record<string, unknown>
  ) => {
    const success = await runAction(insightId, action, params);
    if (!success) return;

    if (action === 'run') {
      // A process that can be automated is offered right after it is run once.
      const insight = pendingInsights.find(i => i.id === insightId);
      if (insight?.paired_process_id && insight.eligible_for_automation) {
        setAutomationConfig({
          processId: insight.paired_process_id,
          suggestedParams: insight.process_parameters || {},
        });
      }
    }
  }, [runAction, pendingInsights]);

  const handleInsightAutomate = useCallback(async (insightId: string, params: Record<string, unknown>) => {
    const success = await runAction(insightId, 'automate', params);
    if (success) {
      setAutomationConfig(undefined);
      await refreshInsights();
    }
  }, [runAction, refreshInsights]);

  const handleDeclineAutomate = useCallback(() => setAutomationConfig(undefined), []);

  // How long this business profile has existed. Used ONLY by the timeline
  // scrubber below, which is a picture of progress rather than a gate.
  //
  // It used to decide what the dashboard showed at all — funnel on day 4,
  // milestones on 18, vectors on 60, replay on 90. That is gone. The number
  // comes from `business_profiles.created_at`, so re-running the onboarding
  // chat recreates the row and resets it to 1, and the whole dashboard emptied
  // itself for a business that had been running for months. Age was never what
  // any of those sections needed: each one now asks its own question, and the
  // answers are things that cannot be reset by rewriting a row.
  const accountAgeDays = vectorMaturity?.accountAgeDays || 1;

  const { capabilities, status: capabilitiesStatus } = useCapabilities();

  /**
   * Channels is gated on the ASK, not on the age.
   *
   * Somebody who ticked "Connect Facebook, Instagram or Google" in the
   * onboarding chat gets the card; somebody who did not never sees it.
   *
   * Hidden while the capabilities request is loading or failed — the opposite
   * of how the pipeline below treats the same uncertainty. The reasoning
   * inverts with the consequence: a card shown by mistake is the platform
   * pushing an integration at someone who already declined it.
   */
  /**
   * Already connected counts as asking.
   *
   * The capability answers "did they tick the box in the onboarding chat?",
   * which is the only way to know about a business that WANTS channels and has
   * not connected anything yet. It cannot be the whole test, because it is a
   * row in a table that has to be seeded and backfilled — and until it is, a
   * business with a live Facebook Page and a live GA4 property was being shown
   * no channels at all. Connected accounts are a fact on the ground; no
   * migration is required to believe them.
   *
   * Read off the readiness items rather than fetched again: the dashboard
   * already computes them from `s.channels` on the stats call.
   */
  const hasConnectedChannel = setupItems.some(
    item => (item.id === 'meta_insights' || item.id === 'google_analytics') && item.completed
  );

  const showChannels =
    hasConnectedChannel || (capabilitiesStatus === 'ready' && capabilities.has('channel_insights'));

  /**
   * The funnel and its pipeline: shown to a business that has a CRM.
   *
   * Fails OPEN — hidden only when we positively know the capability is off.
   * These are the business's own contacts, so a request that has not answered
   * yet must not blank them.
   */
  const showPipeline = !(capabilitiesStatus === 'ready' && !capabilities.has('crm'));

  /**
   * The Meta and Google readiness steps follow the same answer as the card, so
   * a business is never told to connect Facebook and then left with nowhere to
   * see what connecting it produced.
   */
  const readinessItems = showChannels
    ? setupItems
    : setupItems.filter(item => item.id !== 'meta_insights' && item.id !== 'google_analytics');

  // Timeline stages - using existing translation keys from LanguageContext
  const TIMELINE_STAGES: TimelineStage[] = useMemo(() => [
    { key: 'd1', day: 1, label: t('timeline.stage.day1') || 'Day 1', sublabel: t('timeline.stage.day1.sub') || 'Setup' },
    { key: 'd4', day: 4, label: t('timeline.stage.day4') || 'Day 4', sublabel: t('timeline.stage.day4.sub') || 'First visitors' },
    { key: 'd18', day: 18, label: t('timeline.stage.day18') || 'Day 18', sublabel: t('timeline.stage.day18.sub') || 'First booking' },
    { key: 'd60', day: 60, label: t('timeline.stage.day60') || 'Day 60', sublabel: t('timeline.stage.day60.sub') || 'Running' },
    { key: 'd90', day: 90, label: t('timeline.stage.day90') || 'Day 90', sublabel: t('timeline.stage.day90.sub') || 'Automated' },
  ], [t]);

  // Determine current stage based on REAL account age
  const getCurrentStageIndex = useCallback(() => {
    for (let i = TIMELINE_STAGES.length - 1; i >= 0; i--) {
      if (accountAgeDays >= TIMELINE_STAGES[i].day) {
        return i;
      }
    }
    return 0;
  }, [accountAgeDays, TIMELINE_STAGES]);

  // State
  const [selectedStageIndex, setSelectedStageIndex] = useState(getCurrentStageIndex);
  const [selectedNode, setSelectedNode] = useState<string>(() =>
    pipelineStages.length > 0 ? pipelineStages[0].stage_key : 'lead'
  );
  const [tipIndex, setTipIndex] = useState(0);

  // Update stage when account age changes
  useEffect(() => {
    setSelectedStageIndex(getCurrentStageIndex());
  }, [getCurrentStageIndex]);

  // Update selected node when pipeline stages load
  useEffect(() => {
    if (pipelineStages.length > 0 && selectedNode === 'lead') {
      setSelectedNode(pipelineStages[0].stage_key);
    }
  }, [pipelineStages, selectedNode]);

  // ===========================
  // Derive funnel data from REAL stats
  // ===========================

  const stats = funnelStats || { found: 0, touch: 0, booked: 0, paid: 0, paidAmount: 0 };

  /*
   * Is anything of this business actually live?
   *
   * This read `websiteItem ? websiteItem.completed : true` — the WEBSITE step
   * in the setup list, defaulting to true when there is no such step. So a
   * business that had declined a website, which is the case where the step is
   * absent, was declared published on the strength of a default: the dashboard
   * said "You're live. Since you published." to someone whose only page was a
   * draft and who had published nothing at all.
   *
   * The real answer is `is_reachable` from the stats call — a live page or an
   * active smart link, either one — because a smart link IS the publication for
   * a business that needs no website. The setup item stays as the fallback for
   * a caller that has not passed the fact.
   */
  const websiteItem = setupItems.find(item => item.id === 'website');
  const hasPublished = isReachable ?? (websiteItem ? websiteItem.completed : false);

  /**
   * What this business actually publishes under, named for the verdict.
   *
   * Not hardcoded to a website: a smart link is the publication for a business
   * that needs no site, and saying "since you published your site" to one would
   * describe work it deliberately declined.
   */
  const liveSinceLabel = reachSurfaces?.livePages
    ? (t('verdict.live.when') || 'Since you published')
    : reachSurfaces?.smartLinks
      ? (t('verdict.live.when.link') || 'Since your link went out')
      : (t('verdict.live.when') || 'Since you published');

  /** The channel actually producing leads, if one is. */
  const topLeadChannel = (() => {
    const rows = (channelPerformance?.rows || []).filter(row => row.leads > 0);
    if (rows.length === 0) return null;
    const best = rows.reduce((a, b) => (b.leads > a.leads ? b : a));
    return {
      leads: best.leads,
      label: CHANNEL_LABELS[best.channel]?.[language] || CHANNEL_LABELS[best.channel]?.en || best.channel,
    };
  })();

  /**
   * Whether being reachable means a link rather than a site.
   *
   * A business that chose a booking link has no website to publish, and every
   * sentence on this page that told it to publish one was describing work it
   * had already declined. The step is the same — give clients a way to reach
   * you — but the thing to do, and the words for it, are not.
   */
  const reachesByLink = setupShape.presence === 'booking_only' || setupShape.presence === 'none';
  const hasHours = setupItems.some(item => item.id === 'availability' && item.completed);
  const hasPayments = setupItems.some(item => item.id === 'payments' && item.completed);
  const setupComplete = setupItems.filter(item => item.completed).length;
  const setupTotal = setupItems.length;

  /**
   * The funnel as one ordered list, visitors first.
   *
   * Stations and gaps are both derived from this, so gap `gN` always sits
   * between node N-1 and node N. They used to be built from two different
   * arrays with their own indexing, which is why several gap branches in the
   * drawer could never be reached.
   *
   * The visitors node is the top of the funnel and was missing entirely —
   * `stats.found` was computed, referenced by two tips, and rendered nowhere,
   * so those tips pointed at a station that did not exist.
   */
  const funnelNodes = useMemo(() => {
    const nodes: { key: string; label: string; count: number; color?: string; window: FunnelWindow }[] = [];

    // Present whenever the business has a website at all, published or not.
    // Before publishing the map draws every station as a dash rather than a
    // zero, and the day-one tip badge pins to this station — leaving it out
    // would put that badge on a station that doesn't exist, which is the bug
    // the 'found' tips already had.
    if (websiteItem || stats.found > 0) {
      nodes.push({
        key: 'found',
        label: t('station.found') || 'Found you',
        count: stats.found,
        window: 'visitors',
      });
    }

    if (pipelineStages.length > 0) {
      for (const stage of pipelineStages) {
        nodes.push({
          key: stage.stage_key,
          // Stage labels are stored in one language — whichever the user had at
          // onboarding — so a default stage is translated here. A label the
          // user wrote themselves is left exactly as they wrote it.
          label: localizeStageLabel(stage.stage_key, stage.stage_label, language),
          count: stage.count ?? 0,
          color: stage.color,
          window: 'pipeline',
        });
      }
      return nodes;
    }

    // No CRM stages configured. Falls back to the shape every account starts
    // with, so the map is never empty.
    nodes.push(
      { key: 'lead', label: t('station.lead') || 'Lead', count: stats.touch, window: 'pipeline' },
      { key: 'active_client', label: t('station.client') || 'Active Client', count: stats.booked, window: 'period' },
      { key: 'completed', label: t('station.completed') || 'Completed', count: stats.paid, window: 'period' }
    );
    return nodes;
  }, [websiteItem, pipelineStages, stats, language, t]);

  const funnelStations: FunnelStation[] = useMemo(() => {
    return funnelNodes.map(node => {
      /*
       * Only the visitor station depends on being published.
       *
       * Every station used to go to a dash the moment the site was unpublished,
       * which blanked the CRM pipeline too — for a business whose presence is
       * `booking_only` it blanked the pipeline over a website it had
       * deliberately declined, permanently.
       *
       * The stage counts come from contacts. They are true whether or not
       * anything is published, and a real zero is information; a dash is the
       * dashboard refusing to answer. So the dash is now scoped to the one
       * number that genuinely cannot exist yet — arrivals at a page nobody can
       * reach.
       */
      const awaitingSite = node.key === 'found' && !hasPublished;

      return {
        k: node.key,
        n: awaitingSite ? '—' : node.count.toString(),
        lb: node.label,
        off: awaitingSite,
        color: node.color,
      };
    });
  }, [funnelNodes, hasPublished]);

  // Gap gN sits between funnelNodes[N-1] and funnelNodes[N] — same array the
  // stations come from, so the two can't drift out of step. resolveGap decides
  // what may be claimed; this only puts words to it.
  const funnelGaps: FunnelGap[] = useMemo(() => {
    return funnelNodes.slice(0, -1).map((from, i) => {
      const to = funnelNodes[i + 1];
      const verdict = resolveGap(from, to, hasPublished);

      let lb: string | undefined;
      if (verdict.kind === 'tooEarly') lb = t('gap.tooEarly') || 'too early to tell';
      else if (verdict.kind === 'watching') lb = t('gap.watchConversion') || 'watching';
      else if (verdict.kind === 'leaking') lb = `${verdict.dropped} ${t('gap.dropped') || 'dropped off'}`;

      return { k: `g${i + 1}`, state: gapStateFor(verdict), lb };
    });
  }, [hasPublished, funnelNodes, t]);

  // Build tips from REAL data (actionable suggestions)
  const tips: Tip[] = useMemo(() => {
    const result: Tip[] = [];

    // Setup mode - tip to publish
    if (!hasPublished) {
      result.push({
        at: 'found',
        n: 1,
        t: t('tip.setup.title') || 'One thing to do',
        s: reachesByLink
          ? t('tip.setup.link.desc')
          : t('tip.setup.desc'),
      });
      return result;
    }

    // The first real leak, wherever it is. This used to be pinned to 'g2',
    // which assumed both a fixed number of stages and a fixed meaning for the
    // second gap — neither survives a pipeline the user has renamed or resized.
    const leakIndex = funnelGaps.findIndex(gap => gap.state === 'leak');
    if (leakIndex >= 0) {
      const from = funnelNodes[leakIndex];
      const to = funnelNodes[leakIndex + 1];
      result.push({
        at: funnelGaps[leakIndex].k,
        n: result.length + 1,
        t: t('tip.followup.title') || 'Follow up',
        s: `${from.count - to.count} ${t('tip.followup.stuckAt') || 'are still at'} ${from.label} ${t('tip.followup.notYet') || 'and haven\'t reached'} ${to.label}. ${t('tip.followup.desc') || 'A note costs nothing.'}`,
      });
    }

    // Low reach tip
    if (stats.found > 0 && stats.found < 50) {
      result.push({
        at: 'found',
        n: result.length + 1,
        t: t('tip.reach.title') || 'Increase reach',
        s: t('tip.reach.desc') || 'Your rate is fine. Your reach isn\'t — consider more channels.',
      });
    }

    return result;
  }, [hasPublished, reachesByLink, funnelGaps, funnelNodes, stats, t]);

  // Build milestones from REAL data
  const milestones: Milestone[] = useMemo(() => {
    const md = milestoneData || {};
    const visitorDate = md.firstVisitor?.date ? formatMilestoneDate(md.firstVisitor.date) : '';
    const enquiryDate = md.firstEnquiry?.date ? formatMilestoneDate(md.firstEnquiry.date) : '';
    const bookingDate = md.firstBooking?.date ? formatMilestoneDate(md.firstBooking.date) : '';

    return [
      {
        t: t('milestone.firstVisitor') || 'First visitor',
        s: md.firstVisitor
          ? visitorDate
          : (t('milestone.waiting.visitor') || 'Usually within a few hours of publishing.'),
        w: md.firstVisitor ? visitorDate : (t('milestone.waiting') || 'waiting'),
        lit: !!md.firstVisitor,
      },
      {
        t: t('milestone.firstEnquiry') || 'First enquiry',
        s: md.firstEnquiry
          ? `${enquiryDate} · ${t('milestone.answered') || 'answered in'} ${md.firstEnquiry.responseTime}`
          : (t('milestone.waiting.enquiry') || 'Most businesses see one in the first week or two.'),
        w: md.firstEnquiry ? enquiryDate : (t('milestone.waiting') || 'waiting'),
        lit: !!md.firstEnquiry,
      },
      {
        t: t('milestone.firstBooking') || 'First booking',
        // Show date only - amount no longer available from booking table
        s: md.firstBooking
          ? bookingDate
          : (t('milestone.waiting.booking') || 'I\'ll tell you the moment it happens.'),
        w: md.firstBooking ? bookingDate : (t('milestone.waiting') || 'waiting'),
        lit: !!md.firstBooking,
      },
    ];
  }, [milestoneData, t, formatMilestoneDate]);

  /** Says which period a number covers, so no figure sits unlabelled. */
  const windowLabel = useCallback(
    (window: FunnelWindow): string => {
      if (window === 'visitors') return t('window.visitors') || 'last 30 days';
      if (window === 'period') return t('window.period') || 'this month';
      return t('window.pipeline') || 'right now';
    },
    [t]
  );

  /**
   * The drawer, for leaks only.
   *
   * Every other panel this used to open was a restatement: a station's panel
   * repeated the count printed on the station, the visitors panel pointed at the
   * channels card, and the checklist and setup panels duplicated the readiness
   * and advisor cards. A click that returns nothing new is worse than no click.
   *
   * A leak is the exception, and the reason the drawer still exists. The map can
   * say "14 dropped off" in red, but not between WHICH two counts, over WHICH
   * period, or at what rate — and those are the numbers that make a drop-off
   * either alarming or expected.
   *
   * Derived from `resolveGap`, the same verdict `funnelGaps` gives the map. Two
   * separate judgements of the same gap could disagree — the map showing red
   * while the panel called it healthy — and re-deriving it here is what makes
   * that impossible rather than merely unlikely.
   */
  const gapDrawer = useMemo<DrawerContent | null>(() => {
    // The rule lives in pickLeak, where it is tested: a leak opens this panel
    // whether or not anyone clicked it, a clicked leak wins over a worse one,
    // and with several leaks the worst shows rather than the first.
    const leak = pickLeak(funnelNodes, hasPublished, selectedNode);
    if (!leak) return null;

    const { from, to } = leak;

    // resolveGap returns 'empty' at from.count 0 and 'tooEarly' below
    // MIN_TO_JUDGE, both before 'leaking' — so this cannot divide by zero.
    const rate = Math.round((to.count / from.count) * 100);

    return {
      ey: `${t('drawer.gap.between') || 'Between'} ${from.label} ${t('drawer.gap.and') || 'and'} ${to.label}`,
      t: `${leak.dropped} ${t('drawer.gap.dropped') || 'dropped off'}`,
      p: t('drawer.gap.dropped.desc') || 'Some contacts didn\'t move to the next stage.',
      hero: true,
      stats: [
        // Each figure wears its own period. The two ends of a gap can be counted
        // over different spans, and an unlabelled pair invites the reader to
        // treat them as one flow.
        { v: from.count.toString(), l: from.label, s: windowLabel(from.window) },
        { v: to.count.toString(), l: to.label, s: `${rate}%`, bad: true },
      ],
    };
  }, [selectedNode, funnelNodes, hasPublished, windowLabel, t]);


  // Build verdict from REAL data
  const verdict = useMemo(() => {
    if (!hasPublished) {
      return {
        status: 'warn' as const,
        text: t('verdict.setup') || 'Nothing can reach you yet.',
        sub: reachesByLink ? t('verdict.setup.link.sub') : t('verdict.setup.sub'),
        when: reachesByLink ? t('verdict.setup.link.when') : t('verdict.setup.when'),
      };
    }

    if (stats.booked > 0) {
      return {
        status: 'ok' as const,
        text: `${stats.found} ${t('verdict.running.found') || 'found you'}. ${stats.touch} ${t('verdict.running.contacts') || 'contacts'}. ${stats.booked} ${t('verdict.running.booked') || 'booked'} — ${formatCurrency(stats.paidAmount)}.`,
        sub: t('verdict.running.sub') || 'Everything\'s running.',
        when: t('verdict.running.when') || 'This week',
      };
    }

    if (stats.found > 0) {
      /*
       * Say where they came from, and name what is actually live.
       *
       * "Since you published" was printed whatever the business had published —
       * and it was printed to businesses that had published nothing, because
       * the flag behind it defaulted to true. A business reached by a smart
       * link has published a link, not a site, and the sentence has to be able
       * to say so. Where a channel is actually producing leads, that is the
       * more useful fact than a visitor count.
       */
      const source = topLeadChannel
        ? ` ${t('verdict.live.via') || 'Most came from'} ${topLeadChannel.label}.`
        : '';

      return {
        status: 'ok' as const,
        text: `${t('verdict.live') || 'You\'re live'}. ${stats.found} ${t('verdict.live.found') || 'people have found you'}.${source}`,
        sub: stats.found < 25
          ? (t('verdict.live.early') || 'At this point that tells me nothing — I\'d expect the first enquiry around 25 visitors.')
          : (t('verdict.live.sub') || 'Looking good so far.'),
        when: liveSinceLabel,
      };
    }

    return {
      status: 'ok' as const,
      text: t('verdict.justPublished') || 'You\'re live. Waiting for first visitors.',
      sub: t('verdict.justPublished.sub') || 'Usually within a few hours.',
      when: t('verdict.justPublished.when') || 'Just published',
    };
  }, [hasPublished, reachesByLink, stats, formatCurrency, t]);

  // Ghost projection (only in setup mode)
  const ghost: GhostProjection | undefined = useMemo(() => {
    if (!hasPublished) {
      return {
        t: t('ghost.title') || 'About 40 people a week search for a business like yours nearby.',
        s: t('ghost.sub') || 'That\'s the pool this map will fill from once you\'re live.',
        tag: t('ghost.tag') || 'My estimate from your area and category — not your numbers.',
      };
    }
    return undefined;
  }, [hasPublished, t]);

  // Footer replay data from REAL autonomous work
  const replayData: ReplayModal = useMemo(() => {
    const work = autonomousWorkData.length > 0 ? autonomousWorkData : autonomousWork.slice(0, 6).map(w => ({
      title: w.processName,
      detail: w.summary || `${w.outcome.itemsSucceeded} completed`,
    }));

    return {
      h: t('replay.header') || 'Recently',
      s: work.length > 0
        ? `${work.length} ${t('replay.subtitle') || 'things happened. You approved none of them, because you already had.'}`
        : (t('replay.empty') || 'Nothing to show yet.'),
      rows: work.map(w => ({ b: w.title, s: w.detail })),
    };
  }, [autonomousWorkData, autonomousWork, t]);

  // Handlers
  const handleStageClick = useCallback((index: number) => {
    setSelectedStageIndex(index);
  }, []);

  const handleNodeSelect = useCallback((nodeKey: string) => {
    setSelectedNode(nodeKey);
    const tipForNode = tips.findIndex(tip => tip.at === nodeKey);
    if (tipForNode >= 0) setTipIndex(tipForNode);
  }, [tips]);

  const handleTipSelect = useCallback((tip: Tip) => {
    setSelectedNode(tip.at);
  }, []);

  return (
    <section
      className="bg-[var(--v2-bg)] border border-[var(--v2-border)] relative overflow-hidden"
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
          background: 'radial-gradient(circle, rgba(255, 180, 84, 0.16), transparent 68%)',
        }}
      />

      {/* Page header with greeting + collapse button */}
      <div className={collapsed ? 'mb-0' : 'mb-6'}>
        <div className="flex items-start justify-between gap-4 mb-1">
          {/* Greeting */}
          <div className="flex-1">
            <h1
              className="text-[var(--v2-text-primary)]"
              style={{
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                fontSize: 'clamp(23px, 3.6vw, 31px)',
                fontWeight: 600,
                letterSpacing: '-0.025em',
              }}
            >
              {greetingText}, {userName}
            </h1>
          </div>
          {/* Date + Collapse button */}
          <div className="flex items-center gap-3">
            <div className={`flex-none ${isRTL ? 'text-start' : 'text-end'}`}>
              <b
                className="block text-[var(--v2-text-primary)]"
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '15px',
                  fontWeight: 600,
                }}
              >
                {dayName}
              </b>
              <span className="text-xs text-[var(--v2-text-muted)]">{dateStr}</span>
            </div>
            {/* Collapse/Expand button */}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-2 rounded-lg hover:bg-[var(--v2-bg-secondary)] transition-colors"
                title={collapsed ? (t('insight.expand') || 'Expand') : (t('insight.collapse') || 'Collapse')}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[var(--v2-text-muted)]"
                  style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </button>
            )}
          </div>
        </div>
        {!collapsed && (
          <p
            className="text-[var(--v2-text-muted)]"
            style={{ fontSize: '15px', maxWidth: '52rem' }}
          >
            {setupComplete < setupTotal
              ? (t('liveDashboard.setup') || `${setupComplete} of ${setupTotal} setup steps complete. The map shows what's built and what's waiting.`)
              : (t('liveDashboard.running') || "Your live dashboard. The map shows what's flowing and where to look.")}
          </p>
        )}
      </div>

      {/* Collapsible content - everything below the header */}
      {!collapsed && (
        <>
      {/* Timeline Scrubber - CLICKABLE */}
      <div
        className="mb-6"
        style={{
          background: '#FFFFFF',
          border: '1px solid #E7E9F1',
          borderRadius: '18px',
          padding: '18px 16px 14px',
          boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        }}
      >
        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: '#697187',
            marginBottom: '14px',
            paddingLeft: '2px',
          }}
        >
          {t('timeline.header') || 'Your journey'}
        </div>

        <div style={{ display: 'flex', position: 'relative' }}>
          {/* Connection line */}
          <div
            style={{
              position: 'absolute',
              [isRTL ? 'right' : 'left']: '11%',
              top: '11px',
              height: '2px',
              width: '78%',
              background: '#E7E9F1',
            }}
          />

          {/* Timeline nodes */}
          {TIMELINE_STAGES.map((stage, index) => {
            const isCurrent = accountAgeDays >= stage.day && (index === TIMELINE_STAGES.length - 1 || accountAgeDays < TIMELINE_STAGES[index + 1].day);
            const isSelected = index === selectedStageIndex;
            const isPast = accountAgeDays >= stage.day && !isCurrent;
            const isFuture = accountAgeDays < stage.day;

            return (
              <button
                key={stage.key}
                onClick={() => handleStageClick(index)}
                disabled={isFuture}
                style={{
                  flex: 1,
                  position: 'relative',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '9px',
                  background: 'none',
                  border: 'none',
                  cursor: isFuture ? 'not-allowed' : 'pointer',
                  padding: 0,
                  opacity: isFuture ? 0.5 : 1,
                }}
              >
                {/* Dot */}
                <span
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: isSelected
                      ? 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)'
                      : '#FFFFFF',
                    border: isSelected
                      ? 'none'
                      : isPast || isCurrent
                      ? '2px solid #F9C79A'
                      : '2px solid #E7E9F1',
                    position: 'relative',
                    zIndex: 1,
                    transition: '0.25s',
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: isSelected ? '0 0 0 4px rgba(249,115,22,0.16)' : 'none',
                  }}
                >
                  <i
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: isSelected ? '#FFFFFF' : isPast || isCurrent ? '#F9C79A' : '#E7E9F1',
                      transition: '0.25s',
                      display: 'block',
                    }}
                  />
                </span>

                {/* Text */}
                <span>
                  <b
                    style={{
                      display: 'block',
                      fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      color: isSelected ? '#C2410C' : isCurrent ? '#F97316' : '#131A2B',
                    }}
                  >
                    {stage.label}
                  </b>
                  <small
                    style={{
                      display: 'block',
                      fontSize: '11.5px',
                      color: '#697187',
                      marginTop: '1px',
                      lineHeight: 1.35,
                    }}
                  >
                    {stage.sublabel}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* System readiness — sits directly under the timeline, ahead of every
          metric, because an unconfigured system makes the numbers below it moot.
          Consumption sits beside it: both answer "what is the state of my
          account" rather than "what happened in my business", so they belong on
          the same row. Usage is the narrower column — it is a glance, not a task
          list — and it stacks above on narrow screens rather than being cut. */}
      {(
        <div className="usage-readiness-row">
          <UsageCard />
          <SystemReadiness
            items={readinessItems}
            shape={setupShape}
            onAction={onAction}
            pendingActions={pendingActions}
            actionError={actionError}
          />
        </div>
      )}

      <style jsx>{`
        .usage-readiness-row {
          display: grid;
          /* Usage takes a third, readiness two thirds. Readiness is a task list
             that needs the room; usage is a glance.
             The explicit LTR below is there because the section above sets rtl
             for Hebrew, which flips grid column order and put the widget on the
             right. Column POSITION is a layout decision, not a reading
             direction, so it is pinned; each card sets its own text direction.
             (No backticks in this comment: it lives inside a template literal,
             and a stray one ends the string and breaks the parse.) */
          direction: ltr;
          grid-template-columns: 1fr 2fr;
          gap: 16px;
          /* Stretch, not start: the two cards are a pair and ending at
             different depths made the row look broken rather than deliberate.
             Each card sets height:100% so it fills the track it is given. */
          align-items: stretch;
          margin-bottom: 16px;
        }
        @media (max-width: 900px) {
          .usage-readiness-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Verdict Card */}
      {(
        <VerdictCard
          status={verdict.status}
          verdict={verdict.text}
          verdictSub={verdict.sub}
          when={verdict.when}
        />
      )}

      {/* Tips Stepper */}
      {tips.length > 0 && (
        <TipsStepper
          tips={tips}
          onSelectTip={handleTipSelect}
        />
      )}

      {/* Funnel map and its drawer travel together — the drawer is only the
          detail view of a station the map shows, so one without the other is
          a panel about nothing. */}
      {showPipeline && (
        <>
          <FunnelMap
            stations={funnelStations}
            gaps={funnelGaps}
            tips={tips.map(tip => ({ at: tip.at, n: tip.n }))}
            selectedKey={selectedNode}
            onSelectNode={handleNodeSelect}
            ghost={ghost}
          />

          {/* Present whenever the funnel is leaking, clicked or not. Null
              otherwise, and FunnelDrawer renders nothing for null. */}
          <FunnelDrawer content={gapDrawer} />

          {/* The map's numbers don't share one period and can't be made to: a
              pipeline is where people stand now, visitors are a rolling window.
              Saying which is which beats leaving four unlabelled figures in a
              row and letting the reader assume they're comparable. */}
          {hasPublished && (
            <p
              style={{
                fontSize: '12px',
                color: '#697187',
                margin: '8px 2px 0',
                lineHeight: 1.45,
              }}
            >
              {t('funnel.windows', {
                visitors: windowLabel('visitors'),
                pipeline: windowLabel('pipeline'),
              })}
            </p>
          )}
        </>
      )}

      {/* Channels: what is connected, and what it brought in. Placed after the
          pipeline so the reader has seen the funnel before being asked which
          channels feed it. */}
      {showChannels && (
        <ChannelsOverviewCard performance={channelPerformance} onChanged={onChannelsChanged} />
      )}

      {/* The advisor. The engine's pending detections are the advice; when it
          has none, the card says so in one line rather than narrating the
          account's age back at the reader. The only scripted copy left is the
          setup pitch, which exists because its buttons genuinely do something. */}
      {(pendingInsights.length > 0 ? (
        <InsightAdvisorCard
          insights={pendingInsights}
          currentIndex={currentInsightIndex}
          projection={pendingInsights[currentInsightIndex]?.projection}
          automationConfig={automationConfig}
          stage={vectorMaturity?.maturityLevel === 'cold_start' ? 'setup' : 'run'}
          onIndexChange={setCurrentInsightIndex}
          onAction={handleInsightAction}
          onAutomate={handleInsightAutomate}
          onDeclineAutomate={handleDeclineAutomate}
        />
      ) : (
        <AdvisorIdleCard
          isSetup={!hasPublished}
          isRTL={isRTL}
          t={t}
          onPublish={() => onConfigureClick?.('website')}
        />
      ))}

      {/* One vectors strip, from the server's own reading.
          There used to be two: this one, hand-rolled from dashboard stats, and
          the real VectorsStrip inside InsightAdvisorCard. They disagreed —
          leads lit at 5 contacts here against 10 server-side, cash on any
          payment here against any invoice there — so the same vector could read
          differently in two places a few hundred pixels apart. */}
      {vectorMaturity && (
        <div style={{ marginTop: '12px' }}>
          <VectorsStrip vectorMaturity={vectorMaturity} standalone />
        </div>
      )}

      {/* First Light Milestones */}
      {milestones.some(milestone => milestone.lit) && <FirstLightMilestones milestones={milestones} />}

      {/* Footer Replay */}
      {replayData.rows.length > 0 && (
        <FooterReplay
          label={t('replay.button') || 'See what happened'}
          modal={replayData}
        />
      )}

      {/* One handled section, same reason as the strip above — this hand-rolled
          copy and the real HandledSection inside InsightAdvisorCard both showed
          the same work whenever there was a pending insight. */}
      {autonomousWork.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <HandledSection
            entries={autonomousWork.slice(0, 4).map(work => ({
              title: work.processName,
              detail: work.summary || `${work.outcome.itemsSucceeded} completed`,
            }))}
            standalone
          />
        </div>
      )}

        </>
      )}
    </section>
  );
}
