/**
 * One contact's marketing consent: what it is, and how it got that way.
 *
 * GET returns the whole history rather than a boolean, because the history IS
 * the answer to the only questions that get asked of it — what did they agree
 * to, when, and did they ever change their mind. A subject access request
 * cannot be answered from a flag.
 *
 * POST records a decision made off the web forms, and the two it accepts are
 * deliberately asymmetric:
 *
 *   'withdrawn' — one click, no evidence required. Withdrawal must never be
 *                 harder than granting was.
 *   'granted'   — requires the owner to type what the person agreed to and
 *                 when. A paper form or a verbal yes at reception is real
 *                 consent, and this is how it gets recorded; a toggle would
 *                 make the unlawful path the easy one.
 *
 * There is no bulk endpoint, and there must never be one. "Mark all contacts
 * as consented" would undo the entire system in a single request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'ContactConsentAPI' });
const auditTrail = AuditTrailService.getInstance();

const RecordSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('withdrawn'),
    /** Free text, e.g. "asked me at the desk". Never required. */
    note: z.string().max(500).optional(),
  }),
  z.object({
    decision: z.literal('granted'),
    // Both required. The database rejects a wording-free grant anyway; asking
    // here produces a usable message instead of a constraint violation.
    statement_text: z.string().min(1, 'Record what they agreed to').max(2000),
    occurred_at: z.string().datetime().optional(),
    statement_locale: z.string().max(8).default('en'),
    note: z.string().max(500).optional(),
  }),
]);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: contactId } = await context.params;

    const { data: contact } = await crmContactRepository.findById(contactId, user.id);
    if (!contact) {
      return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 });
    }

    const email = contact.email?.trim();
    if (!email) {
      // Consent attaches to an address. No address, nothing to say.
      return NextResponse.json({ success: true, data: { consented: null, events: [] } });
    }

    const [{ data: state }, { data: events }, { data: subscriber }] = await Promise.all([
      marketingConsentRepository.getState(user.id, email),
      marketingConsentRepository.history(user.id, { email }),
      /*
       * Where this contact came from, when it was the newsletter.
       *
       * Subscribers are not contacts, so a promoted one leaves a roster row
       * behind as the record of their origin. Surfacing it here is what makes
       * that record worth keeping: open any contact and you can see whether
       * they were on the list before they were a client, and since when.
       */
      businessSubscriberRepository.findByEmail(user.id, email),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        email,
        consented: state?.consented ?? false,
        decidedAt: state?.decided_at ?? null,
        events: events ?? [],
        subscribedAt: subscriber?.subscribed_at ?? null,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read contact consent');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: contactId } = await context.params;
    const body = await request.json();
    const parsed = RecordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: contact } = await crmContactRepository.findById(contactId, user.id);
    if (!contact) {
      return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 });
    }

    const email = contact.email?.trim();
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'This contact has no email address' },
        { status: 400 }
      );
    }

    const input = parsed.data;

    const { data: event, error } = await marketingConsentRepository.record({
      userId: user.id,
      contactId,
      email,
      decision: input.decision,
      method: input.decision === 'granted' ? 'owner_entered' : 'unsubscribe_link',
      statementText: input.decision === 'granted' ? input.statement_text : null,
      statementLocale: input.decision === 'granted' ? input.statement_locale : null,
      occurredAt:
        input.decision === 'granted' && input.occurred_at
          ? new Date(input.occurred_at)
          : undefined,
      sourceSurface: 'crm_drawer',
      // Who typed it in. Stamped rather than supplied, so it cannot be claimed.
      recordedBy: user.id,
      evidence: input.note ? { note: input.note } : {},
    });

    if (error) throw error;

    /*
     * Keep the newsletter roster in step, for the case where this person is
     * also on it. A roster saying `confirmed` beside a consent saying
     * `withdrawn` is a disagreement nothing later reconciles. No-ops for
     * anybody with no roster row, which is most contacts.
     *
     * A promoted row is left alone by the repository: they are a contact now,
     * and their entry has become a record of where they came from.
     */
    void (input.decision === 'withdrawn'
      ? businessSubscriberRepository.markUnsubscribed(user.id, email)
      : businessSubscriberRepository.markConfirmed(user.id, email));

    auditTrail
      .log({
        action: input.decision === 'granted' ? 'CONSENT_RECORDED' : 'CONSENT_WITHDRAWN',
        entityType: 'crm_contact',
        entityId: contactId,
        userId: user.id,
        severity: 'warning',
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true, data: event });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to record contact consent');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
