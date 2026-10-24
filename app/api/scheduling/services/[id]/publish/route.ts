/**
 * POST /api/scheduling/services/[id]/publish
 *
 * Publishes a draft service, making it active and bookable.
 * This is the user's approval step after reviewing AI-generated services.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
/* The same readiness the website publish gate and both booking routes ask. */
import {
  journeyGaps,
  isBlockingGap,
  describeJourneyGaps,
} from '@/lib/business-os/journeyReadiness';
/*
 * Service role, deliberately: `resolvePaymentCollectionCapability` reads
 * `stripe_connect_accounts` for THIS user id, which is passed explicitly and
 * is the authenticated owner's. CLAUDE.md rule 4 — the scope is the argument,
 * not an RLS session.
 */
import { supabaseServer } from '@/lib/supabaseServer';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';

const logger = createLogger({ module: 'PublishServiceAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id, serviceId: id }, 'Publishing draft service');

    /*
     * 2. NOTHING GOES LIVE THAT CANNOT BE BOOKED.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Publishing takes no body — it flips the status and nothing else — so
     * whatever the editor happened to be SHOWING at the time is not saved by
     * pressing it. That combination put a service live with
     * `duration_minutes: null`: the owner opened a service created by
     * onboarding, saw a 60 the form had invented for display, changed nothing,
     * and published.
     *
     * The failure is silent all the way down. A scheduled service with no
     * length produces a slot every thirty minutes whose end equals its start,
     * because `start + null * 60000` is `start`, so the public page offered 51
     * bookable-looking slots of zero length on a business whose hours and
     * timezone were both correct. Nothing errored, and the owner's report was
     * "all dates are zero time available".
     *
     * Checked at the moment of going live rather than on save, because a draft
     * is allowed to be incomplete — that is what a draft is. What must not
     * happen is an incomplete draft becoming a public booking page.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const toPublish = await schedulingServiceRepository.findById(id, user.id);

    if (toPublish.data?.is_scheduled && !(Number(toPublish.data.duration_minutes) > 0)) {
      requestLogger.warn(
        { userId: user.id, serviceId: id, duration: toPublish.data.duration_minutes },
        'Publish refused: a scheduled service has no length'
      );
      return NextResponse.json(
        {
          success: false,
          /* A code the client can translate, and a sentence for anything that
             just prints `error`. */
          code: 'duration_required',
          error: 'This service books a time, so it needs a length before it can go live.',
        },
        { status: 400 }
      );
    }

    /*
     * MONEY TO COLLECT MEANS AN AMOUNT TO COLLECT.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * `collection` says HOW the client pays — a card at the moment of booking,
     * or an invoice afterwards. Either answer means money is owed, and neither
     * says how much. Nothing stopped a service going live with a collection
     * method and no price, which leaves a client at a checkout for an unstated
     * amount, or an invoice raised for nothing.
     *
     * A quoted service is the deliberate exception and is NOT caught here: a
     * `proposal` names its amount in the quote that has not been written yet,
     * which is the whole point of quoting. Its collection is published as null
     * for exactly that reason.
     *
     * A free service is not caught either, because it has no collection at all
     * — the editor stores null the moment the price is zero, so there is
     * nothing here to be inconsistent with.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (
      toPublish.data?.collection
      && toPublish.data.sale_mode !== 'proposal'
      && !(Number(toPublish.data.price) > 0)
    ) {
      requestLogger.warn(
        {
          userId: user.id,
          serviceId: id,
          collection: toPublish.data.collection,
          price: toPublish.data.price,
        },
        'Publish refused: a service that collects money has no price'
      );
      return NextResponse.json(
        {
          success: false,
          code: 'price_required',
          error: 'This service is paid for, so it needs a price before it can go live.',
        },
        { status: 400 }
      );
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * A CARD SERVICE NEEDS A PROCESSOR TO CHARGE THE CARD.
     *
     * `processor` is deliberately NON-blocking in `isBlockingGap`, and that
     * stays true: an already-published card service on an account with no
     * Stripe falls back to an invoice, which is a real way to be paid, and
     * making the gap blocking would stop those accounts taking bookings at all.
     * This is narrower on purpose — it refuses the one ACT of promising
     * something new, not the running business.
     *
     * Why it is refused rather than degraded: the owner chose card. Publishing
     * a service that says "pay by card" onto a surface that will invoice
     * instead is the platform quietly substituting its own answer for theirs.
     * The editor offers the card option again (it was hidden for a while, which
     * removed the choice instead of enabling it) and names the fix beside it,
     * so the path from here is one click.
     *
     * Free and quoted services are untouched: both are excluded by the price
     * test, for the same reasons the guard above spells out.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (
      toPublish.data?.collection === 'online'
      && toPublish.data.sale_mode !== 'proposal'
      && Number(toPublish.data.price) > 0
    ) {
      const capability = await resolvePaymentCollectionCapability(supabaseServer, user.id);
      if (!capability.canCollect) {
        requestLogger.warn(
          { userId: user.id, serviceId: id },
          'Publish refused: a card service has no connected processor'
        );
        return NextResponse.json(
          {
            success: false,
            code: 'processor_required',
            error: 'This service is paid by card, so a payment account has to be connected before it can go live.',
          },
          { status: 400 }
        );
      }
    }

    /*
     * AND THE BUSINESS HAS TO BE ABLE TO HONOUR WHAT THIS PROMISES.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Publishing is the moment a service becomes a promise to a client, and
     * this route never asked whether the business could keep it. An invoiced
     * service could go live on an account with no invoice company name, no tax
     * id, no address and no payment instructions — and the client who booked it
     * was sent an invoice built from none of them.
     *
     * The website publish gate has asked this for some time
     * (`pagePublishBlocker`), and the two must agree: one definition of ready,
     * asked at every point where something becomes client-facing.
     *
     * `isBlockingGap` keeps the card processor out of it — a card service with
     * no Stripe falls back to invoicing and is valid. What blocks is hours,
     * timezone and invoicing.
     *
     * The gaps come back WITH the refusal, because the owner needs to know
     * which half is short: "invoicing needs 4 details" sends them somewhere,
     * "not ready" does not. `describeJourneyGaps` is the shared sentence, so
     * the website, the smart link and this cannot word it three ways.
     *
     * FAILS OPEN, like every other caller: a database outage must not stop a
     * business publishing work it has already done.
     * ─────────────────────────────────────────────────────────────────────────
     */
    try {
      const blocking = (
        await journeyGaps(user.id, [
          {
            name: toPublish.data?.service_name,
            is_scheduled: toPublish.data?.is_scheduled,
            collection: toPublish.data?.collection,
            price: toPublish.data?.price,
            /* A quote ends in an invoice too — see `JourneyReadinessService.sale_mode`. */
            sale_mode: toPublish.data?.sale_mode,
          },
        ])
      ).filter(isBlockingGap);

      if (blocking.length > 0) {
        requestLogger.warn(
          { userId: user.id, serviceId: id, gaps: blocking.map(g => g.kind) },
          'Publish refused: the business cannot honour this service yet'
        );
        return NextResponse.json(
          {
            success: false,
            code: 'not_ready',
            error: describeJourneyGaps(blocking),
            /* Each gap apart, so the editor can offer a link per fix rather
               than one sentence the owner has to decompose. */
            gaps: blocking.map(gap => ({ kind: gap.kind, missing: gap.missing ?? [] })),
          },
          { status: 400 }
        );
      }
    } catch (error) {
      requestLogger.error(
        { err: error, userId: user.id, serviceId: id },
        'Readiness check failed; allowing the publish rather than blocking work'
      );
    }

    // 5. Publish the service
    const result = await schedulingServiceRepository.publish(id, user.id);

    if (result.error) {
      // Check if it's because service wasn't a draft
      const existing = await schedulingServiceRepository.findById(id, user.id);
      if (existing.data && existing.data.status !== 'draft') {
        return NextResponse.json(
          { success: false, error: 'Service is not a draft' },
          { status: 400 }
        );
      }

      requestLogger.error({ err: result.error, userId: user.id, serviceId: id }, 'Failed to publish service');
      return NextResponse.json(
        { success: false, error: 'Failed to publish service' },
        { status: 500 }
      );
    }

    // 3. Audit log (non-blocking)
    auditTrail.log({
      action: 'SCHEDULING_SERVICE_PUBLISHED',
      userId: user.id,
      entityType: 'scheduling_service',
      entityId: id,
      resourceName: result.data?.service_name || 'Unknown service',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 4. Return success
    requestLogger.info({ userId: user.id, serviceId: id }, 'Service published successfully');
    return NextResponse.json({
      success: true,
      service: result.data,
      message: 'Service is now active and clients can book it.'
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Publish service request failed');
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
