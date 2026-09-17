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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AUTOMATIONS COME BACK WITH THEM, FROM THE SAME PASS
 *
 * `GET /api/business-os/automations/operational` used to answer separately, and
 * it opened with `findGaps` of its own — because the advisor asks "three
 * invoices are past due, shall I chase them from now on?" and that sentence
 * needs the counts. The dashboard fired both requests at once, so the six gap
 * definitions and their eleven queries ran TWICE, concurrently, for the same
 * answer.
 *
 * The client could not do the join itself: `reply_to_enquiries` maps to an
 * owner-blocked gap, but `chase_invoices` and `chase_intake` map to
 * client-blocked ones, which `ownerGaps` deliberately strips out of the response
 * below. So the counts had to be taken here, off the unfiltered list, before
 * that filter is applied.
 *
 * The PUT stays where it was: deciding is a write about automations, not a read
 * about gaps.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { findGaps, ownerGaps } from '@/lib/business-os/gaps/findGaps';
import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';
import { leadResponseRepository } from '@/lib/repositories/LeadResponseRepository';

const logger = createLogger({ module: 'BusinessGapsAPI' });

/** Enough rows to act on; the rest live in the CRM. */
const NAMED_PER_GAP = 5;

/**
 * What the platform has permission to do, and how many are waiting on each.
 *
 * `all` is the UNFILTERED gap list — two of the three automations clear a
 * client-blocked gap, which never reaches the owner-facing list.
 *
 * The approvals are read on their own and a failure is swallowed: Postgres
 * rejects an entire select for one unknown column, so folding these into a
 * wider profile read would take the advisor down everywhere the migration has
 * not run. Unreadable means "not approved", which fails towards NOT acting on
 * somebody's behalf.
 */
async function operationalAutomations(
  userId: string,
  all: Awaited<ReturnType<typeof findGaps>>,
  log: { warn: (ctx: Record<string, unknown>, msg: string) => void }
) {
  const columns = [...OPERATIONAL_AUTOMATIONS.map(a => a.column), 'automations_declined'].join(', ');

  let approvals: Record<string, unknown> = {};
  try {
    const { data, error } = await supabaseServer
      .from('business_profiles')
      .select(columns)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    approvals = (data ?? {}) as unknown as Record<string, unknown>;
  } catch (err) {
    log.warn({ err }, 'Automation permissions unreadable; reporting all as not approved');
  }

  /*
   * Three states, not two.
   *
   * A boolean cannot tell "said no" from "never asked", so a decline is kept in
   * its own list. The advisor asks about anything in neither — approved ones are
   * a setting now, declined ones were answered.
   */
  const declined = new Set(
    Array.isArray(approvals.automations_declined)
      ? (approvals.automations_declined as string[])
      : []
  );

  const waitingByGap = new Map(all.map(gap => [gap.id, gap.count]));

  return OPERATIONAL_AUTOMATIONS.map(automation => ({
    id: automation.id,
    enabled: Boolean(approvals[automation.column]),
    declined: declined.has(automation.id),
    waiting: waitingByGap.get(automation.gapId) ?? 0,
    labelKey: automation.labelKey,
    hintKey: automation.hintKey,
  }));
}

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
     * Started here, awaited at the end, so its one profile read overlaps the
     * queued-replies read below rather than following it.
     */
    const automationsPromise = operationalAutomations(user.id, all, requestLogger);

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

    return NextResponse.json({ success: true, gaps, automations: await automationsPromise });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read business gaps');
    return NextResponse.json(
      { success: false, error: 'Failed to load what needs you' },
      { status: 500 }
    );
  }
}
