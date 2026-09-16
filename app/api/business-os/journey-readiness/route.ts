/**
 * Can a client actually walk this service's journey?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The publish gate answers this for a PAGE, by reading the services that page
 * offers. The landing-page wizard needs the same answer one step earlier, for a
 * single service the owner has just picked and before any page exists — so it
 * can say "this service needs working hours" while the choice is still in front
 * of them, instead of letting them generate a page, write its copy, and only
 * discover at the publish button that it cannot go live.
 *
 * It asks `journeyGaps`, the same function the publish gate and the smart-link
 * gate use, so the three cannot disagree about whether a service is sellable.
 *
 * @module app/api/business-os/journey-readiness
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  journeyGaps,
  describeJourneyGaps,
  describeJourneyGap,
  isBlockingGap,
} from '@/lib/business-os/journeyReadiness';

const logger = createLogger({ module: 'JourneyReadinessAPI' });

/*
 * One service, several, or none.
 *
 * A landing page is about exactly one. A smart link may name a few, and one
 * that names none offers the whole catalogue — the same rule
 * `journeyGapsForSmartLink` applies, so the two surfaces are asked the same
 * question in the same way.
 */
const querySchema = z.object({
  service_ids: z.array(z.string().uuid()).optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const requested = (request.nextUrl.searchParams.get('service_ids') || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    const parsed = querySchema.safeParse({
      service_ids: requested.length > 0 ? requested : undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'service_ids must be service ids' },
        { status: 400 }
      );
    }

    let query = supabaseServer
      .from('scheduling_services')
      .select('id, service_name, is_scheduled, collection, price')
      .eq('user_id', user.id);

    if (parsed.data.service_ids) {
      /*
       * Named services are checked WHATEVER their state.
       *
       * `is_active` was applied here too, and it made the check fail open: a
       * service that did not match — a draft, or one just published whose flag
       * had not settled — returned no rows, `journeyGaps` short-circuits on an
       * empty list, and the answer came back "ready". A caller naming a service
       * is asking about that service, not about whether it happens to be
       * switched on, and "we found nothing to check" must not read as "nothing
       * is wrong".
       */
      query = query.in('id', parsed.data.service_ids);
    } else {
      // Naming none means offering the catalogue, and the catalogue is what is
      // live. A switched-off service is not part of the offer.
      query = query.eq('is_active', true);
    }

    const { data: services, error } = await query;
    if (error) throw error;

    if (parsed.data.service_ids && (services ?? []).length === 0) {
      // Not fatal — the caller is told "ready" because there is genuinely
      // nothing to be unready about — but it is almost always a sign the id
      // was wrong, and that used to be invisible.
      requestLogger.warn(
        { serviceIds: parsed.data.service_ids },
        'Journey readiness asked about services that matched no rows'
      );
    }

    const gaps = await journeyGaps(
      user.id,
      (services || []).map(service => ({
        name: service.service_name,
        is_scheduled: service.is_scheduled,
        collection: service.collection,
        price: service.price,
      }))
    );

    const blocking = gaps.filter(isBlockingGap);

    return NextResponse.json({
      success: true,
      ready: blocking.length === 0,
      error: blocking.length > 0 ? describeJourneyGaps(blocking) : undefined,
      reason: blocking[0]?.kind,
      /*
       * Each blocking gap apart, so the caller can show one row per problem
       * with the control that fixes it — hours and invoice details live on
       * different settings tabs. The joined `error` above stays for a caller
       * that only wants a sentence.
       */
      gaps: blocking.map(gap => ({ kind: gap.kind, message: describeJourneyGap(gap) })),
      // The advisory gaps too, so a caller can show them without enforcing.
      advisory: gaps.filter(gap => !isBlockingGap(gap)).map(gap => gap.kind),
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to check journey readiness');
    /*
     * Never block on our own failure to check.
     *
     * The publish gate asks again and refuses properly, so a broken check here
     * must not stand between an owner and a page they are entitled to build.
     */
    return NextResponse.json({
      success: true,
      ready: true,
      /*
       * Says WHY it is ready, because it is not.
       *
       * A silent `ready: true` from this catch is indistinguishable from a
       * clean check, so a broken query looks exactly like a business with
       * nothing to fix — the gate simply stops gating and nobody can tell. The
       * caller logs this so the difference is visible from the browser as well
       * as the server.
       */
      checkFailed: true,
    });
  }
}
