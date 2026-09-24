/**
 * Customer With No Next Step
 *
 * Something happened with this person, and nothing is scheduled to happen next.
 * No future booking, no open task, no movement — they are not stuck at a stage
 * anyone is watching, they have simply stopped having a future.
 *
 * This is the safety net, and it is deliberately the broadest detector in the
 * catalogue. Every other detector encodes a specific failure someone thought of
 * in advance: a lead going cold, an invoice aging, a package ending. This one
 * asks the question those all share — is anything going to happen to this
 * person? — so it catches the cases nobody enumerated.
 *
 * Because it is broad it is also the easiest to make annoying, so three things
 * are excluded rather than reported:
 *
 *  - People who have gone quiet for good. A past client or a lost lead has no
 *    next step BY DESIGN; reporting them would make the card a list of everyone
 *    the business has ever finished with.
 *  - People nothing has ever happened to. Without a first event there is no
 *    "next" to be missing — that is an empty CRM, not a dropped thread.
 *  - The first few days. A person who enquired this morning does not need a
 *    scheduled next step yet, and saying so would fire on every new lead.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/**
 * Stage types that are SUPPOSED to have no next step.
 *
 * Read from `crm_pipeline_stages.stage_type` rather than the stage key, because
 * stage keys are invented per account by onboarding and cannot be enumerated —
 * the type is always one of a handful and is what carries the meaning.
 */
const TERMINAL_STAGE_TYPES = new Set(['past_client', 'lost', 'archived']);

/** Below this, a person is too new to be missing a next step. */
const GRACE_DAYS = 3;

/** How far back something must have happened for the thread to count as live. */
const LOOKBACK_DAYS = 45;

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  stage: string | null;
  created_at: string | null;
}

export class ConvNoNextStepDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_no_next_step',
    name: 'No Next Step',
    category: 'conversion',
    description: 'Finds people who had activity but have nothing scheduled to happen next',

    watchedMetrics: ['conversion.pipeline_velocity'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * Three, not one. This is a pattern detector, not an alert: one person
     * between steps is ordinary business, several at once is a process leak —
     * and the recommendation ("these may fall through the cracks") only makes
     * sense about a group.
     */
    minSamples: 3,

    /*
     * The base signature is (delta, baseline); only the count carries meaning
     * here, so the second is named and ignored rather than dropped — the
     * interface is shared and a one-argument function does not satisfy it.
     */
    severityFn: (count: number, _baseline: number): InsightSeverity => {
      if (count >= 15) return 'high';
      if (count >= 8) return 'medium';
      return 'low';
    },

    // Existing process — this is exactly the nudge it was built for.
    pairedProcessId: 'send_followup_nudge',
    /*
     * Runs even while this category's vector is dark, because a person with nothing scheduled next is in that state regardless of how
     * much traffic the website has ever had, and the `conv` vector gates on
     * visitors — which would silence this for every business without a website.
     */
    ignoresVectorMaturity: true,

    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 72,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = new Date();
    const lookback = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const graceCutoff = new Date(now.getTime() - GRACE_DAYS * 86_400_000).toISOString();

    const [contactsResult, stagesResult, activityResult, bookingsResult, tasksResult] =
      await Promise.all([
        this.supabase
          .from('crm_contacts')
          .select('id, first_name, last_name, email, stage, created_at')
          .eq('user_id', userId)
          .lt('created_at', graceCutoff),

        this.supabase
          .from('crm_pipeline_stages')
          .select('stage_key, stage_type')
          .eq('user_id', userId),

        // Anything at all having happened, recently.
        this.supabase
          .from('crm_activities')
          .select('contact_id, activity_date')
          .eq('user_id', userId)
          .gte('activity_date', lookback),

        // A future they already have.
        this.supabase
          .from('scheduling_bookings')
          .select('contact_id')
          .eq('user_id', userId)
          .neq('status', 'cancelled')
          .gte('start_time', now.toISOString()),

        // A future the owner has written down.
        this.supabase
          .from('crm_tasks')
          .select('contact_id')
          .eq('user_id', userId)
          .neq('status', 'completed')
          .neq('status', 'cancelled'),
      ]);

    if (contactsResult.error) throw contactsResult.error;

    /*
     * Each supporting read degrades on its own. A failure in any of them would
     * otherwise make its exclusion silently empty — and an empty exclusion here
     * does not under-report, it OVER-reports: everyone with a booking would be
     * listed as having no next step. Bailing out is the safe direction.
     */
    for (const [source, error] of [
      ['crm_pipeline_stages', stagesResult.error],
      ['crm_activities', activityResult.error],
      ['scheduling_bookings', bookingsResult.error],
      ['crm_tasks', tasksResult.error],
    ] as const) {
      if (error) {
        throw new Error(`no_next_step: ${source} unreadable — ${error.message}`);
      }
    }

    const terminalStages = new Set(
      (stagesResult.data ?? [])
        .filter(row => TERMINAL_STAGE_TYPES.has(String(row.stage_type)))
        .map(row => String(row.stage_key))
    );

    const hadActivity = new Set(
      (activityResult.data ?? []).map(row => String(row.contact_id)).filter(Boolean)
    );
    const hasFuture = new Set(
      (bookingsResult.data ?? []).map(row => String(row.contact_id)).filter(Boolean)
    );
    const hasOpenTask = new Set(
      (tasksResult.data ?? []).map(row => String(row.contact_id)).filter(Boolean)
    );

    const contacts = (contactsResult.data ?? []) as ContactRow[];

    const stranded = contacts.filter(contact => {
      if (contact.stage && terminalStages.has(contact.stage)) return false;
      if (hasFuture.has(contact.id) || hasOpenTask.has(contact.id)) return false;

      // Something has to have happened. A contact created inside the lookback
      // counts as its own first event — being added IS the thing that happened.
      const createdRecently = contact.created_at ? contact.created_at >= lookback : false;
      return hadActivity.has(contact.id) || createdRecently;
    });

    if (stranded.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    const severity = this.definition.severityFn(stranded.length, 0);
    const estimatedImpact = await this.opportunityValue(userId, stranded.length);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.pipeline_velocity',
      currentValue: stranded.length,
      baselineValue: 0,
      thresholdValue: this.definition.minSamples,
      /*
       * Nothing changed by a hundred per cent.
       *
       * This detector counts: there is no baseline to have moved from, and a
       * hardcoded 100 reached the narrator as a real measurement. It produced
       * sentences like "a 100% increase in risk compared to your usual client
       * retention" and "a 100% increase in your expected cash flow" — arithmetic
       * presented as a trend, about a base of zero.
       *
       * `hasRealBaseline` now keeps the figure out of the prompt, but that guard
       * reads `baselineValue`, so it is the second line of defence. This is the
       * first: a count reports no change, because none was measured.
       */
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: stranded.map(c => c.id),
      affectedCount: stranded.length,
      estimatedImpactUsd: estimatedImpact,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        contact_ids: stranded.map(c => c.id),
        contacts: stranded.slice(0, 10).map(c => ({
          id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email,
          stage: c.stage,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /**
   * What this many stranded people are plausibly worth.
   *
   * Priced from THIS business's own services rather than a constant. Several
   * detectors in this catalogue hardcode a $300 deal value, which is wrong for
   * a £40 barber and wronger for a £6,000 programme, and the figure is shown to
   * the owner as money. A conservative conversion fraction is applied because
   * these are people who might be recovered, not orders already placed.
   */
  private async opportunityValue(userId: string, count: number): Promise<number | undefined> {
    const { data, error } = await this.supabase
      .from('scheduling_services')
      .select('price')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error || !data?.length) return undefined;

    const prices = data
      .map(row => (typeof row.price === 'number' ? row.price : parseFloat(String(row.price))))
      .filter(price => Number.isFinite(price) && price > 0);

    if (prices.length === 0) return undefined;

    /*
     * The share that actually converts, measured — not a literal 0.2.
     *
     * This multiplied by an invented 20% and showed the product to the owner as
     * money they could recover. `resolveLeadConversionRate` answers it from
     * this business's own contacts, and answers null when there is not enough
     * history to say — in which case there is no figure at all.
     */
    const conversionRate = await this.resolveLeadConversionRate(userId);
    if (conversionRate === null) return undefined;

    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    return Math.round(count * average * conversionRate * 100) / 100;
  }
}
