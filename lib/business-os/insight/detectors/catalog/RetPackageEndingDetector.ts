/**
 * A Client About To Finish Their Package
 *
 * Someone is on the last instalment of a multi-part package and has nothing
 * booked to follow it. The moment to ask about the next block is before the
 * final session, while they are still coming, not after the relationship has
 * quietly ended.
 *
 * ---------------------------------------------------------------------------
 * THIS DETECTOR WAS DELETED ONCE. HERE IS WHY, AND WHAT CHANGED.
 *
 * It fired on things that were not packages ending, and the card it produced
 * ("1 Client at Final Instalment, $1,000 Impact") was wrong in three ways at
 * once on a real account. Each is now a rule rather than a comment:
 *
 *   IT FIRED ON PLANS THAT HAD FINISHED PAYING.
 *   The test was `remaining <= 1`, which includes `remaining === 0`. A client
 *   who had paid every instalment was reported as being AT their final one.
 *   That is not a package ending, it is a package ended — and the advice
 *   arrives after the moment it was for. Now: exactly one left.
 *
 *   IT COUNTED A PAYMENT SPLIT AS A PACKAGE.
 *   The $1,000 card was a quote someone chose to pay in two instalments of
 *   $500. Splitting one payment in half is not committing to a block of work,
 *   and there is no "next block" to offer. Now: at least three instalments.
 *
 *   IT CLAIMED A 100% CHANGE.
 *   `percentChange: 100` against a baseline of nothing, narrated to the owner
 *   as "a 100% increase in risk compared to your usual client retention".
 *   Now: no percentage, because nothing was measured twice.
 *
 * WHAT `payment_plans` ACTUALLY IS
 *
 * Worth stating, because the original read it as a subscription list. It is a
 * TEMPLATE table: `service_id`, `name`, `installment_count`, `is_active` — the
 * owner's pricing for a service. Three rows on this database have no
 * instalments at all, because nobody has bought them.
 *
 * A client's real commitment is the set of `payment_plan_installments` rows
 * carrying their `contact_id`. That is what this reads, and it is why every
 * count here comes from instalments rather than from the plan.
 *
 * WHAT IT ADVISES
 *
 * The product has no "renew" button, and the deleted version advised using one.
 * The advice is now something that exists: send them a proposal for the next
 * block, while they are still in front of you.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** Instalment states that mean this one is behind them. */
const SETTLED = new Set(['paid', 'completed', 'succeeded']);

/**
 * Instalments a commitment needs before it is a package.
 *
 * Three. Two is a payment split — one price, paid in halves — and there is no
 * "next block" to offer someone who simply chose to pay a quote in two goes.
 * That mistake is what put "1 Client at Final Instalment, $1,000 Impact" on a
 * dashboard about a finished $1,000 quote.
 */
const MIN_INSTALMENTS = 3;

/**
 * Unsettled instalments left when a package counts as ending.
 *
 * Exactly one, not "one or fewer". Zero means it is already over, and advice
 * about the next block arrives too late to be advice.
 */
const ENDING_AT_REMAINING = 1;

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

interface PackageSummary {
  planId: string;
  contactId: string;
  total: number;
  settled: number;
  remaining: number;
  value: number;
  currency: string | null;
  finalDue: string | null;
}

export class RetPackageEndingDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_package_ending',
    name: 'A Client About To Finish Their Package',
    category: 'retention',
    description: 'Finds clients on their last package instalment with nothing booked to follow it',

    watchedMetrics: ['retention.clients_at_risk'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    /*
     * One is enough, unlike the pattern detectors. A named client finishing a
     * package on a known date is specific and individually actionable — and for
     * a business with four clients on packages, waiting for three to lapse
     * before mentioning it would defeat the point.
     *
     * The floor that matters here is not how many clients, it is
     * `MIN_INSTALMENTS`: what counts as a package at all.
     */
    minSamples: 1,

    severityFn: (count: number, value: number): InsightSeverity => {
      // Follows the money at stake rather than the headcount: one ending
      // £6,000 programme outranks three ending £80 blocks.
      if (value >= 3000 || count >= 5) return 'high';
      if (value >= 500 || count >= 2) return 'medium';
      return 'low';
    },

    /*
     * Advisory. Asking a client to commit to another block is a conversation
     * the owner has, and the platform has no process that can have it for them.
     * The deleted version offered one, which is half of why it was deleted.
     */
    pairedProcessId: undefined,
    /*
     * A named client finishing a dated package is a fact about that client, not
     * a rate needing history behind it. The retention vector needs 60 days and
     * 10 clients before it lights, and a business with three clients on
     * packages would never hear about any of them.
     */
    ignoresVectorMaturity: true,

    consentTier: 'suggest',
    eligibleForAutomation: false,
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

    const rows = (data ?? []) as unknown as InstallmentRow[];
    if (rows.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const packages = summarisePackages(rows);

    /*
     * How many separate packages each client has had.
     *
     * Two or more means a later one exists to carry them past the one ending,
     * which is what a renewal physically is here — there is no flag for it.
     */
    const packagesPerContact = new Map<string, number>();
    for (const pkg of packages) {
      packagesPerContact.set(pkg.contactId, (packagesPerContact.get(pkg.contactId) ?? 0) + 1);
    }

    const ending = packages.filter(pkg => {
      // A payment split is not a package. See MIN_INSTALMENTS.
      if (pkg.total < MIN_INSTALMENTS) return false;
      // Not started is not ending.
      if (pkg.settled === 0) return false;
      // Exactly one left: zero is already over, two or more is not yet near.
      if (pkg.remaining !== ENDING_AT_REMAINING) return false;
      // Already has the next one booked.
      if ((packagesPerContact.get(pkg.contactId) ?? 0) > 1) return false;
      return true;
    });

    if (ending.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const value = ending.reduce((sum, pkg) => sum + pkg.value, 0);
    const severity = this.definition.severityFn(ending.length, value);

    const contactIds = ending.map(pkg => pkg.contactId);
    const names = await this.namesFor(userId, contactIds);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.clients_at_risk',
      currentValue: ending.length,
      baselineValue: 0,
      thresholdValue: 0,
      /*
       * No percentage. This counts clients; there is no previous rate it moved
       * from, and the hardcoded 100 the deleted version carried reached the
       * owner as "a 100% increase in risk compared to your usual client
       * retention" — a sentence about a base of nothing.
       */
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: contactIds,
      affectedCount: ending.length,
      /*
       * What the package they are finishing was worth — the size of the block
       * the owner would be offering again, which is the number they are
       * actually deciding about.
       */
      estimatedImpactUsd: Math.round(value * 100) / 100,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        currency: ending[0].currency ?? undefined,
        contact_ids: contactIds,
        packages: ending.slice(0, 10).map(pkg => ({
          plan_id: pkg.planId,
          client: names[pkg.contactId] ?? null,
          instalments_total: pkg.total,
          instalments_left: pkg.remaining,
          package_value: pkg.value,
          final_due: pkg.finalDue,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /** Client names, so the card can say who rather than how many. */
  private async namesFor(userId: string, contactIds: string[]): Promise<Record<string, string>> {
    if (contactIds.length === 0) return {};

    const { data } = await this.supabase
      .from('crm_contacts')
      .select('id, first_name, last_name')
      .eq('user_id', userId)
      .in('id', contactIds);

    const names: Record<string, string> = {};
    for (const row of (data ?? []) as Array<{ id: string; first_name?: string; last_name?: string }>) {
      const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      if (full) names[row.id] = full;
    }
    return names;
  }
}

/**
 * One entry per client-package, from the instalments that make it up.
 *
 * Keyed on plan AND contact: one template can be sold to several clients, and
 * each of those is a separate package with its own end. Keying on the plan
 * alone would merge them and report one ending when two clients were finishing.
 *
 * Instalments with no `contact_id` are dropped — those belong to a template
 * nobody has bought, and there is no client to advise about.
 */
function summarisePackages(rows: InstallmentRow[]): PackageSummary[] {
  const byPackage = new Map<string, PackageSummary>();

  for (const row of rows) {
    if (!row.payment_plan_id || !row.contact_id) continue;

    const key = `${row.payment_plan_id}:${row.contact_id}`;
    let summary = byPackage.get(key);

    if (!summary) {
      summary = {
        planId: row.payment_plan_id,
        contactId: row.contact_id,
        total: 0,
        settled: 0,
        remaining: 0,
        value: 0,
        currency: row.currency ?? null,
        finalDue: null,
      };
      byPackage.set(key, summary);
    }

    summary.total += 1;

    const amount = Number(row.amount ?? 0);
    if (Number.isFinite(amount)) summary.value += amount;

    if (SETTLED.has(String(row.status ?? ''))) {
      summary.settled += 1;
    } else {
      summary.remaining += 1;
      // The date the relationship runs out, where one is recorded. Plans run at
      // whatever pace the client books, so a due date is optional here.
      if (row.due_date && (!summary.finalDue || row.due_date > summary.finalDue)) {
        summary.finalDue = row.due_date;
      }
    }
  }

  return [...byPackage.values()];
}
