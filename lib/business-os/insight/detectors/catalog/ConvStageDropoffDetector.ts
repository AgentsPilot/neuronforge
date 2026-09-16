/**
 * Where People Stop Moving
 *
 * The brief calls this the most important insight in the set, and it is the one
 * that needs history rather than a snapshot: "18 completed consultations this
 * month, 7 bought a package, 11 stopped after the consultation" cannot be
 * answered by looking at where people are NOW. It needs to know where they were
 * and whether they moved.
 *
 * That history was assumed to be missing — the event rail it would naturally
 * live on has barely been written to. It turns out the CRM has been recording
 * it all along: every stage change writes a `stage_changed` activity whose
 * `description` is JSON carrying the stage moved FROM and the stage moved TO,
 * with a date. This detector reads that.
 *
 * What it reports is a cohort, not a standing count. `ConvPipelineStuckDetector`
 * already says "these people are sitting in a stage"; this says "of everyone who
 * reached this stage, THIS fraction never went further" — which is the number
 * that identifies a broken step rather than a slow week.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import { createLogger } from '@/lib/logger';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import {
  computeStageFlow,
  parseStageMove,
  type StageMove,
  type StageRank,
} from '../../stageFlow';

const logger = createLogger({ module: 'ConvStageDropoffDetector' });

/** How far back a cohort is gathered from. */
const WINDOW_DAYS = 60;

/**
 * Long enough that not having moved means something.
 *
 * Without it the newest arrivals — people who reached the stage yesterday and
 * are behaving perfectly normally — would be counted as having stopped, and the
 * stage nearest the top of the funnel would always look like the worst leak.
 */
const SETTLE_DAYS = 7;

/** Below this the fraction is arithmetic, not evidence. */
const MIN_COHORT = 5;

/** Report only when this much of the cohort went nowhere. */
const LEAK_RATE = 0.5;

/**
 * Stages where stopping is the correct outcome.
 *
 * Read by TYPE, never by key: stage keys are invented per business by
 * onboarding — `family_enrolled`, `retained` — and cannot be listed. Someone who
 * reached "past client" and stayed there has completed the journey, and
 * reporting them as a drop-off would make every finished customer a problem.
 */
const TERMINAL_TYPES = new Set(['past_client', 'lost', 'archived', 'client']);

export class ConvStageDropoffDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_stage_dropoff',
    name: 'Where People Stop Moving',
    category: 'conversion',
    description: 'Finds the stage people reach and never move past',

    watchedMetrics: ['conversion.stage_progression_rate'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'percent_change',
    threshold: LEAK_RATE * 100,
    direction: 'above',
    minSamples: MIN_COHORT,

    severityFn: (stuckRate: number, stuckCount: number): InsightSeverity => {
      if (stuckRate >= 80 && stuckCount >= 10) return 'high';
      if (stuckRate >= 70 || stuckCount >= 10) return 'medium';
      return 'low';
    },

    pairedProcessId: 'send_followup_nudge',
    /*
     * Runs even while this category's vector is dark, because the cohort is its own baseline: this compares people who reached a stage
     * against each other, not this month against last, so it needs no history
     * beyond the window it already requires.
     */
    ignoresVectorMaturity: true,

    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 168,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = Date.now();
    const windowStart = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();

    const [activityResult, stagesResult] = await Promise.all([
      this.supabase
        .from('crm_activities')
        .select('contact_id, description, activity_date')
        .eq('user_id', userId)
        .eq('activity_type', 'stage_changed')
        .gte('activity_date', windowStart)
        .order('activity_date', { ascending: true })
        .limit(2000),

      this.supabase
        .from('crm_pipeline_stages')
        // `position` decides what counts as FORWARD — without it, being marked
        // lost would read as having moved on.
        .select('stage_key, stage_label, stage_type, position')
        .eq('user_id', userId),
    ]);

    if (activityResult.error) throw activityResult.error;
    if (stagesResult.error) throw stagesResult.error;

    const moves = (activityResult.data ?? [])
      .map(row => parseStageMove(row as { contact_id?: unknown; description?: unknown; activity_date?: unknown }))
      .filter((move): move is StageMove => move !== null);

    if (moves.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const stageMeta = new Map(
      (stagesResult.data ?? []).map(row => [
        String(row.stage_key),
        { label: String(row.stage_label ?? row.stage_key), type: String(row.stage_type ?? '') },
      ])
    );

    /*
     * The cohort maths the funnel map draws its connectors from.
     *
     * Shared rather than repeated: this detector and the map answer the same
     * question about the same funnel, and two implementations of it would
     * eventually disagree — the card naming a stage the diagram had drawn
     * green. `computeStageFlow` also knows things this copy did not, notably
     * that moving to a lost stage is not progress.
     */
    const ranks: StageRank[] = (stagesResult.data ?? []).map(row => ({
      stageKey: String(row.stage_key),
      position: Number(row.position ?? 0),
      type: row.stage_type as string | null,
    }));

    const flows = computeStageFlow(moves, {
      now,
      settleDays: SETTLE_DAYS,
      windowDays: WINDOW_DAYS,
      ranks,
    });

    let worst: {
      stage: string;
      label: string;
      cohort: number;
      stuck: string[];
      rate: number;
    } | null = null;

    for (const flow of flows) {
      const meta = stageMeta.get(flow.stageKey);
      if (meta && TERMINAL_TYPES.has(meta.type)) continue;
      if (flow.arrived < MIN_COHORT) continue;

      const rate = flow.stuck / flow.arrived;
      if (rate < LEAK_RATE) continue;

      if (!worst || flow.stuck > worst.stuck.length) {
        worst = {
          stage: flow.stageKey,
          label: meta?.label ?? flow.stageKey,
          cohort: flow.arrived,
          stuck: flow.stuckIds,
          rate,
        };
      }
    }

    if (!worst) {
      this.logDetection(userId, null);
      return null;
    }

    const stuckRate = Math.round(worst.rate * 100);
    const severity = this.definition.severityFn(stuckRate, worst.stuck.length);
    const estimatedImpact = await this.opportunityValue(userId, worst.stuck.length);

    logger.info(
      { userId, stage: worst.stage, cohort: worst.cohort, stuck: worst.stuck.length },
      'Stage drop-off detected'
    );

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.stage_progression_rate',
      // The rate that was breached, so the card can state it.
      currentValue: stuckRate,
      baselineValue: Math.round(LEAK_RATE * 100),
      thresholdValue: Math.round(LEAK_RATE * 100),
      percentChange: stuckRate - Math.round(LEAK_RATE * 100),
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: worst.stuck,
      affectedCount: worst.stuck.length,
      estimatedImpactUsd: estimatedImpact,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        stage_key: worst.stage,
        stage_label: worst.label,
        cohort_size: worst.cohort,
        stuck_count: worst.stuck.length,
        stuck_rate_percent: stuckRate,
        window_days: WINDOW_DAYS,
        contact_ids: worst.stuck.slice(0, 20),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /** Priced from this business's own services — see ConvNoNextStepDetector. */
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

    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    return Math.round(count * average * 0.2 * 100) / 100;
  }
}
