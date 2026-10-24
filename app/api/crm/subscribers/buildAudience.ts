/**
 * Two tables, one row per person: the business's mailable audience.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT INSIDE THE ROUTE
 *
 * The merge is where the mistakes live, and none of them need a request to
 * reproduce: a person present in both tables, a consent row with no contact
 * behind it, a contact that has since been deleted, and a toggle that has to
 * mean the same thing on both halves or it appears to do nothing. Pure and
 * separate, each is one assertion.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO SOURCES, AND WHAT EACH KNOWS
 *
 * `business_subscribers` has a narrow, deliberate scope: newsletter signups who
 * were not already contacts. Only the two newsletter forms write to it. It is
 * the only thing that knows about somebody MID-CONFIRMATION — signed up, not
 * yet consented — because until they click the link there is no consent to
 * record.
 *
 * `marketing_consent_state` is the authority on who may be written to. It is
 * what every send checks and what `countMailable` counts, and it receives
 * consent from four surfaces the roster never sees: the booking flow's
 * tickbox, the contact form's, the owner entering it in the CRM drawer, and the
 * double opt-in link.
 *
 * Listing only the first answered a question nobody asks. On a live account:
 * nine consented, every one mailable, zero shown.
 *
 *   on the roster only          a signup mid-confirmation      pending
 *   consented, has a contact    a client who said yes          contact
 *   consented, no contact       an address and a yes, no more  confirmed
 *
 * @module app/api/crm/subscribers/buildAudience
 */

import type { SubscriberStatus } from '@/lib/repositories/BusinessSubscriberRepository';

/**
 * One person the business may write to, whichever table knows about them.
 *
 * `status` carries one value the roster itself cannot hold — `contact`, for
 * somebody who consented and is already in the CRM. The other four are
 * `SubscriberStatus` unchanged, so a roster row maps across field for field.
 */
export interface AudienceRow {
  id: string;
  email: string;
  name: string | null;
  status: SubscriberStatus | 'contact';
  source: string;
  subscribed_at: string;
  confirmed_at: string | null;
  promoted_contact_id: string | null;
  mailable: boolean;
}

/** Only the roster fields the merge reads. */
export interface RosterRow {
  id: string;
  email: string;
  email_normalized: string;
  name: string | null;
  status: SubscriberStatus;
  source: string;
  subscribed_at: string;
  confirmed_at: string | null;
  promoted_contact_id: string | null;
}

/** Only the consent fields the merge reads. */
export interface ConsentRow {
  email_normalized: string;
  contact_id: string | null;
  decided_at: string;
}

/** Only the contact fields the merge reads. */
export interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  source: string | null;
}

export function buildAudience(input: {
  /**
   * The roster IN FULL, never pre-filtered.
   *
   * It is the deduplication key as well as a source of rows, so filtering it
   * before the merge would UNDO the filter for exactly the rows it excludes: a
   * promoted signup dropped here is still consented and still has a contact, so
   * it returns through the other door wearing a `contact` label. The owner
   * switches the toggle off and watches the same people stay put.
   */
  roster: RosterRow[];
  consented: ConsentRow[];
  /** The contacts named by `consented`, fetched in one round trip. */
  contacts: ContactRow[];
  /** Live consent per normalised address, for the roster half. */
  consentByEmail: Map<string, boolean>;
  /** "Include people already in the CRM" — applied once, to both sources. */
  includePromoted: boolean;
}): AudienceRow[] {
  const { roster, consented, contacts, consentByEmail, includePromoted } = input;

  const rows: AudienceRow[] = roster
    .filter((s) => includePromoted || s.status !== 'promoted')
    .map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      status: s.status,
      source: s.source,
      subscribed_at: s.subscribed_at,
      confirmed_at: s.confirmed_at,
      promoted_contact_id: s.promoted_contact_id,
      /*
       * The roster's own status and the consent record can disagree — consent
       * is withdrawn through unsubscribe links that never touch this table.
       * The consent record governs sending, so it is shown rather than
       * inferred from how far through signing up somebody got.
       */
      mailable: consentByEmail.get(s.email_normalized) === true,
    }));

  /* Keyed on the normalised address, so a person in both tables is listed once. */
  const onRoster = new Set(roster.map((s) => s.email_normalized));
  const byId = new Map(contacts.map((c) => [c.id, c]));

  for (const c of consented) {
    if (onRoster.has(c.email_normalized)) continue;

    const contact = c.contact_id ? byId.get(c.contact_id) : undefined;

    /* The other half of the flag: a contact IS somebody already in the CRM. */
    if (contact && !includePromoted) continue;

    /*
     * A contact that no longer exists leaves its consent row standing, and that
     * is correct — a deleted contact does not un-say what they said, and the
     * suppression has to outlive them. It is listed under its address.
     */
    const name = contact
      ? [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || null
      : null;

    rows.push({
      /*
       * The contact's id where there is one, so the row is stable across
       * reloads. Otherwise the address, which is the only identity this person
       * has: `marketing_consent_state` is keyed on (user, address, channel) and
       * has no id of its own to borrow. Duplicate keys make React drop rows.
       */
      id: contact?.id ?? `consent:${c.email_normalized}`,
      email: contact?.email ?? c.email_normalized,
      name,
      /*
       * `contact` where we know who they are, `confirmed` where all we have is
       * an address and a yes. Neither is `promoted`: that word means a roster
       * signup the owner moved into the pipeline, and these people were never
       * on the roster to be moved.
       */
      status: contact ? 'contact' : 'confirmed',
      source: contact?.source ?? 'consent',
      /* When they said yes. There is no earlier date for these rows. */
      subscribed_at: c.decided_at,
      confirmed_at: c.decided_at,
      /*
       * Set for a contact, which is what hides the Promote button. Promoting
       * somebody already in the pipeline would create a duplicate of them.
       */
      promoted_contact_id: contact?.id ?? null,
      /* They are in this list because the consent record said so. */
      mailable: true,
    });
  }

  /* Newest first across both sources, so the two do not read as two lists. */
  return rows.sort((a, b) => Date.parse(b.subscribed_at) - Date.parse(a.subscribed_at));
}
