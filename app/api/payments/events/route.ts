/**
 * Payment Events API
 *
 * Query payment events for AI analysis and user dashboards.
 *
 * GET /api/payments/events - List events with filtering
 *
 * This endpoint is designed for:
 * 1. AI automation kernel - to analyze payment patterns
 * 2. User dashboards - to show payment activity
 * 3. Debugging - to trace event flows
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { PaymentEventService } from '@/lib/services/PaymentEventService';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'PaymentEventsAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get('event_type') || undefined;
    const entityType = searchParams.get('entity_type') || undefined;
    const entityId = searchParams.get('entity_id') || undefined;
    const contactId = searchParams.get('contact_id') || undefined;
    const processorType = searchParams.get('processor_type') || undefined;
    const fromDate = searchParams.get('from') || undefined;
    const toDate = searchParams.get('to') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const includeCounts = searchParams.get('include_counts') === 'true';

    requestLogger.info({
      userId: user.id,
      eventType,
      entityType,
      contactId,
      limit,
      offset
    }, 'Fetching payment events');

    const eventService = new PaymentEventService(supabaseServer);

    // Get events
    const eventsResult = await eventService.getEvents(user.id, {
      eventType: eventType as Parameters<typeof eventService.getEvents>[1]['eventType'],
      entityType: entityType as Parameters<typeof eventService.getEvents>[1]['entityType'],
      entityId,
      contactId,
      processorType: processorType as Parameters<typeof eventService.getEvents>[1]['processorType'],
      fromDate,
      toDate,
      limit,
      offset
    });

    if (eventsResult.error) {
      throw eventsResult.error;
    }

    // Get event counts if requested
    let counts = undefined;
    if (includeCounts) {
      const countsResult = await eventService.getEventCounts(user.id, {
        fromDate,
        toDate
      });
      if (countsResult.data) {
        counts = countsResult.data;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        events: eventsResult.data,
        total: eventsResult.data?.length || 0,
        limit,
        offset,
        ...(counts ? { counts } : {})
      }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch payment events');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch payment events',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}
