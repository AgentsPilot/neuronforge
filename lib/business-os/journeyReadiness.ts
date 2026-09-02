/**
 * Whether the journeys a surface sells can actually be walked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A service's journey is decided by two facts it carries — does the client pick
 * a time, and how does the money arrive. But a step being PART of the journey
 * is not the same as that step being able to RUN:
 *
 *   a booking step needs working hours     — with none, the calendar is empty
 *                                            and the client picks nothing
 *   a card step needs a live processor     — with none, the payment screen has
 *                                            nothing behind it
 *
 * Both were only ever surfaced as advice: the readiness chain drew the step
 * dashed and the journey strip named what it was waiting for. Nothing stopped a
 * business publishing anyway, so the first person to find out was a client,
 * halfway through booking.
 *
 * This is the check that turns that advice into a gate. It is deliberately
 * about the SERVICES a surface actually sells, not about the business in
 * general: a page selling one invoiced programme does not need Stripe, and a
 * page selling one download does not need working hours. Asking the business
 * rather than the catalogue is what produced the old complaint of demanding a
 * card processor from a consultancy that invoices for everything.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { hasAnyAvailability } from '@/lib/scheduling/availabilityWindows';
import { collectsOnline } from '@/lib/business-os/clientJourney';

const logger = createLogger({ module: 'JourneyReadiness' });

/** The facts a surface knows about each service it offers. */
export interface JourneyReadinessService {
  name?: string | null;
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  price?: number | null;
}

export type JourneyGapKind = 'hours' | 'processor';

export interface JourneyGap {
  kind: JourneyGapKind;
  /** The services that need it, for a message that names them. */
  services: string[];
}

/** A service asks the client to pick a time. */
function needsHours(service: JourneyReadinessService): boolean {
  return service.is_scheduled !== false;
}

/** A service asks the client for a card at the moment of booking. */
function needsProcessor(service: JourneyReadinessService): boolean {
  return (service.price || 0) > 0 && collectsOnline(service.collection);
}

/**
 * What is missing before these services can be sold.
 *
 * Empty array means everything the journeys need is in place. An empty service
 * list is also ready — there is nothing to be unready for, and a page with no
 * services is a brochure, which is allowed.
 */
export async function journeyGaps(
  userId: string,
  services: JourneyReadinessService[]
): Promise<JourneyGap[]> {
  const scheduled = services.filter(needsHours);
  const charged = services.filter(needsProcessor);

  if (scheduled.length === 0 && charged.length === 0) return [];

  const gaps: JourneyGap[] = [];

  if (scheduled.length > 0) {
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('scheduling_availability')
      .eq('user_id', userId)
      .maybeSingle();

    if (!hasAnyAvailability(profile?.scheduling_availability)) {
      gaps.push({
        kind: 'hours',
        services: scheduled.map(s => s.name || 'a service').filter(Boolean),
      });
    }
  }

  if (charged.length > 0) {
    const connect = await stripeConnectRepository.findByUserId(userId);
    if (connect.data?.charges_enabled !== true) {
      gaps.push({
        kind: 'processor',
        services: charged.map(s => s.name || 'a service').filter(Boolean),
      });
    }
  }

  if (gaps.length > 0) {
    logger.info({ userId, gaps: gaps.map(g => g.kind) }, 'Journey readiness gaps found');
  }

  return gaps;
}

/**
 * One sentence a person can act on, naming the services affected.
 *
 * Kept here rather than at each call site so the website, a landing page and a
 * smart link cannot describe the same gap three different ways.
 */
export function describeJourneyGaps(gaps: JourneyGap[]): string {
  return gaps
    .map(gap => {
      const named = gap.services.slice(0, 3).join(', ');
      const more = gap.services.length > 3 ? ` and ${gap.services.length - 3} more` : '';
      return gap.kind === 'hours'
        ? `${named}${more} ${gap.services.length === 1 ? 'asks' : 'ask'} clients to pick a time, but you have no working hours set.`
        : `${named}${more} ${gap.services.length === 1 ? 'is' : 'are'} paid by card, but no payment processor is connected.`;
    })
    .join(' ');
}


/**
 * The services a smart link actually sells, resolved from its destination.
 *
 * A smart link has no publish step — it is created active and `/go/{code}`
 * serves it from that moment — so `is_active` is where its readiness gate has
 * to live, and that means knowing what it points at.
 *
 * A booking link may name specific services (`?services=a,b,c`); one that names
 * none offers the whole catalogue. A form link sells nothing and is always
 * ready. Landing and website links are covered by that page's own publish gate,
 * so they are not re-checked here — a link to an unpublished page is a
 * different problem with a different message.
 */
export async function journeyGapsForSmartLink(
  userId: string,
  link: { destination_type: string | null; destination_url: string }
): Promise<JourneyGap[]> {
  if (link.destination_type !== 'booking' && link.destination_type !== 'payment') {
    return [];
  }

  let serviceIds: string[] = [];
  try {
    const url = new URL(link.destination_url, 'https://placeholder.local');
    serviceIds = (url.searchParams.get('services') || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
  } catch {
    // A destination we cannot parse offers the whole catalogue, which is the
    // safer assumption: it checks more, not less.
    serviceIds = [];
  }

  let query = supabaseServer
    .from('scheduling_services')
    .select('service_name, is_scheduled, collection, price')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('is_active', true);

  if (serviceIds.length > 0) query = query.in('id', serviceIds);

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, userId }, 'Could not read services for a smart link');
    // Do not block on our own failure to check.
    return [];
  }

  return journeyGaps(
    userId,
    (data || []).map(s => ({
      name: s.service_name,
      is_scheduled: s.is_scheduled,
      collection: s.collection,
      price: s.price,
    }))
  );
}
