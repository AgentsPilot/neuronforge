/**
 * What a lead could be sent, and which one to send when nobody is guessing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURE, AND SEPARATE FROM THE MODEL ON PURPOSE
 *
 * Two things need this list: the recommender, which asks a model to pick from
 * it, and the fallback, which picks without one. Keeping the list and the
 * deterministic choice in a module with no IO means the whole of that logic can
 * be tested without a provider, a database, or a network — and means the
 * feature still works with the model switched off.
 *
 * INDEXES ARE MINTED HERE, AND URLS NEVER LEAVE HERE
 *
 * The model is shown `{ index, label, … }` and answers with an index. It never
 * sees a URL and cannot return one, so an invented link is not a thing that can
 * happen — the same discipline `IntakeGenerationService` uses, where the model
 * refers to questions by position and our code holds the ids.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/leads/leadReplyCandidates
 */

import { isQuoted } from '@/lib/business-os/clientJourney';

export interface LeadReplyCandidate {
  /** Position in the list. What the model answers with. */
  index: number;
  kind: 'service' | 'generic';
  /** What this is, in the business's own words. */
  label: string;
  /** Where it sends them. Never shown to the model. */
  url: string;
  serviceId?: string;
  /** Free work reads as an invitation; priced work reads as a commitment. */
  isFree: boolean;
  /** Quoted work ends at a request — the copy must not promise a booking. */
  isQuote: boolean;
  /** Does booking it involve picking a time? */
  isScheduled: boolean;
  /** A line of context for the model, and for the dashboard. */
  summary?: string;
}

export interface CandidateService {
  id: string;
  service_name: string;
  description?: string | null;
  price?: number | null;
  duration_minutes?: number | null;
  sale_mode?: string | null;
  is_scheduled?: boolean | null;
}

/**
 * Every link this business could reasonably send a new lead.
 *
 * Services first, in their own order, then the generic booking page as the last
 * entry — which is also the safe answer, so a model that cannot decide has
 * somewhere sensible to land.
 */
export function buildLeadReplyCandidates(input: {
  services: CandidateService[];
  bookingUrl?: string | null;
}): LeadReplyCandidate[] {
  const candidates: LeadReplyCandidate[] = [];

  if (!input.bookingUrl) return candidates;

  for (const service of input.services) {
    const price = typeof service.price === 'number' ? service.price : null;
    const quoted = isQuoted(service.sale_mode as Parameters<typeof isQuoted>[0]);

    candidates.push({
      index: candidates.length,
      kind: 'service',
      label: service.service_name,
      url: `${input.bookingUrl}?service=${encodeURIComponent(service.id)}`,
      serviceId: service.id,
      // A quoted service has no price YET — that is not the same as free, and
      // treating it as free is how "ask for a quote" became "book this for £0".
      isFree: !quoted && (price === null || price === 0),
      isQuote: quoted,
      isScheduled: service.is_scheduled !== false,
      summary: service.description?.trim() || undefined,
    });
  }

  candidates.push({
    index: candidates.length,
    kind: 'generic',
    label: 'Everything we offer',
    url: input.bookingUrl,
    isFree: false,
    isQuote: false,
    isScheduled: true,
  });

  return candidates;
}

/**
 * The choice to make when no model is involved.
 *
 * Used three ways: as the whole decision before the recommender exists, as its
 * fallback when it fails, and as the answer when its kill switch is off. Being
 * the same code in all three is what makes "the model is unavailable" a
 * non-event rather than a second behaviour to reason about.
 *
 * The ladder, in order:
 *   1. they named a service — take them at their word
 *   2. a free service they can book — the intro call, which is how most of
 *      these relationships actually start
 *   3. everything on offer
 */
export function pickFallbackCandidate(
  candidates: LeadReplyCandidate[],
  input: { serviceInterest?: string | null } = {}
): LeadReplyCandidate | null {
  if (candidates.length === 0) return null;

  const interest = normalise(input.serviceInterest);
  if (interest) {
    const named = candidates.find(
      candidate =>
        candidate.kind === 'service' &&
        (normalise(candidate.label) === interest ||
          normalise(candidate.label).includes(interest) ||
          interest.includes(normalise(candidate.label)))
    );
    if (named) return named;
  }

  const intro = candidates.find(c => c.kind === 'service' && c.isFree && c.isScheduled);
  if (intro) return intro;

  return candidates.find(c => c.kind === 'generic') ?? candidates[0];
}

/**
 * What the model is allowed to see.
 *
 * No URLs and no ids — it chooses a position, and this module holds what that
 * position means.
 */
export function candidatesForPrompt(candidates: LeadReplyCandidate[]) {
  return candidates.map(candidate => ({
    index: candidate.index,
    label: candidate.label,
    free: candidate.isFree,
    quotedWork: candidate.isQuote,
    picksATime: candidate.isScheduled,
    about: candidate.summary,
  }));
}

/** Case- and accent-insensitive, because people type their own way. */
function normalise(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
