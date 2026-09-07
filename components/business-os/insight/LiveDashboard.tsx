'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { resolveGap, gapStateFor, pickLeak, type FunnelWindow } from '@/lib/business-os/insight/funnelGap';
import { buildJourney, daysSince } from '@/lib/business-os/insight/journeyTimeline';
import { getProcessForDetector } from '@/lib/business-os/insight/kernel/TriggerableProcesses';
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
import { FooterReplay, ReplayModal } from './FooterReplay';
import { VectorsStrip } from './VectorsStrip';
import { HandledSection, HandledEntry } from './HandledSection';
import { InsightAdvisorCard } from './InsightAdvisorCard';

// ===========================
// Types
// ===========================

// The fixed day-1/4/18/60/90 stages that used to live here are gone. Nodes are
// built by `buildJourney` from the business's own events.

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
  /**
   * How many of each owned surface is live. Counts rather than booleans: the
   * connections panel lists these as channels and has to name them correctly,
   * and "a live page" could be a website or a landing page.
   */
  ownedSurfaces?: {
    website: number;
    landing: number;
    smartLinks: number;
    websiteDrafts: number;
    landingDrafts: number;
  };
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
  ownedSurfaces,
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
  /**
   * How many pending insights the kernel could take over right now.
   *
   * Eligibility is per detector, not per insight — `draft_reply_templates` is
   * advisory and can never run unattended, however many insights point at it.
   * The registry is plain data with no server imports, so the count is made
   * here rather than round-tripped.
   */
  const automatableNow = useMemo(
    () => pendingInsights.filter(
      insight => getProcessForDetector(insight.detector_id)?.eligibleForAutomation
    ).length,
    [pendingInsights]
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

  /*
   * `accountAgeDays` is gone from this component, and with it the last thing
   * the dashboard decided by counting from signup.
   *
   * It used to gate what was shown at all — funnel on day 4, milestones on 18,
   * vectors on 60, replay on 90 — and that went first, because the number comes
   * from `business_profiles.created_at`: re-running the onboarding chat
   * recreates the row, resets the age to 1, and emptied the dashboard of a
   * business that had been running for months. The timeline scrubber was the
   * last holdout, still lighting "Day 4 · First visitors" on the fourth day
   * whether or not anyone had visited.
   *
   * Every node now carries its own date. Nothing here can be reset by
   * rewriting a row, because a booking cannot be un-taken.
   */

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

  /**
   * The journey, built from what happened rather than from how long it has been.
   *
   * The milestone dates come from `/stats` and the unlock anchors from the
   * insight engine's own vector maturity — the same anchors it already uses to
   * decide when a detector may speak. See `buildJourney` for why each node is
   * dated the way it is.
   */
  const journey = useMemo(() => buildJourney({
    accountCreatedAt: vectorMaturity?.journeyAnchors?.accountCreatedAt ?? null,
    firstVisitorAt: milestoneData?.firstVisitor?.date ?? null,
    firstEnquiryAt: milestoneData?.firstEnquiry?.date ?? null,
    // The anchor from vector maturity is the booking's `created_at` — when it
    // was made. The milestone date is the same event from `/stats`; either is
    // right, and preferring the anchor keeps one node and one unlock in step.
    firstBookingAt:
      vectorMaturity?.journeyAnchors?.firstBookingAt ?? milestoneData?.firstBooking?.date ?? null,
    firstClientAt: vectorMaturity?.journeyAnchors?.firstClientAt ?? null,
    convCrossedAt: vectorMaturity?.journeyAnchors?.convCrossedAt ?? null,
    firstAutomationAt: vectorMaturity?.journeyAnchors?.firstAutomationAt ?? null,
    automatableNow,
    vectors: vectorMaturity?.vectors ?? [],
  }), [vectorMaturity, milestoneData, automatableNow]);

  /*
   * Today, read at render rather than taken from the memo above.
   *
   * `buildJourney` also returns a `todayDay`, and it is correct at the moment
   * it runs — but the memo is keyed on the DATA, which does not change when the
   * date does. A dashboard left open across midnight kept insisting it was
   * yesterday, because nothing had happened to make it recompute.
   *
   * The nodes are facts about the past and belong in the memo. Today does not.
   */
  const todayDay = daysSince(vectorMaturity?.journeyAnchors?.accountCreatedAt);

  /**
   * The journey as words, in the reader's language.
   *
   * `buildJourney` returns dates and day numbers and stops there; the sentence
   * for each node is composed here, where `t` and the locale live.
   */
  const journeyRows = useMemo(() => journey.nodes.map(node => {
    const dated = node.date ? formatMilestoneDate(node.date) : '';
    const counted = node.progress
      ? `${node.progress.current} / ${node.progress.threshold}`
      : '';

    // The headline number. A day when we have one; otherwise the count, for the
    // one unlock measured in visitors; otherwise nothing to say.
    const top =
      node.day !== null
        ? t('journey.day', { day: node.day })
        : node.progress
        ? counted
        : node.offered !== null
        ? String(node.offered)
        : '—';

    // The line under the name. Reached says when; counting says when it will
    // be; waiting says what it is waiting for, and never a date.
    const meta =
      node.state === 'reached'
        ? dated || (node.progress ? t('journey.meta.visitors') : '')
        : node.offered !== null
        ? t('journey.meta.ready')
        : node.progress
        ? t('journey.meta.visitors')
        : node.date
        ? t('journey.unlocks', { date: dated })
        : t(`journey.wait.${node.key}`);

    /*
     * What kind of thing this node is, in the reader's words.
     *
     * The four unlock nodes shared one tag, which read "unlock" — a word about
     * the mechanism rather than about what the business gets. Three of them are
     * the insight engine starting to watch something; the fourth is the
     * platform taking a recurring job off the owner, which is not an insight at
     * all and should never have been labelled as one.
     */
    const tag = node.kind !== 'unlock'
      ? null
      : node.key === 'handover'
      ? 'journey.tag.automation'
      : 'journey.tag.insight';

    return {
      key: node.key,
      kind: node.kind,
      state: node.state,
      tag,
      top,
      name: t(`journey.node.${node.key}`),
      meta,
    };
  }), [journey, t, formatMilestoneDate]);

  /*
   * Where the rail fills to, and where "today" sits on it.
   *
   * The line spans 7.1%–92.9% so that it starts and ends at the centre of the
   * first and last node, which are each 1/7 of the row wide. `per` is therefore
   * the distance between two node centres, and the today marker goes in the gap
   * after the last thing that has actually happened.
   */
  const railSpan = 85.8;
  const railStep = railSpan / Math.max(1, journey.nodes.length - 1);
  const railFilled = Math.max(0, journey.lastReachedIndex) * railStep;
  const todayAt =
    journey.lastReachedIndex >= journey.nodes.length - 1
      ? 7.1 + railSpan
      : 7.1 + Math.max(0, journey.lastReachedIndex) * railStep + railStep / 2;

  // State
  const [selectedNode, setSelectedNode] = useState<string>(() =>
    pipelineStages.length > 0 ? pipelineStages[0].stage_key : 'lead'
  );
  const [tipIndex, setTipIndex] = useState(0);

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
  /**
   * Where this business actually is, in one sentence under the greeting.
   *
   * It used to be a coin flip on `setupComplete < setupTotal` — every setup
   * item, optional ones included. So a business taking bookings and getting
   * paid was still told "complete your setup to go live" because it had never
   * connected Google Analytics, and the readiness card immediately below it
   * said the opposite: that card asks the setup GRAPH what is compulsory, which
   * shifts with the business (invoice details are optional until payments are
   * connected). Two components, two answers, one screen.
   *
   * So the line now reads from the same two sources as everything else on the
   * card: the graph for "is anything compulsory outstanding", and the journey
   * for what has actually happened since. It moves when the business moves.
   */
  const status = useMemo((): { key: string; vars: Record<string, string | number> } => {
    const graph = resolveSetup(setupItems, setupShape);
    const reached = (key: string) =>
      journey.nodes.some(node => node.key === key && node.state === 'reached');

    // Reachability is a fact about what is live; readiness is a fact about
    // what is configured. A business can be fully configured and still have
    // nothing a client can open, and that is still setup.
    if (!isReadyForClients(graph) || !hasPublished) {
      return {
        key: 'liveDashboard.status.setup',
        vars: { done: graph.mandatoryDone, total: graph.mandatoryTotal },
      };
    }
    if (reached('handover')) return { key: 'liveDashboard.status.handover', vars: {} };
    if (reached('booking')) return { key: 'liveDashboard.status.running', vars: {} };
    if (reached('visitor')) {
      return { key: 'liveDashboard.status.arriving', vars: { found: stats.found } };
    }
    return { key: 'liveDashboard.status.live_quiet', vars: {} };
  }, [setupItems, setupShape, hasPublished, journey, stats.found]);

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

  /*
   * `FirstLightMilestones` and the `milestones` memo that fed it are gone.
   *
   * Its three rows — first visitor, first enquiry, first booking — are now the
   * second, third and fourth nodes of the journey rail above, built from the
   * same `milestoneData`. Keeping both meant the card carried two timelines: a
   * fictional one at the top, lit by the calendar, and a factual one at the
   * foot that only appeared once something had happened.
   *
   * One thing did not survive the move: the enquiry row's "answered in 2h".
   * A seventh of a rail is too narrow for it, and response time is a
   * performance figure rather than a milestone — it belongs with the funnel.
   */

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
            {t(status.key, status.vars)}
          </p>
        )}
      </div>

      {/* Collapsible content - everything below the header */}
      {!collapsed && (
        <>
      {/*
          The journey — every node a fact about this business.

          Three states carry it, and the difference between the last two is the
          whole point of the rework:

            reached   it happened; the date is the record, the day number is
                      arithmetic on it
            counting  the anchor event exists, so the unlock date is COMPUTABLE
                      (first booking + 42 days) rather than predicted
            waiting   no anchor, so no date is offered — it names the condition
                      and stops. Nothing is greyed out as overdue.

          The nodes are not buttons any more. The old ones were, and clicking
          one only recoloured itself: `selectedStageIndex` was read in exactly
          one place, to style the dot you had just pressed. A control that looks
          interactive and does nothing is worse than a plain label. */}
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
            paddingInlineStart: '2px',
          }}
        >
          {t('timeline.title') || 'Your journey'}
        </div>

        {/* Seven nodes need more room than a narrow card has; the rail scrolls
            inside its own box rather than pushing the page sideways. */}
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', position: 'relative', minWidth: '760px', paddingTop: '26px' }}>
            {/* The rail, and the part of it already travelled */}
            <div
              style={{
                position: 'absolute',
                top: '37px',
                [isRTL ? 'right' : 'left']: '7.1%',
                height: '2px',
                width: '85.8%',
                background: '#E7E9F1',
              }}
            />
            {railFilled > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '37px',
                  [isRTL ? 'right' : 'left']: '7.1%',
                  height: '2px',
                  width: `${railFilled}%`,
                  borderRadius: '2px',
                  background: isRTL
                    ? 'linear-gradient(270deg, #F9C79A 0%, #F97316 100%)'
                    : 'linear-gradient(90deg, #F9C79A 0%, #F97316 100%)',
                }}
              />
            )}

            {/* Today. Everything behind it happened; everything ahead has not,
                and the card no longer pretends to know when it will. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                [isRTL ? 'right' : 'left']: `${todayAt}%`,
                transform: isRTL ? 'translateX(50%)' : 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  fontSize: '9.5px',
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: '#128A5E',
                  background: 'rgba(34, 197, 139, 0.13)',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  whiteSpace: 'nowrap',
                  marginBottom: '4px',
                }}
              >
                {todayDay === null
                  ? t('journey.today_plain')
                  : t('journey.today', { day: todayDay })}
              </span>
              <span
                style={{
                  width: '2px',
                  height: '20px',
                  background:
                    'repeating-linear-gradient(180deg, #22C58B 0 3px, transparent 3px 6px)',
                }}
              />
            </div>

            {journeyRows.map(row => (
              <div
                key={row.key}
                style={{
                  flex: 1,
                  position: 'relative',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '9px',
                  padding: '0 4px',
                }}
              >
                <span
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    position: 'relative',
                    zIndex: 1,
                    flex: 'none',
                    display: 'grid',
                    placeItems: 'center',
                    ...(row.state === 'reached'
                      ? {
                          background:
                            'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                          border: 'none',
                          boxShadow: '0 0 0 4px rgba(249,115,22,0.14)',
                        }
                      : row.state === 'counting'
                      ? { background: '#FFF8F2', border: '2px dashed #F9A15C' }
                      : { background: '#FFFFFF', border: '2px solid #E7E9F1' }),
                  }}
                >
                  <i
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      display: 'block',
                      background:
                        row.state === 'reached'
                          ? '#FFFFFF'
                          : row.state === 'counting'
                          ? '#F9A15C'
                          : '#EDEFF5',
                    }}
                  />
                </span>

                <span>
                  <b
                    style={{
                      display: 'block',
                      fontFamily: isRTL
                        ? '"Heebo", system-ui, sans-serif'
                        : '"Space Grotesk", system-ui, sans-serif',
                      fontSize: '14px',
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.1,
                      fontVariantNumeric: 'tabular-nums',
                      color:
                        row.state === 'reached'
                          ? '#131A2B'
                          : row.state === 'counting'
                          ? '#C2410C'
                          : '#C6CAD6',
                    }}
                  >
                    {row.top}
                  </b>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '11.5px',
                      fontWeight: 500,
                      lineHeight: 1.3,
                      marginTop: '3px',
                      color: row.state === 'waiting' ? '#9AA1B4' : '#4A5165',
                    }}
                  >
                    {row.name}
                  </span>
                  {row.meta && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: '10.5px',
                        lineHeight: 1.35,
                        marginTop: '2px',
                        color: row.state === 'counting' ? '#D97706' : '#8D94A8',
                      }}
                    >
                      {row.meta}
                    </span>
                  )}
                  {row.tag && (
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: '5px',
                        fontSize: '8.5px',
                        fontWeight: 700,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        padding: '2px 5px',
                        borderRadius: '4px',
                        background: 'rgba(79, 110, 247, 0.10)',
                        color: '#4F6EF7',
                      }}
                    >
                      {t(row.tag)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
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
        <ChannelsOverviewCard
          performance={channelPerformance}
          onChanged={onChannelsChanged}
          /* Already on this component from `/api/business-os/stats` — the
             connections column lists owned surfaces beside connected accounts,
             and needed no query of its own to do it. Undefined rather than
             false while the stats call is in flight: "not told yet" must not
             render a Publish button at a business that has a published site. */
          owned={ownedSurfaces}
          onAction={action => onAction?.(action)}
        />
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
