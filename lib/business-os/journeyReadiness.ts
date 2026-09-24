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
import {
  missingProfileFields,
  missingInvoiceFields,
  type OrganizationSettings,
} from '@/lib/business-os/setup/profileReadiness';

const logger = createLogger({ module: 'JourneyReadiness' });

/** The facts a surface knows about each service it offers. */
export interface JourneyReadinessService {
  name?: string | null;
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  price?: number | null;
}

export type JourneyGapKind = 'hours' | 'timezone' | 'processor' | 'invoicing';

export interface JourneyGap {
  kind: JourneyGapKind;
  /** The services that need it, for a message that names them. */
  services: string[];
  /**
   * The specific fields still outstanding, for an `invoicing` gap.
   *
   * "Your business and invoice details are incomplete" is true and useless: an
   * owner who has just filled in their company name and tax id reads it, opens
   * the tab, sees fields with values in them, closes it, and finds the same
   * message — because what was actually missing was the bank details or the
   * address. Naming them is the difference between a message they can act on
   * and one they conclude is broken.
   */
  missing?: string[];
}

/**
 * Does this gap make the journey impossible, or merely worse?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `hours`, `timezone` and `invoicing` block; `processor` does not. The
 * difference is whether the client can still get to the end.
 *
 * NO WORKING HOURS is fatal. The journey keeps its `datetime` step — the
 * service says it is scheduled — and the calendar behind it is empty, so the
 * client reaches a screen with nothing to pick and stops. There is no version
 * of that page worth publishing.
 *
 * NO PROCESSOR is not. `journeySteps` already DROPS the payment step when the
 * processor is not ready, so the client books straight through, and
 * `BookingLifecycleService` raises a `payment_invoices` row for any priced
 * service regardless of Stripe — the Stripe invoice is an enrichment on top of
 * that row, not a precondition for it. So a business with no processor still
 * takes the booking and still bills for it; it just collects by invoice instead
 * of by card.
 *
 * Blocking on it meant refusing to publish a site that works, over a step the
 * client would never have seen. It stays a gap so the advice still shows — a
 * business that MEANT to take cards should be told it is not — but it no longer
 * stands between them and a live page.
 *
 * MISSING INVOICE DETAILS blocks, and it is the other half of that same
 * decision. Saying "no processor is fine, we invoice instead" is only true if
 * an invoice can actually be issued — which needs the business's own details
 * and its invoicing fields. Without them the client books, the booking
 * completes, and the money has no way of being asked for. The fallback that
 * makes the processor gap harmless is the thing that has to work.
 *
 * NO TIMEZONE blocks, for the same reason as hours and worse.
 *
 * Hours with no zone are not hours: `09:00–17:00` is only an instant once you
 * know where. Unset means the platform falls back to UTC, so a Jerusalem
 * business publishes a page offering its clients times three hours from the
 * ones it works, the confirmation email states an hour it is closed, and
 * nothing anywhere reports an error. A client keeping that appointment arrives
 * to a locked door.
 *
 * It is not a client-visible failure the way empty hours are — the page looks
 * perfectly fine — which is precisely why it has to be caught before publish
 * rather than discovered afterwards.
 *
 * NOTE there is no `currency` gap, deliberately. `scheduling_services.currency`
 * is already set on the row being booked, and a business may legitimately price
 * in a currency other than its own country's — Israel charging a US client in
 * USD. There is nothing for a currency gate to protect.
 */
export function isBlockingGap(gap: JourneyGap): boolean {
  return gap.kind === 'hours' || gap.kind === 'timezone' || gap.kind === 'invoicing';
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

    /*
     * The zone those hours are in. Read from `user_preferences`, which is the
     * authority — `business_profiles.timezone` does not exist, and naming it in
     * a select makes PostgREST reject the WHOLE query, which is how a business
     * with a full diary once showed no times at all.
     *
     * A STORED 'UTC' IS NOT AN ANSWER, AND THIS GATE MUST ASK FOR IT.
     *
     * This comment used to say the opposite — that 'UTC' was a deliberate
     * choice to be left alone — which was true only while the column carried
     * `DEFAULT 'UTC'` and therefore could not express "nobody said". 20261006
     * dropped that default and 20261007 added `timezone_confirmed_at` precisely
     * so the two could be told apart, and the check below was rewritten to
     * require the confirmation. The comment was not, and left standing it would
     * argue a future reader straight back into the bug.
     *
     * Nine of twelve accounts still sit on that inherited 'UTC'. Every one of
     * them is asked, because UTC is wrong for almost every business and an hour
     * offered to a client from an unasked default is wrong silently.
     */
    const { data: prefs } = await supabaseServer
      .from('user_preferences')
      .select('timezone, timezone_confirmed_at')
      .eq('user_id', userId)
      .maybeSingle();

    /*
     * ASKED, not merely SET.
     *
     * Reading the value alone could not tell a business that chose UTC from one
     * that was never asked — the column defaulted to 'UTC' until 20261006, and
     * 9 of 12 accounts still carry that default. A gate on the value protected
     * nobody.
     *
     * `timezone_confirmed_at` is written whenever a human answers, so this is
     * the one question with one answer. A blank timezone still counts as unset
     * even if something marked it confirmed — the two must agree.
     */
    const answered =
      Boolean(prefs?.timezone_confirmed_at) &&
      Boolean(prefs?.timezone) &&
      Boolean(String(prefs?.timezone).trim());

    if (!answered) {
      gaps.push({
        kind: 'timezone',
        services: scheduled.map(s => s.name || 'a service').filter(Boolean),
      });
    }
  }

  /*
   * Whether a card can be charged decides TWO things, so it is resolved once.
   *
   * It names the advisory processor gap, and it decides which services fall
   * back to being invoiced — which is what the blocking invoicing gap below is
   * about.
   */
  let processorReady = true;
  if (charged.length > 0) {
    const connect = await stripeConnectRepository.findByUserId(userId);
    processorReady = connect.data?.charges_enabled === true;

    if (!processorReady) {
      gaps.push({
        kind: 'processor',
        services: charged.map(s => s.name || 'a service').filter(Boolean),
      });
    }
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHO WILL BE BILLED RATHER THAN CHARGED — AND CAN THEY BE?
   *
   * Two routes end in an invoice: a service the business chose to invoice, and
   * a service set to collect by card on an account with no processor connected.
   * The second is the fallback that makes the processor gap harmless, and it is
   * only harmless if an invoice can actually be issued.
   *
   * Issuing one needs the business's own details and its invoicing fields —
   * company name, tax id, address, a payment method for the client to use.
   * Without them the client books, the booking completes, an invoice row is
   * created, and nothing can be sent. The money is simply never asked for, and
   * the first person to notice is the owner, weeks later.
   *
   * Asked through `profileReadiness`, the same functions the readiness chain
   * uses for its "business details" and "invoice details" rows, so the gate and
   * the chain cannot disagree about whether they are filled in.
   */
  const invoiced = services.filter(
    service =>
      (service.price || 0) > 0 &&
      (service.collection === 'invoice' || (collectsOnline(service.collection) && !processorReady))
  );

  if (invoiced.length > 0) {
    /*
     * Fields the readiness chain asks for that an INVOICE does not need.
     *
     * `missingProfileFields` describes a complete business profile, which is a
     * broader idea than "can issue an invoice" — it includes things the chain
     * nudges for because they improve the product, not because a document is
     * invalid without them.
     *
     * A company name, a tax id and an address are what make an invoice a legal
     * document, and without a payment method the client is not told where to
     * send the money. Those stay. The rest are profile polish.
     *
     * The LOGO is not listed here because it is no longer reported missing at
     * all — see `profileReadiness`: it is not part of being complete anywhere
     * on the platform.
     */
    const NOT_NEEDED_TO_INVOICE = new Set([
      'industry',
      'company_size',
      'primary_goal',
      'technical_level',
      'business_type',
    ]);

    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: org } = await supabaseServer
      .from('organizations')
      .select('settings')
      .eq('owner_user_id', userId)
      .maybeSingle();

    const settings = (org?.settings as OrganizationSettings) ?? null;
    /*
     * BOTH sets of fields, because the gate asks for both and an owner told
     * only "details are incomplete" cannot know which half is short.
     */
    const missing = [
      ...missingProfileFields(profile, settings),
      ...missingInvoiceFields(profile),
    ].filter(field => !NOT_NEEDED_TO_INVOICE.has(field));

    if (missing.length > 0) {
      gaps.push({
        kind: 'invoicing',
        services: invoiced.map(s => s.name || 'a service').filter(Boolean),
        missing,
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
  return gaps.map(describeJourneyGap).join(' ');
}

/**
 * One gap, as one sentence.
 *
 * Separate from the joined version because a reader needs them apart: each gap
 * is fixed somewhere different, so a card showing two of them needs two
 * messages with two controls. Joined into one string they arrived as a wall of
 * text with a single link that addressed half of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT NO LONGER NAMES THE SERVICES
 *
 * It used to open with "Training 60 min, Custom Training, Intro ask clients to
 * pick a time…", which made the sentence long, put the least useful part first,
 * and repeated a name across gaps whenever one service had two problems. The
 * owner does not need to be told which services are affected: the fix is the
 * same one setting either way, and they are about to go and set it.
 *
 * `gap.services` is still collected and still carried on the gap — it is real
 * information and a caller that wants to list them can — it simply is not in
 * the sentence a person reads before clicking.
 */
/**
 * Field codes into the words on the form.
 *
 * The same words the readiness chain uses for its "business details" and
 * "invoice details" rows — an owner should not be sent looking for a field
 * named one thing here and another there.
 */
const FIELD_LABELS = (field: string): string =>
  ({
    company_name: 'business name',
    business_type: 'business type',
    logo: 'logo',
    industry: 'industry',
    company_size: 'company size',
    primary_goal: 'main goal',
    technical_level: 'technical level',
    tax_id: 'tax ID',
    address: 'business address',
    payment_method: 'bank details',
  } as Record<string, string>)[field] ?? field;

/**
 * Which settings tab mends this gap.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every surface that renders a gap also renders a Fix button, and each of the
 * four wrote the same ternary — `isInvoicing ? 'invoice' : 'availability'`.
 * That was true while there were two blocking kinds. A third made all four
 * wrong at once: a timezone gap would have opened the availability tab, which
 * has hours and no timezone picker, so the owner would read "set your
 * timezone", arrive somewhere it cannot be set, and conclude the message was
 * broken.
 *
 * One mapping, named by the thing it decides, so a fourth kind is one line here
 * rather than a hunt through the call sites.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function describeJourneyGap(gap: JourneyGap): string {
  switch (gap.kind) {
    case 'hours':
      return 'Your services ask clients to pick a time, but you have no working hours set.';

    /*
     * Says what goes wrong, not what is missing. "Set your timezone" reads as
     * housekeeping and gets postponed; the reason it cannot wait is that every
     * hour the page offers is currently the wrong one.
     */
    case 'timezone':
      return 'Your working hours have no timezone, so clients would be offered the wrong times.';

    case 'invoicing': {
      // Names the consequence, because "invoice details are incomplete" sounds
      // like paperwork rather than money that cannot be collected.
      const base =
        'Some services are billed by invoice, but there would be no way to send one.';

      /*
       * And names the fields, because the owner has to know WHICH.
       *
       * Without them this said "your business and invoice details are
       * incomplete" — read by someone who had just filled in their company name
       * and tax id as a message that had not updated, when what was actually
       * outstanding was the address or the bank details. They would close the
       * tab, see the same sentence, and conclude the check was broken.
       *
       * Deduplicated: `company_name` is asked for by both the profile and the
       * invoice checks, and naming it twice reads as a mistake.
       */
      const fields = Array.from(new Set(gap.missing ?? []));
      if (fields.length === 0) return base;

      return `${base} Still needed: ${fields.map(FIELD_LABELS).join(', ')}.`;
    }

    default:
      // Says what will happen, not just what is missing — because something
      // sensible does happen: the card step is skipped and the client is
      // invoiced instead.
      return 'Some services are set to be paid by card, but no payment processor is connected — clients will be invoiced instead.';
  }
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
