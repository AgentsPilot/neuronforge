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
import { OPERATIONAL_AUTOMATIONS, offerIsEarned } from '@/lib/business-os/gaps/automations';
import { applicableAutomations, automationEvidence } from '@/lib/business-os/gaps/automationApplies';
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
  const wanted = [...OPERATIONAL_AUTOMATIONS.map(a => a.column), 'automations_declined'];

  /*
   * ONE COLUMN THAT DOES NOT EXIST YET MUST NOT SWITCH OFF EVERY AUTOMATION.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT HAPPENED. A `chase_quotes` automation was added to the registry and
   * merged with its migration. The migration had not been run on the database,
   * so `chase_quotes_enabled` did not exist — and PostgREST rejects the WHOLE
   * select for one unknown name. The read failed, the catch below reported
   * every automation as not approved, and an owner whose lead autosend, invoice
   * chasing, intake chasing and meeting reminders were all `true` in the
   * database opened My Advisor and found the lot switched off. Nothing warned
   * them, because from the card's side "not approved" is a normal state.
   *
   * The blast radius is the problem, not the missing column. Code reaching a
   * database that has not caught up is ordinary between a merge and a
   * migration; a registry entry being ahead of the schema should cost THAT
   * automation and nothing else.
   *
   * So a column PostgREST names as absent is dropped and the read retried.
   * Bounded by the number of columns asked for — each pass removes exactly one,
   * and the loop stops the moment a read succeeds or an error is about
   * something else. A dropped column is simply absent from `approvals`, which
   * reads as "never approved" for that one automation: the same answer as
   * before, now confined to the automation whose column is missing.
   * ───────────────────────────────────────────────────────────────────────────
   */
  let approvals: Record<string, unknown> = {};
  let remaining = [...wanted];
  const absent: string[] = [];

  try {
    for (let attempt = 0; attempt <= wanted.length && remaining.length > 0; attempt += 1) {
      const { data, error } = await supabaseServer
        .from('business_profiles')
        .select(remaining.join(', '))
        .eq('user_id', userId)
        .maybeSingle();

      if (!error) {
        approvals = (data ?? {}) as unknown as Record<string, unknown>;
        break;
      }

      /* PostgREST names one missing column at a time: "column
         business_profiles.chase_quotes_enabled does not exist". */
      const named = String(error.message ?? '').match(
        /column\s+\S*?\.?(\w+)\s+does not exist/i
      )?.[1];

      if (!named || !remaining.includes(named)) {
        log.warn({ err: error }, 'Automation permissions unreadable; reporting all as not approved');
        break;
      }

      absent.push(named);
      remaining = remaining.filter(column => column !== named);
    }

    if (absent.length > 0) {
      /* Loud, because this means a migration has not been run. The feature is
         degraded rather than broken, which is exactly the state nobody notices
         without being told. */
      log.warn(
        { absent, userId },
        'Automation columns missing from business_profiles; those automations report as not approved. A migration is probably pending.'
      );
    }
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

  /*
   * The reminder's settings, read SEPARATELY and allowed to fail.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * They were briefly folded into the select above, which is the mistake the
   * comment on that read exists to prevent: Postgres rejects an ENTIRE select
   * for one unknown column, so on a database where this migration has not run
   * the approvals came back empty and every automation on the card — including
   * the three that predate this one — reported itself as not approved. An owner
   * with all four running was asked to switch all four on.
   *
   * One extra round trip is the price of a card that cannot be taken down by a
   * column that is not there yet. Unreadable means the defaults, which are the
   * same defaults the migration writes.
   * ───────────────────────────────────────────────────────────────────────────
   */
  let reminderSettings = {
    hoursBefore: 24,
    notifyClient: true,
    notifyOwner: true,
    /*
     * The tightest change deadline across the business's bookable services.
     *
     * The card needs it to say what a lead time COSTS: the reminder invites the
     * client to reschedule, and the reschedule route refuses anything inside the
     * service's `min_notice_hours`. With the default 24 and the choices the card
     * offers ([1, 2, 3, 24, 48]) four of the five produce a link the client
     * cannot use — so the owner is choosing that blind.
     *
     * The SHORTEST, because the lead time is per business and the window is per
     * service: a practice with a 24-hour and a 48-hour service cannot satisfy
     * both with one number, and the warning should be the one that is true most
     * often. The send-time check in `sendMeetingReminder` still decides per
     * booking, correctly, whatever this says.
     */
    noticeHours: 24,
  };
  try {
    const { data, error } = await supabaseServer
      .from('business_profiles')
      .select('meeting_reminder_hours_before, meeting_reminder_notify_client, meeting_reminder_notify_owner')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    const row = (data ?? {}) as Record<string, unknown>;

    /*
     * Its own read, like every other block here: one unknown column takes the
     * whole select down, and a missing notice window must not be able to make
     * the reminder settings report themselves as defaults.
     */
    let noticeHours = 24;
    const { data: services } = await supabaseServer
      .from('scheduling_services')
      .select('min_notice_hours')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('status', 'active')
      .eq('is_scheduled', true);

    const windows = (services ?? [])
      .map(svc => Number((svc as { min_notice_hours?: number | null }).min_notice_hours ?? 24))
      .filter(n => Number.isFinite(n) && n >= 0);
    if (windows.length > 0) noticeHours = Math.min(...windows);

    reminderSettings = {
      hoursBefore: Number(row.meeting_reminder_hours_before ?? 24),
      notifyClient: row.meeting_reminder_notify_client !== false,
      notifyOwner: row.meeting_reminder_notify_owner !== false,
      noticeHours,
    };
  } catch (err) {
    log.warn({ err }, 'Meeting reminder settings unreadable; showing the defaults');
  }

  /*
   * The owner alert, read SEPARATELY for the same reason the reminder's settings
   * are: one unknown column takes the whole select down with it, and this must
   * not be able to make four automations report themselves unapproved.
   *
   * Unreadable means ON, matching `LeadAlertService`, which treats a switch it
   * cannot read as on because silence is this feature's failure mode. A card
   * that guessed OFF would invite an owner to enable something already running.
   */
  let alertOwner = true;
  try {
    const { data, error } = await supabaseServer
      .from('business_profiles')
      .select('lead_alert_email_enabled')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    alertOwner = (data as { lead_alert_email_enabled?: boolean } | null)
      ?.lead_alert_email_enabled !== false;
  } catch (err) {
    log.warn({ err }, 'Owner alert switch unreadable; showing it as on');
  }

  const waitingByGap = new Map(all.map(gap => [gap.id, gap.count]));

  /*
   * Only what this business could use.
   *
   * "Remind clients about their form" was being offered to businesses with no
   * published form, where saying yes would have produced nothing — a request
   * for permission to do something that cannot happen. See `automationApplies`.
   */
  const applicable = await applicableAutomations(userId, OPERATIONAL_AUTOMATIONS);

  /*
   * And only what this owner has earned the offer of.
   *
   * `applicableAutomations` answers "could this business use it". This answers
   * "has this owner shown they do it by hand" — the gate `auto_complete_meetings`
   * carries, because saying yes to that one records an answer the platform
   * cannot verify on up to ninety days of past meetings. An automation already
   * switched ON is never hidden: it has to stay reachable to switch off.
   */
  const evidence = await automationEvidence(userId, applicable);
  const offered = applicable.filter(automation =>
    offerIsEarned(automation, {
      enabled: Boolean(approvals[automation.column]),
      evidence: evidence.get(automation.id) ?? 0,
    })
  );

  return offered.map(automation => ({
    id: automation.id,
    enabled: Boolean(approvals[automation.column]),
    declined: declined.has(automation.id),
    waiting: waitingByGap.get(automation.gapId) ?? 0,
    labelKey: automation.labelKey,
    hintKey: automation.hintKey,
    /*
     * Present only for the automation that has settings. The card renders its
     * extra controls off the presence of this object, so the other three keep
     * their one-line shape.
     */
    settings: automation.id === 'remind_about_meeting' ? reminderSettings : undefined,
    /*
     * Driven off the registry rather than off the id, so declaring
     * `ownerAlertColumn` on the next automation is the whole change.
     */
    notifications: automation.ownerAlertColumn ? { alertOwner } : undefined,
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
    const queuedFor = mine
      .filter(gap => gap.id === 'enquiry_unanswered' || gap.id === 'meeting_unmarked')
      .flatMap(gap => gap.items.map(item => item.contactId));

    const queued = await leadResponseRepository.listForContacts(user.id, queuedFor);
    const pendingByContact = new Map(
      queued
        .filter(row => row.kind === 'invite' && row.status === 'pending')
        .map(row => [row.contact_id, row])
    );

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND WHAT THE PLATFORM IS ABOUT TO DO WITHOUT BEING ASKED AGAIN.
     *
     * `auto_complete_meetings` marks a meeting completed twelve hours after it
     * was due. The unmarked gap claims the same meeting after two. So for ten
     * hours the card asked the owner to answer a question the platform was
     * about to answer for them, said nothing about it, and then the row
     * vanished when the automation ran.
     *
     * Nothing was broken. The row simply never mentioned it, and a task
     * disappearing with no explanation is how an owner stops trusting the list.
     *
     * KEYED BY BOOKING, not by contact. One client can have three unmarked
     * meetings and the queue carries one row per booking — keying this the way
     * the enquiry map above is keyed would put the wrong time on two of them.
     * That difference is why this is a second map rather than a widening of
     * the first.
     *
     * No button. The seven-day triage row already lets the owner correct an
     * auto-completed meeting, so a Cancel here would buy ten hours of
     * prevention on top of a week of cure. What was missing is the sentence.
     * ───────────────────────────────────────────────────────────────────────
     */
    const closingByBooking = new Map(
      queued
        .filter(row => row.kind === 'meeting_complete' && row.status === 'pending')
        .map(row => [row.entity_id, row])
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
          /*
           * The booking the row's button opens, where that is not `entityId`.
           *
           * This list is written out field by field rather than spread, which
           * is deliberate — the card should only receive what it needs — but it
           * does mean a new field is dropped in silence unless it is named
           * here. `bill_stage` is the one gap that needs it: its `entityId` is
           * a payment stage, and the card was passing that to `&booking=`.
           */
          bookingId: item.bookingId ?? null,
          /*
           * What is held on it, where money is involved.
           *
           * The card needs this to decide which button a row gets: a cancelled
           * booking with money on it is a refund, and the same gap with nothing
           * paid is a freed hour to refill. One gap, two moves, and the amount
           * is what tells them apart.
           */
          value: item.value ?? null,
          currency: item.currency ?? null,
          /*
           * A plan still charging this client. Carried through because it is
           * the row's whole urgency: the appointment is off and the card is
           * debited again next period until the owner decides otherwise.
           */
          planLive: item.planLive ?? false,
          queued: pending
            ? {
                label: recommendation?.label ?? null,
                chosenBy: recommendation?.source ?? null,
                dueAt: pending.next_attempt_at,
              }
            : null,
          /*
           * When the platform will answer this one itself, if the owner does
           * not. A time and nothing else: no label, no buttons, nothing to
           * press. See the note where `closingByBooking` is built.
           */
          closingAt: item.entityId
            ? closingByBooking.get(item.entityId)?.next_attempt_at ?? null
            : null,
          /*
           * When THIS one's moment is: a quote's `valid_until`, an
           * appointment's start.
           *
           * Computed by the gaps for as long as they have existed and dropped
           * here, so the card could say "9 days since you sent it" and never
           * "open until the 14th" — the half that decides what to do first.
           * `mostUrgent` ranks on it.
           */
          eventAt: item.eventAt ?? null,
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
