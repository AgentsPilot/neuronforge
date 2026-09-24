/**
 * Pricing Intro Offer Stuck Detector
 *
 * Detects when customers use intro/trial offers but don't convert to full price.
 * Signals potential upselling or offer design issues.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { COMMON_GUARDRAILS } from '../types';

export class PricingIntroOfferStuckDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'pricing_intro_offer_stuck',
    name: 'Intro Offer Not Converting',
    category: 'pricing',
    description: 'Detects low conversion from intro offers to full price',

    watchedMetrics: ['pricing.intro_conversion'],
    eventTypes: ['intro_offer.used', 'intro_offer.converted'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 30, // <30% intro-to-full conversion
    direction: 'below',
    minSamples: 5, // Need at least 5 intro offer uses

    severityFn: (conversionRate: number, volume: number): InsightSeverity => {
      if (conversionRate < 10 && volume >= 10) return 'critical';
      if (conversionRate < 20 || volume >= 15) return 'high';
      if (conversionRate < 30) return 'medium';
      return 'low';
    },

    pairedProcessId: 'send_followup_nudge',
    /*
     * Runs even while this category's vector is dark, because someone on an intro offer who has not moved to full price is a countable
     * person, while `price` gates on 42 days of bookings.
     */
    ignoresVectorMaturity: true,

    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_after_intro',
        label: 'Days After Intro to Follow Up',
        type: 'number',
        default: 7,
        min: 3,
        max: 14,
      },
      {
        id: 'offer_incentive',
        label: 'Follow-up Incentive',
        type: 'select',
        default: 'none',
        options: [
          { value: 'none', label: 'No Incentive' },
          { value: 'discount_10', label: '10% Discount' },
          { value: 'discount_15', label: '15% Discount' },
          { value: 'bonus_session', label: 'Bonus Session' },
        ],
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_1_per_contact_per_7d,
      COMMON_GUARDRAILS.max_20_per_run,
    ],
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

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get bookings (intro detection done via service name pattern, not metadata)
    const { data: allBookings, error: bookingsError } = await this.supabase
      .from('scheduling_bookings')
      .select('id, contact_id, service_id, payment_amount, created_at, status')
      .eq('user_id', userId)
      .gte('created_at', ninetyDaysAgo.toISOString())
      .in('status', ['confirmed', 'completed']);

    if (bookingsError) {
      throw bookingsError;
    }

    if (!allBookings || allBookings.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get services to identify intro-priced ones
    // Note: intro_price and is_intro_offer may be stored in metadata since not all schemas have these columns
    const { data: services } = await this.supabase
      .from('scheduling_services')
      .select('id, service_name, price, currency')
      .eq('user_id', userId);

    // Build map of intro services and their full-price equivalents
    // Detect intro services by name patterns (e.g., "intro", "trial", "first session")
    const introServices = new Set<string>();
    const serviceInfo: Record<string, { name: string; introPrice: number; fullPrice: number }> = {};

    services?.forEach((service) => {
      const serviceName = service.service_name?.toLowerCase() || '';
      const isIntroByName = serviceName.includes('intro') ||
                           serviceName.includes('trial') ||
                           serviceName.includes('first session') ||
                           serviceName.includes('discovery');
      if (isIntroByName) {
        introServices.add(service.id);
        serviceInfo[service.id] = {
          name: service.service_name,
          introPrice: parseFloat(service.price || '0'),
          fullPrice: parseFloat(service.price || '0'),
        };
      }
    });

    // Also check booking metadata for intro indicators
    const introBookings: Array<{
      email: string;
      date: string;
      serviceId: string;
      price: number;
    }> = [];

    const clientBookingHistory: Record<string, Array<{ date: string; price: number; isIntro: boolean }>> = {};

    allBookings.forEach((booking) => {
      // The contact, not an email string. `client_email` was dropped —
      // crm_contacts is the single source of truth — and `contact_id` is the
      // better key regardless: one person with two spellings of their address
      // used to count as two clients.
      const email = booking.contact_id;
      if (!email) return;

      if (!clientBookingHistory[email]) {
        clientBookingHistory[email] = [];
      }

      // Detect intro by service name pattern (no metadata column in scheduling_bookings)
      const isIntro = introServices.has(booking.service_id);

      const price = parseFloat(booking.payment_amount || '0');

      clientBookingHistory[email].push({
        date: booking.created_at,
        price,
        isIntro,
      });

      if (isIntro) {
        introBookings.push({
          email,
          date: booking.created_at,
          serviceId: booking.service_id,
          price,
        });
      }
    });

    // Filter to intro bookings from 30-90 days ago (enough time to convert)
    const eligibleIntroBookings = introBookings.filter((b) => {
      const bookingDate = new Date(b.date);
      return bookingDate >= ninetyDaysAgo && bookingDate < thirtyDaysAgo;
    });

    if (eligibleIntroBookings.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Check who converted (booked again at full price after intro)
    const convertedEmails = new Set<string>();
    const stuckEmails = new Set<string>();

    eligibleIntroBookings.forEach((intro) => {
      const history = clientBookingHistory[intro.email] || [];
      const introDate = new Date(intro.date);

      // Look for full-price booking after intro
      const hasFullPriceBooking = history.some((b) => {
        const bookingDate = new Date(b.date);
        return bookingDate > introDate && !b.isIntro && b.price > intro.price * 1.5;
      });

      if (hasFullPriceBooking) {
        convertedEmails.add(intro.email);
      } else {
        stuckEmails.add(intro.email);
      }
    });

    // Calculate conversion rate
    const totalIntroUsers = new Set(eligibleIntroBookings.map((b) => b.email)).size;
    const convertedUsers = convertedEmails.size;
    const conversionRate = (convertedUsers / totalIntroUsers) * 100;

    // Check threshold
    if (conversionRate >= this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const stuckCount = stuckEmails.size;
    const severity = this.definition.severityFn(conversionRate, stuckCount);

    /*
     * Calculate missed revenue — WITHIN ONE CURRENCY.
     *
     * This averaged every service's price together regardless of what each was
     * denominated in. A business pricing US clients in dollars from Israel
     * (the case per-service currency exists for) had 300 ILS and 300 USD
     * averaged to 300 of nothing, and `missedRevenue` — which reaches the owner
     * as a figure — was a quantity in no unit. There is no FX rate anywhere in
     * the platform to make that average mean something.
     *
     * So the comparison runs over the DOMINANT currency: the one the most
     * priced services are in. Anything else is excluded rather than converted,
     * and `currency` is reported so the number can be labelled correctly
     * instead of taking a symbol from the reader's language.
     */
    const priced = (services ?? []).filter((s) => parseFloat(s.price || '0') > 0);
    const currencyCounts = new Map<string, number>();
    for (const s of priced) {
      const code = (s.currency || 'ILS').toUpperCase();
      currencyCounts.set(code, (currencyCounts.get(code) ?? 0) + 1);
    }
    const dominantCurrency =
      [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const comparable = priced.filter(
      (s) => (s.currency || 'ILS').toUpperCase() === dominantCurrency
    );

    const avgFullPrice = comparable.length
      ? comparable.reduce((sum, s) => sum + parseFloat(s.price || '0'), 0) / comparable.length
      : 100;

    // The intro bookings are already scoped to services this detector matched;
    // restrict them to the same currency so the two halves of the subtraction
    // are in the same unit.
    const comparableIds = new Set(comparable.map((s) => s.id));
    const comparableIntro = eligibleIntroBookings.filter((b) => comparableIds.has(b.serviceId));
    const introSample = comparableIntro.length ? comparableIntro : eligibleIntroBookings;

    const avgIntroPrice =
      introSample.reduce((sum, b) => sum + b.price, 0) / introSample.length;
    const priceDiff = avgFullPrice - avgIntroPrice;
    /*
     * One upgrade each, not two.
     *
     * This multiplied by a literal 2 — "Assume 2 future bookings missed" — so
     * every figure shown to the owner was double a number that was itself an
     * assumption. What is actually knowable is the gap between the intro price
     * and the full price, once per client who has not moved on. That is the
     * claim the data supports; anything beyond it is a forecast.
     */
    const missedRevenue = stuckCount * priceDiff;

    // Get contact details for stuck users
    const { data: contacts } = await this.supabase
      .from('crm_contacts')
      .select('id, email, first_name, last_name')
      .eq('user_id', userId)
      .in('email', [...stuckEmails].slice(0, 50));

    const stuckContacts = contacts?.map((c) => ({
      id: c.id,
      email: c.email,
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email,
    })) || [];

    const result = this.createDetectionResult({
      severity,
      metricKey: 'pricing.intro_conversion',
      currentValue: Math.round(conversionRate),
      baselineValue: this.definition.threshold,
      thresholdValue: this.definition.threshold,
      percentChange: -Math.round(((this.definition.threshold - conversionRate) / this.definition.threshold) * 100),
      direction: 'below',
      affectedEntityType: 'contact',
      affectedEntityIds: stuckContacts.map((c) => c.id),
      affectedCount: stuckCount,
      estimatedImpactUsd: Math.round(missedRevenue),
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        days_after_intro: 7,
        offer_incentive: 'none',
        total_intro_users: totalIntroUsers,
        converted_users: convertedUsers,
        stuck_users: stuckCount,
        conversion_rate: Math.round(conversionRate * 10) / 10,
        target_rate: this.definition.threshold,
        avg_intro_price: Math.round(avgIntroPrice),
        avg_full_price: Math.round(avgFullPrice),
        // What the three money figures above are denominated in. Without it a
        // reader takes the symbol from the UI language, so a dollar-billing
        // business working in Hebrew reads every one of them as shekels.
        currency: dominantCurrency,
        stuck_contacts: stuckContacts.slice(0, 10),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
