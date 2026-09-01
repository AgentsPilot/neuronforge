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
import { resolveUserLanguage } from '@/lib/business-os/userLanguage';
import { createLogger } from '@/lib/logger';
import type { DetectionResult, InsightSeverity } from '../detectors/types';
import type { PrioritizedInsight } from '../prioritizer/InsightPrioritizer';
import type { BusinessEventCategory } from '../events/types';
import type { CorrelatedInsight, CorrelationSummary } from '../correlation/types';
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory';
import { getVerticalConfig, buildTerminologyInstruction, getVerticalDescriptor } from '../vertical-config';

const logger = createLogger({ service: 'InsightRepository' });

// ===========================
// Types
// ===========================

export type InsightStatus = 'new' | 'viewed' | 'snoozed' | 'dismissed' | 'acted' | 'automated';

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
}

export interface VectorMaturityData {
  vectors: VectorStatus[];
  maturityLevel: MaturityLevel;
  litCount: number;
  totalVectors: number;
  accountAgeDays: number;
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
const VECTOR_THRESHOLDS: Record<VectorKey, { threshold: number; metric: string; note: string }> = {
  wins: { threshold: 1, metric: 'positive_events', note: 'Lights immediately on any good news' },
  conv: { threshold: 25, metric: 'total_visitors', note: 'Need about 25 visitors before I\'d trust what the conversion rate is telling me' },
  ops: { threshold: 1, metric: 'total_bookings', note: 'Need at least one booking to understand your calendar' },
  cash: { threshold: 1, metric: 'total_invoices', note: 'Starts watching when you have invoices to track' },
  leads: { threshold: 10, metric: 'total_contacts', note: 'Need some leads to spot patterns' },
  ret: { threshold: 60, metric: 'days_with_clients', note: 'Retention needs clients old enough to lapse — about two months' },
  price: { threshold: 42, metric: 'days_with_bookings', note: 'Pricing needs six weeks of your calendar before I\'d say anything' },
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
  runId?: string;
}

// ===========================
// InsightRepository
// ===========================

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
        businessContext
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
    businessContext: BusinessContext
  ): Promise<{ title: string; description: string; recommendation: string }> {
    try {
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
        web_page_underperform: 'high-traffic pages with no conversions',
        web_mobile_issues: 'mobile visitors converting at lower rates than desktop',
        // Phase 5: Cash Flow Deep
        cash_cards_expiring: 'customer payment cards expiring soon',
        cash_ar_aging: 'invoices aging into harder-to-collect buckets (60+ days)',
        cash_refund_pattern: 'high refund rate that may signal service issues',
        cash_payout_blocked: 'Stripe payouts blocked - cannot receive money',
        // Phase 6: Pricing
        pricing_discount_abuse: 'excessive discounting that may be eroding margins',
        pricing_intro_offer_stuck: 'customers using intro offers but not converting to full price',
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
${typeof detection.percentChange === 'number' ? `- Change from baseline: ${detection.percentChange.toFixed(0)}%` : ''}
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

      const response = await provider.chatCompletion(
        {
          messages: [{ role: 'user' as const, content: prompt }],
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 300,
        },
        {
          userId: 'system',
          feature: 'insight-generation',
          component: 'InsightRepository',
        }
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
    runId?: string
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
   * Get active insights for a user (new status, not snoozed)
   */
  async findActive(
    userId: string,
    limit: number = 10
  ): Promise<RepositoryResult<Insight[]>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'new')
        .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
        .order('priority_score', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: data || [], error: null };
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
   * Mark insight as surfaced (shown to user)
   */
  async markSurfaced(id: string, userId: string): Promise<RepositoryResult<Insight>> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .update({
          last_surfaced_at: new Date().toISOString(),
          surface_count: this.supabase.rpc('increment_surface_count', { insight_id: id }),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        // Fallback without RPC
        const { data: fallbackData, error: fallbackError } = await this.supabase
          .from('insights')
          .select('surface_count')
          .eq('id', id)
          .eq('user_id', userId)
          .single();

        if (fallbackError) throw fallbackError;

        const { data: updated, error: updateError } = await this.supabase
          .from('insights')
          .update({
            last_surfaced_at: new Date().toISOString(),
            surface_count: (fallbackData?.surface_count || 0) + 1,
          })
          .eq('id', id)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) throw updateError;
        return { data: updated, error: null };
      }

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to mark insight surfaced');
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

    // Hebrew titles
    if (language === 'he') {
      const hebrewTitles: Record<string, string> = {
        cash_ar_overdue: `${count} חשבוניות שלא שולמו - ${formatMoney(value, currency)}`,
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
        web_page_underperform: `${count} עמודים עם תנועה ללא המרות`,
        web_mobile_issues: `המרות במובייל נמוכות ב-${pctChange}%`,
        cash_cards_expiring: `${count} כרטיסי אשראי פגים בקרוב`,
        cash_ar_aging: `${formatMoney(impact, currency)} בחשבוניות מזדקנות (60+ יום)`,
        cash_refund_pattern: `שיעור החזרים של ${value.toFixed(1)}%`,
        cash_payout_blocked: `העברות Stripe חסומות`,
        pricing_discount_abuse: `${value.toFixed(0)}% מהמכירות בהנחה`,
        pricing_intro_offer_stuck: `רק ${value.toFixed(0)}% ממבצעי היכרות הומרו`,
      };
      return hebrewTitles[detection.detectorId] || `${count} בעיות זוהו`;
    }

    // English titles (default)
    const titles: Record<string, string> = {
      cash_ar_overdue: `${formatMoney(value, currency)} in Overdue Invoices`,
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
      web_page_underperform: `${count} High-Traffic Pages Not Converting`,
      web_mobile_issues: `Mobile Conversion ${pctChange}% Lower`,
      cash_cards_expiring: `${count} Customer Cards Expiring Soon`,
      cash_ar_aging: `${formatMoney(impact, currency)} in Aging Invoices (60+ Days)`,
      cash_refund_pattern: `Refund Rate at ${value.toFixed(1)}%`,
      cash_payout_blocked: `Stripe Payouts Blocked`,
      pricing_discount_abuse: `${value.toFixed(0)}% of Sales Discounted`,
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
    const rawPctChange = typeof detection.percentChange === 'number' ? detection.percentChange : parseFloat(String(detection.percentChange)) || 0;
    const pctChange = Math.abs(rawPctChange).toFixed(0);
    const avgDaysStuck = (detection.processParameters?.avg_days_stuck as number) || 14;
    const avgDaysSilent = (detection.processParameters?.avg_days_silent as number) || 30;

    // Hebrew descriptions
    if (language === 'he') {
      const hebrewDescriptions: Record<string, string> = {
        cash_ar_overdue: `יש לך ${count} חשבוניות בסך ${formatMoney(value, currency)} שנמצאות בפיגור של יותר מ-7 ימים.`,
        cash_payment_issues: this.getPaymentIssueDescriptionHe(issueType, detection, currency),
        ret_no_show_spike: `שיעור אי-ההגעות עלה מ-${baseline.toFixed(1)}% ל-${value.toFixed(1)}%, עלייה של ${pctChange}% מהבסיס.`,
        sales_stalled: `${count} לקוחות פוטנציאליים ממתינים לתגובה יותר מ-48 שעות.`,
        sales_reply_slow: `זמן התגובה הממוצע שלך הוא ${value.toFixed(1)} שעות, איטי ב-${pctChange}% מהבסיס של ${baseline.toFixed(1)} שעות.`,
        ops_utilization_low: `היומן שלך מלא רק ב-${value.toFixed(0)}%, עם כ-${count} שעות פנויות השבוע.`,
        crm_cold_leads: `${count} לידים לא קיבלו קשר במשך 7+ ימים. הזדמנות בסיכון: ${formatMoney(impact, currency)}.`,
        acq_traffic_drop: `התנועה לאתר ירדה ב-${pctChange}% בהשוואה לשבוע שעבר. ייתכן שפחות לידים נכנסים.`,
        acq_low_conversion: `רק ${value.toFixed(1)}% מהמבקרים באתר הופכים ללידים, מתחת ליעד של ${baseline.toFixed(1)}%.`,
        ret_cancellation_spike: `הביטולים עלו ב-${pctChange}% השבוע (${count} ביטולים). בדוק את הסיבות לזהות דפוסים.`,
        conv_pipeline_stuck: `${count} אנשי קשר תקועים באותו שלב בממוצע ${avgDaysStuck} ימים. השפעה משוערת: ${formatMoney(impact, currency)}.`,
        conv_followup_overdue: `${count} משימות מעקב באיחור. מעקב בזמן משפר את שיעורי ההמרה.`,
        conv_source_underperform: `מקור לידים זה ממיר ב-${value.toFixed(1)}%, מתחת לממוצע של ${baseline.toFixed(1)}%.`,
        crm_engagement_decay: `${count} לקוחות פעילים שקטים בממוצע ${avgDaysSilent} ימים. הם בסיכון לנטישה.`,
        ret_repeat_booking_low: `רק ${(100 - value).toFixed(0)}% מהלקוחות החדשים חוזרים להזמנה נוספת. היעד הוא ${(100 - baseline).toFixed(0)}%+.`,
        ops_last_minute_cancels: `${count} הזמנות בוטלו בתוך 24 שעות. הפסד הכנסות: ${formatMoney(impact, currency)}.`,
        ops_service_performance: `${count} שירותים מציגים ביצועים נמוכים משמעותית בהשוואה לשירותים המובילים.`,
        ops_peak_unutilized: `שעות השיא ההיסטוריות שלך ${(100 - value).toFixed(0)}% ריקות. הזדמנות הכנסה: ${formatMoney(impact, currency)}.`,
        web_missing_cta: `${count} עמודים חסרים קריאה לפעולה ברורה. מבקרים עלולים לעזוב בלי לפעול.`,
        web_incomplete_content: `${count} אזורים עם תוכן לא שלם. זה עלול לפגוע באמינות.`,
        web_page_underperform: `${count} עמודים עם תנועה גבוהה ללא המרות. שקול להוסיף קריאות לפעולה חזקות יותר.`,
        web_mobile_issues: `המבקרים במובייל ממירים ${pctChange}% פחות מדסקטופ. שקול לבדוק את חוויית המובייל.`,
        cash_cards_expiring: `${count} כרטיסי אשראי של לקוחות פגים בתוך 30 יום. הכנסה חוזרת בסיכון: ${formatMoney(impact, currency)}.`,
        cash_ar_aging: `חשבוניות מזדקנות מעבר ל-60 יום, מה שמקשה על הגבייה. סכום בסיכון: ${formatMoney(impact, currency)}.`,
        cash_refund_pattern: `שיעור ההחזרים שלך הוא ${value.toFixed(1)}%, מעל הסף של ${baseline.toFixed(1)}%. זה עשוי להצביע על בעיות שירות.`,
        cash_payout_blocked: `חשבון ה-Stripe שלך לא יכול לקבל העברות. זה חוסם ${formatMoney(impact, currency)} בכספים ממתינים.`,
        pricing_discount_abuse: `${value.toFixed(0)}% מהעסקאות בהנחה, מה ששוחק את הרווחיות. סך הנחות: ${formatMoney(impact, currency)}.`,
        pricing_intro_offer_stuck: `רק ${value.toFixed(0)}% מלקוחות מבצע ההיכרות עוברים למחיר מלא. הכנסה חסרה: ${formatMoney(impact, currency)}.`,
      };
      return hebrewDescriptions[detection.detectorId] || `${count} פריטים זוהו שדורשים תשומת לב. השפעה משוערת: ${formatMoney(impact, currency)}.`;
    }

    // English descriptions (default)
    const plural = count !== 1;
    const descriptions: Record<string, string> = {
      cash_ar_overdue: `You have ${count} invoice${plural ? 's' : ''} totaling ${formatMoney(value, currency)} that ${plural ? 'are' : 'is'} more than 7 days overdue.`,
      cash_payment_issues: this.getPaymentIssueDescription(issueType, detection, currency),
      ret_no_show_spike: `Your no-show rate has increased from ${baseline.toFixed(1)}% to ${value.toFixed(1)}%, which is ${pctChange}% above your normal baseline.`,
      sales_stalled: `${count} potential client${plural ? 's' : ''} ${plural ? 'have' : 'has'} been waiting 48+ hours without a response.`,
      sales_reply_slow: `Your average reply time is ${value.toFixed(1)} hours, which is ${pctChange}% slower than your baseline of ${baseline.toFixed(1)} hours.`,
      ops_utilization_low: `Your calendar is only ${value.toFixed(0)}% utilized, with approximately ${count} hours available this week.`,
      crm_cold_leads: `${count} lead${plural ? 's have' : ' has'} had no contact in 7+ days. Estimated opportunity at risk: ${formatMoney(impact, currency)}.`,
      acq_traffic_drop: `Website traffic dropped ${pctChange}% compared to last week. This could mean fewer leads coming in.`,
      acq_low_conversion: `Only ${value.toFixed(1)}% of website visitors are converting to leads, below the ${baseline.toFixed(1)}% benchmark.`,
      ret_cancellation_spike: `Cancellations increased ${pctChange}% this week (${count} cancellations). Review reasons to identify patterns.`,
      conv_pipeline_stuck: `${count} contact${plural ? 's are' : ' is'} stuck in the same pipeline stage for an average of ${avgDaysStuck} days. Estimated impact: ${formatMoney(impact, currency)}.`,
      conv_followup_overdue: `${count} follow-up task${plural ? 's are' : ' is'} overdue. Staying on top of follow-ups improves conversion rates.`,
      conv_source_underperform: `This lead source is converting at ${value.toFixed(1)}%, below your average of ${baseline.toFixed(1)}%.`,
      crm_engagement_decay: `${count} active client${plural ? 's have' : ' has'} been silent for an average of ${avgDaysSilent} days. They may be at risk of churning.`,
      ret_repeat_booking_low: `Only ${(100 - value).toFixed(0)}% of first-time clients are rebooking. Target is ${(100 - baseline).toFixed(0)}%+.`,
      ops_last_minute_cancels: `${count} booking${plural ? 's were' : ' was'} cancelled within 24 hours. Lost revenue: ${formatMoney(impact, currency)}.`,
      ops_service_performance: `${count} service${plural ? 's are' : ' is'} significantly underperforming compared to your top services.`,
      ops_peak_unutilized: `Your historically busy time slots are ${(100 - value).toFixed(0)}% empty. Potential revenue opportunity: ${formatMoney(impact, currency)}.`,
      web_missing_cta: `${count} page${plural ? 's are' : ' is'} missing a clear call-to-action. Visitors may leave without taking action.`,
      web_incomplete_content: `${count} section${plural ? 's have' : ' has'} incomplete content. This can hurt credibility with visitors.`,
      web_page_underperform: `${count} high-traffic page${plural ? 's have' : ' has'} zero conversions. Consider adding stronger CTAs.`,
      web_mobile_issues: `Mobile visitors convert ${pctChange}% less than desktop. Consider reviewing mobile experience.`,
      cash_cards_expiring: `${count} customer card${plural ? 's are' : ' is'} expiring within 30 days. Recurring revenue at risk: ${formatMoney(impact, currency)}.`,
      cash_ar_aging: `Invoices are aging past 60 days, making them harder to collect. Amount at risk: ${formatMoney(impact, currency)}.`,
      cash_refund_pattern: `Your refund rate is ${value.toFixed(1)}%, above the ${baseline.toFixed(1)}% threshold. This may signal service issues.`,
      cash_payout_blocked: `Your Stripe account cannot receive payouts. This is blocking ${formatMoney(impact, currency)} in pending funds.`,
      pricing_discount_abuse: `${value.toFixed(0)}% of transactions are discounted, eroding margins. Total discounts: ${formatMoney(impact, currency)}.`,
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

    // Hebrew recommendations
    if (language === 'he') {
      const hebrewRecommendations: Record<string, string> = {
        cash_ar_overdue: `שלח תזכורות תשלום ללקוחות עם חשבוניות בפיגור. זה יכול לעזור לגבות עד ${formatMoney(impact, currency)}.`,
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
        web_page_underperform: `הוסף ווידג'טים להזמנות או טפסי יצירת קשר לעמודים עם תנועה גבוהה אלה.`,
        web_mobile_issues: `בדוק את האתר שלך במכשירים ניידים ופשט את תהליך ההזמנה/יצירת הקשר למשתמשי מובייל.`,
        cash_cards_expiring: `שלח ללקוחות תזכורת לעדכן את אמצעי התשלום לפני שהכרטיס פג.`,
        cash_ar_aging: `הסלם את מאמצי הגבייה לחשבוניות מעל 60 יום. שקול להציע תוכניות תשלום.`,
        cash_refund_pattern: `בדוק את סיבות ההחזרים כדי לזהות בעיות שירות. שקול לפנות להבין חששות.`,
        cash_payout_blocked: `השלם את הגדרת חשבון ה-Stripe מיד כדי לשחרר העברות ולהתחיל לקבל כספים.`,
        pricing_discount_abuse: `בדוק את אסטרטגיית ההנחות שלך. שקול להגביל קודי הנחה או לקבוע סכומי הנחה מקסימליים.`,
        pricing_intro_offer_stuck: `צור רצף מעקב למשתמשי מבצע היכרות. הצע תמריץ מוגבל בזמן להמרה למחיר מלא.`,
      };
      return hebrewRecommendations[detection.detectorId] || `בדוק את התובנה הזו ונקוט בפעולה לטיפול בבעיה.`;
    }

    // English recommendations (default)
    const recommendations: Record<string, string> = {
      cash_ar_overdue: `Send payment reminders to clients with overdue invoices. This could help recover up to ${formatMoney(impact, currency)}.`,
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
      web_page_underperform: `Add booking widgets or contact forms to these high-traffic pages to capture leads.`,
      web_mobile_issues: `Test your website on mobile devices and simplify the booking/contact process for mobile users.`,
      cash_cards_expiring: `Send customers a reminder to update their payment method before their card expires.`,
      cash_ar_aging: `Escalate collection efforts for invoices over 60 days. Consider offering payment plans.`,
      cash_refund_pattern: `Review refund reasons to identify service issues. Consider reaching out to understand concerns.`,
      cash_payout_blocked: `Complete your Stripe account setup immediately to unblock payouts and start receiving funds.`,
      pricing_discount_abuse: `Review your discounting strategy. Consider limiting discount codes or setting maximum discount amounts.`,
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
    runId?: string
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
        businessContext
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
    businessContext: BusinessContext
  ): Promise<{ story: string; title: string; recommendation: string }> {
    try {
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

      const response = await provider.chatCompletion(
        {
          messages: [{ role: 'user' as const, content: prompt }],
          model: 'gpt-4o-mini',
          temperature: 0.4,
          max_tokens: 400,
        },
        {
          userId: 'system',
          feature: 'correlated-insight-generation',
          component: 'InsightRepository',
        }
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
    runId?: string
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
        language
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
    language: string
  ): Promise<{
    title: string;
    narrative: string;
    highlights: Array<{ type: 'positive' | 'negative' | 'neutral'; text: string }>;
    priorities: Array<{ rank: number; category: string; title: string; insight_id?: string }>;
  }> {
    try {
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

      const response = await provider.chatCompletion(
        {
          messages: [{ role: 'user' as const, content: prompt }],
          model: 'gpt-4o-mini',
          temperature: 0.5,
          max_tokens: 800,
        },
        {
          userId,
          feature: 'health-summary-generation',
          component: 'InsightRepository',
        }
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
    runId?: string
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

        // Total visitors. Page views are the raw record; one row per view, so
        // this counts views rather than people — the conversion vector only
        // needs enough traffic to be worth reading, not a unique-visitor figure.
        this.supabase
          .from('website_page_views')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),

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

      // Get first client date to calculate days with clients
      const { data: firstClient } = await this.supabase
        .from('crm_contacts')
        .select('created_at')
        .eq('user_id', userId)
        .eq('lifecycle_stage', 'client')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const daysWithClients = firstClient?.created_at
        ? Math.floor((Date.now() - new Date(firstClient.created_at).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Build metrics map
      const metrics: Record<string, number> = {
        positive_events: winsResult.count || 0,
        // Contacts stand in for traffic when no page views are recorded — a
        // business can be reached without a website on this platform.
        total_visitors: visitorsResult.count || contactsResult.count || 0,
        total_bookings: bookingsResult.count || 0,
        total_invoices: invoicesResult.count || 0,
        total_contacts: contactsResult.count || 0,
        days_with_clients: daysWithClients,
        days_with_bookings: daysWithBookings,
      };

      // Calculate state for each vector
      const vectors: VectorStatus[] = (Object.keys(VECTOR_THRESHOLDS) as VectorKey[]).map((key) => {
        const config = VECTOR_THRESHOLDS[key];
        const dataPoints = metrics[config.metric] || 0;
        const threshold = config.threshold;

        let state: VectorState;
        if (dataPoints >= threshold) {
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
        };
      });

      // Count lit vectors
      const litCount = vectors.filter(v => v.state === 'lit').length;

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
      'pricing_discount_abuse': { metric: 'total_transactions', needed: 20 },
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
