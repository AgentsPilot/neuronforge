/**
 * Package Ending Without Renewal
 *
 * A client is on their last instalment of a package and nothing has been set up
 * to follow it. This is revenue preservation rather than CRM housekeeping: the
 * client is still active, still paying, and the moment to ask about the next
 * block is before the final session, not after the relationship has lapsed.
 *
 * A package here is a `payment_plan` — a service the owner priced as several
 * instalments — and its instalments are rows in `payment_plan_installments`.
 * "Approaching the end" is read from those rows rather than from a date: plans
 * run at whatever pace the client books, so instalments remaining is the only
 * honest measure of how close the end is.
 *
 * Renewal is inferred from a SECOND plan for the same client, which is what a
 * renewal physically is in this data model. Nothing needs to be flagged on the
 * first plan for that to work.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** Instalment states that mean this one is behind them. */
const SETTLED = new Set(['paid', 'completed', 'succeeded']);

/** Instalments left at or below which the package counts as ending. */
const ENDING_WITHIN = 1;

interface InstallmentRow {
  id: string;
  payment_plan_id: string | null;
  contact_id: string | null;
  status: string | null;
  installment_number: number | null;
  amount: number | string | null;
  currency: string | null;
  due_date: string | null;
}

interface PlanSummary {
  planId: string;
  contactId: string | null;
  total: number;
  settled: number;
  remaining: number;
  value: number;
  currency: string | null;
  lastDueDate: string | null;
}

export class RetPackageEndingDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_package_ending',
    name: 'Package Ending Without Renewal',
    category: 'retention',
    description: 'Finds clients on their final package instalment with no renewal in place',

    watchedMetrics: ['retention.clients_at_risk'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * One is enough, unlike the pattern detectors. A named client finishing a
     * package is a specific, dated, individually actionable fact — and for a
     * business with four clients on packages, waiting for three to lapse before
     * mentioning it would defeat the point.
     */
    minSamples: 1,

    severityFn: (count: number, value: number): InsightSeverity => {
      // Severity follows the money at stake, not the headcount: one ending
      // £6,000 programme outranks three ending £80 blocks.
      if (value >= 3000 || count >= 5) return 'high';
      if (value >= 500 || count >= 2) return 'medium';
      return 'low';
    },

    // Existing process — a renewal conversation is a follow-up nudge.
    pairedProcessId: 'send_followup_nudge',
    /*
     * Runs even while this category's vector is dark, because the `ret` vector needs sixty days of clients AND ten of them, which is a
     * reasonable bar for judging a RETENTION RATE and an absurd one for noticing
     * that a named client is on their final session.
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

    const { data, error } = await this.supabase
      .from('payment_plan_installments')
      .select('id, payment_plan_id, contact_id, status, installment_number, amount, currency, due_date')
      .eq('user_id', userId);

    if (error) throw error;

    const rows = (data ?? []) as InstallmentRow[];
    if (rows.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const plans = summarisePlans(rows);

    /*
     * How many plans each client has ever had. Two or more means they have
     * renewed at least once already — and, more importantly, that a later plan
     * exists to carry them past the one that is ending.
     */
    const plansPerContact = new Map<string, number>();
    for (const plan of plans) {
      if (!plan.contactId) continue;
      plansPerContact.set(plan.contactId, (plansPerContact.get(plan.contactId) ?? 0) + 1);
    }

    const ending = plans.filter(plan => {
      if (plan.total === 0) return false;
      // Not started is not ending — a brand-new plan has everything remaining.
      if (plan.settled === 0) return false;
      if (plan.remaining > ENDING_WITHIN) return false;
      // Already renewed: a second plan is the renewal.
      if (plan.contactId && (plansPerContact.get(plan.contactId) ?? 0) > 1) return false;
      return true;
    });

    if (ending.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const value = ending.reduce((sum, plan) => sum + plan.value, 0);
    const severity = this.definition.severityFn(ending.length, value);

    const contactIds = ending.map(plan => plan.contactId).filter(Boolean) as string[];
    const names = await this.namesFor(contactIds);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.clients_at_risk',
      currentValue: ending.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: contactIds,
      affectedCount: ending.length,
      // The value of the package they are finishing — what renewing is worth,
      // which is the number the owner is deciding about.
      estimatedImpactUsd: Math.round(value * 100) / 100,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        currency: ending[0].currency ?? undefined,
        contact_ids: contactIds,
        packages: ending.slice(0, 10).map(plan => ({
          plan_id: plan.planId,
          client: plan.contactId ? names[plan.contactId] ?? null : null,
          instalments_left: plan.remaining,
          package_value: plan.value,
          final_due: plan.lastDueDate,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  private async namesFor(contactIds: string[]): Promise<Record<string, string>> {
    if (contactIds.length === 0) return {};

    const { data } = await this.supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email')
      .in('id', contactIds);

    return (data ?? []).reduce((acc, row) => {
      const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      acc[row.id] = full || row.email || '';
      return acc;
    }, {} as Record<string, string>);
  }
}

/** Fold instalment rows into one row per plan. */
function summarisePlans(rows: InstallmentRow[]): PlanSummary[] {
  const byPlan = new Map<string, PlanSummary>();

  for (const row of rows) {
    if (!row.payment_plan_id) continue;

    const existing = byPlan.get(row.payment_plan_id) ?? {
      planId: row.payment_plan_id,
      contactId: row.contact_id,
      total: 0,
      settled: 0,
      remaining: 0,
      value: 0,
      currency: row.currency,
      lastDueDate: null,
    };

    existing.total += 1;
    if (SETTLED.has((row.status ?? '').toLowerCase())) existing.settled += 1;
    else existing.remaining += 1;

    existing.value += toNumber(row.amount);
    existing.contactId = existing.contactId ?? row.contact_id;

    if (row.due_date && (!existing.lastDueDate || row.due_date > existing.lastDueDate)) {
      existing.lastDueDate = row.due_date;
    }

    byPlan.set(row.payment_plan_id, existing);
  }

  return [...byPlan.values()];
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
