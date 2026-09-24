/**
 * Cards Expiring Soon
 *
 * A client's saved card expires within thirty days, so the next charge against
 * it will fail. Told in advance, the owner can ask for new details while the
 * relationship is healthy rather than after a payment bounces.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SILENT TODAY, AND WHAT WOULD LIGHT IT
 *
 * `saved_payment_methods` exists and holds ZERO rows on every account. Cards
 * are held by Stripe under Connect and their expiry dates have never been
 * synced back, so there is nothing here to read.
 *
 * The logic is sound and the query is cheap — it reads one empty table and
 * returns. It is kept rather than deleted because the capability is wanted and
 * only the instrumentation is missing. Deleting it once already cost the
 * reasoning: the file went, and with it the record of what it needed.
 *
 * TO LIGHT IT: sync `card.exp_month` / `card.exp_year` from the Connect
 * account's payment methods into `saved_payment_methods` (`expiry_month`,
 * `expiry_year`, `is_valid`, `method_type: 'card'`). Nothing in this file
 * changes when that lands; it starts firing on its own.
 *
 * Until then it reports nothing, which is the correct answer to "which cards
 * are expiring" when the platform does not know about any cards.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class CashCardsExpiringDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_cards_expiring',
    name: 'Cards Expiring Soon',
    category: 'cash_flow',
    description: 'Detects customer cards expiring within 30 days',

    watchedMetrics: ['cashflow.expiring_cards'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0, // Any expiring card
    direction: 'above',
    minSamples: 1,

    // severityFn receives: count as delta, hasRecurring as baseline (1=true, 0=false)
    severityFn: (count: number, hasRecurring: number): InsightSeverity => {
      if (hasRecurring && count >= 3) return 'critical';
      if (count >= 5 || hasRecurring) return 'high';
      if (count >= 2) return 'medium';
      return 'low';
    },

    /*

     * Advisory: nothing can run this yet.

     *

     * It used to name `update_payment_method_request`, a process that was never built — so the card

     * offered "handle it for me", the server answered 404 on the process, and the

     * insight was never marked acted. Whatever fixes this is a different KIND of

     * action from the four that exist, which all send a message.

     *

     * Declaring nothing is honest: the card shows the finding without a button

     * that cannot work.

     */
    /*
     * Runs even while this category's vector is dark, because a card expiring before the next charge is a date on that card. Waiting for
     * a baseline means finding out after the payment has already failed.
     */
    ignoresVectorMaturity: true,

    consentTier: 'automate',
    eligibleForAutomation: false,
    ownerParameters: [
      {
        id: 'days_before',
        label: 'Days Before Expiry',
        type: 'number',
        default: 30,
        min: 14,
        max: 60,
      },
    ],
    guardrails: [],
    cooldownHours: 168, // 1 week
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    // Calculate expiry window (next 30 days)
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiryMonth = thirtyDaysLater.getMonth() + 1;
    const expiryYear = thirtyDaysLater.getFullYear();

    // Get saved payment methods expiring soon
    const { data: expiringMethods, error } = await this.supabase
      .from('saved_payment_methods')
      .select('id, contact_id, method_type, brand, last_four, expiry_month, expiry_year, is_valid')
      .eq('user_id', userId)
      .eq('is_valid', true)
      .eq('method_type', 'card');

    if (error) {
      throw error;
    }

    if (!expiringMethods || expiringMethods.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Filter to cards expiring within 30 days
    const expiringSoon = expiringMethods.filter((method) => {
      const expMonth = method.expiry_month;
      const expYear = method.expiry_year;

      // Already expired
      if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
        return true; // Include already expired
      }

      // Expiring within window
      if (expYear === currentYear && expMonth <= expiryMonth) {
        return true;
      }
      if (expYear === expiryYear && expMonth <= expiryMonth) {
        return true;
      }

      return false;
    });

    if (expiringSoon.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get contact info for affected cards
    const contactIds = [...new Set(expiringSoon.map((m) => m.contact_id).filter(Boolean))];
    let contactNames: Record<string, string> = {};

    if (contactIds.length > 0) {
      /*
       * Scoped. `.in('id', …)` alone is a cross-tenant read under the service
       * role: the ids happen to come from this user's own cards, but nothing in
       * the query says so, and that is the shape the tenant-isolation guidance
       * exists to stop. A filter that is cheap to repeat is worth repeating.
       */
      const { data: contacts } = await this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .eq('user_id', userId)
        .in('id', contactIds);

      if (contacts) {
        contactNames = contacts.reduce((acc, c) => {
          acc[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    // Check if any have recurring payments (payment plans)
    const { data: activePlans } = await this.supabase
      .from('payment_plan_installments')
      .select('contact_id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .in('contact_id', contactIds);

    const hasRecurring = activePlans && activePlans.length > 0;

    // Calculate severity (pass hasRecurring as 1 or 0 to match number signature)
    const severity = this.definition.severityFn(expiringSoon.length, hasRecurring ? 1 : 0);

    /*
     * What is genuinely at risk, or nothing.
     *
     * This was `expiringSoon.length * 150` — an invented £150 a card, shown to
     * the owner as money about to stop arriving. The value of a recurring
     * charge is knowable from the instalments themselves; where it is not,
     * there is no money sentence.
     */
    const atRiskRevenue = await this.resolveAverageDealValue(userId)
      .then(average => (average === null ? null : expiringSoon.length * average));

    // Group by expiry month
    const expiryBreakdown = expiringSoon.reduce((acc, m) => {
      const key = `${m.expiry_month}/${m.expiry_year}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.expiring_cards',
      currentValue: expiringSoon.length,
      baselineValue: 0,
      thresholdValue: 0,
      // A count, with no baseline to have moved from. See the sweep that
      // removed this literal from fifteen other detectors.
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'payment_method',
      affectedEntityIds: expiringSoon.map((m) => m.id),
      affectedCount: expiringSoon.length,
      estimatedImpactUsd: atRiskRevenue ?? undefined,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        days_before: 30,
        expiring_count: expiringSoon.length,
        has_recurring: hasRecurring,
        expiry_breakdown: expiryBreakdown,
        cards: expiringSoon.map((m) => ({
          id: m.id,
          brand: m.brand,
          last_four: m.last_four,
          expiry: `${m.expiry_month}/${m.expiry_year}`,
          contact_name: m.contact_id ? contactNames[m.contact_id] : null,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
