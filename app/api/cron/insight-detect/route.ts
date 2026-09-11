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

const logger = createLogger({ module: 'InsightDetectCron' });

// Language to currency mapping
const LANGUAGE_CURRENCY_MAP: Record<string, string> = {
  en: 'USD',
  es: 'EUR',
  he: 'ILS',
};

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
      return {
        language: lang,
        currency: (LANGUAGE_CURRENCY_MAP[lang] || 'USD') as 'USD' | 'EUR' | 'ILS',
      };
    }

    // Fallback to business_profiles
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', userId)
      .single();

    if (profile?.language) {
      const lang = profile.language as 'en' | 'es' | 'he';
      return {
        language: lang,
        currency: (LANGUAGE_CURRENCY_MAP[lang] || 'USD') as 'USD' | 'EUR' | 'ILS',
      };
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
  if (!cronSecret) {
    logger.warn('CRON_SECRET not configured - cron endpoint is unprotected');
    return true;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

interface DetectionStats {
  usersProcessed: number;
  detectorsRun: number;
  detectionsFound: number;
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
    for (const userId of userIds) {
      try {
        // Get user's locale preferences for localized content
        const userLocale = await getUserLocale(userId);

        // Run all detectors
        const detections = await detectorEngine.runForUser(userId);
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
          const result = await repository.createBatch(userId, prioritized, runId);

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
              runId
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
                runId
              );
              if (healthResult.data) {
                stats.healthSummariesCreated++;
              }
            }
          }
        }

        stats.usersProcessed++;

      } catch (error) {
        requestLogger.error(
          { err: error, userId, runId },
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
