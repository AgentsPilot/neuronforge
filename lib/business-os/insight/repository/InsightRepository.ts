/**
 * Insight Repository
 *
 * Data access layer for insights and insight history.
 * Follows the repository pattern established in lib/repositories/.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 * @see docs/REPOSITORY_STRATEGY.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider';
import { resolveUserLanguage } from '@/lib/business-os/userLanguage';
import { createLogger } from '@/lib/logger';
import type { DetectionResult, InsightSeverity } from '../detectors/types';
import type { PrioritizedInsight } from '../prioritizer/InsightPrioritizer';
import type { BusinessEventCategory } from '../events/types';
import type { CorrelatedInsight, CorrelationSummary } from '../correlation/types';
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import { getVerticalConfig, buildTerminologyInstruction, getVerticalDescriptor } from '../vertical-config';
import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';
import { automationApplies } from '@/lib/business-os/gaps/automationApplies';

const logger = createLogger({ service: 'InsightRepository' });

// ===========================
// Types
// ===========================

/**
 * 'resolved' is set by the detection sweep, not by a person: the condition
 * stopped holding — the invoice was paid, the lead booked, the detector was
 * removed. Kept distinct from 'dismissed', which means somebody looked and
 * chose to close it, so "how much of what we surface sorts itself out" stays a
 * question with an answer.
 */
export type InsightStatus =
  | 'new' | 'viewed' | 'snoozed' | 'dismissed' | 'acted' | 'automated' | 'resolved';

export interface Insight {
  id: string;
  user_id: string;
  detector_id: string;
  detection_run_id?: string;
  category: BusinessEventCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  business_impact?: string;
  recommendation?: string;
  metric_key?: string;
  current_value?: number;
  baseline_value?: number;
  threshold_value?: number;
  percent_change?: number;
  direction?: 'above' | 'below';
  affected_entity_type?: string;
  affected_entity_ids?: string[];
  affected_count: number;
  estimated_impact_usd?: number;
  impact_direction?: 'loss' | 'opportunity' | 'savings';
  impact_period?: 'daily' | 'weekly' | 'monthly';
  paired_process_id?: string;
  process_parameters?: Record<string, unknown>;
  eligible_for_automation: boolean;
  priority_score: number;
  status: InsightStatus;
  snoozed_until?: string;
  dismissed_at?: string;
  dismiss_reason?: string;
  acted_at?: string;
  action_execution_id?: string;
  last_surfaced_at?: string;
  surface_count: number;
  detected_at: string;
  created_at: string;
  updated_at: string;
  // Correlation fields
  is_correlated?: boolean;
  correlation_parent_id?: string;
  correlation_pattern_id?: string;
  contributing_insight_ids?: string[];
  total_correlated_impact_usd?: number;
  story?: string;
  // Trend context
  trend_direction?: 'improving' | 'stable' | 'worsening';
  trend_percent_change?: number;
  previous_week_value?: number;
  language?: string;
  // Child insights for correlated insights
  contributing_insights?: ContributingInsight[];
}

export interface ContributingInsight {
  detector_id: string;
  detector_name: string;
  severity: InsightSeverity;
  summary: string;
  impact_usd: number;
  insight_id?: string;
}

export interface BusinessHealthSummary {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  period_type: 'daily' | 'weekly' | 'monthly';
  health_score: number;
  previous_health_score?: number;
  score_change?: number;
  acquisition_score: number;
  conversion_score: number;
  sales_score: number;
  cash_flow_score: number;
  retention_score: number;
  operations_score: number;
  pricing_score: number;
  summary_title: string;
  summary_narrative: string;
  summary_language: string;
  highlights: Array<{ type: 'positive' | 'negative' | 'neutral'; text: string }>;
  priorities: Array<{ rank: number; category: string; title: string; insight_id?: string }>;
  insight_count: number;
  critical_count: number;
  high_count: number;
  total_impact_usd: number;
  detection_run_id?: string;
  created_at: string;
  updated_at: string;
}

export interface InsightHistoryEntry {
  id: string;
  user_id: string;
  insight_id: string;
  action: 'viewed' | 'acted' | 'dismissed' | 'snoozed' | 'automated';
  detector_id: string;
  category: string;
  severity: string;
  time_to_action_seconds?: number;
  was_helpful?: boolean;
  created_at: string;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ===========================
// Vector Maturity System (Progressive Data Revelation)
// ===========================

export type VectorKey = 'wins' | 'conv' | 'ops' | 'cash' | 'leads' | 'ret' | 'price';
export type VectorState = 'dark' | 'learn' | 'lit';
export type MaturityLevel = 'cold_start' | 'early' | 'running' | 'mature';

export interface VectorStatus {
  key: VectorKey;
  name: string;
  state: VectorState;
  dataPoints: number;
  threshold: number;
  note?: string;
  /**
   * The volume condition behind a time-based vector, with where it stands.
   *
   * Carried out of here so the journey timeline can tell the two apart: days
   * are arithmetic and can be stated as a date, volume cannot. Absent on the
   * vectors that have only one condition.
   */
  also?: { metric: string; current: number; threshold: number };
}

/**
 * The dates the journey timeline counts from.
 *
 * Every vector below is already anchored to an event rather than to signup —
 * `days_with_bookings` runs from the first booking, `days_with_clients` from the
 * first client. Those anchors were computed here, reduced to an elapsed count,
 * and thrown away. The count alone cannot say WHEN a vector lights: only
 * `anchor + threshold` can, and that is the whole difference between a timeline
 * that predicts and one that states a date.
 */
export interface JourneyAnchors {
  /** `business_profiles.created_at` — day zero for every day number shown. */
  accountCreatedAt: string | null;
  /** First booking ever taken. Anchors the pricing vector. */
  firstBookingAt: string | null;
  /** First contact to reach the client stage. Anchors the retention vector. */
  firstClientAt: string | null;
  /**
   * When the conversion vector's visitor threshold was actually crossed.
   *
   * The only unlock measured in a count rather than in days, so it is the only
   * one whose date cannot be derived — the 25th visit has to be read. Fetched
   * once the count says the threshold is met, and null before that: there is no
   * arithmetic that can predict when a 25th visitor will arrive.
   */
  convCrossedAt: string | null;
  /**
   * The first standing automation the owner handed over.
   *
   * This is what the old "Day 90 · Automated / Takes over" node was reaching
   * for — the platform doing recurring work instead of the owner. It was
   * written as a date on the calendar, which it never was: handover happens
   * when there is something worth handing over and the owner agrees to it,
   * which can be week two or never. `insight_automations` records exactly that
   * moment, so the node can state it.
   */
  firstAutomationAt: string | null;
  /** Standing automations switched on right now. */
  runningAutomations: number;
}

export interface VectorMaturityData {
  vectors: VectorStatus[];
  maturityLevel: MaturityLevel;
  litCount: number;
  totalVectors: number;
  accountAgeDays: number;
  /** Event dates the journey timeline measures from. */
  journeyAnchors: JourneyAnchors;
  /**
   * English prose, kept as a fallback for any caller that has not been updated.
   * The UI should prefer `noteKey`.
   */
  note: string;
  /**
   * The note as a translation key, because this text is read by Hebrew and
   * Spanish businesses and was being assembled in English on the server, where
   * there is no reader to have a language.
   */
  noteKey: 'vecs.note.cold' | 'vecs.note.full' | 'vecs.note.partial';
  /**
   * Vector KEYS still learning, for the partial note. Keys rather than names:
   * the client already localises a vector name as `insight.vector.{key}`, and
   * sending the English name would put an untranslated word inside a translated
   * sentence.
   */
  noteLearning: string[];
}

// Thresholds for each vector to become "lit" (active)
interface VectorThreshold {
  threshold: number;
  metric: string;
  note: string;
  /**
   * A second condition that must ALSO hold before the vector lights.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `price` and `ret` are the only vectors measured in elapsed time, and time
   * on its own is not evidence. `days_with_bookings` is `Date.now()` minus the
   * first booking — nothing about how many bookings there have been. So a
   * business that took ONE booking in January had "42 days of pricing data" by
   * mid-February, and pricing insights unlocked on a sample of one.
   *
   * transactions, `ret_cancellation_spike` wants 20 bookings — so the vector
   * said "lit, start reasoning" and the detector then declined on sample size.
   * The gate and the detector disagreed about what readiness means, and the
   * journey map showed the gate's answer.
   *
   * Time still matters for these two — a client cannot be LAPSED until enough
   * time has passed for lapsing to mean anything, however many you have. It is
   * necessary and it is not sufficient. Both conditions, or the vector waits.
   * ───────────────────────────────────────────────────────────────────────────
   */
  also?: { metric: string; threshold: number };
}

/**
 * How many page-view rows the visitor count will scan.
 *
 * Uniqueness cannot be pushed into the query — PostgREST offers no DISTINCT and
 * no COUNT(DISTINCT) — so the rows are folded here instead. The cap keeps a
 * busy site from pulling an unbounded table into memory to answer a question
 * whose threshold is 25; when it is hit the result is reported as a floor and
 * logged, never silently truncated into a number that looks exact.
 */
const VISITOR_SCAN_LIMIT = 5000;

/** One page-view row, reduced to what identifies the person who made it. */
interface VisitorIdentityRow {
  session_id?: string | null;
  ip_hash?: string | null;
  is_owner_view?: boolean | null;
}

/**
 * How many distinct PEOPLE are in a set of page views.
 *
 * Identity falls back through what the row actually has. `session_id` is the
 * real answer; `ip_hash` catches rows written before a session existed or by a
 * client that blocked storage. A row with neither cannot be attributed to
 * anyone, so it counts as one visitor each rather than collapsing every
 * anonymous row in the table into a single phantom person — undercounting a
 * real audience is the worse error of the two.
 *
 * Owner views are excluded in code rather than in the query because the column
 * is nullable: `neq('is_owner_view', true)` drops NULL rows in Postgres, and
 * NULL is what almost every row in this table currently holds — the filter
 * would have discarded the entire audience it was meant to clean.
 */
function countUniqueVisitors(rows: VisitorIdentityRow[] | null | undefined): number {
  if (!rows?.length) return 0;

  const identities = new Set<string>();
  let anonymous = 0;

  for (const row of rows) {
    if (row.is_owner_view === true) continue;

    const identity = row.session_id || row.ip_hash;
    if (identity) identities.add(identity);
    else anonymous += 1;
  }

  return identities.size + anonymous;
}

const VECTOR_THRESHOLDS: Record<VectorKey, VectorThreshold> = {
  wins: { threshold: 1, metric: 'positive_events', note: 'Lights immediately on any good news' },
  conv: { threshold: 25, metric: 'total_visitors', note: 'Need about 25 visitors before I\'d trust what the conversion rate is telling me' },
  ops: { threshold: 1, metric: 'total_bookings', note: 'Need at least one booking to understand your calendar' },
  cash: { threshold: 1, metric: 'total_invoices', note: 'Starts watching when you have invoices to track' },
  leads: { threshold: 10, metric: 'total_contacts', note: 'Need some leads to spot patterns' },
  ret: {
    threshold: 60,
    metric: 'days_with_clients',
    note: 'Retention needs clients old enough to lapse — about two months — and enough of them for a lapse to be a rate',
    also: { metric: 'total_clients', threshold: 10 },
  },
  price: {
    threshold: 42,
    metric: 'days_with_bookings',
    note: 'Pricing needs six weeks of your calendar, and enough bookings in it to say anything about price',
    also: { metric: 'total_bookings', threshold: 20 },
  },
};

/**
 * Money in an insight is the business's own money, in the currency it bills in.
 *
 * The column it lands in is called `estimated_impact_usd`, which is a lie the
 * schema tells: detectors put raw amounts in it, whatever the business charges.
 * So every figure shown to a user is formatted with that business's currency
 * rather than a hardcoded symbol — an Israeli therapist should never be told
 * they are owed "$5,066.61".
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  ILS: '₪',
  EUR: '€',
  GBP: '£',
};

function formatMoney(amount: number | null | undefined, currency: string): string {
  const value = Number(amount) || 0;
  const symbol = CURRENCY_SYMBOLS[currency?.toUpperCase()];
  // An unmapped currency reads better as "1,200 CHF" than as a guessed symbol.
  return symbol ? `${symbol}${value.toLocaleString()}` : `${value.toLocaleString()} ${currency?.toUpperCase() || ''}`.trim();
}

const VECTOR_NAMES: Record<VectorKey, string> = {
  wins: 'Wins',
  conv: 'Conversion',
  ops: 'Booking',
  cash: 'Cash flow',
  leads: 'Leads',
  ret: 'Retention',
  price: 'Pricing',
};

/** Who the business is, in the terms the generated content needs. */
interface BusinessContext {
  language: string;
  /** What the business bills in — every money figure is formatted with it. */
  currency: string;
  vertical: string | null;
  sub_vertical: string | null;
  company_size: string | null;
}

export interface CreateInsightParams {
  userId: string;
  detection: DetectionResult;
  priorityScore: number;
  /**
   * The detection run this insight came from. Required: it is also the
   * grouping id every LLM call in the run is recorded under.
   */
  runId: string;
}

// ===========================
// InsightRepository
// ===========================

/**
 * The earliest of several dates, ignoring the absent ones.
 *
 * Null when nothing is known, which the journey renders as "unknown" rather
 * than as "started this morning".
 */
function earliestOf(candidates: Array<string | null | undefined>): string | null {
  const times = candidates
    .filter((c): c is string => !!c)
    .map(c => ({ iso: c, ms: new Date(c).getTime() }))
    .filter(c => Number.isFinite(c.ms));

  if (times.length === 0) return null;
  return times.reduce((a, b) => (a.ms <= b.ms ? a : b)).iso;
}


/**
 * Whether this detection actually measured a change against something.
 *
 * Sixteen detectors report `percentChange: 100` beside `baselineValue: 0`, not
 * because anything doubled but because they are absolute counts — three
 * invoices overdue, one payout blocked — and the field had to be given a value.
 * Passing that to the model as "Change from baseline: 100%" is how an owner was
 * told a single unpaid invoice represented "a 100% increase in your expected
 * cash flow this period": a fabricated statistic, of the same kind as the
 * assumed payment rate this module has already had to remove once.
 *
 * A change needs something to have changed FROM. With no baseline the line is
 * omitted entirely, and the model has nothing to narrate — the same discipline
 * the daily briefing applies to absent facts.
 */
function hasRealBaseline(detection: {
  percentChange?: number | null;
  baselineValue?: number | null;
}): boolean {
  return (
    typeof detection.percentChange === 'number' &&
    typeof detection.baselineValue === 'number' &&
    detection.baselineValue !== 0
  );
}

/**
 * How long a resolved insight stays visible before it goes.
 *
 * Long enough that somebody who looks at the dashboard once a day sees that the
 * thing they were told about sorted itself out, rather than finding the card
 * simply gone and wondering whether they imagined it. Short enough that the
 * advisor does not become a list of things not to worry about.
 */
const RESOLVED_VISIBLE_HOURS = 24;

export class InsightRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Create a new insight from a detection result
   * If an active insight already exists for this detector, update it instead
   */
  async create(params: CreateInsightParams): Promise<RepositoryResult<Insight>> {
    try {
      const { userId, detection, priorityScore, runId } = params;

      // Check if there's already an active insight for this detector
      const { data: existingInsights } = await this.supabase
        .from('insights')
        .select('id')
        .eq('user_id', userId)
        .eq('detector_id', detection.detectorId)
        .in('status', ['new', 'viewed'])
        .order('created_at', { ascending: false })
        .limit(1);

      const existingInsight = existingInsights?.[0];

      // If an active insight exists, update it instead of creating a new one
      if (existingInsight) {
        logger.info(
          { userId, insightId: existingInsight.id, detectorId: detection.detectorId },
          'Updating existing insight instead of creating duplicate'
        );

        const { data: updated, error: updateError } = await this.supabase
          .from('insights')
          .update({
            detection_run_id: runId,
            severity: detection.severity,
            current_value: detection.currentValue,
            baseline_value: detection.baselineValue,
            threshold_value: detection.thresholdValue,
            percent_change: detection.percentChange,
            affected_entity_ids: detection.affectedEntityIds,
            affected_count: detection.affectedCount,
            estimated_impact_usd: detection.estimatedImpactUsd,
            process_parameters: detection.processParameters,
            priority_score: priorityScore,
            detected_at: detection.detectedAt.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingInsight.id)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) throw updateError;
        return { data: updated, error: null };
      }

      // Get user's business context for personalized content
      const businessContext = await this.getUserBusinessContext(userId);

      // Generate title and description using LLM with vertical-aware personalization
      const { title, description, recommendation } = await this.generateLocalizedContent(
        detection,
        userId,
        businessContext,
        runId
      );

      const { data, error } = await this.supabase
        .from('insights')
        .insert({
          user_id: userId,
          detector_id: detection.detectorId,
          detection_run_id: runId,
          category: detection.category,
          severity: detection.severity,
          title,
          description,
          recommendation,
          metric_key: detection.metricKey,
          current_value: detection.currentValue,
          baseline_value: detection.baselineValue,
          threshold_value: detection.thresholdValue,
          percent_change: detection.percentChange,
          direction: detection.direction,
          affected_entity_type: detection.affectedEntityType,
          affected_entity_ids: detection.affectedEntityIds,
          affected_count: detection.affectedCount,
          estimated_impact_usd: detection.estimatedImpactUsd,
          impact_direction: detection.impactDirection,
          impact_period: detection.impactPeriod,
          paired_process_id: detection.pairedProcessId,
          process_parameters: detection.processParameters,
          eligible_for_automation: detection.eligibleForAutomation,
          priority_score: priorityScore,
          status: 'new',
          // The column defaults to 'en' and was never set, so every row claimed
          // English whatever it held. Nothing could tell the two apart.
          language: businessContext.language,
          detected_at: detection.detectedAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(
        { userId, insightId: data.id, detectorId: detection.detectorId, language: businessContext.language, vertical: businessContext.vertical },
        'Insight created with personalized content'
      );

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create insight');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get user's language preference from user_preferences or business_profiles
   */
  /**
   * Get user's business context for personalized insights
   * Returns language, vertical, sub_vertical, and company_size
   */
  private async getUserBusinessContext(userId: string): Promise<BusinessContext> {
    try {
      // First try user_preferences for language (primary source)
      const { data: prefs } = await this.supabase
        .from('user_preferences')
        .select('preferred_language')
        .eq('user_id', userId)
        .single();

      // Get business profile for vertical and other context
      const { data: profile } = await this.supabase
        .from('business_profiles')
        .select('language, vertical, sub_vertical, company_size')
        .eq('user_id', userId)
        .single();

      // The profile is preferred over the preference row: the preference row is
      // also created as a side effect of saving a timezone, which supplies no
      // language and leaves the column on its `en` default. That defaulted
      // value used to outrank a language the user had actually chosen, which is
      // how a Hebrew account generated English insights.
      const { language, source } = resolveUserLanguage({
        profileLanguage: profile?.language,
        preferredLanguage: prefs?.preferred_language,
      });

      logger.debug({ userId, language, source }, 'Resolved user language for insight content');

      return {
        language,
        currency: await this.getUserCurrency(userId),
        vertical: profile?.vertical || null,
        sub_vertical: profile?.sub_vertical || null,
        company_size: profile?.company_size || null,
      };
    } catch (error) {
      logger.warn({ userId, err: error }, 'Failed to fetch business context, using defaults');
      return {
        language: 'en',
        currency: 'USD',
        vertical: null,
        sub_vertical: null,
        company_size: null,
      };
    }
  }

  /**
   * The currency this business actually charges in.
   *
   * There is no currency on the profile, so it is read from what the business
   * bills: its services first, then its invoices. USD only as a last resort,
   * and it is a guess when it happens.
   */
  private async getUserCurrency(userId: string): Promise<string> {
    try {
      const { data: service } = await this.supabase
        .from('scheduling_services')
        .select('currency')
        .eq('user_id', userId)
        .not('currency', 'is', null)
        .limit(1)
        .maybeSingle();

      if (service?.currency) return service.currency;

      const { data: invoice } = await this.supabase
        .from('payment_invoices')
        .select('currency')
        .eq('user_id', userId)
        .not('currency', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return invoice?.currency || 'USD';
    } catch (error) {
      logger.warn({ userId, err: error }, 'Failed to resolve business currency, assuming USD');
      return 'USD';
    }
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use getUserBusinessContext() instead
   */
  private async getUserLanguage(userId: string): Promise<string> {
    const context = await this.getUserBusinessContext(userId);
    return context.language;
  }

  /**
   * Generate localized content using LLM with vertical-aware personalization
   */
  private async generateLocalizedContent(
    detection: DetectionResult,
    userId: string,
    businessContext: BusinessContext,
    runId: string
  ): Promise<{ title: string; description: string; recommendation: string }> {
    try {
      // Model, temperature and the on/off switch come from the insights area
      // row (Layer 2 FR-12). Off means the translated templates below, which
      // is what an LLM failure has always fallen back to.
      const settings = await resolveBosLlmSettings('insights', 'insight_content');
      if (!settings.enabled) {
        logger.info(
          { detectorId: detection.detectorId, language: businessContext.language, reason: 'disabled' },
          'Insight content AI is switched off; using the templates'
        );
        return {
          title: this.generateTitle(detection, businessContext.language, businessContext.currency),
          description: this.generateDescription(detection, businessContext.language, businessContext.currency),
          recommendation: this.generateRecommendation(detection, businessContext.language, businessContext.currency),
        };
      }

      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);

      const languageNames: Record<string, string> = {
        en: 'English',
        he: 'Hebrew',
        es: 'Spanish',
      };
      const langName = languageNames[businessContext.language] || 'English';

      // Get vertical configuration
      const verticalConfig = getVerticalConfig(businessContext.vertical);
      const verticalDescriptor = getVerticalDescriptor(businessContext.vertical, businessContext.company_size);
      const terminologyInstruction = buildTerminologyInstruction(businessContext.vertical, businessContext.language);

      const detectorDescriptions: Record<string, string> = {
        // Original 6 detectors
        cash_ar_overdue: 'overdue invoices that need payment follow-up',
        cash_payment_issues: 'payment issues (failed, pending, or refunded payments)',
        ret_no_show_spike: 'increased no-show rate for appointments',
        sales_stalled: 'leads/enquiries waiting too long without a response',
        sales_reply_slow: 'slow response time to customer enquiries',
        ops_utilization_low: 'low calendar utilization (empty appointment slots)',
        // Phase 1: High Impact
        crm_cold_leads: 'leads that have gone cold with no contact in 7+ days',
        acq_traffic_drop: 'significant drop in website traffic',
        acq_low_conversion: 'low conversion rate from website visitors to leads',
        ret_cancellation_spike: 'spike in appointment cancellations',
        // Phase 2: CRM/Pipeline
        conv_pipeline_stuck: 'contacts stuck in the same pipeline stage for too long',
        conv_followup_overdue: 'overdue follow-up tasks that need attention',
        conv_source_underperform: 'lead sources with below-average conversion rates',
        crm_engagement_decay: 'clients who have gone quiet and may be at risk of churning',
        // Phase 3: Booking/Operations
        ret_repeat_booking_low: 'low rate of clients rebooking after their first visit',
        ops_last_minute_cancels: 'last-minute cancellations (within 24 hours of appointment)',
        ops_service_performance: 'services that are underperforming compared to others',
        ops_peak_unutilized: 'peak hours that are not being fully utilized',
        // Phase 4: Website Content
        web_missing_cta: 'pages missing clear calls-to-action',
        web_incomplete_content: 'website sections with incomplete content',
        // Phase 5: Cash Flow Deep
        cash_ar_aging: 'invoices aging into harder-to-collect buckets (60+ days)',
        cash_refund_pattern: 'high refund rate that may signal service issues',
        cash_payout_blocked: 'Stripe payouts blocked - cannot receive money',
        // Phase 6: Pricing
        pricing_intro_offer_stuck: 'customers using intro offers but not converting to full price',
        // MVP0: the three journey gaps
        cash_booking_unpaid: 'upcoming appointments that were supposed to be paid for in advance and have not been',
        cash_work_unbilled: 'completed appointments that were never invoiced and never paid for',
        cash_income_drop: 'money received over the last four weeks falling well below the four weeks before',
        cash_client_concentration: 'a single client accounting for an outsized share of everything received',
        conv_quote_acceptance_drop: 'the share of answered quotes that were accepted falling against the previous quarter',
        web_mobile_conversion_gap: 'mobile visitors getting in touch far less often than desktop visitors',
        web_page_no_conversions: 'published pages with real traffic that produced no enquiries at all',
        web_link_not_converting: 'shared links that people click and that produced no bookings or enquiries behind any click',
        web_link_dead_destination: 'a link the owner is still sharing whose destination cannot open on anyone else\'s device',
        conv_no_next_step: 'people who had activity but now have nothing scheduled to happen next — no booking, no task, no movement',
        cash_revenue_at_risk: 'money that has been billed or quoted and has not arrived yet — invoices, plan instalments and unanswered quotes together',
        conv_stage_dropoff: 'a stage in the customer journey that people reach and never move past',
        conv_service_rate_drop: 'an entry service converting into paid work less often than it used to',
      };

      const issueType = detection.processParameters?.issue_type as string | undefined;
      let context = detectorDescriptions[detection.detectorId] || 'a business issue';

      if (detection.detectorId === 'cash_payment_issues' && issueType) {
        const issueDescriptions: Record<string, string> = {
          failed: 'failed payment transactions that need retry or follow-up',
          pending: 'pending payments awaiting confirmation (bank transfers, etc.)',
          refunded: 'refunds processed this month',
        };
        context = issueDescriptions[issueType] || context;
      }

      const prompt = `You are a business insights assistant for a ${verticalDescriptor}.

Business Context:
- Type: ${businessContext.vertical || 'general business'}${businessContext.sub_vertical ? ` (${businessContext.sub_vertical})` : ''}
- Company size: ${businessContext.company_size || 'solo'}
- Language: ${langName}

Detection details:
- Issue type: ${context}
- Affected items: ${detection.affectedCount}
- Amount involved: ${formatMoney(detection.currentValue, businessContext.currency)}
- Estimated impact: ${formatMoney(detection.estimatedImpactUsd, businessContext.currency)}
- Severity: ${detection.severity}
${hasRealBaseline(detection) ? `- Change from baseline: ${detection.percentChange!.toFixed(0)}%` : ''}
${issueType ? `- Specific issue: ${issueType}` : ''}

TONE & STYLE GUIDELINES:
${verticalConfig.toneGuidelines}

${terminologyInstruction}

WRITING STYLE:
- Use simple, conversational language appropriate for a solo business owner
- Avoid business jargon - explain numbers in plain terms
- Be specific with numbers and concrete actions
- For recommendations: Give clear, actionable next steps that feel achievable

Generate in ${langName} language. Respond with ONLY a JSON object (no markdown, no code blocks):
{
  "title": "A short, impactful title (max 50 chars, include key numbers)",
  "description": "1-2 sentences explaining the issue with specific numbers in plain language",
  "recommendation": "1 clear, actionable sentence that a busy solo owner can act on today"
}`;

      // The request is built INSIDE the attempt, so a retry on the code
      // default carries the model that actually ran (FR-11, RC-W4).
      const { result: response } = await withModelFallback(settings, (model) =>
        provider.chatCompletion(
          {
            messages: [{ role: 'user' as const, content: prompt }],
            model,
            ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
            max_tokens: 300,
          },
          // Recorded against the business analysed, grouped by the detection run.
          buildBosCallContext({
            userId,
            area: 'insights',
            callName: 'insight_content',
            groupId: runId,
          })
        )
      );

      const content = response.choices[0]?.message?.content?.trim() || '';
      // Remove markdown code blocks if present
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      return {
        title: parsed.title || this.generateTitle(detection, businessContext.language, businessContext.currency),
        description: parsed.description || this.generateDescription(detection, businessContext.language, businessContext.currency),
        recommendation: parsed.recommendation || this.generateRecommendation(detection, businessContext.language, businessContext.currency),
      };
    } catch (error) {
      // Logged at error, not warn: this is the difference between an insight
      // written for this business and a filled-in template, and it was
      // previously indistinguishable from normal operation. The language is
      // included because the first question asked of a wrong-language insight
      // is which language generation actually used.
      //
      // The templates below are fully translated, so the fallback still lands
      // in the user's language — it just loses the personalised phrasing.
      logger.error(
        {
          err: error,
          detectorId: detection.detectorId,
          language: businessContext.language,
          vertical: businessContext.vertical,
        },
        'LLM insight generation failed — falling back to templates'
      );
      return {
        title: this.generateTitle(detection, businessContext.language, businessContext.currency),
        description: this.generateDescription(detection, businessContext.language, businessContext.currency),
        recommendation: this.generateRecommendation(detection, businessContext.language, businessContext.currency),
      };
    }
  }

  /**
   * Create multiple insights from prioritized results
   */
  async createBatch(
    userId: string,
    insights: PrioritizedInsight[],
    runId: string
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const results: Insight[] = [];

      for (const insight of insights) {
        const result = await this.create({
          userId,
          detection: insight.detection,
          priorityScore: insight.score,
          runId,
        });

        if (result.data) {
          results.push(result.data);
        }
      }

      return { data: results, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create insight batch');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get insight by ID
   */
  async findById(id: string, userId: string): Promise<RepositoryResult<Insight>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

/**
 * Get active insights for a user, plus the ones that have just resolved.
 *
 * Resolved rows are included deliberately. An insight that disappears the
 * instant its condition clears leaves the owner with a card they half remember
 * and no idea what happened to it — and the platform loses the one chance it
 * has to say "that sorted itself out", which is the most reassuring thing an
 * advisor ever gets to report. They carry `resolved_at`, and the dashboard
 * renders them read-only.
 */
  async findActive(
    userId: string,
    limit: number = 10
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const now = new Date().toISOString();
      const resolvedSince = new Date(Date.now() - RESOLVED_VISIBLE_HOURS * 3_600_000).toISOString();

      const [openResult, resolvedResult] = await Promise.all([
        this.supabase
          .from('insights')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'new')
          .or(`snoozed_until.is.null,snoozed_until.lt.${now}`)
          .order('priority_score', { ascending: false })
          .limit(limit),
        this.supabase
          .from('insights')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'resolved')
          .gte('resolved_at', resolvedSince)
          .order('resolved_at', { ascending: false })
          .limit(limit),
      ]);

      if (openResult.error) throw openResult.error;

      /*
       * A failure on the resolved half is not fatal.
       *
       * Until 20260917_insight_resolution.sql is applied there is no
       * `resolved_at` column, and PostgREST rejects the whole select for one
       * unknown name. Degrading to the open insights alone keeps the advisor
       * working through the window between deploy and migration, which this
       * repository has been caught out by before.
       */
      if (resolvedResult.error) {
        logger.warn(
          { err: resolvedResult.error, userId },
          'Could not read resolved insights; showing open ones only'
        );
        return { data: openResult.data || [], error: null };
      }

      return { data: [...(openResult.data || []), ...(resolvedResult.data || [])], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get insights by status
   */
  async findByStatus(
    userId: string,
    status: InsightStatus,
    limit: number = 50
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('user_id', userId)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update insight status
   */
  async updateStatus(
    id: string,
    userId: string,
    status: InsightStatus,
    additionalFields?: Partial<Insight>
  ): Promise<RepositoryResult<Insight>> {
    try {
      const updateData: Record<string, unknown> = {
        status,
        ...additionalFields,
      };

      // Set timestamp fields based on status
      if (status === 'dismissed') {
        updateData.dismissed_at = new Date().toISOString();
      } else if (status === 'acted') {
        updateData.acted_at = new Date().toISOString();
      }

      const { data, error } = await this.supabase
        .from('insights')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      // Log to history
      await this.logHistory(userId, id, status as InsightHistoryEntry['action'], data);

      logger.info({ userId, insightId: id, status }, 'Insight status updated');

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to update insight status');
      return { data: null, error: error as Error };
    }
  }

  /**
   * How many of the three operational automations are on AND able to act.
   *
   * Reads the profile once. Only the ones actually switched on are then asked
   * whether they could do anything, so a business that has enabled nothing pays
   * for a single row and no further queries.
   *
   * Never throws: this feeds a journey node on the dashboard, and an
   * unreadable profile should cost the number, not the page. Unreadable reports
   * zero, which understates rather than invents.
   */
  private async countOperationalAutomations(userId: string): Promise<number> {
    try {
      const columns = OPERATIONAL_AUTOMATIONS.map(a => a.column).join(', ');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .select(columns)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      const approvals = (data ?? {}) as unknown as Record<string, unknown>;
      const enabled = OPERATIONAL_AUTOMATIONS.filter(a => Boolean(approvals[a.column]));

      if (enabled.length === 0) return 0;

      const verdicts = await Promise.all(
        enabled.map(automation => automationApplies(userId, automation))
      );

      return verdicts.filter(Boolean).length;
    } catch (error) {
      logger.warn({ err: error, userId }, 'Could not count operational automations; reporting none running');
      return 0;
    }
  }

  /**
   * Mark insight as surfaced (shown to user)
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Read, then write. Not an RPC.
   *
   * This used to assign a query builder as a column value —
   * `surface_count: this.supabase.rpc('increment_surface_count', …)` — which is
   * not an increment and never was. `increment_surface_count` does not exist in
   * the database, so the whole update failed on every call and the code fell
   * into a fallback that did the read-then-write properly. The fast path had
   * never once worked.
   *
   * The same shape was found and removed from `SmartLinkRepository.markConversion`
   * the day before this. If a third turns up, it is worth grepping for
   * `: this.supabase.rpc(` across the repositories.
   *
   * A read-then-write can lose a concurrent increment. That is accepted here:
   * this counts how many times a card has been shown to one person on one
   * dashboard, and two simultaneous loads of the same insight by the same owner
   * is not a case worth a stored procedure.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async markSurfaced(id: string, userId: string): Promise<RepositoryResult<Insight>> {
    try {
      const { data: current, error: readError } = await this.supabase
        .from('insights')
        .select('surface_count')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (readError) throw readError;

      const { data, error } = await this.supabase
        .from('insights')
        .update({
          last_surfaced_at: new Date().toISOString(),
          surface_count: (current?.surface_count || 0) + 1,
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, insightId: id }, 'Failed to mark insight surfaced');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark a page of insights as surfaced in one go.
   *
   * This is what makes detector cooldowns mean anything. `isOnCooldown` reads
   * `last_surfaced_at`, and until this was called on listing, that column stayed
   * null for insights nobody had opened — so a detector on a one-week cooldown
   * re-fired every fifteen minutes forever.
   *
   * Rows are grouped by their current surface_count so the whole page is written
   * in one or two statements rather than one per insight. A concurrent view can
   * lose an increment; last_surfaced_at, the part the cooldown depends on, is
   * unaffected by that race.
   */
  async markManySurfaced(
    insights: Array<{ id: string; surface_count?: number | null }>,
    userId: string
  ): Promise<RepositoryResult<number>> {
    if (insights.length === 0) return { data: 0, error: null };

    try {
      const idsByCount = new Map<number, string[]>();
      for (const insight of insights) {
        const count = insight.surface_count ?? 0;
        idsByCount.set(count, [...(idsByCount.get(count) || []), insight.id]);
      }

      const surfacedAt = new Date().toISOString();
      for (const [count, ids] of idsByCount) {
        const { error } = await this.supabase
          .from('insights')
          .update({ last_surfaced_at: surfacedAt, surface_count: count + 1 })
          .in('id', ids)
          .eq('user_id', userId);

        if (error) throw error;
      }

      return { data: insights.length, error: null };
    } catch (error) {
      logger.error({ err: error, userId, count: insights.length }, 'Failed to mark insights surfaced');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Snooze an insight
   */
  async snooze(
    id: string,
    userId: string,
    until: Date
  ): Promise<RepositoryResult<Insight>> {
    return this.updateStatus(id, userId, 'snoozed', {
      snoozed_until: until.toISOString(),
    });
  }

  /**
   * Dismiss an insight
   */
  async dismiss(
    id: string,
    userId: string,
    reason?: string
  ): Promise<RepositoryResult<Insight>> {
    return this.updateStatus(id, userId, 'dismissed', {
      dismiss_reason: reason,
    });
  }

  /**
   * Mark insight as acted upon
   */
  async markActed(
    id: string,
    userId: string,
    executionId?: string
  ): Promise<RepositoryResult<Insight>> {
    return this.updateStatus(id, userId, 'acted', {
      action_execution_id: executionId,
    });
  }

  /**
   * Close every open insight whose condition no longer holds.
   *
   * Called at the end of a detection run, which is the one moment the platform
   * knows the full answer: every detector has just been asked, so a detector
   * absent from `firedDetectorIds` either found nothing or no longer exists.
   * Both mean the same thing to the owner — whatever this card was about is not
   * true any more.
   *
   * This closes two failures with one sweep:
   *
   *   the world moved   an invoice was paid, a lead booked, a page was fixed
   *   the code moved    a detector was deleted and its rows outlived it
   *
   * Snoozed insights are left alone. A snooze is a person saying "not now", and
   * resolving it underneath them would answer a question they asked to be asked
   * again later.
   *
   * Returns how many were closed, so the cron can report it rather than sweep
   * silently.
   */
  async resolveStaleInsights(
    userId: string,
    firedDetectorIds: string[]
  ): Promise<RepositoryResult<number>> {
    try {
      const { data: open, error: readError } = await this.supabase
        .from('insights')
        .select('id, detector_id')
        .eq('user_id', userId)
        .in('status', ['new', 'viewed']);

      if (readError) throw readError;

      const fired = new Set(firedDetectorIds);
      const stale = (open ?? []).filter(row => !fired.has(String(row.detector_id)));

      if (stale.length === 0) return { data: 0, error: null };

      const { error: writeError } = await this.supabase
        .from('insights')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in('id', stale.map(row => row.id))
        // Scoped again on the write: the ids came from this user's own read,
        // and a filter that is cheap to repeat is worth repeating on a
        // service-role update.
        .eq('user_id', userId);

      if (writeError) throw writeError;

      logger.info(
        { userId, resolved: stale.length, detectors: [...new Set(stale.map(r => r.detector_id))] },
        'Closed insights whose condition no longer holds'
      );
      return { data: stale.length, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to resolve stale insights');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark an insight as handed to a standing automation.
   */
  async markAutomated(id: string, userId: string): Promise<RepositoryResult<Insight>> {
    return this.updateStatus(id, userId, 'automated');
  }

  /**
   * Turn an insight into a standing rule.
   *
   * The row is what `AutomationManager.runDueAutomations` drains and what the
   * journey's "working on its own" count reads, so creating it is the whole of
   * turning an automation on. The API used to answer "coming in Phase 4" with
   * success: true, which showed the owner an automation that did not exist.
   *
   * `created_from_insight_id` keeps the provenance: months later, "why is the
   * platform emailing my clients" has an answer.
   */
  async createAutomation(input: {
    userId: string;
    detectorId: string;
    processId: string;
    parameters?: Record<string, unknown>;
    insightId?: string;
  }): Promise<RepositoryResult<{ id: string }>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_automations')
        .insert({
          user_id: input.userId,
          detector_id: input.detectorId,
          kernel_process_id: input.processId,
          process_parameters: input.parameters ?? {},
          trigger_condition: {},
          is_active: true,
          /*
           * Checked on the same cadence as the drain that follows it. Left to
           * the column default would mean the owner turns something on and
           * nothing happens for however long that default is.
           */
          check_interval_minutes: 60,
          created_from_insight_id: input.insightId ?? null,
        })
        .select('id')
        .single();

      if (error) throw error;

      logger.info(
        { userId: input.userId, detectorId: input.detectorId, processId: input.processId },
        'Standing automation created'
      );
      return { data: { id: data.id as string }, error: null };
    } catch (error) {
      logger.error(
        { err: error, userId: input.userId, detectorId: input.detectorId },
        'Failed to create the standing automation'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Log insight interaction to history
   */
  private async logHistory(
    userId: string,
    insightId: string,
    action: InsightHistoryEntry['action'],
    insight: Insight
  ): Promise<void> {
    try {
      // Calculate time to action if applicable
      let timeToAction: number | undefined;
      if (insight.last_surfaced_at && (action === 'acted' || action === 'dismissed')) {
        const surfacedAt = new Date(insight.last_surfaced_at);
        timeToAction = Math.round((Date.now() - surfacedAt.getTime()) / 1000);
      }

      await this.supabase.from('owner_insight_history').insert({
        user_id: userId,
        insight_id: insightId,
        action,
        detector_id: insight.detector_id,
        category: insight.category,
        severity: insight.severity,
        time_to_action_seconds: timeToAction,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to log insight history');
    }
  }

  /**
   * Generate a human-readable title for the insight (localized fallback)
   */
  private generateTitle(detection: DetectionResult, language: string = 'en', currency: string = 'USD'): string {
    const issueType = detection.processParameters?.issue_type as string | undefined;
    const count = detection.affectedCount || 0;
    const value = detection.currentValue || 0;
    const impact = detection.estimatedImpactUsd || 0;
    const rawPctChange = typeof detection.percentChange === 'number' ? detection.percentChange : parseFloat(String(detection.percentChange)) || 0;
    const pctChange = Math.abs(rawPctChange).toFixed(0);
    /* See the description builder: a landing page and a home page get named. */
    const titlePageKind = (detection.processParameters?.page_kind as string) || 'mixed';

    // Hebrew titles
    if (language === 'he') {
      const hebrewTitles: Record<string, string> = {
        cash_ar_overdue: `${count} חשבוניות שלא שולמו - ${formatMoney(value, currency)}`,
        cash_booking_unpaid: `${count} פגישות שטרם שולמו - ${formatMoney(impact, currency)}`,
        cash_work_unbilled: `${count} פגישות שהסתיימו ולא חויבו - ${formatMoney(impact, currency)}`,
        cash_income_drop: `ההכנסות ירדו - ${formatMoney(impact, currency)}`,
        cash_client_concentration: `לקוח אחד מהווה חלק גדול מההכנסה - ${formatMoney(impact, currency)}`,
        conv_quote_acceptance_drop: `פחות הצעות מחיר מאושרות - ${formatMoney(impact, currency)}`,
        web_mobile_conversion_gap: `פחות פניות ממכשירים ניידים`,
        web_page_no_conversions: titlePageKind === 'landing'
          ? `${count} דפי נחיתה עם תנועה וללא פניות`
          : titlePageKind === 'homepage'
            ? `דף הבית מקבל תנועה ולא מביא פניות`
            : `${count} עמודים עם תנועה וללא פניות`,
        web_link_not_converting: `${count} קישורים שנלחצים ולא מביאים כלום`,
        web_link_dead_destination: `${count} קישורים ששיתפת לא נפתחים`,
        conv_no_next_step: `${count} אנשים בלי המשך`,
        cash_revenue_at_risk: `${formatMoney(impact, currency)} ממתינים בצנרת`,
        conv_stage_dropoff: `${count} אנשים נתקעו באותו שלב`,
        conv_service_rate_drop: `שיעור ההמרה ירד ב-${Math.abs(Number(pctChange))} נקודות`,
        cash_payment_issues: this.getPaymentIssueTitleHe(issueType, detection, currency),
        ret_no_show_spike: `עלייה של ${pctChange}% באי-הגעות`,
        sales_stalled: `${count} פניות ממתינות לתגובה`,
        sales_reply_slow: `זמן תגובה איטי ב-${pctChange}%`,
        ops_utilization_low: `היומן מלא רק ב-${value.toFixed(0)}%`,
        crm_cold_leads: `${count} לידים קרים דורשים טיפול`,
        acq_traffic_drop: `ירידה של ${pctChange}% בתנועה לאתר`,
        acq_low_conversion: `שיעור המרה נמוך: ${value.toFixed(1)}%`,
        ret_cancellation_spike: `עלייה של ${pctChange}% בביטולים`,
        conv_pipeline_stuck: `${count} אנשי קשר תקועים בצנרת`,
        conv_followup_overdue: `${count} מעקבים באיחור`,
        conv_source_underperform: `מקור לידים בביצועים נמוכים`,
        crm_engagement_decay: `${count} לקוחות הפכו שקטים`,
        ret_repeat_booking_low: `רק ${(100 - value).toFixed(0)}% מהלקוחות חוזרים`,
        ops_last_minute_cancels: `${count} ביטולים ברגע האחרון`,
        ops_service_performance: `${count} שירותים בביצועים נמוכים`,
        ops_peak_unutilized: `שעות השיא ${(100 - value).toFixed(0)}% ריקות`,
        web_missing_cta: `${count} עמודים ללא קריאה לפעולה`,
        web_incomplete_content: `${count} אזורי תוכן לא שלמים`,
        cash_ar_aging: `${formatMoney(impact, currency)} בחשבוניות מזדקנות (60+ יום)`,
        cash_refund_pattern: `שיעור החזרים של ${value.toFixed(1)}%`,
        cash_payout_blocked: `העברות Stripe חסומות`,
        pricing_intro_offer_stuck: `רק ${value.toFixed(0)}% ממבצעי היכרות הומרו`,
      };
      return hebrewTitles[detection.detectorId] || `${count} בעיות זוהו`;
    }

    // English titles (default)
    const titles: Record<string, string> = {
      cash_ar_overdue: `${formatMoney(value, currency)} in Overdue Invoices`,
      cash_booking_unpaid: `${count} Appointment${count === 1 ? '' : 's'} Not Paid For`,
      cash_work_unbilled: `${count} Completed Session${count === 1 ? '' : 's'} Never Billed`,
      cash_income_drop: `Income Down ${formatMoney(impact, currency)} On Last Month`,
      cash_client_concentration: `One Client Is ${count}% Of Your Income`,
      conv_quote_acceptance_drop: `Fewer Quotes Are Being Accepted`,
      web_mobile_conversion_gap: `Your Site Works Less Well On Phones`,
      web_page_no_conversions: titlePageKind === 'landing'
        ? `${count} Landing Page${count === 1 ? '' : 's'} With Readers And No Enquiries`
        : titlePageKind === 'homepage'
          ? `Your Home Page Has Readers And No Enquiries`
          : `${count} Page${count === 1 ? '' : 's'} With Readers And No Enquiries`,
      web_link_not_converting: `${count} Shared Link${count === 1 ? '' : 's'} Nobody Books From`,
      web_link_dead_destination: `${count === 1 ? 'A Link You Share Does Not Open' : `${count} Links You Share Do Not Open`}`,
      conv_no_next_step: `${count} People With No Next Step`,
      cash_revenue_at_risk: `${formatMoney(impact, currency)} Sitting In Your Pipeline`,
      conv_stage_dropoff: `${count} People Stopped At The Same Step`,
      conv_service_rate_drop: `Conversion Fell ${Math.abs(Number(pctChange))} Points`,
      cash_payment_issues: this.getPaymentIssueTitle(issueType, detection, currency),
      ret_no_show_spike: `No-Show Rate Up ${pctChange}%`,
      sales_stalled: `${count} Enquiries Waiting for Reply`,
      sales_reply_slow: `Reply Time ${pctChange}% Slower`,
      ops_utilization_low: `Calendar Only ${value.toFixed(0)}% Filled`,
      crm_cold_leads: `${count} Cold Leads Need Attention`,
      acq_traffic_drop: `Website Traffic Down ${pctChange}%`,
      acq_low_conversion: `Low Conversion Rate: ${value.toFixed(1)}%`,
      ret_cancellation_spike: `Cancellations Up ${pctChange}%`,
      conv_pipeline_stuck: `${count} Contacts Stuck in Pipeline`,
      conv_followup_overdue: `${count} Overdue Follow-ups`,
      conv_source_underperform: `Lead Source Underperforming`,
      crm_engagement_decay: `${count} Clients Going Quiet`,
      ret_repeat_booking_low: `Only ${(100 - value).toFixed(0)}% Clients Rebooking`,
      ops_last_minute_cancels: `${count} Last-Minute Cancellations`,
      ops_service_performance: `${count} Services Underperforming`,
      ops_peak_unutilized: `Peak Hours ${(100 - value).toFixed(0)}% Empty`,
      web_missing_cta: `${count} Pages Missing Call-to-Action`,
      web_incomplete_content: `${count} Incomplete Content Sections`,
      cash_ar_aging: `${formatMoney(impact, currency)} in Aging Invoices (60+ Days)`,
      cash_refund_pattern: `Refund Rate at ${value.toFixed(1)}%`,
      cash_payout_blocked: `Stripe Payouts Blocked`,
      pricing_intro_offer_stuck: `Only ${value.toFixed(0)}% Intro Offers Converting`,
    };

    return titles[detection.detectorId] || `${count} Issues Detected`;
  }

  /**
   * Get Hebrew title for payment issues
   */
  private getPaymentIssueTitleHe(issueType: string | undefined, detection: DetectionResult, currency: string = 'USD'): string {
    const amount = formatMoney(detection.currentValue, currency);
    const count = detection.affectedCount || 0;

    switch (issueType) {
      case 'failed':
        return `${count} תשלומים נכשלו (${amount})`;
      case 'pending':
        return `${count} תשלומים ממתינים לאישור`;
      case 'refunded':
        return `${count} החזרים החודש (${amount})`;
      default:
        return `בעיות תשלום זוהו`;
    }
  }

  /**
   * Get title for payment issues based on issue type
   */
  private getPaymentIssueTitle(issueType: string | undefined, detection: DetectionResult, currency: string = 'USD'): string {
    const amount = formatMoney(detection.currentValue, currency);
    const count = detection.affectedCount;

    switch (issueType) {
      case 'failed':
        return `${count} Failed Payment${count !== 1 ? 's' : ''} (${amount})`;
      case 'pending':
        return `${count} Pending Payment${count !== 1 ? 's' : ''} Awaiting Confirmation`;
      case 'refunded':
        return `${count} Refund${count !== 1 ? 's' : ''} This Month (${amount})`;
      default:
        return `Payment Issues Detected`;
    }
  }

  /**
   * Generate a description for the insight (localized fallback)
   */
  private generateDescription(detection: DetectionResult, language: string = 'en', currency: string = 'USD'): string {
    const issueType = detection.processParameters?.issue_type as string | undefined;
    const count = detection.affectedCount || 0;
    const value = detection.currentValue || 0;
    const baseline = detection.baselineValue || 0;
    const impact = detection.estimatedImpactUsd || 0;
    /*
     * The money, or nothing — never a zero.
     *
     * A detector that cannot price a business (no transactions, no priced
     * services) now reports no impact at all rather than a figure someone
     * picked. Passed through `|| 0` that becomes "$0.00", which reads as a
     * measurement meaning nothing is at stake — the opposite of what an absent
     * value means. Where this is null the sentence simply ends earlier.
     */
    const money = detection.estimatedImpactUsd && detection.estimatedImpactUsd > 0
      ? formatMoney(detection.estimatedImpactUsd, currency)
      : null;
    const rawPctChange = typeof detection.percentChange === 'number' ? detection.percentChange : parseFloat(String(detection.percentChange)) || 0;
    const pctChange = Math.abs(rawPctChange).toFixed(0);
    const avgDaysStuck = (detection.processParameters?.avg_days_stuck as number) || 14;
    const avgDaysSilent = (detection.processParameters?.avg_days_silent as number) || 30;
    /*
     * The clicks are the whole point of the link sentence: "3 links" is a
     * housekeeping note, "62 people clicked and none of them booked" is the
     * finding. No default worth inventing, so an absent value falls to 0 and
     * the caller reads the count instead.
     */
    const wastedClicks = (detection.processParameters?.wasted_clicks as number) || 0;
    /* People who already pressed a broken link and got an error page. */
    const lostClicks = (detection.processParameters?.lost_clicks as number) || 0;
    /*
     * What kind of page this is about. A landing page and a home page fail in
     * different ways and the owner fixes them in different places, so the
     * sentence names which one rather than saying "page" for both.
     *
     * 'mixed' when the finding spans more than one kind, which is the only
     * honest thing to call it.
     */
    const pageKind = (detection.processParameters?.page_kind as string) || 'mixed';

    // Hebrew descriptions
    if (language === 'he') {
      const hebrewDescriptions: Record<string, string> = {
        cash_ar_overdue: `יש לך ${count} חשבוניות בסך ${formatMoney(value, currency)} שנמצאות בפיגור של יותר מ-7 ימים.`,
        cash_booking_unpaid: `${count} פגישות קרובות היו אמורות להיות משולמות מראש והתשלום טרם הגיע. סה\"כ ${formatMoney(impact, currency)}.`,
        cash_work_unbilled: `${count} פגישות הסתיימו ומעולם לא נשלחה עליהן חשבונית. סה\"כ ${formatMoney(impact, currency)}.`,
        cash_income_drop: `נכנס פחות כסף בארבעה השבועות האחרונים מאשר בארבעה שלפניהם, הפרש של ${formatMoney(impact, currency)}.`,
        cash_client_concentration: `לקוח אחד אחראי ל-${count}% מכל הכסף שנכנס בחצי השנה האחרונה, ${formatMoney(impact, currency)}.`,
        conv_quote_acceptance_drop: `${count} הצעות מחיר לא אושרו ברבעון האחרון, בשווי ${formatMoney(impact, currency)}.`,
        web_mobile_conversion_gap: `${count} מבקרים הגיעו מהנייד, והם פונים אליך בשיעור נמוך בהרבה מאשר ממחשב.`,
        web_page_no_conversions: pageKind === 'landing'
          ? `${count} דפי נחיתה קיבלו תנועה אמיתית בחודש האחרון ואיש לא יצר קשר דרכם. זו בדיוק המטרה היחידה של דף נחיתה.`
          : pageKind === 'homepage'
            ? `דף הבית שלך קיבל תנועה אמיתית בחודש האחרון ואיש לא יצר קשר ממנו.`
            : `${count} עמודים קיבלו תנועה אמיתית בחודש האחרון ואיש לא יצר קשר דרכם.`,
        web_link_not_converting: `${wastedClicks} אנשים לחצו על ${count} קישורים ששיתפת, ואף אחד מהם לא קבע פגישה או יצר קשר. הקישור עובד, מה שנמצא בצד השני שלו לא.`,
        web_link_dead_destination: `${count === 1 ? 'קישור פעיל שאתה משתף מוביל' : `${count} קישורים פעילים שאתה משתף מובילים`} לכתובת שלא נפתחת אצל אף אחד אחר. אצלך במחשב זה עובד, אצל הלקוח מופיעה שגיאה. ${lostClicks > 0 ? `${lostClicks} אנשים כבר לחצו והגיעו לשם.` : 'עדיין אף אחד לא לחץ.'}`,
        conv_no_next_step: `${count} אנשים היו פעילים אצלך ועכשיו אין להם שום דבר מתוכנן - לא פגישה, לא משימה, לא שלב הבא.`,
        cash_revenue_at_risk: `${formatMoney(impact, currency)} חויבו או הוצעו ועדיין לא התקבלו. יש ${count} אנשים לפנות אליהם.`,
        conv_stage_dropoff: `${count} אנשים הגיעו לאותו שלב ולא התקדמו ממנו. זו הנקודה שבה אתה מאבד הכי הרבה.`,
        conv_service_rate_drop: `שירות הכניסה שלך ממיר פחות מבעבר - ${value}% לעומת ${baseline}% בתקופה הקודמת.`,
        cash_payment_issues: this.getPaymentIssueDescriptionHe(issueType, detection, currency),
        ret_no_show_spike: `שיעור אי-ההגעות עלה מ-${baseline.toFixed(1)}% ל-${value.toFixed(1)}%, עלייה של ${pctChange}% מהבסיס.`,
        sales_stalled: `${count} לקוחות פוטנציאליים ממתינים לתגובה יותר מ-48 שעות.`,
        sales_reply_slow: `זמן התגובה הממוצע שלך הוא ${value.toFixed(1)} שעות, איטי ב-${pctChange}% מהבסיס של ${baseline.toFixed(1)} שעות.`,
        ops_utilization_low: `היומן שלך מלא רק ב-${value.toFixed(0)}%, עם כ-${count} שעות פנויות השבוע.`,
        crm_cold_leads: `${count} לידים לא קיבלו קשר במשך 7+ ימים.${money ? ` הזדמנות בסיכון: ${money}.` : ''}`,
        acq_traffic_drop: `התנועה לאתר ירדה ב-${pctChange}% בהשוואה לשבוע שעבר. ייתכן שפחות לידים נכנסים.`,
        acq_low_conversion: `רק ${value.toFixed(1)}% מהמבקרים באתר הופכים ללידים, מתחת ליעד של ${baseline.toFixed(1)}%.`,
        ret_cancellation_spike: `הביטולים עלו ב-${pctChange}% השבוע (${count} ביטולים). בדוק את הסיבות לזהות דפוסים.`,
        conv_pipeline_stuck: `${count} אנשי קשר תקועים באותו שלב בממוצע ${avgDaysStuck} ימים.${money ? ` השפעה משוערת: ${money}.` : ''}`,
        conv_followup_overdue: `${count} משימות מעקב באיחור. מעקב בזמן משפר את שיעורי ההמרה.`,
        conv_source_underperform: `מקור לידים זה ממיר ב-${value.toFixed(1)}%, מתחת לממוצע של ${baseline.toFixed(1)}%.`,
        crm_engagement_decay: `${count} לקוחות פעילים שקטים בממוצע ${avgDaysSilent} ימים. הם בסיכון לנטישה.`,
        ret_repeat_booking_low: `רק ${(100 - value).toFixed(0)}% מהלקוחות החדשים חוזרים להזמנה נוספת. היעד הוא ${(100 - baseline).toFixed(0)}%+.`,
        ops_last_minute_cancels: `${count} הזמנות בוטלו בתוך 24 שעות. הפסד הכנסות: ${formatMoney(impact, currency)}.`,
        ops_service_performance: `${count} שירותים מציגים ביצועים נמוכים משמעותית בהשוואה לשירותים המובילים.`,
        ops_peak_unutilized: `שעות השיא ההיסטוריות שלך ${(100 - value).toFixed(0)}% ריקות.${money ? ` הזדמנות הכנסה: ${money}.` : ''}`,
        web_missing_cta: `${count} עמודים חסרים קריאה לפעולה ברורה. מבקרים עלולים לעזוב בלי לפעול.`,
        web_incomplete_content: `${count} אזורים עם תוכן לא שלם. זה עלול לפגוע באמינות.`,
        cash_ar_aging: `חשבוניות מזדקנות מעבר ל-60 יום, מה שמקשה על הגבייה. סכום בסיכון: ${formatMoney(impact, currency)}.`,
        cash_refund_pattern: `שיעור ההחזרים שלך הוא ${value.toFixed(1)}%, מעל הסף של ${baseline.toFixed(1)}%. זה עשוי להצביע על בעיות שירות.`,
        cash_payout_blocked: `חשבון ה-Stripe שלך לא יכול לקבל העברות. זה חוסם ${formatMoney(impact, currency)} בכספים ממתינים.`,
        pricing_intro_offer_stuck: `רק ${value.toFixed(0)}% מלקוחות מבצע ההיכרות עוברים למחיר מלא. הכנסה חסרה: ${formatMoney(impact, currency)}.`,
      };
      return hebrewDescriptions[detection.detectorId] || `${count} פריטים זוהו שדורשים תשומת לב. השפעה משוערת: ${formatMoney(impact, currency)}.`;
    }

    // English descriptions (default)
    const plural = count !== 1;
    const descriptions: Record<string, string> = {
      cash_ar_overdue: `You have ${count} invoice${plural ? 's' : ''} totaling ${formatMoney(value, currency)} that ${plural ? 'are' : 'is'} more than 7 days overdue.`,
      cash_booking_unpaid: `${count} upcoming appointment${plural ? 's were' : ' was'} due to be paid for in advance and ${plural ? 'have' : 'has'} not been. ${formatMoney(impact, currency)} outstanding.`,
      cash_work_unbilled: `${count} completed appointment${plural ? 's were' : ' was'} never invoiced and never paid for. ${formatMoney(impact, currency)} never asked for.`,
      cash_income_drop: `Less money came in over the last four weeks than the four before, a difference of ${formatMoney(impact, currency)}.`,
      cash_client_concentration: `One client accounts for ${count}% of everything received in the last six months, ${formatMoney(impact, currency)}.`,
      conv_quote_acceptance_drop: `${count} quote${count === 1 ? ' was' : 's were'} turned down this quarter, worth ${formatMoney(impact, currency)}.`,
      web_mobile_conversion_gap: `${count} people visited on a phone, and they got in touch far less often than desktop visitors did.`,
      web_page_no_conversions: pageKind === 'landing'
        ? `${count} landing page${count === 1 ? ' had' : 's had'} real traffic this month and nobody got in touch from ${count === 1 ? 'it' : 'them'}. Getting in touch is the only thing a landing page is for.`
        : pageKind === 'homepage'
          ? `Your home page had real traffic this month and nobody got in touch from it.`
          : `${count} published page${count === 1 ? ' had' : 's had'} real traffic this month and nobody got in touch from ${count === 1 ? 'it' : 'them'}.`,
      web_link_not_converting: `${wastedClicks} people clicked ${count === 1 ? 'a link you shared' : `${count} links you shared`} and not one of them booked or got in touch. The link is working: what sits on the other side of it is not.`,
      web_link_dead_destination: `${count === 1 ? 'A link you are still sharing points' : `${count} links you are still sharing point`} at an address that cannot open on anyone else's device. It works on your own computer, and shows an error on theirs. ${lostClicks > 0 ? `${lostClicks} ${lostClicks === 1 ? 'person has' : 'people have'} already clicked through to it.` : 'Nobody has clicked it yet.'}`,
      conv_no_next_step: `${count} ${plural ? 'people have' : 'person has'} had activity with you and now ${plural ? 'have' : 'has'} nothing scheduled next — no booking, no task, no stage to move to.`,
      cash_revenue_at_risk: `${formatMoney(impact, currency)} has been billed or quoted and has not arrived. ${count} ${plural ? 'people' : 'person'} worth following up.`,
      conv_stage_dropoff: `${count} ${plural ? 'people' : 'person'} reached the same step and went no further. This is where you lose the most.`,
      conv_service_rate_drop: `Your entry service is converting less than it was — ${value}% this period against ${baseline}% last.`,
      cash_payment_issues: this.getPaymentIssueDescription(issueType, detection, currency),
      ret_no_show_spike: `Your no-show rate has increased from ${baseline.toFixed(1)}% to ${value.toFixed(1)}%, which is ${pctChange}% above your normal baseline.`,
      sales_stalled: `${count} potential client${plural ? 's' : ''} ${plural ? 'have' : 'has'} been waiting 48+ hours without a response.`,
      sales_reply_slow: `Your average reply time is ${value.toFixed(1)} hours, which is ${pctChange}% slower than your baseline of ${baseline.toFixed(1)} hours.`,
      ops_utilization_low: `Your calendar is only ${value.toFixed(0)}% utilized, with approximately ${count} hours available this week.`,
      crm_cold_leads: `${count} lead${plural ? 's have' : ' has'} had no contact in 7+ days.${money ? ` Estimated opportunity at risk: ${money}.` : ''}`,
      acq_traffic_drop: `Website traffic dropped ${pctChange}% compared to last week. This could mean fewer leads coming in.`,
      acq_low_conversion: `Only ${value.toFixed(1)}% of website visitors are converting to leads, below the ${baseline.toFixed(1)}% benchmark.`,
      ret_cancellation_spike: `Cancellations increased ${pctChange}% this week (${count} cancellations). Review reasons to identify patterns.`,
      conv_pipeline_stuck: `${count} contact${plural ? 's are' : ' is'} stuck in the same pipeline stage for an average of ${avgDaysStuck} days.${money ? ` Estimated impact: ${money}.` : ''}`,
      conv_followup_overdue: `${count} follow-up task${plural ? 's are' : ' is'} overdue. Staying on top of follow-ups improves conversion rates.`,
      conv_source_underperform: `This lead source is converting at ${value.toFixed(1)}%, below your average of ${baseline.toFixed(1)}%.`,
      crm_engagement_decay: `${count} active client${plural ? 's have' : ' has'} been silent for an average of ${avgDaysSilent} days. They may be at risk of churning.`,
      ret_repeat_booking_low: `Only ${(100 - value).toFixed(0)}% of first-time clients are rebooking. Target is ${(100 - baseline).toFixed(0)}%+.`,
      ops_last_minute_cancels: `${count} booking${plural ? 's were' : ' was'} cancelled within 24 hours. Lost revenue: ${formatMoney(impact, currency)}.`,
      ops_service_performance: `${count} service${plural ? 's are' : ' is'} significantly underperforming compared to your top services.`,
      ops_peak_unutilized: `Your historically busy time slots are ${(100 - value).toFixed(0)}% empty.${money ? ` Potential revenue opportunity: ${money}.` : ''}`,
      web_missing_cta: `${count} page${plural ? 's are' : ' is'} missing a clear call-to-action. Visitors may leave without taking action.`,
      web_incomplete_content: `${count} section${plural ? 's have' : ' has'} incomplete content. This can hurt credibility with visitors.`,
      cash_ar_aging: `Invoices are aging past 60 days, making them harder to collect. Amount at risk: ${formatMoney(impact, currency)}.`,
      cash_refund_pattern: `Your refund rate is ${value.toFixed(1)}%, above the ${baseline.toFixed(1)}% threshold. This may signal service issues.`,
      cash_payout_blocked: `Your Stripe account cannot receive payouts. This is blocking ${formatMoney(impact, currency)} in pending funds.`,
      pricing_intro_offer_stuck: `Only ${value.toFixed(0)}% of intro offer customers convert to full price. Missing upsell revenue: ${formatMoney(impact, currency)}.`,
    };

    return descriptions[detection.detectorId] || `${count} item${plural ? 's' : ''} detected that may need attention. Estimated impact: ${formatMoney(impact, currency)}.`;
  }

  /**
   * Get Hebrew description for payment issues
   */
  private getPaymentIssueDescriptionHe(issueType: string | undefined, detection: DetectionResult, currency: string = 'USD'): string {
    const amount = formatMoney(detection.currentValue, currency);
    const count = detection.affectedCount || 0;
    const otherCount = detection.processParameters?.other_issues_count as number | undefined;

    let desc = '';
    switch (issueType) {
      case 'failed':
        desc = `${count} תשלומים בסך ${amount} נכשלו ב-14 הימים האחרונים. יש צורך במעקב עם הלקוחות.`;
        break;
      case 'pending':
        desc = `${count} תשלומים בסך ${amount} ממתינים יותר מיומיים. שקול לאשר העברות בנקאיות או לעקוב.`;
        break;
      case 'refunded':
        desc = `${count} החזרים בסך ${amount} בוצעו החודש. בדוק כדי להבטיח שביעות רצון לקוחות.`;
        break;
      default:
        desc = `זוהו בעיות תשלום שדורשות תשומת לב.`;
    }

    if (otherCount && otherCount > 0) {
      desc += ` בנוסף, נמצאו ${otherCount} בעיות תשלום נוספות.`;
    }

    return desc;
  }

  /**
   * Get description for payment issues based on issue type
   */
  private getPaymentIssueDescription(issueType: string | undefined, detection: DetectionResult, currency: string = 'USD'): string {
    const amount = formatMoney(detection.currentValue, currency);
    const count = detection.affectedCount;
    const otherCount = detection.processParameters?.other_issues_count as number | undefined;

    let desc = '';
    switch (issueType) {
      case 'failed':
        desc = `${count} payment${count !== 1 ? 's' : ''} totaling ${amount} failed in the last 14 days. These may need follow-up with clients to retry.`;
        break;
      case 'pending':
        desc = `${count} payment${count !== 1 ? 's' : ''} totaling ${amount} ${count !== 1 ? 'have' : 'has'} been pending for more than 2 days. Consider confirming bank transfers or following up.`;
        break;
      case 'refunded':
        desc = `${count} refund${count !== 1 ? 's' : ''} totaling ${amount} were processed this month. Review to ensure customer satisfaction.`;
        break;
      default:
        desc = `Payment issues detected that may need attention.`;
    }

    if (otherCount && otherCount > 0) {
      desc += ` Additionally, ${otherCount} other payment issue${otherCount !== 1 ? 's' : ''} were found.`;
    }

    return desc;
  }

  /**
   * Generate a recommendation for the insight (localized fallback)
   */
  private generateRecommendation(detection: DetectionResult, language: string = 'en', currency: string = 'USD'): string {
    const issueType = detection.processParameters?.issue_type as string | undefined;
    const impact = detection.estimatedImpactUsd || 0;
    /* See the description builder: a landing page is fixed differently. */
    const recPageKind = (detection.processParameters?.page_kind as string) || 'mixed';

    // Hebrew recommendations
    if (language === 'he') {
      const hebrewRecommendations: Record<string, string> = {
        cash_ar_overdue: `שלח תזכורות תשלום ללקוחות עם חשבוניות בפיגור. זה יכול לעזור לגבות עד ${formatMoney(impact, currency)}.`,
        cash_booking_unpaid: `בקש את התשלום לפני הפגישה. מומלץ להתחיל מהפגישה הקרובה ביותר.`,
        cash_work_unbilled: `שלח חשבונית על העבודה שכבר בוצעה, החל מהוותיקה ביותר.`,
        cash_income_drop: `בדוק מה השתנה: פחות עבודה, פחות פניות, או תשלומים שטרם נגבו.`,
        cash_client_concentration: `שווה לחזק את הקשר איתם, ובמקביל להרחיב את בסיס הלקוחות.`,
        conv_quote_acceptance_drop: `בדוק מה השתנה: המחיר, ההיקף, או כמה מהר חוזרים ללקוח.`,
        web_mobile_conversion_gap: `פתח את האתר בטלפון שלך ובדוק את המסלול עד יצירת הקשר.`,
        web_page_no_conversions: recPageKind === 'landing'
          ? `דף נחיתה צריך לבקש דבר אחד. צמצם אותו לבקשה הזאת ושים אותה במקום שלא צריך לגלול כדי למצוא.`
          : `בדוק שיש בעמוד דרך ברורה ליצור קשר או לקבוע פגישה.`,
        web_link_not_converting: `לחץ בעצמך על הקישור ותראה מה הלקוח רואה: אם יש זמנים פנויים, אם המחיר ברור, וכמה פרטים אתה מבקש ממישהו שעוד לא מכיר אותך.`,
        web_link_dead_destination: `ערוך את הקישור ועדכן את כתובת היעד לכתובת הציבורית של העסק. הדרך לוודא: פתח את הקישור בטלפון עם אינטרנט סלולרי, לא ברשת המשרד.`,
        conv_no_next_step: `עבור על הרשימה וקבע לכל אחד צעד הבא - פגישה, משימה או פנייה.`,
        cash_revenue_at_risk: `התחל מהחשבוניות שכבר נשלחו - זה הכסף שכבר סוכם.`,
        conv_stage_dropoff: `פנה לאנשים שנתקעו בשלב הזה ובדוק מה עוצר אותם.`,
        conv_service_rate_drop: `בדוק מה השתנה - המחיר, ההצעה, או מה שקורה אחרי הפגישה הראשונה.`,
        cash_payment_issues: this.getPaymentIssueRecommendationHe(issueType, detection, currency),
        ret_no_show_spike: `שקול לשלוח תזכורות לפגישות 24 שעות לפני כל הזמנה כדי להפחית אי-הגעות.`,
        sales_stalled: `עקוב אחר הלידים האלה כדי לשמור על המומנטום. תגובות מהירות משפרות משמעותית את שיעורי ההמרה.`,
        sales_reply_slow: `בדוק את הגדרות ההתראות שלך ושקול להשתמש בתבניות לתגובות מהירות יותר.`,
        ops_utilization_low: `שקול לקדם משבצות זמן פנויות או להריץ מבצע מיוחד למילוי היומן.`,
        crm_cold_leads: `פנה ללידים האלה עם מעקב אישי. אפילו בדיקה קצרה יכולה להחיות הזדמנויות קרות.`,
        acq_traffic_drop: `בדוק את ערוצי השיווק שלך ושינויים אחרונים. ודא שמודעות רצות ותוכן מתפרסם.`,
        acq_low_conversion: `בדוק את טפסי האתר והקריאות לפעולה. שקול לבצע בדיקות A/B לגישות שונות.`,
        ret_cancellation_spike: `בדוק את סיבות הביטול ושקול ליישם מדיניות ביטולים או דרישת מקדמה.`,
        conv_pipeline_stuck: `קדם את אנשי הקשר האלה עם פנייה ממוקדת. בדוק מה חוסם אותם מלהתקדם.`,
        conv_followup_overdue: `נקה את המעקבים הממתינים היום. מעקבים בזמן יכולים להציל עסקאות.`,
        conv_source_underperform: `שקול להקצות מחדש תקציב ממקור זה לערוצים עם ביצועים גבוהים יותר.`,
        crm_engagement_decay: `שלח הודעת בדיקה אישית ללקוחות האלה. "מה שלומך?" פשוט יכול למנוע נטישה.`,
        ret_repeat_booking_low: `בקש מלקוחות חדשים להזמין את הפגישה הבאה לפני שהם עוזבים. הצע תמריצים להזמנה חוזרת.`,
        ops_last_minute_cancels: `שקול ליישם מדיניות ביטול של 24 שעות או לדרוש מקדמות להזמנות.`,
        ops_service_performance: `בדוק תמחור ושיווק לשירותים בביצועים נמוכים. שקול לאגד או לקדם אותם.`,
        ops_peak_unutilized: `שלח אימייל קידום מכירות המדגיש משבצות פנויות בשעות העמוסות שלך.`,
        web_missing_cta: `הוסף כפתור קריאה לפעולה ברור (הזמן עכשיו, צור קשר, התחל) לעמודים האלה.`,
        web_incomplete_content: `השלם את חלקי התוכן החסרים כדי לבנות אמון ואמינות עם מבקרים.`,
        cash_ar_aging: `הסלם את מאמצי הגבייה לחשבוניות מעל 60 יום. שקול להציע תוכניות תשלום.`,
        cash_refund_pattern: `בדוק את סיבות ההחזרים כדי לזהות בעיות שירות. שקול לפנות להבין חששות.`,
        cash_payout_blocked: `השלם את הגדרת חשבון ה-Stripe מיד כדי לשחרר העברות ולהתחיל לקבל כספים.`,
        pricing_intro_offer_stuck: `צור רצף מעקב למשתמשי מבצע היכרות. הצע תמריץ מוגבל בזמן להמרה למחיר מלא.`,
      };
      return hebrewRecommendations[detection.detectorId] || `בדוק את התובנה הזו ונקוט בפעולה לטיפול בבעיה.`;
    }

    // English recommendations (default)
    const recommendations: Record<string, string> = {
      cash_ar_overdue: `Send payment reminders to clients with overdue invoices. This could help recover up to ${formatMoney(impact, currency)}.`,
      cash_booking_unpaid: `Request payment before the appointment, starting with the soonest one.`,
      cash_work_unbilled: `Invoice the work you have already done, starting with the oldest.`,
      cash_income_drop: `Look at what changed: less work booked, fewer enquiries, or payments not yet collected.`,
      cash_client_concentration: `Worth looking after that relationship, and worth widening the base alongside it.`,
      conv_quote_acceptance_drop: `Look at what changed: the price, the scope, or how quickly you get back to people.`,
      web_mobile_conversion_gap: `Open your own site on your phone and walk through booking, start to finish.`,
      web_page_no_conversions: recPageKind === 'landing'
        ? `A landing page should ask for one thing. Cut it back to that one ask and put it where nobody has to scroll to find it.`
        : `Check each one has an obvious way to get in touch or book.`,
      web_link_not_converting: `Click it yourself and see what a stranger sees: whether there are times free, whether the price is clear, and how much you are asking of someone who has not met you yet.`,
      web_link_dead_destination: `Edit the link and point it at your public address. The way to be sure it is fixed: open it on your phone over mobile data, not on your own network.`,
      conv_no_next_step: `Go through the list and give each person a next step — a booking, a task, or a message.`,
      cash_revenue_at_risk: `Start with what has already been invoiced — that money is agreed, only uncollected.`,
      conv_stage_dropoff: `Reach out to the people stuck at this step and find out what is holding them.`,
      conv_service_rate_drop: `Look at what changed — the price, the offer, or what happens after the first session.`,
      cash_payment_issues: this.getPaymentIssueRecommendation(issueType, detection, currency),
      ret_no_show_spike: `Consider sending appointment reminders 24 hours before each booking to reduce no-shows.`,
      sales_stalled: `Follow up with these leads to maintain momentum. Quick responses can significantly improve conversion rates.`,
      sales_reply_slow: `Review your enquiry notification settings and consider using templates for faster responses.`,
      ops_utilization_low: `Consider promoting available time slots or running a special offer to fill your calendar.`,
      crm_cold_leads: `Reach out to these leads with a personal follow-up. Even a quick check-in can revive cold opportunities.`,
      acq_traffic_drop: `Review your marketing channels and recent changes. Check if ads are running and content is being published.`,
      acq_low_conversion: `Review your website forms and calls-to-action. Consider A/B testing different approaches.`,
      ret_cancellation_spike: `Review cancellation reasons and consider implementing a cancellation policy or deposit requirement.`,
      conv_pipeline_stuck: `Move these contacts forward with targeted outreach. Consider what's blocking them from progressing.`,
      conv_followup_overdue: `Clear your follow-up backlog today. Timely follow-ups can recover deals that would otherwise be lost.`,
      conv_source_underperform: `Consider reallocating budget from this source to higher-performing channels.`,
      crm_engagement_decay: `Send a personal check-in message to these clients. A simple "how are things going?" can prevent churn.`,
      ret_repeat_booking_low: `Ask first-time clients to book their next appointment before they leave. Offer incentives for rebooking.`,
      ops_last_minute_cancels: `Consider implementing a 24-hour cancellation policy or requiring deposits for bookings.`,
      ops_service_performance: `Review pricing and marketing for underperforming services. Consider bundling or promoting them.`,
      ops_peak_unutilized: `Send a promotional email highlighting available slots during your normally busy hours.`,
      web_missing_cta: `Add a clear call-to-action button (Book Now, Contact Us, Get Started) to these pages.`,
      web_incomplete_content: `Complete the missing content sections to build trust and credibility with visitors.`,
      cash_ar_aging: `Escalate collection efforts for invoices over 60 days. Consider offering payment plans.`,
      cash_refund_pattern: `Review refund reasons to identify service issues. Consider reaching out to understand concerns.`,
      cash_payout_blocked: `Complete your Stripe account setup immediately to unblock payouts and start receiving funds.`,
      pricing_intro_offer_stuck: `Create a follow-up sequence for intro offer users. Offer a limited-time incentive to convert to full price.`,
    };

    return recommendations[detection.detectorId] || `Review this insight and take action to address the issue.`;
  }

  /**
   * Get Hebrew recommendation for payment issues
   */
  private getPaymentIssueRecommendationHe(issueType: string | undefined, detection: DetectionResult, currency: string = 'USD'): string {
    const impact = detection.estimatedImpactUsd || 0;

    switch (issueType) {
      case 'failed':
        return `צור קשר עם לקוחות עם תשלומים כושלים כדי לעדכן אמצעי תשלום או לנסות שוב. זה יכול לשחזר עד ${formatMoney(impact, currency)}.`;
      case 'pending':
        return `בדוק תשלומים ממתינים ואשר קבלת העברות בנקאיות. שקול לעקוב אחרי לקוחות שלא השלימו תשלום.`;
      case 'refunded':
        return `בדוק את סיבות ההחזרים כדי לזהות דפוסים. שקול לפנות כדי להבין חששות לקוחות.`;
      default:
        return `בדוק את עסקאות התשלום ונקוט בפעולה מתאימה.`;
    }
  }

  /**
   * Get recommendation for payment issues based on issue type
   */
  private getPaymentIssueRecommendation(issueType: string | undefined, detection: DetectionResult, currency: string = 'USD'): string {
    switch (issueType) {
      case 'failed':
        return `Contact clients with failed payments to update their payment method or retry the charge. This could recover up to ${formatMoney(detection.estimatedImpactUsd, currency)}.`;
      case 'pending':
        return `Review pending payments and confirm receipt of bank transfers. Consider following up with clients who haven't completed payment.`;
      case 'refunded':
        return `Review refund reasons to identify any patterns. Consider reaching out to understand customer concerns.`;
      default:
        return `Review payment transactions and take appropriate action.`;
    }
  }

  // ===========================
  // Correlated Insights Methods
  // ===========================

  /**
   * Create a correlated insight from correlation engine output
   * This creates a parent insight with the unified story and links child insights
   * If an active correlated insight for this pattern already exists, update it instead
   */
  async createCorrelatedInsight(
    userId: string,
    correlatedInsight: CorrelatedInsight,
    childInsightIds: string[],
    runId: string
  ): Promise<RepositoryResult<Insight>> {
    try {
      const detectorId = `correlated_${correlatedInsight.patternId}`;

      // Check if there's already an active correlated insight for this pattern
      const { data: existingInsights } = await this.supabase
        .from('insights')
        .select('id')
        .eq('user_id', userId)
        .eq('detector_id', detectorId)
        .eq('is_correlated', true)
        .in('status', ['new', 'viewed'])
        .order('created_at', { ascending: false })
        .limit(1);

      const existingInsight = existingInsights?.[0];

      // If an active correlated insight exists, update it instead of creating a new one
      if (existingInsight) {
        logger.info(
          { userId, insightId: existingInsight.id, patternId: correlatedInsight.patternId },
          'Updating existing correlated insight instead of creating duplicate'
        );

        const { data: updated, error: updateError } = await this.supabase
          .from('insights')
          .update({
            detection_run_id: runId,
            severity: correlatedInsight.severity,
            estimated_impact_usd: correlatedInsight.totalImpactUsd,
            total_correlated_impact_usd: correlatedInsight.totalImpactUsd,
            priority_score: correlatedInsight.priority,
            contributing_insight_ids: childInsightIds,
            detected_at: correlatedInsight.detectedAt.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingInsight.id)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) throw updateError;

        // Update child insights to link to parent
        if (childInsightIds.length > 0) {
          await this.supabase
            .from('insights')
            .update({ correlation_parent_id: existingInsight.id })
            .in('id', childInsightIds)
            .eq('user_id', userId);
        }

        return { data: updated, error: null };
      }

      const businessContext = await this.getUserBusinessContext(userId);

      logger.debug(
        {
          userId,
          patternId: correlatedInsight.patternId,
          vertical: businessContext.vertical,
          language: businessContext.language
        },
        'Generating correlated content with business context'
      );

      // Generate personalized story using LLM with vertical-aware language
      const { story, title, recommendation } = await this.generateCorrelatedContent(
        correlatedInsight,
        userId,
        businessContext,
        runId
      );

      const { data, error } = await this.supabase
        .from('insights')
        .insert({
          user_id: userId,
          detector_id: `correlated_${correlatedInsight.patternId}`,
          detection_run_id: runId,
          category: this.mapCorrelationCategoryToBusinessCategory(correlatedInsight.category),
          severity: correlatedInsight.severity,
          title,
          description: story,
          story,
          recommendation,
          estimated_impact_usd: correlatedInsight.totalImpactUsd,
          total_correlated_impact_usd: correlatedInsight.totalImpactUsd,
          impact_direction: correlatedInsight.impactDirection === 'gain' ? 'opportunity' : 'loss',
          priority_score: correlatedInsight.priority,
          status: 'new',
          is_correlated: true,
          correlation_pattern_id: correlatedInsight.patternId,
          contributing_insight_ids: childInsightIds,
          // The language the story above was written in. This was a bare
          // `language` shorthand with no such variable in scope, so every
          // correlated insight save threw a ReferenceError before reaching the
          // database.
          language: businessContext.language,
          detected_at: correlatedInsight.detectedAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      // Update child insights to link to parent
      if (childInsightIds.length > 0) {
        await this.supabase
          .from('insights')
          .update({ correlation_parent_id: data.id })
          .in('id', childInsightIds)
          .eq('user_id', userId);
      }

      // Attach contributing insights for UI display
      const enrichedData: Insight = {
        ...data,
        contributing_insights: correlatedInsight.contributingInsights.map((ci) => ({
          detector_id: ci.detectorId,
          detector_name: ci.detectorName,
          severity: ci.severity,
          summary: ci.summary,
          impact_usd: ci.impactUsd,
        })),
      };

      logger.info(
        {
          userId,
          insightId: data.id,
          patternId: correlatedInsight.patternId,
          childCount: childInsightIds.length,
          totalImpact: correlatedInsight.totalImpactUsd,
        },
        'Correlated insight created'
      );

      return { data: enrichedData, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create correlated insight');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Generate localized content for correlated insight using LLM
   */
  private async generateCorrelatedContent(
    correlatedInsight: CorrelatedInsight,
    userId: string,
    businessContext: BusinessContext,
    runId: string
  ): Promise<{ story: string; title: string; recommendation: string }> {
    try {
      const settings = await resolveBosLlmSettings('insights', 'correlated_insight');
      if (!settings.enabled) {
        logger.info({ reason: 'disabled' }, 'Correlated insight AI is switched off; using the templates');
        return this.generateCorrelatedContentFallback(
          correlatedInsight,
          businessContext.language,
          businessContext.currency
        );
      }

      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);

      const languageNames: Record<string, string> = {
        en: 'English',
        he: 'Hebrew',
        es: 'Spanish',
      };
      const langName = languageNames[businessContext.language] || 'English';

      // Get vertical configuration
      const verticalConfig = getVerticalConfig(businessContext.vertical);
      const verticalDescriptor = getVerticalDescriptor(businessContext.vertical, businessContext.company_size);
      const terminologyInstruction = buildTerminologyInstruction(businessContext.vertical, businessContext.language);

      // Build context from contributing insights
      const signals = correlatedInsight.contributingInsights
        .map((ci) => `- ${ci.detectorName}: ${ci.summary}`)
        .join('\n');

      const prompt = `You are a business advisor for a ${verticalDescriptor}, explaining connected business issues.

Business Context:
- Type: ${businessContext.vertical || 'general business'}${businessContext.sub_vertical ? ` (${businessContext.sub_vertical})` : ''}
- Company size: ${businessContext.company_size || 'solo'}
- Language: ${langName}

Pattern detected: ${correlatedInsight.patternName}
Category: ${correlatedInsight.category}
Severity: ${correlatedInsight.severity}
Total financial impact: ${formatMoney(correlatedInsight.totalImpactUsd, businessContext.currency)}

Individual signals detected:
${signals}

Original story template: "${correlatedInsight.story}"
Original action recommendation: "${correlatedInsight.action}"

TONE & STYLE GUIDELINES:
${verticalConfig.toneGuidelines}

${terminologyInstruction}

WRITING STYLE:
- Use simple, conversational language - like explaining to a friend over coffee
- Avoid business jargon - use plain everyday terms
- Tell a UNIFIED STORY that shows how these issues are connected
- Be empathetic and supportive, not alarming
- Give clear, achievable next steps

Generate compelling, personalized content that connects these signals into one coherent narrative.

Requirements:
- The title should be attention-grabbing and convey what's happening (max 60 chars)
- The story should explain HOW these issues are connected and WHY it matters in plain language
- The recommendation should give clear, prioritized next steps a busy owner can act on today
- Use specific numbers from the data
- ${langName === 'Hebrew' ? 'Use ₪ instead of $ for currency' : 'Use $ for currency'}

Generate in ${langName} language. Respond with ONLY a JSON object (no markdown, no code blocks):
{
  "title": "Short attention-grabbing title that explains the pattern",
  "story": "2-3 sentences in plain language connecting these issues into one story",
  "recommendation": "1-2 clear, actionable sentences with prioritized steps"
}`;

      const { result: response } = await withModelFallback(settings, (model) =>
        provider.chatCompletion(
          {
            messages: [{ role: 'user' as const, content: prompt }],
            model,
            ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
            max_tokens: 400,
          },
          buildBosCallContext({
            userId,
            area: 'insights',
            callName: 'correlated_insight',
            groupId: runId,
          })
        )
      );

      const content = response.choices[0]?.message?.content?.trim() || '';
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      return {
        title: parsed.title || correlatedInsight.patternName,
        story: parsed.story || correlatedInsight.story,
        recommendation: parsed.recommendation || correlatedInsight.action,
      };
    } catch (error) {
      logger.warn({ err: error }, 'LLM correlated content generation failed, using fallback');
      return this.generateCorrelatedContentFallback(correlatedInsight, businessContext.language, businessContext.currency);
    }
  }

  /**
   * Fallback for correlated content generation
   */
  private generateCorrelatedContentFallback(
    correlatedInsight: CorrelatedInsight,
    language: string,
    currency: string = 'USD'
  ): { story: string; title: string; recommendation: string } {
    const impact = correlatedInsight.totalImpactUsd;
    const count = correlatedInsight.contributingInsights.length;

    if (language === 'he') {
      const patternTitles: Record<string, string> = {
        funnel_breakdown: `משפך הרכישה שלך שבור - ${formatMoney(impact, currency)} בסיכון`,
        revenue_at_risk: `הכנסה בסיכון מ-${count} בעיות - ${formatMoney(impact, currency)}`,
        retention_crisis: `משבר שימור לקוחות - ${count} סימני אזהרה`,
        pipeline_stall: `צנרת המכירות תקועה - ${formatMoney(impact, currency)} בסיכון`,
        capacity_mismatch: `יש לך קיבולת אבל אין ביקוש`,
        service_health: `בעיות באיכות השירות זוהו`,
        website_crisis: `האתר שלך לא ממיר מבקרים`,
        cash_flow_warning: `אזהרת תזרים מזומנים - פעל עכשיו`,
        pricing_issue: `אסטרטגיית התמחור דורשת תשומת לב`,
        ops_inefficiency: `התפעול רץ לא ביעילות`,
      };

      const patternStories: Record<string, string> = {
        funnel_breakdown: `מספר בעיות במשפך הרכישה שלך עובדות יחד נגדך. ${correlatedInsight.story}`,
        revenue_at_risk: `ההכנסה שלך בסיכון ממספר זוויות. ${count} בעיות מקושרות יוצרות חשיפה כוללת של ${formatMoney(impact, currency)}.`,
        retention_crisis: `הלקוחות שלך מתנתקים. ${count} סימני אזהרה מצביעים על בעיית שימור שדורשת תשומת לב מיידית.`,
        pipeline_stall: `צנרת המכירות שלך עומדת. לידים קרים ועסקאות תקועות יחד מסכנים ${formatMoney(impact, currency)}.`,
        capacity_mismatch: `יש לך זמן פנוי אבל אין מספיק הזמנות. התנועה ירדה והיומן שלך לא מלא.`,
        service_health: `מספר סימנים מצביעים על בעיית איכות שירות. בדוק סיבות ביטולים ומשוב לקוחות.`,
        website_crisis: `האתר שלך מקבל תנועה אבל לא ממיר אותה. עמודים חסרים קריאות לפעולה ומבקרים עוזבים.`,
        cash_flow_warning: `בעיות תזרים מזומנים מתפתחות ממספר מקורות. פעל עכשיו כדי למנוע שיבושי תשלום.`,
        pricing_issue: `אסטרטגיית התמחור שלך דורשת תשומת לב. הנחות יתר ו/או המרת מבצעי היכרות נמוכה שוחקים הכנסות.`,
        ops_inefficiency: `התפעול לא ממקסם את הקיבולת שלך. שעות שיא ריקות ושירותים בביצועים נמוכים.`,
      };

      return {
        title: patternTitles[correlatedInsight.patternId] || `${count} בעיות מקושרות - ${formatMoney(impact, currency)} בסיכון`,
        story: patternStories[correlatedInsight.patternId] || correlatedInsight.story,
        recommendation: 'בדוק את הפרטים ונקוט בפעולה על הבעיות הדחופות ביותר קודם.',
      };
    }

    // English fallback
    const patternTitles: Record<string, string> = {
      funnel_breakdown: `Your Acquisition Funnel is Broken - ${formatMoney(impact, currency)} at Risk`,
      revenue_at_risk: `Revenue at Risk from ${count} Issues - ${formatMoney(impact, currency)}`,
      retention_crisis: `Client Retention Crisis - ${count} Warning Signs`,
      pipeline_stall: `Sales Pipeline Stalled - ${formatMoney(impact, currency)} at Risk`,
      capacity_mismatch: `You Have Capacity but No Demand`,
      service_health: `Service Quality Issues Detected`,
      website_crisis: `Your Website Isn't Converting Visitors`,
      cash_flow_warning: `Cash Flow Warning - Take Action Now`,
      pricing_issue: `Pricing Strategy Needs Attention`,
      ops_inefficiency: `Operations Running Inefficiently`,
    };

    return {
      title: patternTitles[correlatedInsight.patternId] || `${count} Connected Issues - ${formatMoney(impact, currency)} at Risk`,
      story: correlatedInsight.story,
      recommendation: correlatedInsight.action,
    };
  }

  /**
   * Map correlation category to business event category
   */
  private mapCorrelationCategoryToBusinessCategory(
    category: CorrelatedInsight['category']
  ): BusinessEventCategory {
    const mapping: Record<string, BusinessEventCategory> = {
      funnel: 'acquisition',
      revenue: 'cash_flow',
      retention: 'retention',
      pipeline: 'conversion',
      capacity: 'operations',
      service: 'operations',
    };
    return mapping[category] || 'operations';
  }

  // ===========================
  // Business Health Summary Methods
  // ===========================

  /**
   * Create or update business health summary for the current period
   */
  async createOrUpdateHealthSummary(
    userId: string,
    correlationSummary: CorrelationSummary,
    allInsights: Insight[],
    runId: string
  ): Promise<RepositoryResult<BusinessHealthSummary>> {
    try {
      const language = await this.getUserLanguage(userId);

      // Calculate period boundaries (weekly)
      const now = new Date();
      const periodStart = new Date(now);
      periodStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
      periodStart.setHours(0, 0, 0, 0);

      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);

      // Get previous period's score for comparison
      const { data: previousSummary } = await this.supabase
        .from('business_health_summaries')
        .select('health_score')
        .eq('user_id', userId)
        .eq('period_type', 'weekly')
        .lt('period_start', periodStart.toISOString())
        .order('period_start', { ascending: false })
        .limit(1)
        .single();

      // Calculate category scores and overall health
      const scores = this.calculateCategoryScores(allInsights);
      const healthScore = this.calculateOverallHealthScore(scores);
      const previousHealthScore = previousSummary?.health_score || null;
      const scoreChange = previousHealthScore ? healthScore - previousHealthScore : null;

      // Count insights by severity
      const criticalCount = allInsights.filter((i) => i.severity === 'critical').length;
      const highCount = allInsights.filter((i) => i.severity === 'high').length;

      // Calculate total impact
      const totalImpactUsd = correlationSummary.totalImpactUsd;

      // Generate LLM narrative
      const { title, narrative, highlights, priorities } = await this.generateHealthNarrative(
        userId,
        healthScore,
        scoreChange,
        scores,
        correlationSummary,
        allInsights,
        language,
        runId
      );

      // Upsert the summary
      const summaryData = {
        user_id: userId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        period_type: 'weekly' as const,
        health_score: healthScore,
        previous_health_score: previousHealthScore,
        score_change: scoreChange,
        acquisition_score: scores.acquisition,
        conversion_score: scores.conversion,
        sales_score: scores.sales,
        cash_flow_score: scores.cash_flow,
        retention_score: scores.retention,
        operations_score: scores.operations,
        pricing_score: scores.pricing,
        summary_title: title,
        summary_narrative: narrative,
        summary_language: language,
        highlights,
        priorities,
        insight_count: allInsights.length,
        critical_count: criticalCount,
        high_count: highCount,
        total_impact_usd: totalImpactUsd,
        detection_run_id: runId,
      };

      const { data, error } = await this.supabase
        .from('business_health_summaries')
        .upsert(summaryData, {
          onConflict: 'user_id,period_type,period_start',
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(
        {
          userId,
          healthScore,
          scoreChange,
          insightCount: allInsights.length,
          criticalCount,
        },
        'Business health summary created/updated'
      );

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create business health summary');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Calculate category scores based on insights
   */
  private calculateCategoryScores(insights: Insight[]): Record<string, number> {
    const categories = ['acquisition', 'conversion', 'sales', 'cash_flow', 'retention', 'operations', 'pricing'];
    const scores: Record<string, number> = {};

    for (const category of categories) {
      const categoryInsights = insights.filter((i) => i.category === category);

      if (categoryInsights.length === 0) {
        scores[category] = 80; // Default healthy score when no issues
        continue;
      }

      // Calculate penalty based on severity
      let penalty = 0;
      for (const insight of categoryInsights) {
        switch (insight.severity) {
          case 'critical':
            penalty += 25;
            break;
          case 'high':
            penalty += 15;
            break;
          case 'medium':
            penalty += 8;
            break;
          case 'low':
            penalty += 3;
            break;
        }
      }

      // Score is 100 minus penalty, minimum 0
      scores[category] = Math.max(0, 100 - penalty);
    }

    return scores;
  }

  /**
   * Calculate overall health score from category scores
   */
  private calculateOverallHealthScore(categoryScores: Record<string, number>): number {
    // Weighted average - some categories matter more
    const weights: Record<string, number> = {
      cash_flow: 0.20,
      retention: 0.18,
      conversion: 0.15,
      sales: 0.15,
      operations: 0.12,
      acquisition: 0.10,
      pricing: 0.10,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [category, weight] of Object.entries(weights)) {
      const score = categoryScores[category] ?? 80;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    return Math.round(weightedSum / totalWeight);
  }

  /**
   * Generate LLM-powered executive narrative
   */
  private async generateHealthNarrative(
    userId: string,
    healthScore: number,
    scoreChange: number | null,
    categoryScores: Record<string, number>,
    correlationSummary: CorrelationSummary,
    allInsights: Insight[],
    language: string,
    runId: string
  ): Promise<{
    title: string;
    narrative: string;
    highlights: Array<{ type: 'positive' | 'negative' | 'neutral'; text: string }>;
    priorities: Array<{ rank: number; category: string; title: string; insight_id?: string }>;
  }> {
    try {
      const settings = await resolveBosLlmSettings('insights', 'health_summary');
      if (!settings.enabled) {
        logger.info({ reason: 'disabled' }, 'Health summary AI is switched off; using the templates');
        return this.generateHealthNarrativeFallback(
          healthScore,
          scoreChange,
          categoryScores,
          correlationSummary,
          language
        );
      }

      const provider = ProviderFactory.getProvider(PROVIDERS.OPENAI);

      const langName = language === 'he' ? 'Hebrew' : 'English';
      const currencySymbol = language === 'he' ? '₪' : '$';

      // Build context
      const trendEmoji = scoreChange === null ? '➡️' : scoreChange > 0 ? '📈' : scoreChange < 0 ? '📉' : '➡️';
      const trendText = scoreChange === null
        ? 'First assessment'
        : scoreChange > 0
          ? `up ${scoreChange} points`
          : scoreChange < 0
            ? `down ${Math.abs(scoreChange)} points`
            : 'stable';

      // Top issues
      const criticalInsights = allInsights.filter((i) => i.severity === 'critical').slice(0, 3);
      const issuesList = criticalInsights
        .map((i) => `- ${i.title} (${currencySymbol}${i.estimated_impact_usd?.toLocaleString() || 0} impact)`)
        .join('\n');

      // Correlated patterns
      const patterns = correlationSummary.correlatedInsights
        .map((ci) => `- ${ci.patternName}: ${ci.story.substring(0, 100)}...`)
        .join('\n');

      // Category breakdown
      const categoryList = Object.entries(categoryScores)
        .sort((a, b) => a[1] - b[1])
        .map(([cat, score]) => `- ${cat}: ${score}/100`)
        .join('\n');

      const prompt = `You are a friendly business advisor giving a weekly health check to a solo business owner.

BUSINESS HEALTH DATA:
- Overall Score: ${healthScore}/100 ${trendEmoji} (${trendText})
- Total Impact at Risk: ${currencySymbol}${correlationSummary.totalImpactUsd.toLocaleString()}
- Issues Found: ${allInsights.length} (${allInsights.filter(i => i.severity === 'critical').length} critical)

CATEGORY BREAKDOWN:
${categoryList}

TOP CRITICAL ISSUES:
${issuesList || 'None'}

CONNECTED PATTERNS DETECTED:
${patterns || 'None'}

Generate an executive summary that:
1. Opens with the most important takeaway (good news or urgent concern)
2. Explains what's working and what needs attention
3. Provides context (is this improving or getting worse?)
4. Ends with clear prioritized next steps

Be conversational, not corporate. Imagine talking to a busy solo entrepreneur.

Generate in ${langName}. Respond with ONLY a JSON object:
{
  "title": "One-line summary with emotion and score (e.g., 'Your business is healthy at 78/100!')",
  "narrative": "2-3 paragraph executive summary (conversational, specific, actionable)",
  "highlights": [
    {"type": "positive", "text": "Something good"},
    {"type": "negative", "text": "Something concerning"},
    {"type": "neutral", "text": "Something informational"}
  ],
  "priorities": [
    {"rank": 1, "category": "cash_flow", "title": "What to do first"}
  ]
}`;

      const { result: response } = await withModelFallback(settings, (model) =>
        provider.chatCompletion(
          {
            messages: [{ role: 'user' as const, content: prompt }],
            model,
            ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
            max_tokens: 800,
          },
          buildBosCallContext({
            userId,
            area: 'insights',
            callName: 'health_summary',
            groupId: runId,
          })
        )
      );

      const content = response.choices[0]?.message?.content?.trim() || '';
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      return {
        title: parsed.title || `Business Health: ${healthScore}/100`,
        narrative: parsed.narrative || 'Your business health summary is being generated.',
        highlights: parsed.highlights || [],
        priorities: parsed.priorities || [],
      };
    } catch (error) {
      logger.warn({ err: error }, 'LLM health narrative generation failed, using fallback');
      return this.generateHealthNarrativeFallback(healthScore, scoreChange, categoryScores, correlationSummary, language);
    }
  }

  /**
   * Fallback health narrative generation
   */
  private generateHealthNarrativeFallback(
    healthScore: number,
    scoreChange: number | null,
    categoryScores: Record<string, number>,
    correlationSummary: CorrelationSummary,
    language: string
  ): {
    title: string;
    narrative: string;
    highlights: Array<{ type: 'positive' | 'negative' | 'neutral'; text: string }>;
    priorities: Array<{ rank: number; category: string; title: string }>;
  } {
    // Find weakest category
    const weakest = Object.entries(categoryScores).sort((a, b) => a[1] - b[1])[0];
    const strongest = Object.entries(categoryScores).sort((a, b) => b[1] - a[1])[0];

    if (language === 'he') {
      const trendText = scoreChange === null
        ? ''
        : scoreChange > 0
          ? ` (עלייה של ${scoreChange} נקודות מהשבוע שעבר)`
          : scoreChange < 0
            ? ` (ירידה של ${Math.abs(scoreChange)} נקודות מהשבוע שעבר)`
            : ' (יציב)';

      return {
        title: `בריאות העסק שלך: ${healthScore}/100${trendText}`,
        narrative: `הציון הכולל של העסק שלך השבוע הוא ${healthScore} מתוך 100. ` +
          `התחום החזק ביותר שלך הוא ${strongest[0]} (${strongest[1]}/100), ` +
          `בעוד ${weakest[0]} דורש תשומת לב (${weakest[1]}/100). ` +
          (correlationSummary.correlatedInsights.length > 0
            ? `זיהינו ${correlationSummary.correlatedInsights.length} דפוסי בעיות מקושרות שכדאי לטפל בהן יחד.`
            : ''),
        highlights: [
          { type: 'positive' as const, text: `${strongest[0]} הוא התחום החזק ביותר שלך` },
          { type: 'negative' as const, text: `${weakest[0]} דורש תשומת לב מיידית` },
        ],
        priorities: [{ rank: 1, category: weakest[0], title: `שפר את ה${weakest[0]} שלך` }],
      };
    }

    const trendText = scoreChange === null
      ? ''
      : scoreChange > 0
        ? ` (up ${scoreChange} points from last week)`
        : scoreChange < 0
          ? ` (down ${Math.abs(scoreChange)} points from last week)`
          : ' (stable)';

    return {
      title: `Your Business Health: ${healthScore}/100${trendText}`,
      narrative: `Your overall business score this week is ${healthScore} out of 100. ` +
        `Your strongest area is ${strongest[0]} (${strongest[1]}/100), ` +
        `while ${weakest[0]} needs attention (${weakest[1]}/100). ` +
        (correlationSummary.correlatedInsights.length > 0
          ? `We identified ${correlationSummary.correlatedInsights.length} connected issue patterns that are worth addressing together.`
          : ''),
      highlights: [
        { type: 'positive' as const, text: `${strongest[0]} is your strongest area` },
        { type: 'negative' as const, text: `${weakest[0]} needs immediate attention` },
      ],
      priorities: [{ rank: 1, category: weakest[0], title: `Improve your ${weakest[0]}` }],
    };
  }

  /**
   * Get the latest business health summary for a user
   */
  async getLatestHealthSummary(userId: string): Promise<RepositoryResult<BusinessHealthSummary>> {
    try {
      const { data, error } = await this.supabase
        .from('business_health_summaries')
        .select('*')
        .eq('user_id', userId)
        .order('period_start', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get correlated insights for a user (top-level unified insights)
   */
  async getCorrelatedInsights(
    userId: string,
    status: InsightStatus[] = ['new', 'viewed']
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('user_id', userId)
        .eq('is_correlated', true)
        .in('status', status)
        .order('priority_score', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Enrich with contributing insights
      const enriched = await Promise.all(
        (data || []).map(async (insight) => {
          if (insight.contributing_insight_ids?.length) {
            const { data: children } = await this.supabase
              .from('insights')
              .select('detector_id, severity, title, estimated_impact_usd')
              .in('id', insight.contributing_insight_ids)
              .eq('user_id', userId);

            return {
              ...insight,
              contributing_insights: (children || []).map((child) => ({
                detector_id: child.detector_id,
                detector_name: child.detector_id.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
                severity: child.severity,
                summary: child.title,
                impact_usd: child.estimated_impact_usd || 0,
              })),
            };
          }
          return insight;
        })
      );

      return { data: enriched, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Save correlation results from engine
   * This processes the correlation summary and creates all necessary database records
   */
  async saveCorrelationResults(
    userId: string,
    correlationSummary: CorrelationSummary,
    standaloneInsightIds: Map<string, string>, // detectorId -> insightId
    runId: string
  ): Promise<RepositoryResult<{ correlatedInsights: Insight[]; healthSummary: BusinessHealthSummary | null }>> {
    try {
      const createdCorrelatedInsights: Insight[] = [];

      // Create correlated insights
      for (const correlatedInsight of correlationSummary.correlatedInsights) {
        // Get the insight IDs for contributing detectors
        const childInsightIds = correlatedInsight.contributingInsights
          .map((ci) => standaloneInsightIds.get(ci.detectorId))
          .filter((id): id is string => !!id);

        const result = await this.createCorrelatedInsight(
          userId,
          correlatedInsight,
          childInsightIds,
          runId
        );

        if (result.data) {
          createdCorrelatedInsights.push(result.data);
        } else {
          logger.error(
            {
              error: result.error?.message,
              patternId: correlatedInsight.patternId,
              childCount: childInsightIds.length,
              userId
            },
            'Failed to save correlated insight'
          );
        }
      }

      // Get all active insights for health calculation
      const { data: allInsights } = await this.findActive(userId, 50);

      // Create/update health summary
      let healthSummary: BusinessHealthSummary | null = null;
      if (allInsights && allInsights.length > 0) {
        const healthResult = await this.createOrUpdateHealthSummary(
          userId,
          correlationSummary,
          allInsights,
          runId
        );
        healthSummary = healthResult.data;
      }

      logger.info(
        {
          userId,
          correlatedCount: createdCorrelatedInsights.length,
          healthScore: healthSummary?.health_score,
        },
        'Correlation results saved'
      );

      return {
        data: {
          correlatedInsights: createdCorrelatedInsights,
          healthSummary,
        },
        error: null,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to save correlation results');
      return { data: null, error: error as Error };
    }
  }

  // ===========================
  // Vector Maturity System
  // ===========================

  /**
   * Calculate the maturity state of all 7 business vectors
   * This drives the progressive disclosure UI - showing users what's being watched vs. active
   */
  async getVectorMaturity(userId: string): Promise<RepositoryResult<VectorMaturityData>> {
    try {
      // Fetch all metrics in parallel
      const [
        accountResult,
        visitorsResult,
        bookingsResult,
        invoicesResult,
        contactsResult,
        winsResult,
      ] = await Promise.all([
        // Account age - use business_profiles.created_at (when Business OS was set up)
        // Falls back to profiles.created_at if no business profile exists
        this.supabase
          .from('business_profiles')
          .select('created_at')
          .eq('user_id', userId)
          .maybeSingle(),

        /*
         * Visitors, meaning PEOPLE — not page views.
         *
         * `website_page_views` holds one row per view, and counting those rows
         * told a business opened this morning that 25 people had found it when
         * the owner had reloaded their own site twenty times. The vector is the
         * gate on whether a conversion rate is worth reading, so the number it
         * counts has to be the denominator of that rate: sessions, not hits.
         * Twenty views from one session is one visitor and no conversion
         * signal whatsoever.
         *
         * The rows come back rather than a `count`, because PostgREST has no
         * DISTINCT and the identity has to be resolved per row — see
         * `countUniqueVisitors`.
         */
        this.supabase
          .from('website_page_views')
          .select('session_id, ip_hash, is_owner_view')
          .eq('user_id', userId)
          .limit(VISITOR_SCAN_LIMIT),

        // Total bookings
        this.supabase
          .from('scheduling_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),

        // Total invoices
        this.supabase
          .from('payment_invoices')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),

        // Total contacts
        this.supabase
          .from('crm_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),

        // Win events (completed bookings, payments received, etc.)
        this.supabase
          .from('insights')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('category', 'win'),
      ]);

      // Calculate account age in days from business_profiles.created_at
      // If no business profile, default to today (day 1)
      let accountCreatedAt = new Date();
      if (accountResult.data?.created_at) {
        accountCreatedAt = new Date(accountResult.data.created_at);
      }
      // Ensure minimum of 1 day (for newly created accounts)
      const accountAgeDays = Math.max(1, Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)));

      const visitorRows = (visitorsResult.data ?? []) as VisitorIdentityRow[];
      const uniqueVisitors = countUniqueVisitors(visitorRows);

      /*
       * A capped scan reports a floor, and says so. Silently returning the
       * uniques found in the first 5,000 rows would read as an exact audience
       * size while being an arbitrary fraction of one.
       */
      if (visitorRows.length >= VISITOR_SCAN_LIMIT) {
        logger.warn(
          { userId, scanned: visitorRows.length, uniqueVisitors },
          'Visitor scan hit its row cap; unique visitors is a floor, not a total'
        );
      }

      // A query against a table that doesn't exist fails silently into a zeroed
      // metric, which reads as "no data yet" and quietly holds a vector dark
      // forever. Say so instead.
      const sourceErrors = [
        { source: 'website_page_views', error: visitorsResult.error },
        { source: 'scheduling_bookings', error: bookingsResult.error },
        { source: 'payment_invoices', error: invoicesResult.error },
        { source: 'crm_contacts', error: contactsResult.error },
        { source: 'insights', error: winsResult.error },
        { source: 'business_profiles', error: accountResult.error },
      ].filter(s => s.error);
      if (sourceErrors.length > 0) {
        logger.error({
          userId,
          failures: sourceErrors.map(s => ({ source: s.source, message: s.error?.message }))
        }, 'Vector maturity source query failed; affected vectors will read as dark');
      }

      // Get first booking date to calculate days with bookings
      const { data: firstBooking, error: firstBookingError } = await this.supabase
        .from('scheduling_bookings')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstBookingError) {
        logger.error({ err: firstBookingError, userId }, 'Failed to read first booking for vector maturity');
      }

      const daysWithBookings = firstBooking?.created_at
        ? Math.floor((Date.now() - new Date(firstBooking.created_at).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Get first client date to calculate days with clients.
      // The date itself is kept, not just the elapsed count — see JourneyAnchors.
      /*
       * The first time anybody looked at this business online.
       *
       * Part of the journey's anchor: a business whose site had visitors in
       * June did not start today, whatever its profile row says.
       */
      /*
       * Automations the owner has switched on and not paused.
       *
       * `is_active` is the same flag `AutomationManager.pause()` clears, so a
       * paused automation stops counting the moment it is paused.
       */
      const { count: activeAutomations } = await this.supabase
        .from('insight_automations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_active', true);

      /*
       * ...and the ones that do not live in that table at all.
       *
       * ───────────────────────────────────────────────────────────────────────
       * Automations exist in TWO places, and this node was only ever reading
       * one of them.
       *
       *   insight_automations   a standing rule attached to a detector, created
       *                         by "Set this up permanently" on an insight card
       *
       *   business_profiles     the three operational automations the advisor
       *                         asks about — reply to enquiries, chase invoices,
       *                         remind about the form — each a boolean column
       *
       * So the journey said "nothing is working on its own" to an owner with
       * two of the three switched on and demonstrably sending email on their
       * behalf. `insight_automations` is empty on every account in the
       * database; the operational ones are the only automations anybody has
       * actually turned on. Counting only the empty table made the node read
       * zero forever.
       *
       * An enabled automation that CANNOT act does not count. A business with
       * the intake reminder on but no published form has nothing running, and
       * saying otherwise is the same overstatement in a different place — so
       * each one is checked, and only the ones whose column is on are checked
       * at all, which costs nothing for a business that has enabled nothing.
       * ───────────────────────────────────────────────────────────────────────
       */
      const operationalRunning = await this.countOperationalAutomations(userId);

      const { data: firstView } = await this.supabase
        .from('website_page_views')
        .select('viewed_at')
        .eq('user_id', userId)
        .order('viewed_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: firstClient } = await this.supabase
        .from('crm_contacts')
        .select('created_at')
        .eq('user_id', userId)
        .eq('lifecycle_stage', 'client')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      /*
       * How many clients, not just when the first one arrived.
       *
       * The retention vector needs both: two months of elapsed time so a lapse
       * is possible, and enough clients for a lapse rate to be a rate rather
       * than an anecdote about one person.
       */
      const { count: clientCount } = await this.supabase
        .from('crm_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('lifecycle_stage', 'client');

      /*
       * The first job the owner handed over, for the journey's last node.
       *
       * A standing automation rather than a one-off kernel run: `run` is the
       * owner pressing a button, which is still the owner working. An entry in
       * `insight_automations` is the platform holding a recurring job on its
       * own — the thing the old day-90 node was pointing at.
       *
       * `status` is deliberately not filtered: an automation later paused was
       * still handed over on the day it was created, and a timeline records
       * what happened rather than what is currently switched on.
       */
      const { data: firstAutomation, error: firstAutomationError } = await this.supabase
        .from('insight_automations')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstAutomationError) {
        logger.error(
          { err: firstAutomationError, userId },
          'Failed to read first automation for the journey timeline'
        );
      }

      const daysWithClients = firstClient?.created_at
        ? Math.floor((Date.now() - new Date(firstClient.created_at).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Build metrics map
      const metrics: Record<string, number> = {
        positive_events: winsResult.count || 0,
        // Contacts stand in for traffic when no page views are recorded — a
        // business can be reached without a website on this platform.
        total_visitors: uniqueVisitors || contactsResult.count || 0,
        total_bookings: bookingsResult.count || 0,
        total_invoices: invoicesResult.count || 0,
        total_contacts: contactsResult.count || 0,
        days_with_clients: daysWithClients,
        days_with_bookings: daysWithBookings,
        total_clients: clientCount || 0,
      };

      // Calculate state for each vector
      const vectors: VectorStatus[] = (Object.keys(VECTOR_THRESHOLDS) as VectorKey[]).map((key) => {
        const config = VECTOR_THRESHOLDS[key];
        const dataPoints = metrics[config.metric] || 0;
        const threshold = config.threshold;

        /*
         * Both conditions, where there are two.
         *
         * A vector with an `also` clause is one measured in elapsed time, and
         * the clause is the volume behind it. Lighting on the clock alone let
         * `price` unlock on six weeks and a single booking.
         */
        const alsoPoints = config.also ? metrics[config.also.metric] || 0 : null;
        const alsoMet = config.also ? alsoPoints! >= config.also.threshold : true;

        let state: VectorState;
        if (dataPoints >= threshold && alsoMet) {
          state = 'lit';
        } else if (dataPoints > 0) {
          state = 'learn';
        } else {
          state = 'dark';
        }

        return {
          key,
          name: VECTOR_NAMES[key],
          state,
          dataPoints,
          threshold,
          note: state !== 'lit' ? config.note : undefined,
          also: config.also
            ? {
                metric: config.also.metric,
                current: alsoPoints ?? 0,
                threshold: config.also.threshold,
              }
            : undefined,
        };
      });

      // Count lit vectors
      const litCount = vectors.filter(v => v.state === 'lit').length;

      /*
       * The date the conversion threshold was crossed, for the journey timeline.
       *
       * Read as the Nth row rather than counted, because "when did the 25th
       * visitor arrive" is a position in the log, not an elapsed time. Only run
       * once the count says it happened — before that the query would return
       * nothing and cost a round trip to learn what the count already said.
       *
       * `total_visitors` falls back to contacts where a business has no website,
       * so the crossing is read from whichever source the metric actually used.
       */
      const convVector = vectors.find(v => v.key === 'conv');
      let convCrossedAt: string | null = null;
      if (convVector?.state === 'lit') {
        const nth = convVector.threshold - 1;
        const usedPageViews = (visitorsResult.count || 0) >= convVector.threshold;
        const { data: crossing, error: crossingError } = await this.supabase
          .from(usedPageViews ? 'website_page_views' : 'crm_contacts')
          .select('created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: true })
          .range(nth, nth)
          .maybeSingle();
        if (crossingError) {
          logger.error({ err: crossingError, userId }, 'Failed to read conversion crossing date');
        }
        convCrossedAt = crossing?.created_at ?? null;
      }

      // Determine overall maturity level
      let maturityLevel: MaturityLevel;
      if (litCount === 0) {
        maturityLevel = 'cold_start';
      } else if (litCount <= 2) {
        maturityLevel = 'early';
      } else if (litCount <= 5) {
        maturityLevel = 'running';
      } else {
        maturityLevel = 'mature';
      }

      // Build note
      const learnCount = vectors.filter(v => v.state === 'learn').length;
      const darkCount = vectors.filter(v => v.state === 'dark').length;

      let note: string;
      let noteKey: VectorMaturityData['noteKey'];
      let noteLearning: string[] = [];

      if (litCount === 0 && learnCount === 0) {
        noteKey = 'vecs.note.cold';
        note = 'Reading 0 of 7. I start watching the moment you publish — there is genuinely nothing to read until someone visits.';
      } else if (litCount === 7) {
        noteKey = 'vecs.note.full';
        note = 'Reading 7 of 7. This is the whole business now — what brings people in, what stops them, what you\'re owed, who comes back, and what you charge for it.';
      } else {
        noteKey = 'vecs.note.partial';
        noteLearning = vectors.filter(v => v.state === 'learn').map(v => v.key);
        const learningVectors = vectors.filter(v => v.state === 'learn').map(v => v.name.toLowerCase());
        const waitingNote = learningVectors.length > 0
          ? ` ${learningVectors.join(', ')} ${learningVectors.length === 1 ? 'needs' : 'need'} more data.`
          : '';
        note = `Reading ${litCount} of 7.${waitingNote}`;
      }

      logger.debug(
        { userId, litCount, maturityLevel, accountAgeDays },
        'Calculated vector maturity'
      );

      return {
        data: {
          vectors,
          maturityLevel,
          litCount,
          totalVectors: 7,
          accountAgeDays,
          journeyAnchors: {
            /*
             * The EARLIEST evidence, not the profile row.
             *
             * This used to read `business_profiles.created_at`, which is not
             * when the business started — it is when its profile row was last
             * written. Deleting and recreating a business resets it to today,
             * and every milestone on the rail is then dated against an anchor
             * younger than the events it is measuring: a first booking from
             * last week lands before day zero, and "today" reads as day 0 on an
             * account that has been trading for months.
             *
             * It is the same trap the vector thresholds were moved off for,
             * documented in the module guidance as "count from the first
             * booking / first client, never from signup". The timeline was
             * missed at the time.
             *
             * The profile row is kept as the LAST resort, for an account with
             * no evidence at all — where it is the only date there is, and
             * where being wrong about it costs nothing because there are no
             * milestones to mis-date.
             */
            accountCreatedAt: earliestOf([
              firstBooking?.created_at,
              firstClient?.created_at,
              firstView?.viewed_at,
              accountResult.data?.created_at,
            ]),
            firstBookingAt: firstBooking?.created_at ?? null,
            firstClientAt: firstClient?.created_at ?? null,
            convCrossedAt,
            firstAutomationAt: firstAutomation?.created_at ?? null,
            /*
             * How many are switched on RIGHT NOW.
             *
             * `firstAutomationAt` records that the owner once handed something
             * over and stays set forever; it cannot answer "is anything working
             * on its own today", which is what the journey node claims. An
             * account that turned one on in March and paused it in April has
             * reached the milestone and has nothing running.
             */
            runningAutomations: (activeAutomations ?? 0) + operationalRunning,
          },
          note,
          noteKey,
          noteLearning,
        },
        error: null,
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to calculate vector maturity');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get confidence threshold for a specific detector
   * Used to show "not enough data to judge" UI
   */
  async getConfidenceThreshold(
    userId: string,
    detectorId: string
  ): Promise<{ current: number; needed: number; isConfident: boolean } | null> {
    // Map detectors to their confidence requirements
    const detectorThresholds: Record<string, { metric: string; needed: number }> = {
      'cash_ar_overdue': { metric: 'total_invoices', needed: 1 },
      'ret_no_show_spike': { metric: 'total_bookings', needed: 10 },
      'sales_stalled': { metric: 'total_contacts', needed: 5 },
      'ops_utilization_low': { metric: 'days_with_bookings', needed: 14 },
      'conv_pipeline_stuck': { metric: 'total_contacts', needed: 10 },
      'crm_cold_leads': { metric: 'total_contacts', needed: 10 },
      'ret_cancellation_spike': { metric: 'total_bookings', needed: 20 },
    };

    const threshold = detectorThresholds[detectorId];
    if (!threshold) {
      return null; // No confidence threshold for this detector
    }

    try {
      let current = 0;

      switch (threshold.metric) {
        case 'total_invoices': {
          const { count } = await this.supabase
            .from('payment_invoices')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
          current = count || 0;
          break;
        }
        case 'total_bookings': {
          const { count } = await this.supabase
            .from('scheduling_bookings')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
          current = count || 0;
          break;
        }
        case 'total_contacts': {
          const { count } = await this.supabase
            .from('crm_contacts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
          current = count || 0;
          break;
        }
        case 'total_transactions': {
          const { count } = await this.supabase
            .from('payment_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
          current = count || 0;
          break;
        }
        case 'days_with_bookings': {
          const { data: firstBooking } = await this.supabase
            .from('scheduling_bookings')
            .select('created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          current = firstBooking?.created_at
            ? Math.floor((Date.now() - new Date(firstBooking.created_at).getTime()) / (1000 * 60 * 60 * 24))
            : 0;
          break;
        }
      }

      return {
        current,
        needed: threshold.needed,
        isConfident: current >= threshold.needed,
      };
    } catch (error) {
      logger.error({ err: error, userId, detectorId }, 'Failed to get confidence threshold');
      return null;
    }
  }
}

// Singleton export
export const insightRepository = (supabase: SupabaseClient) => new InsightRepository(supabase);
