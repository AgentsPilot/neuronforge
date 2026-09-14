/**
 * What is stuck, and whose move it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPLACES /api/business-os/leads/incoming
 *
 * That route asked one question — who filled a form and got no reply — with its
 * own hand-written definition of "unanswered". The registry behind this asks
 * the same question about six different things and the briefing reads the same
 * definitions, so the card and the morning summary can no longer disagree about
 * what counts as outstanding.
 *
 * ONLY WHAT THE OWNER IS BLOCKING
 *
 * `blocksOn: 'owner'` is the filter. A quote sitting with a client who has not
 * answered is genuinely outstanding and genuinely NOT the owner's move, so it
 * belongs in the briefing and not on a card headed "needs you" — a list that
 * includes things you cannot do teaches people to stop reading the list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { findGaps, ownerGaps } from '@/lib/business-os/gaps/findGaps';
import { leadResponseRepository } from '@/lib/repositories/LeadResponseRepository';

const logger = createLogger({ module: 'BusinessGapsAPI' });

/** Enough rows to act on; the rest live in the CRM. */
const NAMED_PER_GAP = 5;

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const all = await findGaps(user.id, { named: NAMED_PER_GAP });
    const mine = ownerGaps(all);

    /*
     * What is already queued to go out on its own.
     *
     * Only enquiries have an automatic reply, so only their rows carry this —
     * and only while it is still PENDING, because a reply the runner has
     * claimed cannot be stopped and offering a Cancel button for it would
     * promise something the database refuses a second later.
     */
    const enquiryIds = mine
      .filter(gap => gap.id === 'enquiry_unanswered')
      .flatMap(gap => gap.items.map(item => item.contactId));

    const queued = await leadResponseRepository.listForContacts(user.id, enquiryIds);
    const pendingByContact = new Map(
      queued
        .filter(row => row.kind === 'invite' && row.status === 'pending')
        .map(row => [row.contact_id, row])
    );

    const gaps = mine.map(gap => ({
      id: gap.id,
      action: gap.action,
      count: gap.count,
      items: gap.items.map(item => {
        const pending = pendingByContact.get(item.contactId);
        const recommendation = (pending?.recommendation ?? null) as
          | { label?: string; reason?: string; source?: string }
          | null;

        return {
          contactId: item.contactId,
          name: item.name,
          note: item.note ?? null,
          since: item.since,
          entityId: item.entityId ?? null,
          queued: pending
            ? {
                label: recommendation?.label ?? null,
                chosenBy: recommendation?.source ?? null,
                dueAt: pending.next_attempt_at,
              }
            : null,
        };
      }),
    }));

    return NextResponse.json({ success: true, gaps });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read business gaps');
    return NextResponse.json(
      { success: false, error: 'Failed to load what needs you' },
      { status: 500 }
    );
  }
}
