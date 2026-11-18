/**
 * Everyone this business may email, and the button that turns one into a client.
 *
 * `GET` lists the audience. `POST` promotes a roster signup: creates the CRM
 * contact at the owner's first pipeline stage and marks the roster row as where
 * that contact came from.
 *
 * Promotion is also automatic — a trigger on `crm_contacts` links any contact
 * created for an address that already subscribed, so somebody who simply books
 * ends up in the pipeline without anyone deciding. This route is the owner's
 * explicit version of the same thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NO LONGER THE ROSTER ALONE
 *
 * It listed `business_subscribers` and nothing else. That table has a narrow
 * and deliberate scope: newsletter signups who were not already contacts. Only
 * the two newsletter forms write to it.
 *
 * Consent is given in four other places — a tickbox inside the booking flow,
 * the same tickbox on the contact form, the owner entering it in the CRM
 * drawer, and the double opt-in link — and none of them touch the roster,
 * correctly, because those people are contacts and a contact is not an
 * anonymous address.
 *
 * The consequence was a screen that answered a question nobody asks. On a live
 * account: nine people consented, every one of them mailable, and the
 * Subscribers tab showed zero. Seven had never been near a newsletter form,
 * one was already a contact so the roster insert skipped them by design, and
 * one predated the roster feature by eleven minutes.
 *
 * So the list is built from `marketing_consent_state` — the authority on who
 * may be written to, the same table every send checks and `countMailable`
 * counts — and the roster is folded in for the one thing it knows that the
 * consent table does not: somebody who has signed up and NOT yet confirmed.
 *
 * Two sources, one row per person, keyed on the normalised address:
 *
 *   on the roster only          a signup mid-confirmation      pending
 *   consented, has a contact    a client who said yes          contact
 *   consented, no contact       an address and a yes, no more  confirmed
 *
 * The roster row wins where both exist: it carries the signup's own history —
 * when they subscribed, what they confirmed, where they came from — and the
 * consent row would flatten that to a single date.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { buildAudience } from './buildAudience';

const logger = createLogger({ module: 'CRMSubscribersAPI' });

const PromoteSchema = z.object({ subscriberId: z.string().uuid() });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * The flag is NOT pushed into the roster query: `buildAudience` needs the
     * full roster as its deduplication key, and applies the flag to both
     * sources itself. Pre-filtering here is what let a hidden row return
     * through the consent table wearing a different label.
     */
    const includePromoted =
      new URL(request.url).searchParams.get('includePromoted') !== 'false';

    const [{ data: roster, error }, { data: consented }] = await Promise.all([
      businessSubscriberRepository.list(user.id, { includePromoted: true }),
      marketingConsentRepository.listConsented(user.id),
    ]);

    if (error) throw error;

    /*
     * Names for the consent-only rows, in one round trip rather than one per
     * row. A consent row carries `contact_id` precisely so this does not have
     * to match people on their address.
     */
    const contactIds = (consented ?? [])
      .map((c) => c.contact_id)
      .filter((id): id is string => Boolean(id));

    /*
     * And the addresses of the consent rows that name NOBODY.
     *
     * `contact_id` is only written when the consent and the contact arrive
     * together; nothing backfills it. So a person who consented on the website
     * and became a client three weeks later keeps a consent row saying
     * `contact_id: null`, and this screen read that as "not in the CRM": the
     * row survived the exclude toggle and offered to add a client the owner had
     * been working for weeks. Found on a live account, 2026-11-15.
     *
     * The roster addresses are left out because a roster row already wins the
     * merge for its address, so a contact found for one could never be used.
     */
    const rosterEmails = new Set((roster ?? []).map((s) => s.email_normalized));
    const unlinkedEmails = Array.from(
      new Set(
        (consented ?? [])
          .filter((c) => !c.contact_id && !rosterEmails.has(c.email_normalized))
          .map((c) => c.email_normalized)
      )
    );

    const [{ data: contacts }, { data: byAddress }, { data: consentByEmail }] = await Promise.all([
      contactIds.length
        ? crmContactRepository.listBasic(user.id, { ids: contactIds })
        : Promise.resolve({ data: [], error: null }),
      unlinkedEmails.length
        ? crmContactRepository.listBasic(user.id, { emails: unlinkedEmails })
        : Promise.resolve({ data: [], error: null }),
      marketingConsentRepository.getStateBulk(
        user.id,
        (roster ?? []).map((s) => s.email)
      ),
    ]);

    /* Keyed the way the consent table keys people, so the two sides agree. */
    const contactsByEmail = new Map(
      (byAddress ?? [])
        .filter((c) => c.email)
        .map((c) => [c.email!.trim().toLowerCase(), c] as const)
    );

    const rows = buildAudience({
      roster: roster ?? [],
      consented: consented ?? [],
      contacts: contacts ?? [],
      contactsByEmail,
      consentByEmail: consentByEmail ?? new Map(),
      includePromoted,
    });

    return NextResponse.json({ success: true, subscribers: rows });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list subscribers');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = PromoteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    /*
     * Scoped to the caller. `list` is user-scoped, so finding the row through it
     * is what stops an id from another tenant being promoted into this one.
     */
    const { data: all } = await businessSubscriberRepository.list(user.id, {
      includePromoted: true,
    });
    const subscriber = (all ?? []).find((s) => s.id === parsed.data.subscriberId);

    /*
     * Also the answer for a row that came from the consent table rather than
     * the roster. Those people are already contacts — the list sets their
     * `promoted_contact_id`, so the button is never rendered for them — and
     * there is nothing here to promote. A 404 is the honest reply: this id
     * names no roster row.
     */
    if (!subscriber) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (subscriber.promoted_contact_id) {
      // Already a contact. Idempotent rather than an error: a double-clicked
      // button must not produce a second contact for the same person.
      return NextResponse.json({
        success: true,
        data: { contactId: subscriber.promoted_contact_id, alreadyPromoted: true },
      });
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * IS THIS PERSON ALREADY A CONTACT? ASK BEFORE CREATING ONE.
     *
     * `promoted_contact_id` above only stops the SAME roster row being
     * promoted twice. It says nothing about a contact that reached the CRM by
     * another door — a booking, an enquiry, an import — after this row was
     * written.
     *
     * The trigger on `crm_contacts` covers the other direction: a contact
     * created later links the roster row by email, which then makes the button
     * idempotent. It cannot cover this one, because nothing fires when the
     * owner presses Promote.
     *
     * So an owner with a client who later subscribed, or a subscriber who
     * later booked while the roster row was written under a different address,
     * got a SECOND contact for a person already in their CRM. Found on a live
     * account: two rows, one address, 28 minutes apart.
     *
     * Matched the way every other capture path matches — `emailLikePattern`
     * through the shared repository, so case and surrounding space cannot
     * split one person into two.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { data: already } = await crmContactRepository.findByEmail(
      subscriber.email,
      user.id
    );

    if (already) {
      /* Link the roster row to the contact they already are, and tell the
         caller the same thing a double-press is told: this is that person. */
      await businessSubscriberRepository.markPromoted(user.id, subscriber.email, already.id);

      requestLogger.info(
        { subscriberId: subscriber.id, contactId: already.id },
        'Subscriber already had a contact; linked rather than duplicated'
      );

      return NextResponse.json({
        success: true,
        data: { contactId: already.id, alreadyPromoted: true },
      });
    }

    /*
     * The start of this owner's board, through the repository that owns the
     * table. This was an inline `crm_pipeline_stages` read ending `|| 'lead'`
     * — one of seven such copies, and a direct Supabase call from a route.
     *
     * Null means the business has no pipeline at all. The stage is then left
     * off the insert so the column's own `DEFAULT 'lead'` applies, rather than
     * this route restating that default as if it had decided it.
     */
    const { data: firstStage } = await crmPipelineStagesRepository.firstStageKey(user.id);

    /*
     * A name only where one was given. The address is the fallback for display,
     * never written into the name column — inventing "offir.omer" from an
     * address is the bug that filled the CRM with fictional people.
     */
    const parts = subscriber.name?.trim().split(/\s+/) ?? [];

    const { data: contact, error: createError } = await crmContactRepository.create({
      user_id: user.id,
      first_name: parts[0] ?? null,
      last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
      email: subscriber.email,
      ...(firstStage ? { stage: firstStage } : {}),
      source: subscriber.source,
      // Where they came from, carried across so the contact keeps its origin.
      source_metadata: subscriber.attribution as never,
    } as never);

    if (createError || !contact) throw createError || new Error('Contact was not created');

    /*
     * The trigger on `crm_contacts` has already linked the roster row by email.
     * This call is belt and braces for the case where the trigger is absent —
     * an environment where the migration has not been applied — and is harmless
     * where it has run, because it writes the same values.
     */
    await businessSubscriberRepository.markPromoted(user.id, subscriber.email, contact.id);

    requestLogger.info(
      { userId: user.id, contactId: contact.id, stage: firstStage },
      'Subscriber promoted to the pipeline'
    );

    return NextResponse.json({
      success: true,
      data: { contactId: contact.id, alreadyPromoted: false },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to promote a subscriber');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
