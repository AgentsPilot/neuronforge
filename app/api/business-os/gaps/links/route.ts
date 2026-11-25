/**
 * The links an owner can drop into a reply, and nothing they cannot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The commonest answer to a waiting client is not prose, it is a link: "pick a
 * time here", "the free consultation is here". Without one the owner has to
 * leave the card, open the booking page, copy the address and come back — which
 * is the exact round trip the reply box was built to remove, re-entered through
 * a different door.
 *
 * THE AGENT CANNOT DO THIS, AND MUST NOT. Rule 5 of its drafting prompt is "no
 * links, no URLs", because a model asked for a booking address will produce a
 * plausible one, and a plausible booking link in a client's inbox is worse than
 * no reply at all. That rule stays. This route is the other half of it: the
 * OWNER may insert a link, because the list they choose from is built from
 * their own services and the URLs are minted here from `resolveBookingUrl`.
 * Nothing in the loop can invent an address.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FETCHED WHEN ASKED, NOT WITH THE CARD
 *
 * A dashboard can carry a dozen gap rows and almost none of them will ever have
 * a link inserted. Folding this into the gaps response would cost every reader
 * a services read and a subdomain lookup to serve a control most of them never
 * open, on the one request the dashboard waits for.
 *
 * GET, because it reads and changes nothing. The answer is per-business and
 * small enough that the client holds it for the life of the page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { resolveBookingUrl } from '@/lib/branding/platformSite';
import { buildLeadReplyCandidates } from '@/lib/business-os/leads/leadReplyCandidates';

const logger = createLogger({ module: 'GapReplyLinksAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * The client is INJECTED — this repository takes one and has no default.
     * `supabaseServer` is the service role here, and the scoping it bypasses is
     * restored by `listBookable`, which filters `user_id` itself. Same
     * construction as every other caller of this repository.
     */
    const services = new SchedulingServiceRepository(supabaseServer);
    const { data: bookable, error } = await services.listBookable(user.id);

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Could not read the service list');
      return NextResponse.json({ success: false, error: 'Could not read your services' }, { status: 500 });
    }

    /*
     * The profile read is `user_code` only, and its failure is not fatal.
     *
     * `resolveBookingUrl` falls back to that code when the business has no
     * published website; a business with one needs neither. Treating an
     * unreadable profile as "no code" costs the generic fallback link at worst,
     * where failing the request would cost the owner every link they have.
     */
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('user_code')
      .eq('user_id', user.id)
      .maybeSingle();

    const bookingUrl = await resolveBookingUrl(user.id, profile);

    /*
     * The same builder the lead recommender uses, so the link an owner inserts
     * by hand and the one the platform sends on their behalf are the same link,
     * built the same way, with the same `?service=` parameter.
     */
    const candidates = buildLeadReplyCandidates({
      services: (bookable ?? []).map(service => ({
        id: service.id,
        service_name: service.service_name,
        description: service.description,
        price: service.price,
        duration_minutes: service.duration_minutes,
        sale_mode: service.sale_mode,
        is_scheduled: service.is_scheduled,
      })),
      bookingUrl,
    });

    return NextResponse.json({
      success: true,
      data: {
        /* `index` and `summary` are for the recommender's model prompt and are
           noise on a menu; the card needs what to call it and where it goes. */
        links: candidates.map(candidate => ({
          label: candidate.label,
          url: candidate.url,
          kind: candidate.kind,
          isFree: candidate.isFree,
          isQuote: candidate.isQuote,
        })),
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Reply links request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not load your links',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
