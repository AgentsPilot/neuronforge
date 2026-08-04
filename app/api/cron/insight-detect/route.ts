/**
 * Insight Detection Cron Job
 *
 * This endpoint is called by Vercel Cron to run all detectors and generate insights.
 * It runs every 15 minutes to:
 * 1. Run all detectors for active users
 * 2. Prioritize detection results
 * 3. Store insights for surfacing
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

const logger = createLogger({ module: 'InsightDetectCron' });

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
      errors: 0,
    };

    // Initialize services
    const detectorEngine = new DetectorEngine(supabaseServer);
    const prioritizer = new InsightPrioritizer(supabaseServer);
    const repository = new InsightRepository(supabaseServer);

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
        // Run all detectors
        const detections = await detectorEngine.runForUser(userId);
        stats.detectorsRun += detectorEngine.getDetectors().length;

        if (detections.length > 0) {
          stats.detectionsFound += detections.length;

          // Prioritize detections
          const prioritized = await prioritizer.getTopInsights(userId, detections, 5);

          // Store as insights
          const result = await repository.createBatch(userId, prioritized, runId);

          if (result.data) {
            stats.insightsCreated += result.data.length;
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
