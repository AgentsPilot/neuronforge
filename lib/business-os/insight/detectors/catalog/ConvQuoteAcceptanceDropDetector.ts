/**
 * Quotes Being Accepted Less Often
 *
 * Of the quotes that got an answer in the last three months, the share answered
 * yes, against the same share for the three months before.
 *
 * For a business that sells by quote this is the conversion rate that decides
 * everything, and nothing else measures it. The `conv_*` detectors all watch
 * pipeline STAGES, which is a different question: a contact can move through
 * every stage and still say no at the price.
 *
 * WHAT COUNTS AS A DECISION, and why the denominator is not "quotes sent":
 *
 *  - `accepted` and `declined` are answers. They are the rate.
 *  - `sent` and `viewed` are quotes still in play. Counting them as failures
 *    would make every busy month look like a collapse, because the newest
 *    quotes have had the least time to come back. It would also mean the rate
 *    could only ever fall as volume rose.
 *  - `expired` IS counted as a decision, and against. A quote that ran out is a
 *    no that nobody said out loud, and excluding it would let a business whose
 *    quotes all quietly lapse show a perfect acceptance rate.
 *  - `withdrawn` and `superseded` are excluded entirely. The owner pulled or
 *    replaced those; the client never rejected anything. A superseded quote is
 *    usually a re-quote of the same job, and counting it against the business
 *    would penalise the act of negotiating.
 *  - `draft` never reached anyone.
 *
 * THE FLOOR IS ON DECISIONS, not on days or on quotes sent. A business that
 * sends two quotes a quarter has no rate, however long it has been trading, and
 * telling it that acceptance "halved" because one of two clients said no would
 * be arithmetic dressed as insight.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** The window, and the one it is compared against. */
const WINDOW_DAYS = 90;

/** Answers that count towards the rate. Order matters to nothing; membership does. */
const ACCEPTED = 'accepted';
const DECIDED = new Set(['accepted', 'declined', 'expired']);

/**
 * Decisions needed in the EARLIER window before a comparison means anything.
 *
 * Five. With three, one client changing their mind moves the rate by a third,
 * and a detector that reports a third of a business as a trend will be right
 * occasionally and noisy constantly.
 */
const MIN_BASELINE_DECISIONS = 5;

/** How far the rate must fall, in percentage POINTS, before it is worth saying. */
const DROP_THRESHOLD_POINTS = 20;

interface ProposalRow {
  id: string;
  status: string | null;
  total: number | string | null;
  currency: string | null;
  decided_at: string | null;
}

interface Period {
  decided: number;
  accepted: number;
  /** What the declined and expired quotes in this window were worth. */
  lostValue: number;
  currency?: string;
}

export class ConvQuoteAcceptanceDropDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_quote_acceptance_drop',
    name: 'Quotes Being Accepted Less Often',
    category: 'conversion',
    description: 'Finds the share of answered quotes that were accepted falling against the previous period',

    watchedMetrics: ['conversion.quote_acceptance_rate'],
    eventTypes: [],

    baselineWindow: '90days',
    thresholdType: 'percent_change',
    threshold: DROP_THRESHOLD_POINTS,
    direction: 'below',
    minSamples: MIN_BASELINE_DECISIONS,

    severityFn: (dropPoints: number, lostValue: number): InsightSeverity => {
      if (dropPoints >= 40 || lostValue >= 10_000) return 'high';
      if (dropPoints >= 30 || lostValue >= 3000) return 'medium';
      return 'low';
    },

    /*
     * No automation.
     *
     * A quote is declined over price, scope or timing, and none of those is
     * fixed by sending the client another email. `send_followup_nudge` would be
     * the wrong answer loudly: chasing someone who has already said no.
     */
    pairedProcessId: undefined,

    // A rate over two quarters. Needs history to be a rate at all.
    ignoresVectorMaturity: false,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 336,
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
    const recentFrom = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
    const baselineFrom = new Date(now - 2 * WINDOW_DAYS * 86_400_000).toISOString();

    /*
     * Dated by `decided_at`, not `sent_at`.
     *
     * The question is how the business is doing at CLOSING work, so a quote
     * belongs to the period it was answered in. Dating by when it was sent puts
     * a slow January decision into December and leaves the newest window
     * permanently short of its own answers.
     */
    const { data, error } = await this.supabase
      .from('proposals')
      .select('id, status, total, currency, decided_at')
      .eq('user_id', userId)
      .in('status', [...DECIDED])
      .gte('decided_at', baselineFrom);

    if (error) throw error;

    const rows = (data ?? []) as unknown as ProposalRow[];

    const recent = summarise(rows.filter(r => (r.decided_at ?? '') >= recentFrom));
    const baseline = summarise(
      rows.filter(r => (r.decided_at ?? '') < recentFrom && (r.decided_at ?? '') >= baselineFrom)
    );

    if (baseline.decided < MIN_BASELINE_DECISIONS) {
      this.logDetection(userId, null);
      return null;
    }

    // A window with no answers at all is not a fall in the rate — it is a fall
    // in volume, which is a different finding and not this one's to report.
    if (recent.decided === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const recentRate = Math.round((recent.accepted / recent.decided) * 100);
    const baselineRate = Math.round((baseline.accepted / baseline.decided) * 100);
    const dropPoints = baselineRate - recentRate;

    if (dropPoints < DROP_THRESHOLD_POINTS) {
      this.logDetection(userId, null);
      return null;
    }

    const severity = this.definition.severityFn(dropPoints, recent.lostValue);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.quote_acceptance_rate',
      currentValue: recentRate,
      baselineValue: baselineRate,
      thresholdValue: DROP_THRESHOLD_POINTS,
      percentChange: -dropPoints,
      direction: 'below',
      affectedEntityType: 'proposal',
      affectedEntityIds: [],
      affectedCount: recent.decided - recent.accepted,
      /*
       * What the quotes that did not land were worth, in this window only.
       *
       * Not a projection of the rate difference applied to anything: that would
       * be a modelled number presented beside measured ones, which is how a
       * fabricated 30% ended up on the autonomous work feed.
       */
      estimatedImpactUsd: Math.round(recent.lostValue * 100) / 100,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        drop_points: dropPoints,
        rate_recent: recentRate,
        rate_baseline: baselineRate,
        decided_recent: recent.decided,
        decided_baseline: baseline.decided,
        accepted_recent: recent.accepted,
        accepted_baseline: baseline.accepted,
        currency: recent.currency ?? baseline.currency,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}

function summarise(rows: ProposalRow[]): Period {
  let decided = 0;
  let accepted = 0;
  let lostValue = 0;
  let currency: string | undefined;

  for (const row of rows) {
    const status = (row.status ?? '').toLowerCase();
    if (!DECIDED.has(status)) continue;

    decided += 1;
    currency = currency ?? row.currency ?? undefined;

    if (status === ACCEPTED) accepted += 1;
    else lostValue += toNumber(row.total);
  }

  return { decided, accepted, lostValue, currency };
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
