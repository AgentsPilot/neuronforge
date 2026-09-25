/**
 * Insight Detection Cron Job
 *
 * Runs every detector for every active user, correlates what they return,
 * prioritises it, and stores the top insights plus a health summary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DAILY, AT 03:30 — AND WHY IT IS NOT EVERY 15 MINUTES
 *
 * It was `*​/15`: 96 runs a day, 31 detectors per user per run, roughly 64
 * database queries each. At a hundred businesses that is on the order of
 * 600,000 queries a day.
 *
 * Nothing those detectors measure can change in fifteen minutes. They compare
 * this week against last week, look back thirty days, ask for ninety days and
 * ten clients. `RetCancellationSpike` is a week-over-week ratio;
 * `CrmEngagementDecay` looks back a month. Re-asking a week-over-week question
 * ninety-six times a day returns the same answer ninety-five of those times,
 * and when it does change, the repository's dedup means the same insight row
 * comes back anyway.
 *
 * 03:30 rather than any other hour: `insight-metrics` rebuilds the metrics at
 * 03:00, so detection reads numbers computed half an hour earlier rather than
 * yesterday's.
 *
 * If something genuinely needs to be noticed within minutes — a payment that
 * failed, a booking cancelled this morning — that is an EVENT, and it belongs
 * on the event rail. It is not a reason to poll every business on the platform
 * ninety-six times a day.
 *
 * The token cost was never the main charge here: `generateLocalizedContent`
 * (gpt-4o-mini) is called only when an insight is genuinely NEW, because
 * `InsightRepository` finds an existing open insight for the same detector and
 * updates it instead. The database load was the real one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Vercel Cron config: see vercel.json for schedule configuration
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { DetectorEngine } from '@/lib/business-os/insight/detectors';
import { InsightPrioritizer } from '@/lib/business-os/insight/prioritizer';
import { InsightRepository } from '@/lib/business-os/insight/repository';
import { getCorrelationEngine } from '@/lib/business-os/insight/correlation';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';

export const runtime = 'nodejs';

/**
 * The longest this run may take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * There was no `maxDuration` and no `functions` block in `vercel.json`, so this
 * ran on the platform default while doing, per business: a vector-maturity
 * lookup (~12 queries), forty detector evaluations, an N+1 cooldown check, and
 * an LLM call for every genuinely new insight plus one for the health summary.
 *
 * Serially, over every business on the platform. A kill at the default limit
 * loses every user after the cut, silently, with no cursor to resume from —
 * and the ones at the end of the list are the ones who never get insights.
 *
 * Five minutes plus a self-imposed budget below, which stops cleanly and says
 * how far it got rather than being killed mid-business.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const maxDuration = 300;

/**
 * Stop starting new businesses after this long.
 *
 * Under `maxDuration` by a wide margin, because the check happens BETWEEN
 * businesses and one business can take a while. Finishing cleanly and
 * reporting `usersRemaining` beats being killed halfway through writing
 * somebody's insights.
 */
const RUN_BUDGET_MS = 240_000;

const logger = createLogger({ module: 'InsightDetectCron' });

/**
 * What this business actually bills in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This used to be a LANGUAGE_CURRENCY_MAP — en→USD, es→EUR, he→ILS — so the
 * currency on a correlated insight was decided by the interface language.
 * An Israeli therapist pricing a US client in dollars was shown shekels, and a
 * business that switched its interface to English had its money silently
 * redenominated.
 *
 * `scheduling_services.currency` is the authority for what a client is charged
 * (CLAUDE.md § Currency & Timezone), with the most recent invoice as the
 * fallback and USD only as a last resort. The same order `ImpactProjector`
 * already uses, so the two halves of a card cannot disagree.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function getBillingCurrency(userId: string): Promise<'USD' | 'EUR' | 'ILS'> {
  const asKnown = (value: unknown): 'USD' | 'EUR' | 'ILS' | null => {
    const code = String(value ?? '').toUpperCase();
    return code === 'USD' || code === 'EUR' || code === 'ILS' ? code : null;
  };

  try {
    const { data: service } = await supabaseServer
      .from('scheduling_services')
      .select('currency')
      .eq('user_id', userId)
      .not('currency', 'is', null)
      .limit(1)
      .maybeSingle();

    const fromService = asKnown(service?.currency);
    if (fromService) return fromService;

    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select('currency')
      .eq('user_id', userId)
      .not('currency', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const fromInvoice = asKnown(invoice?.currency);
    if (fromInvoice) return fromInvoice;
  } catch {
    // Unreadable: fall through to the default rather than fail the run.
  }

  return 'USD';
}

// Helper to get user's language and currency preference
async function getUserLocale(userId: string): Promise<{ language: 'en' | 'es' | 'he'; currency: 'USD' | 'EUR' | 'ILS' }> {
  try {
    // Try user_preferences first
    const { data: prefs } = await supabaseServer
      .from('user_preferences')
      .select('preferred_language')
      .eq('user_id', userId)
      .single();

    if (prefs?.preferred_language) {
      const lang = prefs.preferred_language as 'en' | 'es' | 'he';
      return { language: lang, currency: await getBillingCurrency(userId) };
    }

    // Fallback to business_profiles
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', userId)
      .single();

    if (profile?.language) {
      const lang = profile.language as 'en' | 'es' | 'he';
      return { language: lang, currency: await getBillingCurrency(userId) };
    }
  } catch {
    // Ignore errors, return default
  }

  return { language: 'en', currency: 'USD' };
}

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without secret
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // If no secret configured, allow (but log warning)
  /*
   * Fail closed.
   *
   * This returned `true` — a missing secret meant "let everyone in" on a public
   * URL where the bearer token is the only thing separating a Vercel
   * invocation from an arbitrary caller. `payment-reminders` has always failed
   * closed, and it demonstrably sends in production, which is the proof that
   * CRON_SECRET is configured and that closing this costs nothing.
   *
   * Refusing is also the safer failure: an unrun cron means yesterday's
   * insights, and an unprotected one means a stranger can drive the engine.
   */
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

interface DetectionStats {
  usersProcessed: number;
  detectorsRun: number;
  detectionsFound: number;
  /** Open insights closed because their condition no longer holds. */
  insightsResolved: number;
  insightsCreated: number;
  correlatedInsightsCreated: number;
  healthSummariesCreated: number;
  patternsMatched: number;
  errors: number;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify authorization
  if (!verifyCronSecret(request)) {
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();

  try {
    requestLogger.info({ runId }, 'Starting insight detection cron job');

    const stats: DetectionStats = {
      usersProcessed: 0,
      detectorsRun: 0,
      detectionsFound: 0,
      insightsResolved: 0,
      insightsCreated: 0,
      correlatedInsightsCreated: 0,
      healthSummariesCreated: 0,
      patternsMatched: 0,
      errors: 0,
    };

    // Initialize services
    const detectorEngine = new DetectorEngine(supabaseServer);
    const prioritizer = new InsightPrioritizer(supabaseServer);
    const repository = new InsightRepository(supabaseServer);
    const correlationEngine = getCorrelationEngine();

    // Get all active users from multiple business tables
    // We check: payment_invoices, scheduling_bookings, crm_contacts
    const userIdSet = new Set<string>();

    // Users with invoices
    const { data: invoiceUsers } = await supabaseServer
      .from('payment_invoices')
      .select('user_id')
      .limit(500);
    invoiceUsers?.forEach((u) => u.user_id && userIdSet.add(u.user_id));

    // Users with bookings
    const { data: bookingUsers } = await supabaseServer
      .from('scheduling_bookings')
      .select('user_id')
      .limit(500);
    bookingUsers?.forEach((u) => u.user_id && userIdSet.add(u.user_id));

    // Users with CRM contacts
    const { data: crmUsers } = await supabaseServer
      .from('crm_contacts')
      .select('user_id')
      .limit(500);
    crmUsers?.forEach((u) => u.user_id && userIdSet.add(u.user_id));

    // Users with business events (if any)
    const { data: eventUsers } = await supabaseServer
      .from('business_events')
      .select('user_id')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(500);
    eventUsers?.forEach((u) => u.user_id && userIdSet.add(u.user_id));

    const userIds = [...userIdSet];

    requestLogger.info(
      { runId, userCount: userIds.length },
      'Processing users for detection'
    );

    // Process each user
    const startedAt = Date.now();
    let usersRemaining = 0;

    for (const [index, userId] of userIds.entries()) {
      /*
       * Out of budget: stop starting new businesses.
       *
       * Deliberately not a partial-business abort — a business half processed
       * has insights written and no health summary, which reads worse than one
       * not processed at all. The next run picks these up, and the count is
       * logged so a growing tail is visible rather than silent.
       */
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        usersRemaining = userIds.length - index;
        requestLogger.warn(
          { runId, usersProcessed: stats.usersProcessed, usersRemaining },
          'Detection run out of budget; remaining businesses deferred to the next run'
        );
        break;
      }

      /*
       * ───────────────────────────────────────────────────────────────────
       * ONE AI GROUP PER BUSINESS PER RUN — minted HERE, inside the loop.
       *
       * One AI action per business per run (Layer 3, FR-10, D-3): this
       * business's insight, correlated-insight and health-summary calls share
       * THIS group and become ONE entry, on the platform actor, trigger
       * `scheduled`. A throw is recorded as that business's FAILED entry and
       * rethrown unchanged to the catch below, which logs it and moves on to
       * the next business (WC-8). A business with no detections makes no call
       * and writes no entry.
       *
       * WHY IT IS MINTED INSIDE THE LOOP (F-13)
       *
       * It used to be `runId` — one value per RUN, handed to every business.
       * The group id becomes the ledger's `token_usage.session_id` AND the
       * `ai_action` audit entry's `entity_id`, so one value spanned N tenants:
       * grouping AI spend by that id alone merged several businesses' cost into
       * one action, and `audit_trail` was not unique on
       * `(entity_type, entity_id)` across tenants. `validateIdentities` does not
       * catch it — a shared-but-valid UUID passes.
       *
       * The invariant to preserve on both sides: one group id ⇔ exactly one
       * (business, AI action). Shared WITHIN one business's run; never ACROSS
       * two. Fragmenting it per call would write three entries per business
       * instead of one, which is the opposite anti-goal.
       *
       * Declared OUTSIDE the try so the catch below can name it: a business
       * that failed is the one whose group you most want to look up.
       * ───────────────────────────────────────────────────────────────────
       */
      const businessGroupId = crypto.randomUUID();

      /*
       * Load-bearing, not a convenience.
       *
       * The group id is random, so THIS LINE is the only record tying a run to
       * the groups it produced — nothing derives one from the other, and
       * nothing stores them together. Without it a run cannot be reconstructed
       * from the ledger or the audit trail at all. A deterministic id was
       * considered and rejected (SA Q-1): it would make a business's insight
       * rows derivable from an admin row, which NFR-2 does not want.
       *
       * All three ids on ONE record, so a single log line correlates them.
       */
      requestLogger.info(
        { runId, userId, businessGroupId },
        'Business AI usage group for this detection run'
      );

      try {
        /*
         * Declared out here so the sweep below can see it. `detections` itself
         * lives inside the audited action, and the sweep deliberately does not
         * — a database cleanup is not AI work and must not mark the run's LLM
         * calls as failed.
         */
        let ranDetectorIds: string[] = [];

        await runAiAction(
          { area: 'insights', actionType: 'insight_run', groupId: businessGroupId, trigger: 'scheduled', accountId: userId, correlationId },
          async () => {
            // Get user's locale preferences for localized content
            const userLocale = await getUserLocale(userId);

            // Run all detectors
            const detections = await detectorEngine.runForUser(userId);
            ranDetectorIds = detections.map(d => d.detectorId);
            // Detectors whose vector is dark are skipped, so count what ran.
            stats.detectorsRun += detectorEngine.getLastEvaluatedCount();

            if (detections.length > 0) {
              stats.detectionsFound += detections.length;

              // Set locale for this user before correlating
              correlationEngine.setLocale(userLocale);

              // Run correlation engine to find connected patterns
              const correlationSummary = correlationEngine.correlate(detections);
              stats.patternsMatched += correlationSummary.patternsMatched;

              // Map to track detector -> insight ID for linking
              const detectorToInsightId = new Map<string, string>();

              // Prioritize ALL detections (both correlated and standalone)
              const prioritized = await prioritizer.getTopInsights(userId, detections, 10);

              // Store individual insights first
              const result = await repository.createBatch(userId, prioritized, { runId, groupId: businessGroupId });

              if (result.data) {
                stats.insightsCreated += result.data.length;

                // Build detector -> insight ID mapping
                for (const insight of result.data) {
                  detectorToInsightId.set(insight.detector_id, insight.id);
                }
              }

              // If we have correlated insights, save them with health summary
              if (correlationSummary.correlatedInsights.length > 0) {
                const correlationResult = await repository.saveCorrelationResults(
                  userId,
                  correlationSummary,
                  detectorToInsightId,
                  { runId, groupId: businessGroupId }
                );

                if (correlationResult.data) {
                  stats.correlatedInsightsCreated += correlationResult.data.correlatedInsights.length;
                  if (correlationResult.data.healthSummary) {
                    stats.healthSummariesCreated++;
                  }
                }
              } else {
                // No correlations but we might still want a health summary
                const { data: allInsights } = await repository.findActive(userId, 50);
                if (allInsights && allInsights.length > 0) {
                  const healthResult = await repository.createOrUpdateHealthSummary(
                    userId,
                    correlationSummary,
                    allInsights,
                    { runId, groupId: businessGroupId }
                  );
                  if (healthResult.data) {
                    stats.healthSummariesCreated++;
                  }
                }
              }
            }

            stats.usersProcessed++;
          }
        );

        /*
         * Close what is no longer true.
         *
         * Runs for EVERY user, including those with no detections at all —
         * which is the case that matters most. A business whose last open
         * insight has just resolved produces an empty detection list, and if
         * the sweep sat inside `if (detections.length > 0)` that card would
         * stay on the dashboard for ever.
         *
         * After the insights are written, so a detector that fired again this
         * run has already refreshed its row and is not swept by its own pass.
         *
         * OUTSIDE the audited action, deliberately. `runAiAction` writes one
         * entry describing the AI work, and this is a database sweep with no
         * model call in it. Inside, a failed sweep would report the run's LLM
         * calls as FAILED when every one of them succeeded — an audit entry
         * that says the wrong thing about the thing it exists to describe.
         * The loop's own catch still counts an error here and carries on.
         */
        const resolved = await repository.resolveStaleInsights(userId, ranDetectorIds);
        if (resolved.data) stats.insightsResolved += resolved.data;

      } catch (error) {
        requestLogger.error(
          // `businessGroupId` too: this business's FAILED audit entry is keyed
          // on it, so the log and the entry can be matched up.
          { err: error, userId, runId, businessGroupId },
          'Failed to process user for detection'
        );
        stats.errors++;
      }
    }

    const duration = Date.now() - startTime;

    requestLogger.info(
      {
        runId,
        duration,
        stats,
      },
      'Insight detection cron job completed'
    );

    return NextResponse.json({
      success: true,
      data: {
        runId,
        duration,
        ...stats,
        // Non-zero when the run stopped on budget. A number that keeps growing
        // means the schedule can no longer keep up with the account count.
        usersRemaining,
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, runId, duration }, 'Insight detection cron job failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Cron job failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggering in development
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { success: false, error: 'POST only allowed in development' },
      { status: 405 }
    );
  }

  return GET(request);
}
