/**
 * GET /api/scheduling/services/[id]
 * PUT /api/scheduling/services/[id]
 * PATCH /api/scheduling/services/[id]
 * DELETE /api/scheduling/services/[id]
 * Individual scheduling service endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import {
  findServiceReferences,
  deleteServiceReferences,
  unpublishServiceReferences,
} from '@/lib/services/ServiceReferenceService';
import { z } from 'zod';
import { updateServiceSchema } from '@/lib/validation/schedulingService';
import { bustSitesForUser } from '@/lib/website-builder/siteCache';
import { syncServicePaymentPlan } from '@/lib/payments/syncServicePaymentPlan';
/*
 * Service role, deliberately: the capability is read for the authenticated
 * owner's id, passed explicitly below. CLAUDE.md rule 4 — the scope is the
 * argument, not an RLS session.
 */
import { supabaseServer } from '@/lib/supabaseServer';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
// One schema for create and update, so the two cannot drift apart again.

const logger = createLogger({ module: 'SchedulingServiceAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: serviceId } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    requestLogger.info({ userId: user.id, serviceId }, 'Fetching scheduling service');

    // 2. Get service
    const result = await schedulingServiceRepository.findById(serviceId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, serviceId }, 'Failed to fetch service');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch service' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      service: result.data
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: serviceId } = await params;

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
    const validated = updateServiceSchema.parse(body);
    requestLogger.info({ userId: user.id, serviceId, updates: Object.keys(validated) }, 'Updating scheduling service');

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * CHOOSING CARD NEEDS A PROCESSOR THAT CAN TAKE ONE.
     *
     * The same refusal the publish route makes, at the moment the choice is
     * made, so the owner is told while they are looking at the control rather
     * than later when they try to go live.
     *
     * ONLY WHEN THIS SAVE *CHANGES* THE ANSWER TO CARD.
     *
     * The first version tested the incoming value alone — `validated.collection
     * === 'online'` — on the reasoning that it meant "this save is choosing
     * card". It does not. `saveRowEdit` rebuilds the whole payload from the
     * row's current values on every save, so a service already on card resends
     * `collection: 'online'` when the owner edits its NAME.
     *
     * The effect was a frozen row, and three separate things had to agree for
     * it to be wrong:
     *
     *   - a live card service on an account with no processor is a SUPPORTED
     *     state. `processor` is deliberately non-blocking, the public booking
     *     route trades on it, and `serviceMoneyLine` tells the owner outright
     *     that the money will arrive by invoice until Stripe is connected;
     *   - this gate refused every edit to such a row, the correction included;
     *   - and saving writes `status: 'draft'`, so the publish gate would then
     *     refuse to put it back on sale.
     *
     * Together: a trading service that could not be edited, and could not be
     * recovered except by switching it to invoice.
     *
     * Comparing with the stored row restores what was intended all along —
     * gate the DECISION, not its echo. Choosing card today is refused and
     * pointed at Stripe; a row that was already on card is left alone, and
     * every edit to it, including the one that fixes it, goes through.
     *
     * Publishing is deliberately NOT softened the same way: it refuses for an
     * existing card row too, exactly as the invoicing gate already refuses to
     * publish a service whose invoice details are missing. Going live is a new
     * promise whoever made it first.
     *
     * A free or quoted service never reaches this: free stores a null
     * collection, and a quote settles its amount in the proposal.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const choosingCard =
      validated.collection === 'online'
      && validated.sale_mode !== 'proposal'
      && (validated.price === undefined || validated.price === null || Number(validated.price) > 0);

    if (choosingCard) {
      const existing = await schedulingServiceRepository.findById(serviceId, user.id);
      // Already on card: this save is not the decision, so it is not gated.
      const alreadyOnCard = existing.data?.collection === 'online';

      const capability = alreadyOnCard
        ? { canCollect: true }
        : await resolvePaymentCollectionCapability(supabaseServer, user.id);

      if (!capability.canCollect) {
        requestLogger.warn(
          { userId: user.id, serviceId },
          'Save refused: card was chosen with no connected processor'
        );
        return NextResponse.json(
          {
            success: false,
            code: 'processor_required',
            error: 'Card payments need a connected payment account. Connect one, or bill this service by invoice.',
          },
          { status: 400 }
        );
      }
    }

    // 3. Update service
    //
    // The schema tolerates nulls on the instalment fields because older clients
    // send them; the columns do not. A null here means "leave it alone", not
    // "write null", so those keys are dropped rather than forwarded.
    const NULLABLE_ONLY_IN_TRANSIT = [
      'installment_count',
      'installment_frequency',
      'first_payment_due',
      'first_payment_days',
    ] as const;

    const updates: Record<string, unknown> = { ...validated };
    NULLABLE_ONLY_IN_TRANSIT.forEach(key => {
      if (updates[key] === null) delete updates[key];
    });

    /*
     * Switching a service off removes it from the public page exactly as
     * deleting it does: the renderer loads active services only, so a landing
     * page whose service is merely deactivated advertises a thing that cannot
     * be booked, with a button that fails at the API. Resolve what points at it
     * first, while it is still findable.
     */
    const deactivating = validated.is_active === false;
    const references = deactivating
      ? await findServiceReferences(serviceId, user.id)
      : null;

    const result = await schedulingServiceRepository.update(
      serviceId,
      user.id,
      updates as Parameters<typeof schedulingServiceRepository.update>[2]
    );

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, serviceId }, 'Failed to update service');
      return NextResponse.json(
        { success: false, error: 'Failed to update service' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    /*
     * Mirror the instalment configuration to the row the CLIENT is shown.
     *
     * Two places answer "is this service paid in instalments": these columns,
     * which the server trusts, and a `payment_plans` row, which the public
     * booking dialog, the contact drawer and the reminders read. This save
     * wrote only the first, so a service configured here had a server that knew
     * it was a plan and a dialog that did not — and the dialog quoted, and
     * charged, the full price. See `syncServicePaymentPlan`.
     *
     * Blocking, and reported as a failure. The service row itself is already
     * written and cannot be rolled back here, so the honest outcome is to say
     * exactly that rather than return success over a plan row that does not
     * exist: the next save repairs it, because the sync is idempotent.
     */
    const planSync = await syncServicePaymentPlan(result.data, user.id);

    if (planSync.error) {
      requestLogger.error(
        { err: planSync.error, userId: user.id, serviceId },
        'Service saved but its payment plan row was not written — clients may be quoted the wrong amount'
      );

      return NextResponse.json(
        {
          success: false,
          error:
            'The service was saved, but its payment plan could not be updated. Save it again before taking bookings.',
          code: 'PLAN_SYNC_FAILED',
          service: result.data,
          details: process.env.NODE_ENV === 'development' ? planSync.error.message : undefined,
        },
        { status: 500 }
      );
    }

    // Same treatment as a delete — see the comment above.
    const takenDown = references
      ? await unpublishServiceReferences(references, user.id)
      : null;

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_SERVICE_UPDATED',
        userId: user.id,
        entityType: 'scheduling_service',
        entityId: serviceId,
        resourceName: result.data.service_name,
        changes: validated,
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
    requestLogger.info({ serviceId, userId: user.id }, 'Service updated successfully');
    return NextResponse.json({
      success: true,
      service: result.data,
      takenDown
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

// PATCH handler - alias for PUT (partial updates)
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PUT(request, context);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: serviceId } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    requestLogger.info({ userId: user.id, serviceId }, 'Deleting scheduling service');

    // 2. Get service first (for audit trail)
    const getResult = await schedulingServiceRepository.findById(serviceId, user.id);
    if (getResult.error || !getResult.data) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    /*
     * 3. Work out what points at this service — before it is gone.
     *
     * The lookup reads the service id out of website blocks, so it has to run
     * while the service still exists to be sure of what it finds. Taking the
     * references down happens after the delete succeeds.
     */
    const references = await findServiceReferences(serviceId, user.id);

    // 4. Delete service (checks for bookings first)
    const result = await schedulingServiceRepository.delete(serviceId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, serviceId }, 'Failed to delete service');
      return NextResponse.json(
        { success: false, error: 'Failed to delete service' },
        { status: 500 }
      );
    }

    // 4. Check if deletion was blocked by existing bookings
    if (!result.data?.deleted) {
      requestLogger.warn({ serviceId, userId: user.id, bookingCount: result.data?.bookingCount }, 'Cannot delete service with existing bookings');
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot delete service with existing bookings',
          bookingCount: result.data?.bookingCount
        },
        { status: 409 }
      );
    }

    /*
     * 5. Destroy what was written for it.
     *
     * A landing page is GENERATED for one service: its headline, its body, its
     * objections and its closing section are all about that one thing. Without
     * the service it is not a page missing a product, it is an article about
     * something that does not exist — so it goes, rather than becoming a draft
     * the owner can never usefully republish.
     *
     * This used to unpublish. The reasoning was that the owner might bring the
     * service back and their copy was worth keeping, which is true of a service
     * moved to DRAFT and false of one deleted. Drafting is handled in PATCH
     * above, and still unpublishes.
     *
     * Smart links scoped to this service alone are switched off rather than
     * deleted: a short code may have been written down or shared, and its
     * content is not about the service the way a page's is.
     */
    const takenDown = await deleteServiceReferences(references, user.id);

    // 6. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_SERVICE_DELETED',
        userId: user.id,
        entityType: 'scheduling_service',
        entityId: serviceId,
        resourceName: getResult.data.service_name,
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

    // 7. Return success
    requestLogger.info({ serviceId, userId: user.id }, 'Service deleted successfully');
    return NextResponse.json({
      success: true,
      message: 'Service deleted successfully',
      takenDown
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
