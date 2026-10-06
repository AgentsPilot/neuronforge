/**
 * POST /api/scheduling/services
 * GET /api/scheduling/services
 * Scheduling services endpoints - create and list services
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { z } from 'zod';
import { createServiceSchema } from '@/lib/validation/schedulingService';
import { soldServiceIds } from '@/lib/scheduling/soldServices';
import { supabaseServer } from '@/lib/supabaseServer';
import { bustSitesForUser } from '@/lib/website-builder/siteCache';
import { syncServicePaymentPlan } from '@/lib/payments/syncServicePaymentPlan';
// One schema for create and update, so the two cannot drift apart again.

const logger = createLogger({ module: 'SchedulingServicesAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = createServiceSchema.parse(body);

    requestLogger.info({ userId: user.id, serviceName: validated.service_name }, 'Creating scheduling service');

    // 3. Create service
    const result = await schedulingServiceRepository.create({
      user_id: user.id,
      ...validated
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create service');
      return NextResponse.json(
        { success: false, error: 'Failed to create service' },
        { status: 500 }
      );
    }

    /*
     * A service created as instalments needs the row the CLIENT is shown.
     *
     * Same reason as the update path in `[id]/route.ts`: the instalment columns
     * here are what the server trusts, and a `payment_plans` row is what the
     * public dialog, the contact drawer and the reminders read. Creating one
     * without the other is how a 200 ILS service sold as 2 × 100 came to quote
     * 200 and bank nothing.
     */
    const planSync = await syncServicePaymentPlan(result.data!, user.id);

    if (planSync.error) {
      requestLogger.error(
        { err: planSync.error, userId: user.id, serviceId: result.data!.id },
        'Service created but its payment plan row was not written — clients may be quoted the wrong amount'
      );

      return NextResponse.json(
        {
          success: false,
          error:
            'The service was created, but its payment plan could not be saved. Edit and save it again before taking bookings.',
          code: 'PLAN_SYNC_FAILED',
          service: result.data,
          details: process.env.NODE_ENV === 'development' ? planSync.error.message : undefined,
        },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_SERVICE_CREATED',
        userId: user.id,
        entityType: 'scheduling_service',
        entityId: result.data!.id,
        resourceName: result.data!.service_name,
        details: {
          duration_minutes: result.data!.duration_minutes,
          price: result.data!.price
        },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    /*
     * The public pages quote this service. They read it live, but they are
     * cached for up to a minute — so without this the owner changes a price and
     * the site keeps quoting the old one for as long as the cache holds. Every
     * WEBSITE edit already did this; the edits that most often change what a
     * visitor is quoted did not.
     */
    await bustSitesForUser(user.id);

    // 5. Return success
    requestLogger.info({ serviceId: result.data!.id, userId: user.id }, 'Service created successfully');
    return NextResponse.json({
      success: true,
      service: result.data
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    requestLogger.info({ userId: user.id, activeOnly }, 'Listing scheduling services');

    // 3. Get services
    const result = await schedulingServiceRepository.listAll(user.id, activeOnly);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list services');
      return NextResponse.json(
        { success: false, error: 'Failed to list services' },
        { status: 500 }
      );
    }

    /*
     * 4. Mark the ones whose currency is frozen.
     *
     * `service_currency_lock` (20261008) refuses the change once a service has
     * been booked, invoiced, paid or quoted. Without this the picker offers all
     * four currencies on a sold service, takes the click, and fails on save —
     * a settled rule arriving as an error.
     *
     * Never fatal: an unresolved set leaves every picker open, which is exactly
     * the behaviour before this existed. The database is still the guarantee.
     */
    const sold = await soldServiceIds(supabaseServer, user.id);

    const services = (result.data ?? []).map(service => ({
      ...service,
      currency_locked: sold.has(service.id),
    }));

    // 5. Return success
    return NextResponse.json({
      success: true,
      services
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
