'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Bot } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { resolveGap, gapStateFor, pickLeak, type FunnelWindow } from '@/lib/business-os/insight/funnelGap';
import { buildJourney, daysSince } from '@/lib/business-os/insight/journeyTimeline';
import { getProcess } from '@/lib/business-os/insight/kernel/TriggerableProcesses';
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
import type { HandledEntry } from './HandledSection';
import { DailyBriefingCard } from './DailyBriefingCard';
import { NeedsYouCard, type GapView } from './NeedsYouCard';
import { ClientReachJourney } from './ClientReachJourney';
import type { OperationalItem } from './InsightAdvisorCard';
import { briefingLines } from '@/lib/business-os/briefing/BriefingNarrator';
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

/**
 * The same funnel over the last 7 days, for the verdict card alone.
 *
 * Separate from `FunnelStats` because the two answer different questions. The
 * funnel map is a shape — where people are stacking up — and reads better over
 * a month, with each station labelled with the window it was counted over. The
 * verdict is a sentence badged "This week", and every figure in it has to mean
 * that week or the badge is a lie. Reusing one set for both is what produced a
 * card that said "This week" over a 30-day visitor count, a 30-day booking
 * count and an all-time contact count.
 */
/** One labelled number in the verdict card's figure row. */
export interface VerdictFigure {
  value: string;
  label: string;
}

/**
 * What the verdict card renders. `text` is always a complete sentence; where
 * the verdict is a set of numbers, `figures` and `highlight` carry the same
 * content in a form the card can lay out instead of printing as prose.
 */
interface VerdictContent {
  status: 'ok' | 'warn';
  text: string;
  sub: string;
  when: string;
  figures?: VerdictFigure[];
  highlight?: string;
}

export interface WeeklyStats {
  /** Visits to any surface this business owns, last 7 days. */
  found: number;
  /** Contacts created in the last 7 days — a flow, unlike FunnelStats.touch. */
  contacts: number;
  /** Bookings made in the last 7 days. */
  booked: number;
  /**
   * Payments received in the last 7 days.
   *
   * The third beat for a business that books nothing. An invoicing practice has
   * no appointments to count, so `booked` is permanently 0 and the week's story
   * would never be told at all — this is the same step in its funnel, reached
   * by a different route.
   */
  paidCount: number;
  /** Money received in the last 7 days. */
  revenue: number;
}

// Real CRM pipeline stage from crm_pipeline_stages table
export interface PipelineStage {
  stage_key: string;
  stage_label: string;
  color: string;
  /** How many sit here now. What the station shows. */
  count: number;
  /**
   * What happened to the people who reached this stage — what the CONNECTOR
   * below it shows.
   *
   * The station is a queue and the connector is a flow, and they are different
   * questions: "three people are in Consultation" says nothing about whether
   * Consultation leaks. Dividing one station's count by the next used to be how
   * the map decided, which reported seventeen people still waiting as seventeen
   * who had dropped out.
   *
   * Absent when the business has no recorded stage history, in which case the
   * connector says it cannot judge rather than guessing.
   */
  arrived?: number;
  moved_on?: number;
  stuck?: number;
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
  /**
   * Everything waiting on the owner — unanswered enquiries, unwritten and
   * unsent quotes, outstanding intake forms, unpaid invoices.
   *
   * Fetched by the page rather than here, so the card and the rest of the
   * dashboard refresh together and an action cannot leave the two disagreeing.
   */
  gaps?: GapView[];
  /**
   * Work the platform is offering to take on, and whether it has permission.
   *
   * Carouselled inside the advisor itself rather than shown as a second card:
   * operational advice is still advice, and an approval asked next to the pile
   * it would clear is a decision, where the same approval on a settings screen
   * is a checkbox people skip.
   */
  automations?: OperationalItem[];
  /** Refetch after an action clears something, so the row leaves. */
  onGapsChanged?: () => void;
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
  /** Last 7 days, for the verdict card's "This week" sentence. */
  weeklyStats?: WeeklyStats;
  pipelineStages?: PipelineStage[];  // Real CRM pipeline stages
  milestoneData?: MilestoneData;
  autonomousWorkData?: HandledEntry[];
  /**
   * Today's narrated briefing, rendered as a list beside the weekly verdict.
   * `narrative` is newline-separated, one fact per line.
   * Null on a cold-start account, or on any day it could not be produced.
   */
  briefing?: {
    narrative: string;
    date: string;
    /** Undefined when none is set; the morning email is gated on it. */
    timezone?: string;
    isQuiet: boolean;
    source: 'llm' | 'fallback';
    emailEnabled: boolean;
  } | null;
  onConfigureClick?: (stepId: string) => void;
  onAction?: (action: string, data?: unknown) => void;
  /*
   * The assistant panel, which lives below this card on the page.
   *
   * The button is here rather than on the panel itself because the panel is
   * hidden by default and a control you can only reach by finding the thing it
   * reveals is not a control. The card owns the button; the page owns the
   * panel and the flag.
   */
  assistantOpen?: boolean;
  onToggleAssistant?: () => void;
  /*
   * The assistant panel, rendered by the page and placed here.
   *
   * Passed in rather than built here because the page owns the chat — its ref,
   * its handlers, and the thirty-odd places that write into it. This card only
   * decides WHERE it sits, which is directly below the journey, where the
   * button that opens it can still be seen.
   */
  assistantSlot?: React.ReactNode;
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
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
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
                  color: 'var(--v2-text-primary)',
                  margin: '6px 0 8px',
                }}
              >
                {t('advisor.headline.setup') || 'Everything is built. None of it is on.'}
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--v2-text-secondary)', lineHeight: 1.55, marginBottom: '16px' }}>
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
            <div style={{ fontSize: '13px', color: 'var(--v2-text-secondary)', marginTop: '2px' }}>
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
  gaps,
  automations,
  onGapsChanged,
  greeting = 'morning',
  setupItems = [],
  setupShape = UNKNOWN_SHAPE,
  channelPerformance,
  pendingActions,
  actionError,
  onChannelsChanged,
  isReachable,
  ownedSurfaces,
  funnelStats,
  weeklyStats,
  pipelineStages = [],
  milestoneData,
  autonomousWorkData = [],
  briefing,
  onConfigureClick,
  onAction,
  assistantOpen = false,
  onToggleAssistant,
  assistantSlot,
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
  const { insights, vectorMaturity, autonomousWork, healthSummary, runAction, refresh: refreshInsights, loading: insightsLoading } = useInsights();

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
      // The insight's own paired process, not a second lookup by detector id:
      // the row already carries what its detector declared.
      insight => getProcess(insight.paired_process_id)?.eligibleForAutomation
    ).length,
    [pendingInsights]
  );

  /**
   * Is there an automation still to be asked about?
   *
   * Approved ones are a setting and declined ones are an answer; only the
   * undecided are advice. Computed here because the advisor slot has to know
   * whether the operational card would render anything before choosing it.
   */
  const operationalPending = useMemo(
    () => automations ?? [],
    [automations]
  );

  /**
   * Record an approval or a refusal, then refresh.
   *
   * The card does not keep its own copy of the answer: the parent refetches and
   * stops sending the item, which is what makes the page leave the carousel.
   * One source of truth for what is still undecided.
   */
  const handleOperationalDecide = useCallback(
    async (id: string, approve: boolean) => {
      try {
        await fetch('/api/business-os/automations/operational', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, enabled: approve }),
        });
      } finally {
        onGapsChanged?.();
      }
    },
    [onGapsChanged]
  );

  const [currentInsightIndex, setCurrentInsightIndex] = useState(0);
  const [automationConfig, setAutomationConfig] = useState<{
    processId: string;
    suggestedParams: Record<string, unknown>;
  } | undefined>(undefined);

  /*
   * Insights come and go as the engine runs; keep the pointer inside the list.
   *
   * The list is BOTH lists. The advisor card runs one position across insights
   * and then the automations waiting to be approved — `totalPages` there is
   * `insights.length + operational.length`, and an operational page is
   * addressed by the tail of that range. Clamping against the insights alone
   * meant every one of those positions looked out of bounds the instant it was
   * selected: the dot set the index, this effect immediately reset it to 0, and
   * the card snapped back. An account with automations but no insights could
   * not move off the first page at all, because EVERY page was in the tail.
   */
  const advisorPageCount = pendingInsights.length + operationalPending.length;

  useEffect(() => {
    if (currentInsightIndex >= advisorPageCount) {
      setCurrentInsightIndex(0);
    }
  }, [advisorPageCount, currentInsightIndex]);

  const handleInsightAction = useCallback(async (
    action: 'run' | 'snooze' | 'dismiss',
    insightId: string,
    params?: Record<string, unknown>
  ) => {
    const success = await runAction(insightId, action, params);
    // Reported back so the card can stop its "done" animation rather than
    // narrating a job the server refused to start.
    if (!success) return false;

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

    return true;
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

  /**
   * Did this business ASK to see where its clients come from?
   *
   * Note what this no longer decides: whether the card is on the page. The card
   * answers two questions — how a client can reach you (your site, your landing
   * pages, your smart link) and where they came from (connected accounts) — and
   * the onboarding question was only ever about the second. Gating the whole
   * card on it hid a business's only booking link behind an answer about
   * Instagram, with nothing anywhere able to switch it back on.
   *
   * All it decides now is the LABEL on the connections control: a reader who
   * asked gets "Show connections", a reader who declined gets a sentence saying
   * what is behind it. Either opens the same column, and connecting is the
   * activation — `hasConnectedChannel` turns this true on its own from then on.
   */
  const connectionsWanted =
    hasConnectedChannel || (capabilitiesStatus === 'ready' && capabilities.has('channel_insights'));

  /**
   * The funnel and its pipeline: shown to a business that has a CRM.
   *
   * Fails OPEN — hidden only when we positively know the capability is off.
   * These are the business's own contacts, so a request that has not answered
   * yet must not blank them.
   */
  const showPipeline = !(capabilitiesStatus === 'ready' && !capabilities.has('crm'));

  /*
   * The Meta and Google steps are never filtered out.
   *
   * They used to follow the same answer as the card, on the reasoning that a
   * business should not be told to connect Facebook and then left with nowhere
   * to see what connecting it produced. The card is now always on the page, so
   * that place always exists — and `setupGraph.ts` had already written down the
   * rule this restores: those steps are present for EVERY business, because the
   * onboarding answer "must not decide whether the business can ever change its
   * mind".
   */
  const readinessItems = setupItems;

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
   * Memoised, unlike `stats` above: it is a dependency of the verdict memo, and
   * a fresh `{...}` literal every render would make that memo re-run on every
   * render and defeat itself.
   */
  const weekly = useMemo<WeeklyStats>(
    () => weeklyStats || { found: 0, contacts: 0, booked: 0, paidCount: 0, revenue: 0 },
    [weeklyStats]
  );

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
  /**
   * The readiness graph, resolved ONCE for the whole card.
   *
   * It was resolved inside the status memo, and `SystemReadiness` resolves it
   * again from the same two inputs. That was survivable while the second copy
   * only fed a sentence; the reach journey above now renders from it too, and
   * three resolutions of the same question are three chances to disagree on one
   * screen — the exact failure the status line's own comment below describes.
   */
  const setupGraph = useMemo(
    () => resolveSetup(setupItems, setupShape),
    [setupItems, setupShape]
  );

  /**
   * Is the reach journey showing above?
   *
   * The same test in one place, read by both the slot at the top and the
   * readiness card below, so the path and the list can never both claim the
   * screen — or both leave it empty.
   */
  const showReachJourney = setupGraph.steps.length > 0 && !isReadyForClients(setupGraph);

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
    const reached = (key: string) =>
      journey.nodes.some(node => node.key === key && node.state === 'reached');

    // Reachability is a fact about what is live; readiness is a fact about
    // what is configured. A business can be fully configured and still have
    // nothing a client can open, and that is still setup.
    if (!isReadyForClients(setupGraph) || !hasPublished) {
      return {
        key: 'liveDashboard.status.setup',
        vars: { done: setupGraph.mandatoryDone, total: setupGraph.mandatoryTotal },
      };
    }
    if (reached('handover')) return { key: 'liveDashboard.status.handover', vars: {} };
    if (reached('booking')) return { key: 'liveDashboard.status.running', vars: {} };
    if (reached('visitor')) {
      return { key: 'liveDashboard.status.arriving', vars: { found: stats.found } };
    }
    return { key: 'liveDashboard.status.live_quiet', vars: {} };
  }, [setupGraph, hasPublished, journey, stats.found]);

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
    const nodes: {
      key: string;
      label: string;
      count: number;
      color?: string;
      window: FunnelWindow;
      /** Cohort flow for the connector BELOW this station, where it is known. */
      flow?: { arrived: number; movedOn: number };
    }[] = [];

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
          ...(typeof stage.arrived === 'number' && typeof stage.moved_on === 'number'
            ? { flow: { arrived: stage.arrived, movedOn: stage.moved_on } }
            : {}),
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

  /**
   * The two numbers a connector compares.
   *
   * A cohort where the stage has one — arrived, and of those, moved on — and
   * the two stations themselves where it does not. Defined once and handed to
   * both the connector and the drawer below, because they must reach the same
   * verdict: the map drawing red above a panel calling the same gap healthy is
   * the failure this shape exists to prevent.
   */
  const gapEndsFor = useCallback(
    (from: { count: number; window: FunnelWindow; flow?: { arrived: number; movedOn: number } },
     to: { count: number; window: FunnelWindow }) =>
      from.flow
        ? {
            from: { count: from.flow.arrived, window: 'flow' as const },
            to: { count: from.flow.movedOn, window: 'flow' as const },
          }
        : { from, to },
    []
  );

  // Gap gN sits between funnelNodes[N-1] and funnelNodes[N] — same array the
  // stations come from, so the two can't drift out of step. resolveGap decides
  // what may be claimed; this only puts words to it.
  const funnelGaps: FunnelGap[] = useMemo(() => {
    return funnelNodes.slice(0, -1).map((from, i) => {
      const to = funnelNodes[i + 1];

      /*
       * Of everyone who reached this station, how many got further.
       *
       * The two ends handed to `resolveGap` used to be the two stations' own
       * headcounts, which made the rate a comparison of queue lengths: twenty
       * waiting in Lead and three in Consultation read as "17 dropped off",
       * though every one of those seventeen was still in play and everybody who
       * had already passed through was counted in neither.
       *
       * A cohort answers the question the connector has always been drawn to
       * ask. Both ends are marked `flow`, so they compare cleanly, and the
       * `dropped` figure becomes people who are genuinely still there.
       *
       * Without recorded history the old behaviour stands — which for a real
       * pipeline means `incomparable`, and the connector honestly says so.
       */
      const ends = gapEndsFor(from, to);
      const verdict = resolveGap(ends.from, ends.to, hasPublished);

      let lb: string | undefined;
      if (verdict.kind === 'tooEarly') lb = t('gap.tooEarly') || 'too early to tell';
      else if (verdict.kind === 'watching') lb = t('gap.watchConversion') || 'watching';
      else if (verdict.kind === 'leaking') lb = `${verdict.dropped} ${t('gap.dropped') || 'dropped off'}`;

      return { k: `g${i + 1}`, state: gapStateFor(verdict), lb };
    });
  }, [hasPublished, funnelNodes, gapEndsFor, t]);

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
      // A cohort is not a moment: these are the people who ARRIVED in the
      // window, which is a different claim from how many are standing there.
      if (window === 'flow') return t('window.flow') || 'reached this step';
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
    const leak = pickLeak(funnelNodes, hasPublished, selectedNode, gapEndsFor);
    if (!leak) return null;

    const { from, to } = leak;

    // resolveGap returns 'empty' at from.count 0 and 'tooEarly' below
    // MIN_TO_JUDGE, both before 'leaking' — so this cannot divide by zero.
    /*
     * The same two numbers the connector used, not the stations' own counts —
     * otherwise this panel would print a different percentage from the gap it
     * was opened by.
     */
    const ends = gapEndsFor(from, to);
    const rate = Math.round((ends.to.count / ends.from.count) * 100);

    return {
      ey: `${t('drawer.gap.between') || 'Between'} ${from.label} ${t('drawer.gap.and') || 'and'} ${to.label}`,
      t: `${leak.dropped} ${t('drawer.gap.dropped') || 'dropped off'}`,
      p: t('drawer.gap.dropped.desc') || 'Some contacts didn\'t move to the next stage.',
      hero: true,
      stats: [
        /*
         * The figures the RATE was computed from, not the stations' own counts.
         *
         * Each wears its own period, because the two ends of a gap can be
         * counted over different spans and an unlabelled pair invites the
         * reader to treat them as one flow. Showing the stations here while the
         * percentage came from a cohort would print two numbers that do not
         * divide into the number beside them.
         */
        { v: ends.from.count.toString(), l: from.label, s: windowLabel(ends.from.window) },
        { v: ends.to.count.toString(), l: to.label, s: `${rate}%`, bad: true },
      ],
    };
  }, [selectedNode, funnelNodes, hasPublished, windowLabel, gapEndsFor, t]);


  /*
   * Has anything ever happened here — ever, not lately.
   *
   * Read off the milestone dates the dashboard already holds, which is the only
   * signal on this component that looks further back than the reporting period.
   * A 30-day count cannot answer this: it says a year-old business with one
   * dead month has never had a visitor, and the card then greets it as a new
   * account.
   */
  const hasEverTraded = !!(
    milestoneData?.firstVisitor ||
    milestoneData?.firstEnquiry ||
    milestoneData?.firstBooking
  );

  /**
   * One line about the week, from the weekly health summary.
   *
   * `summary_title` rather than the full narrative: this is the sub-line of a
   * card whose content is four figures, and a paragraph under them would bury
   * the numbers the card exists to state.
   */
  const weeklyHeadline = healthSummary?.summary_title?.trim() || '';

  // Build verdict from REAL data
  const verdict = useMemo<VerdictContent>(() => {
    if (!hasPublished) {
      return {
        status: 'warn' as const,
        text: t('verdict.setup') || 'Nothing can reach you yet.',
        sub: reachesByLink ? t('verdict.setup.link.sub') : t('verdict.setup.sub'),
        when: reachesByLink ? t('verdict.setup.link.when') : t('verdict.setup.when'),
      };
    }

    /*
     * The week's trade, gated on the week's own last step.
     *
     * Which step that is depends on the business, not on the platform: a clinic
     * closes the week with a booking, an invoicing practice closes it with a
     * payment. `appointments === false` is the chat's own answer that nothing
     * here is booked against a time, so counting bookings for that business
     * would count a thing it does not do — `booked` stays 0 forever and the
     * week's story never gets told at all, however much it trades. Only an
     * explicit false switches: `null` means the chat has not asked yet, and an
     * unanswered question must not silently re-label the card.
     *
     * Gating on the 30-day count instead would keep this sentence up through a
     * quiet week and print "0 booked — ₪0" under a green dot. A week with no
     * trade isn't this verdict; it falls through below.
     */
    const takesBookings = setupShape.appointments !== false;
    const closingCount = takesBookings ? weekly.booked : weekly.paidCount;

    if (closingCount > 0) {
      /*
       * Plain words for each beat. "Contacts" was the CRM's name for the middle
       * step, not a person's — the owner of a barber shop did not gain three
       * contacts this week, three people got in touch. Resolved once here
       * because the same label is read twice: by the figure and by the sentence
       * that labels the list for a screen reader.
       */
      const foundLabel = t('verdict.running.found') || 'found you';
      const reachedLabel = t('verdict.running.reached') || 'got in touch';
      const closingLabel = takesBookings
        ? (t('verdict.running.booked') || 'booked')
        : (t('verdict.running.paid') || 'paid');

      return {
        status: 'ok' as const,
        /*
         * Figures, not a sentence.
         *
         * Three counts and a sum read as one 19px run-on line — "284 found you.
         * 3 contacts. 3 booked — ₪4,350." — is a paragraph the eye has to parse
         * word by word to find the four numbers that are the whole point. As
         * labelled figures each number is scannable, and the money can sit
         * apart from the counts instead of being punctuated onto the end of
         * them. `text` stays filled for the accessible summary and for any
         * consumer that wants the one-line form.
         */
        text: `${weekly.found} ${foundLabel}. ${weekly.contacts} ${reachedLabel}. ${closingCount} ${closingLabel}${weekly.revenue > 0 ? ` — ${formatCurrency(weekly.revenue)}` : ''}.`,
        figures: [
          { value: weekly.found.toLocaleString(), label: foundLabel },
          { value: weekly.contacts.toLocaleString(), label: reachedLabel },
          { value: closingCount.toLocaleString(), label: closingLabel },
        ],
        /*
         * Omitted rather than printed as zero.
         *
         * Bookings and the money for them are not the same week's events: an
         * invoiced service is booked now and paid later, so a perfectly normal
         * week reads `booked: 2, revenue: 0`. Printing "₪0" beside the beat
         * states a fact the business would read as a loss — nothing came in —
         * when what actually happened is that nothing has come in YET.
         */
        highlight: weekly.revenue > 0 ? formatCurrency(weekly.revenue) : undefined,
        /*
         * The week's closing line, when the engine has one.
         *
         * "Everything's running" used to sit here: a verdict on the platform
         * rather than a fact about the business, printed whenever a booking
         * existed with nothing checked behind it. This is the opposite — the
         * weekly summary the insight engine computes from the week's actual
         * detections, which until now was written to `business_health_summaries`,
         * served by the API, exposed by `useInsights`, and read by nothing.
         *
         * Still empty when there is no summary. The beats above already say
         * what the week held, and the card omits an empty sub rather than
         * leaving a blank row.
         */
        sub: weeklyHeadline,
        when: t('verdict.running.when') || 'This week',
      };
    }

    /*
     * A week where nothing happened says so, rather than counting to zero.
     *
     * "0 found you. 0 got in touch." is technically the week's figures, and it
     * is the wrong sentence: a row of zeros reads as a broken card, and it
     * reports three times over what can be said once.
     *
     * Told apart from a business that has never had anything by its history,
     * not by recent traffic. The gate here used to be a 30-day visitor count,
     * which meant a business trading for a year that had one dead month was
     * greeted with "You're live. Waiting for first visitors." — the sentence
     * written for an account on its first day. Whether anyone has EVER arrived,
     * enquired or booked is a different question from how last month went, and
     * it is the one that decides which of these two sentences is true.
     *
     * No second line. The obvious one to reach for is the 30-day figure, and
     * putting it here would walk straight back into the fault this card started
     * with: a month's number under a badge that says THIS WEEK.
     */
    if (weekly.found === 0 && weekly.contacts === 0) {
      if (!hasEverTraded) {
        return {
          status: 'ok' as const,
          text: t('verdict.justPublished') || 'You\'re live. Waiting for first visitors.',
          sub: t('verdict.justPublished.sub') || 'Usually within a few hours.',
          when: t('verdict.justPublished.when') || 'Just published',
        };
      }

      return {
        status: 'ok' as const,
        text: t('verdict.quiet') || 'No one came this week.',
        sub: '',
        when: t('verdict.running.when') || 'This week',
      };
    }

    {
      /*
       * Say where they came from. Where a channel is actually producing leads,
       * that is the more useful fact than a visitor count on its own.
       */
      const source = topLeadChannel
        ? ` ${t('verdict.live.via') || 'Most came from'} ${topLeadChannel.label}.`
        : '';

      /*
       * The week's two numbers, and nothing about the business.
       *
       * This sentence used to open "You're live" and close on a prediction —
       * that 25 visitors is roughly where a first enquiry should appear. Both
       * were addressed to a business in its first days, and this branch is not
       * that business: it is every week that ends without trade, including the
       * quiet week of a shop that has traded for a year. Being told it is live,
       * and then told what to expect at 25 visitors, is the platform talking
       * about itself.
       *
       * What it reports instead is what happened: how many arrived, how many
       * spoke to you, and where they came from. The badge is the week, because
       * the figures are the week's.
       */
      return {
        status: 'ok' as const,
        text: `${weekly.found} ${t('verdict.running.found') || 'found you'}. ${weekly.contacts} ${t('verdict.running.reached') || 'got in touch'}.${source}`,
        sub: t('verdict.live.sub') || 'No one has booked this week.',
        when: t('verdict.running.when') || 'This week',
      };
    }
  }, [hasPublished, reachesByLink, hasEverTraded, setupShape, weekly, weeklyHeadline, topLeadChannel, formatCurrency, t]);

  /*
   * Today's briefing, ready for the card.
   *
   * Withheld on a cold start: an account with nothing in it gets a briefing
   * about nothing, and the setup checklist is what that space is for. The
   * `cold_start` reading is the same one AdvisorIdleCard uses to make the same
   * judgement, so the two cannot disagree about whether the business has begun.
   *
   * The date is formatted here rather than in the API because it has to follow
   * the interface language, which only the client knows — while the DAY it
   * names is the business's own, resolved server-side. Those are different
   * questions and each is answered where its answer lives.
   */
  const briefingForCard = useMemo(() => {
    if (!briefing?.narrative) return undefined;

    /*
     * Hold until maturity is KNOWN, not merely "not cold start".
     *
     * The two halves of this gate arrive from different fetches: `briefing`
     * comes from the page's my-day call, `vectorMaturity` from this component's
     * own `useInsights`. The briefing usually wins. And while maturity was
     * still in flight, `undefined?.maturityLevel === 'cold_start'` evaluates to
     * false — so the gate read as "not a cold start", the card rendered, and
     * then vanished the moment the real answer landed.
     *
     * A card that appears and then removes itself looks like a bug even when
     * the final state is right. Waiting costs a beat; flashing costs trust.
     *
     * Deliberately keyed on loading rather than on `vectorMaturity` being null:
     * if the insights call FAILS, loading ends with maturity still null, and
     * the briefing should still show. An insights outage is not a reason to
     * hide today's briefing.
     */
    if (insightsLoading) return undefined;
    if (vectorMaturity?.maturityLevel === 'cold_start') return undefined;

    const lines = briefingLines(briefing.narrative);
    if (lines.length === 0) return undefined;

    let dateLabel = briefing.date;
    try {
      // Parsed as UTC noon: the string is a calendar date with no time, and
      // parsing it as local midnight can render the previous day west of UTC.
      dateLabel = new Intl.DateTimeFormat(language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date(`${briefing.date}T12:00:00Z`));
    } catch {
      // Keep the ISO date rather than showing nothing.
    }

    return {
      lines,
      dateLabel,
      emailEnabled: briefing.emailEnabled,
      timezone: briefing.timezone,
    };
  }, [briefing, vectorMaturity?.maturityLevel, insightsLoading, language]);

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

      {/* Page header: the greeting, the date, and the assistant. */}
      <div className="mb-6">
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
              {/*
                Ask the assistant.

                Inline with the greeting, so it reads as part of the sentence
                that addresses you rather than another control competing with
                the date and the chevron on the right.

                The SAME mark the chat panel wears in its own header — the Bot
                glyph on a tinted orange tile — at a smaller size. A sparkle sat
                here first and read as "AI something"; it never said assistant.
                A button that is a miniature of the thing it opens does not have
                to be guessed at.

                It blinks only while the chat is closed: the pulse is an
                invitation, and an invitation to something already open is just
                a distracting icon. It also stops for anyone who has asked the
                system for reduced motion.
              */}
              {onToggleAssistant && (
                <button
                  onClick={onToggleAssistant}
                  aria-expanded={assistantOpen}
                  aria-label={t('chat.title')}
                  title={t('chat.title')}
                  className={`lv-ask${assistantOpen ? ' on' : ''}`}
                >
                  <span className="lv-ask-tile">
                    <Bot strokeWidth={2} />
                  </span>
                  <span className="lv-ask-lb">{t('chat.ask')}</span>
                </button>
              )}
              {/*
                Here, not in the stylesheet at the foot of this component:
                the stylesheet at the foot of this component only renders with
                the body of the card, and these rules belong to the header.
              */}
              <style jsx>{`
                /* font:inherit is the whole reason this icon was invisible.
                   A button does NOT inherit font-size; browsers set their own
                   ~13px on it. The em-sized svg below was therefore 0.62 of
                   13px — an 8px mark beside a 31px heading — rather than 0.62
                   of the greeting. Sized in em deliberately: the heading is a
                   clamp() that grows with the viewport, and a fixed-pixel icon
                   would drift out of proportion at one end or the other. */
                /* The button is the tile AND the words. An icon cannot say
                   "chat" on its own — a bot glyph reads as "AI something" — so
                   the label carries the meaning and the tile carries the
                   attention. */
                .lv-ask {
                  font: inherit;
                  position: relative;
                  display: inline-flex;
                  align-items: center;
                  vertical-align: baseline;
                  /* Padding and a pill radius so the halo has an outline to
                     follow; without them it would trace the text's own ragged
                     box and sit tight against the letters. */
                  gap: 0.2em;
                  padding: 0.2em 0.5em 0.2em 0.36em;
                  border-radius: 999px;
                  /* One unit, not a tile with a caption beside it.
                     The glyph used to carry its own tinted square and the words
                     sat outside it, which read as two objects that happened to
                     be adjacent. The wash belongs to the whole chip; the glyph
                     and the label simply live inside it. */
                  background: rgba(249, 115, 22, 0.12);
                  /* Clearance for the HALO, which spreads 0.6em past the chip
                     on every edge. At the 0.38em that used to sit here it
                     washed over the last letter of the name. */
                  margin-inline-start: 0.8em;
                  border: none;
                  color: #F97316;
                  cursor: pointer;
                  line-height: 0;
                  transition: transform 0.15s, background 0.15s;
                }

                /* The halo, around the WHOLE button — tile and words together.
                   A box-shadow spread rather than a scaled pseudo-element: this
                   button is a wide pill, and scaling one expands it far more
                   sideways than vertically, which reads as a stretching blob
                   rather than a ring. A spreading shadow grows the same amount
                   on every edge and follows the pill exactly. */
                .lv-ask:not(.on) {
                  animation: lvHalo 3.4s ease-out infinite;
                }
                /*
                 * One slow ring with a pause, not a strobe.
                 *
                 * This ran at 1.9s over a glyph that was simultaneously fading
                 * and shrinking — two competing animations on one small target,
                 * which is what made it feel urgent rather than inviting. The
                 * glyph is steady now and this is the only movement left.
                 *
                 * The ring finishes expanding at 45% and the rest of the cycle
                 * is deliberately empty: nearly two seconds of stillness between
                 * pulses. A pulse that restarts the moment it ends reads as an
                 * alarm; one that waits reads as a nudge.
                 */
                @keyframes lvHalo {
                  0% {
                    box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.28);
                  }
                  45% {
                    box-shadow: 0 0 0 0.45em rgba(249, 115, 22, 0);
                  }
                  100% {
                    box-shadow: 0 0 0 0 rgba(249, 115, 22, 0);
                  }
                }

                /* Just the glyph's box now — the chip around it carries the
                   wash that the glyph used to carry alone. */
                .lv-ask-tile {
                  display: inline-flex;
                  align-items: center;
                  justify-content: center;
                  flex: 0 0 auto;
                }

                /* Sized to sit UNDER the greeting rather than beside it as an
                   equal: it is an invitation, not a second headline. */
                .lv-ask-lb {
                  font-size: 0.42em;
                  font-weight: 600;
                  line-height: 1;
                  letter-spacing: 0;
                  white-space: nowrap;
                }
                .lv-ask-tile svg {
                  position: relative;
                  /* Above the ring, which is painted behind it. */
                  z-index: 1;
                  width: 0.66em;
                  height: 0.66em;
                }

                /* Below this the greeting owns the line; the tile and its
                   accessible name carry on alone. */
                @media (max-width: 560px) {
                  .lv-ask-lb {
                    display: none;
                  }
                }

                .lv-ask:hover {
                  background: rgba(249, 115, 22, 0.22);
                  transform: scale(1.04);
                }
                /* Open: steady, and the tile fills in so the button reads as
                   pressed rather than merely stopping its blink. */
                /* Open: the chip deepens and the halo stops. It was there to
                   be found, and it has been. */
                .lv-ask.on {
                  background: rgba(249, 115, 22, 0.22);
                }
                /* Both animations stop for anyone who has asked the system for
                   reduced motion. A pulsing ring is precisely what that setting
                   exists to switch off; the tile alone still marks the button. */
                @media (prefers-reduced-motion: reduce) {
                  .lv-ask:not(.on) {
                    animation: none;
                  }
                }
              `}</style>
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
          </div>
        </div>
        {(
          <p
            className="text-[var(--v2-text-muted)]"
            style={{ fontSize: '15px', maxWidth: '52rem' }}
          >
            {t(status.key, status.vars)}
          </p>
        )}
      </div>

      {(
        <>
      {/*
        Which journey belongs in this slot.

        This is the first block under the greeting — the place the eye lands
        before anything else — and it was always the lifecycle rail: account
        created, first visitor, first booking, first client. For a business that
        has not launched, every one of those nodes is unlit. The best position
        on the dashboard was spent on a timeline of things that had not happened,
        directly above a briefing that is deliberately withheld from a cold-start
        account. Two pieces of emptiness, stacked.

        So while nothing compulsory is outstanding the rail stays exactly as it
        was; until then the slot shows the journey that actually matters to
        someone who has not opened yet — whether a client can reach them at all.
        Same position, same card, same word. Nothing new to find.

        `isReadyForClients` is the graph's own test, the same one the status
        line above uses, so the sentence and the card cannot contradict.

        The length test is not redundant with it. `isReadyForClients` now
        reports false for an EMPTY graph — an unanswered question is not a ready
        business — and a reach journey drawn from no steps would show three
        green stations and no next action, which is the same false all-clear
        wearing the opposite colour. With no data, neither claim is ours to
        make, so the lifecycle rail stays and the readiness card below says the
        check could not run.
      */}
      {showReachJourney ? (
        <ClientReachJourney graph={setupGraph} onAction={onAction} />
      ) : (
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
          background: 'var(--v2-surface)',
          border: '1px solid var(--v2-border)',
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
            color: 'var(--v2-text-secondary)',
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
                background: 'var(--v2-border)',
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
                      ? { background: 'rgba(249, 115, 22, 0.10)', border: '2px dashed #F9A15C' }
                      : { background: 'var(--v2-surface)', border: '2px solid var(--v2-border)' }),
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
                          ? 'var(--v2-surface)'
                          : row.state === 'counting'
                          ? '#F9A15C'
                          : 'var(--v2-border)',
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
                          ? 'var(--v2-text-primary)'
                          : row.state === 'counting'
                          ? '#F97316'
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
                      color: row.state === 'waiting' ? 'var(--v2-text-muted)' : 'var(--v2-text-secondary)',
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

      </>
      )}

      {/* The assistant, directly under the journey.

          It used to sit at the foot of the page, below every card here. Now
          that it is hidden until asked for, it opens where the button that
          opened it is still on screen — a panel that appears eleven sections
          further down reads as nothing having happened. */}
      {assistantSlot}

      {/* System readiness — sits directly under the timeline, ahead of every
          metric, because an unconfigured system makes the numbers below it moot.
          Consumption sits beside it: both answer "what is the state of my
          account" rather than "what happened in my business", so they belong on
          the same row. Usage is the narrower column — it is a glance, not a task
          list — and it stacks above on narrow screens rather than being cut. */}
      {(
        <div className="usage-readiness-row">
          {/* Wrapped so the row's own scoped CSS can order them: styled-jsx
              cannot reach a child component's root node, and the source order
              here is what the stacked layout below 900px falls back to. */}
          <div className="ur-usage">
            <UsageCard />
          </div>
          <div className="ur-readiness">
            <SystemReadiness
              items={readinessItems}
              shape={setupShape}
              onAction={onAction}
              pendingActions={pendingActions}
              actionError={actionError}
            />
          </div>
        </div>
      )}

      <style jsx>{`
        .usage-readiness-row {
          display: grid;
          /* Readiness takes two thirds, usage a third. Readiness is a task list
             that needs the room; usage is a glance.

             The row MIRRORS with the document. It used to pin direction:ltr, on
             the reasoning that column position is a layout decision rather than
             a reading one — but the effect was that both languages put the
             narrow glance card where the eye lands first in English and last in
             Hebrew. Readiness is the card that matters; it belongs at the start
             of the line in both, which is left in English and right in Hebrew.

             Order, not DOM order, does the swapping. Readiness is second in the
             markup so that when this collapses to one column below 900px the
             usage card stays on top, which is what the narrow layout wants.
             (No backticks in this comment: it lives inside a template literal,
             and a stray one ends the string and breaks the parse.) */
          grid-template-columns: 2fr 1fr;
          gap: 16px;
          /* Stretch, not start: the two cards are a pair and ending at
             different depths made the row look broken rather than deliberate.
             Each card sets height:100% so it fills the track it is given. */
          align-items: stretch;
          margin-bottom: 16px;
        }
        /* First track is readiness, second is usage — independent of which
           side those tracks land on, which direction decides. */
        .ur-readiness {
          order: 1;
        }
        .ur-usage {
          order: 2;
        }
        /* The wrappers must not shorten the cards: each card already sets
           height 100%, and an auto-height wrapper between them and the
           stretched track would collapse that back. */
        .ur-usage,
        .ur-readiness {
          min-width: 0;
          height: 100%;
        }
        @media (max-width: 900px) {
          .usage-readiness-row {
            grid-template-columns: 1fr;
          }
          /* Stacked: source order wins again, so the glance sits above the
             task list rather than below it. */
          .ur-usage,
          .ur-readiness {
            order: 0;
          }
        }
        .lv-day-week-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          /* stretch, not start: the two cards are a matched pair and a ragged
             bottom edge reads as a rendering fault rather than a design. Each
             one grows to the taller of the two. */
          align-items: stretch;
          margin-bottom: 14px;
        }
        /* VerdictCard carries its own bottom margin for the stacked case; the
           grid gap owns the spacing here. */
        .lv-day-week-row > .lv-verdict {
          margin-bottom: 0;
          height: 100%;
        }
        .lv-day-week-row > * {
          height: 100%;
        }
        @media (max-width: 900px) {
          .lv-day-week-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/*
        Today and this week, side by side.

        Today leads in DOM order, so it lands on the right in RTL and the left
        in LTR — first in reading order either way, which is what it is: the
        thing you act on now, with the week beside it as context. They collapse
        to one column below 900px, where two cards of prose would be unreadable.
      */}
      {/*
        What is waiting on the owner, above everything else.

        Ahead of the briefing on purpose: the briefing is what happened, and
        this is what has not happened yet. It renders nothing when nothing is
        stuck, so a business that is on top of things sees the dashboard it had
        before.
      */}
      {gaps && gaps.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <NeedsYouCard gaps={gaps} onChanged={onGapsChanged} />
        </div>
      )}

      {briefingForCard ? (
        <div className="lv-day-week-row">
          <DailyBriefingCard
            lines={briefingForCard.lines}
            dateLabel={briefingForCard.dateLabel}
            emailEnabled={briefingForCard.emailEnabled}
            timezone={briefingForCard.timezone}
          />
          <VerdictCard
            status={verdict.status}
            verdict={verdict.text}
            verdictSub={verdict.sub}
            when={verdict.when}
            figures={verdict.figures}
            highlight={verdict.highlight}
            fillHeight
          />
        </div>
      ) : (
        <VerdictCard
          status={verdict.status}
          verdict={verdict.text}
          verdictSub={verdict.sub}
          when={verdict.when}
          figures={verdict.figures}
          highlight={verdict.highlight}
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
                color: 'var(--v2-text-secondary)',
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

      {/* How clients reach you, and where they came from. Placed after the
          pipeline so the reader has seen the funnel before being asked which
          channels feed it.

          Unconditional. This card carries the smart link — which for a business
          with no website is the ONLY way a client reaches it — and that has
          nothing to do with whether they wanted their Instagram read. */}
      <ChannelsOverviewCard
        performance={channelPerformance}
        onChanged={onChannelsChanged}
        /* The onboarding answer decides how the connections control reads,
           never whether this card is here. */
        offerConnections={!connectionsWanted}
        /* Already on this component from `/api/business-os/stats` — the
           connections column lists owned surfaces beside connected accounts,
           and needed no query of its own to do it. Undefined rather than
           false while the stats call is in flight: "not told yet" must not
           render a Publish button at a business that has a published site. */
        owned={ownedSurfaces}
        onAction={action => onAction?.(action)}
      />

      {/*
        ONE advisor.

        The engine's pending detections are the advice; undecided automations
        are carouselled after them, so approving one is a page of the same card
        rather than a second card stacked above it. When there is neither, the
        idle card says so in one line rather than narrating the account's age
        back at the reader — the only scripted copy left is the setup pitch,
        which exists because its buttons genuinely do something.
      */}
      {(pendingInsights.length > 0 || operationalPending.length > 0 ? (
        <InsightAdvisorCard
          insights={pendingInsights}
          operational={operationalPending}
          onOperationalDecide={handleOperationalDecide}
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

      {/* The standalone "What I've handled for you today" block used to sit
          here. It has moved into the briefing at the top of the page, which
          covers the same ground in one narrative rather than a second list of
          today's events three cards below the first.

          Note for whoever reads this next: the comment that used to sit here
          said a second copy lived inside InsightAdvisorCard. It does not, and
          did not — HandledSection is rendered nowhere as of this change. It is
          still exported from ./index.ts. Either give it a home or delete it;
          this codebase has already carried two orphaned insight components
          (ReportCard, MyDaySection) long enough for both to be forgotten. */}

        </>
      )}
    </section>
  );
}
