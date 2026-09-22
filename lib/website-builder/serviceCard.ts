/**
 * One service, as a website card reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Four places mapped `scheduling_services` into the shape `ServicesBlock`
 * renders, each with its own copy of the rules:
 *
 *   app/api/website/public/[subdomain]   the LIVE public page
 *   app/api/website/blocks/services      the editor and the booking flow
 *   lib/services/WebsiteBlockEnrichmentService
 *   lib/services/WebsiteGenerationService
 *
 * Four copies means four chances to disagree, and they did. Three carried an
 * English-only keyword matcher for the icon and one carried an English-plus-
 * partial-Hebrew version, so the same service got different icons depending on
 * which route served it. Three dropped a zero price with `||`, so a free
 * service showed no price at all. Fixing one left the others, which is exactly
 * how a fix can land and change nothing on the page the user is looking at.
 *
 * So the rules live here once, and the four sites carry data in and out.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/serviceCard
 */

import { formatPrice } from '@/lib/website-builder/servicePrice';

/**
 * The icon every service card wears.
 *
 * ONE ICON, DELIBERATELY. This used to be guessed from the service NAME —
 * 'training' → Dumbbell, 'course' → GraduationCap, twelve rules, everything
 * else → Star. Two things were wrong with it and they compounded.
 *
 * It read ENGLISH. A business working in Hebrew matched no rule, so every
 * service fell through to Star — and then one English-named service among them
 * ("Custom Training") matched, and the page showed a dumbbell beside two stars.
 * The odd one out looks like a bug, because it is one.
 *
 * And the rules are thin even in English: "Intro", "Follow-up", "Assessment",
 * "Package" all miss. A guess that succeeds for a minority of names produces a
 * row of mismatched cards, which reads worse than a row of identical ones.
 *
 * Translating the keyword list is not the fix. It would still miss every name
 * outside it, in three languages instead of one, and the platform serves any
 * business with any vocabulary.
 *
 * The SERVICE NAME says what the service is, far better than a pictogram can.
 * To bring variety back properly, give the owner a field to choose one:
 * `ServiceIcon` already renders any Lucide name or a plain emoji, so only a
 * column and a picker are missing.
 */
export const SERVICE_ICON = 'Sparkles';

/** What the mapper needs. A subset of `SchedulingService`, so any caller fits. */
export interface ServiceRow {
  id: string;
  service_name: string;
  is_active?: boolean;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  duration_minutes?: number | null;
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  sale_mode?: 'direct' | 'proposal' | null;
}

export interface ServiceCard {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** A formatted figure, present only when the service actually costs something. */
  price?: string;
  /** The number itself. **Zero survives** — see below. */
  priceRaw?: number;
  currency?: string;
  duration?: string;
  durationMinutes?: number;
  is_scheduled: boolean;
  collection: 'online' | 'invoice' | null;
  sale_mode: 'direct' | 'proposal';
  isActive: boolean;
}

export function toServiceCard(service: ServiceRow): ServiceCard {
  const currency = service.currency && service.currency.length === 3 ? service.currency : 'USD';

  return {
    id: service.id,
    name: service.service_name,
    description: service.description || '',
    icon: SERVICE_ICON,

    /*
     * A formatted price only for something that COSTS something. A free service
     * rendered as "$0" reads as a pricing error rather than as free, so the
     * card says the word instead, in the reader's language.
     */
    price: service.price ? formatPrice(service.price, currency) : undefined,

    /*
     * `??`, not `||`. Zero is a real price, and the two cases `||` collapsed
     * together are different facts: `0` means free and the card can say so,
     * `null` means nobody has set one. Both used to arrive as `undefined`, so a
     * free intro call showed no price line at all and sat beside priced cards
     * looking like the page had failed to load half of it.
     */
    priceRaw: service.price ?? undefined,

    currency,
    duration: service.duration_minutes ? `${service.duration_minutes} min` : undefined,
    durationMinutes: service.duration_minutes ?? undefined,

    // The two facts the booking widget builds its journey from. Without them
    // the page decided from the price alone and asked an invoiced client for a
    // card.
    is_scheduled: service.is_scheduled !== false,
    collection: service.collection ?? null,

    // And whether a client can buy this at all or has to be quoted. Absent, a
    // quoted service reads as 'direct' and the page offers "Book now" on
    // something with no price.
    sale_mode: service.sale_mode || 'direct',

    isActive: service.is_active !== false,
  };
}

/**
 * What a card says where the price goes.
 *
 * Three answers, and none of them is a blank:
 *
 *   quoted   nobody has priced the job    → "Price on request"
 *   free     priced, at zero              → "Free", not "$0"
 *   priced   the figure
 *
 * Free used to fall through to `null` and the card showed nothing at all, so a
 * free intro call sat beside priced services looking like the page had failed
 * to load half of it.
 *
 * The distinction that carries it is `priceRaw === 0` versus `priceRaw`
 * missing: zero is a price and absent is not, and every producer used to
 * collapse the two with `||`.
 *
 * Pure, and separate from the renderer, so it can be tested without a DOM.
 */
export function servicePriceLabel(
  service: { price?: string | null; priceRaw?: number | null; sale_mode?: string | null },
  labels: { free: string; onRequest: string }
): string | null {
  if (service.sale_mode === 'proposal') return labels.onRequest;
  if (service.priceRaw === 0) return labels.free;
  return service.price || null;
}

/**
 * A guess at what a single service is about, from its name.
 *
 * On its own this is the thing that produced the mismatched row: it matches a
 * minority of real service names, so most cards fell back and the few that
 * matched stood out as errors. It is NOT used per card.
 *
 * It earns its place as a VOTE — see `blockServiceIcon`.
 */
function guessIcon(serviceName: string): string | null {
  const name = (serviceName || '').toLowerCase();

  // English and Hebrew together, because a business works in one language and
  // names the odd service in the other — which is exactly the mix that broke
  // the per-card version.
  if (name.includes('train') || name.includes('fitness') || name.includes('workout') || name.includes('אימון')) return 'Dumbbell';
  if (name.includes('consult') || name.includes('session') || name.includes('call') || name.includes('ייעוץ')) return 'MessageCircle';
  if (name.includes('coach') || name.includes('mentor')) return 'Target';
  if (name.includes('therap') || name.includes('counsel') || name.includes('טיפול')) return 'Heart';
  if (name.includes('class') || name.includes('workshop') || name.includes('course') || name.includes('קורס') || name.includes('שיעור')) return 'GraduationCap';
  if (name.includes('massage') || name.includes('spa') || name.includes('wellness') || name.includes('עיסוי')) return 'Hand';
  if (name.includes('yoga') || name.includes('יוגה')) return 'Flower2';
  if (name.includes('photo') || name.includes('video') || name.includes('צילום')) return 'Camera';
  if (name.includes('design') || name.includes('creative') || name.includes('עיצוב')) return 'Palette';
  if (name.includes('legal') || name.includes('law') || name.includes('משפט')) return 'Scale';
  if (name.includes('finance') || name.includes('account') || name.includes('tax') || name.includes('חשבונ')) return 'Calculator';
  if (name.includes('tech') || name.includes('development') || name.includes('code') || name.includes('תכנות')) return 'Code';
  if (name.includes('hair') || name.includes('תספורת')) return 'Scissors';

  return null;
}

/**
 * ONE icon for a whole block of services, chosen by what the business mostly does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The two obvious designs are both wrong, and this is why.
 *
 * GUESS PER CARD, and a page shows a dumbbell beside two stars: the matcher
 * only recognises a minority of real names, so the failures sit next to the
 * successes and the odd one out reads as a bug.
 *
 * ONE FIXED ICON EVERYWHERE, and a personal trainer's services all wear a
 * sparkle that says nothing about training. Consistent, and blank.
 *
 * So the guess votes rather than decides. A trainer whose services are
 * "Training", "Training Package", "Training 60 min" and "Custom Training" gets
 * a dumbbell on ALL of them — including "Intro" and "קורס ADHD", which match
 * nothing on their own. The page is consistent AND it is about training.
 *
 * A business whose names match nothing gets the neutral mark, which is the
 * honest answer: nothing here says what these services are.
 *
 * Computed from the services on the page rather than stored, so it is right on
 * pages that already exist and cannot go stale when a service is renamed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function blockServiceIcon(services: Array<{ name?: string }>): string {
  const votes = new Map<string, number>();

  for (const service of services) {
    const guess = guessIcon(service?.name ?? '');
    if (guess) votes.set(guess, (votes.get(guess) ?? 0) + 1);
  }

  let winner: string | null = null;
  let best = 0;
  for (const [icon, count] of votes) {
    // Strictly greater, so a tie keeps the first seen and the answer is stable
    // rather than depending on Map ordering.
    if (count > best) {
      winner = icon;
      best = count;
    }
  }

  return winner ?? SERVICE_ICON;
}
