/**
 * Approving or declining one of the things the platform can do for a business.
 *
 * PUT — the only verb here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COUNT IS THE POINT, AND IT IS READ ELSEWHERE
 *
 * The advisor asks "three invoices are past due — shall I chase them from now
 * on?" rather than "enable invoice chasing". The first is a decision somebody
 * can make; the second is a checkbox they skip. That sentence needs the gap
 * registry — which is why the GET that used to live here opened by calling
 * `findGaps`.
 *
 * The dashboard also asks `/api/business-os/gaps`, which had just run the same
 * six definitions, so eleven queries were being executed twice per page load
 * for one answer. The read moved into that route, where the pass already
 * happens; the WRITE stayed here, because deciding is not a question about
 * gaps.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { automationById } from '@/lib/business-os/gaps/automations';
import { z } from 'zod';

const logger = createLogger({ module: 'OperationalAutomationsAPI' });

/*
 * An id from the registry and a boolean. Nothing else.
 *
 * The COLUMN is never taken from the request — it is looked up from the id
 * against the registry, so a caller cannot name a column and have it written.
 */
const DecisionSchema = z.object({
  id: z.enum(['reply_to_enquiries', 'chase_invoices', 'chase_intake', 'remind_about_meeting']),
  enabled: z.boolean(),
  /*
   * Settings, for the one automation that has any.
   *
   * The meeting reminder is the first with a shape beyond on/off: a lead time,
   * because the right answer differs by trade, and two audiences, because the
   * owner wanting their own copy is a separate question from the client
   * getting one.
   *
   * Bounded here AND by a CHECK on the column. The schema gives the caller a
   * clear 400 instead of a database error, and the constraint means a second
   * writer cannot get round it.
   */
  hoursBefore: z.number().int().min(1).max(168).optional(),
  notifyClient: z.boolean().optional(),
  notifyOwner: z.boolean().optional(),
});

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, enabled, hoursBefore, notifyClient, notifyOwner } = DecisionSchema.parse(body);

    // The column comes from the registry, never from the caller.
    const automation = automationById(id);
    if (!automation) {
      return NextResponse.json({ success: false, error: 'Unknown automation' }, { status: 400 });
    }

    /*
     * Approving clears the decline, declining records it.
     *
     * Read-modify-write rather than an array operator so the two stay
     * consistent: somebody who declines and later approves must not be left
     * with permission granted AND a decline on file, which would read as a no
     * to anyone looking at the row.
     */
    const { data: current } = await supabaseServer
      .from('business_profiles')
      .select('automations_declined')
      .eq('user_id', user.id)
      .maybeSingle();

    const existing = Array.isArray(current?.automations_declined)
      ? (current!.automations_declined as string[])
      : [];

    const nextDeclined = enabled
      ? existing.filter(entry => entry !== id)
      : [...new Set([...existing, id])];

    /*
     * Settings are written whether or not the automation is being switched on,
     * so the owner can adjust the lead time of one already running without
     * having to toggle it off and back.
     *
     * Each is written only when the caller sent it: an absent field means "do
     * not change", not "set to false" — otherwise the card's on/off button
     * would silently reset the audience every time it was pressed.
     */
    const settings: Record<string, unknown> = {};

    if (id === 'remind_about_meeting') {
      if (hoursBefore !== undefined) settings.meeting_reminder_hours_before = hoursBefore;
      if (notifyClient !== undefined) settings.meeting_reminder_notify_client = notifyClient;
      if (notifyOwner !== undefined) settings.meeting_reminder_notify_owner = notifyOwner;

      /*
       * Somebody has to receive it.
       *
       * Checked against the RESULT, not against the request: a caller sending
       * `notifyClient: false` on a business whose owner copy is already off
       * leaves an automation switched on with nobody to send to — a setting
       * that looks active on the card and does nothing every time it runs.
       *
       * Read separately and only for this automation, because Postgres rejects
       * an entire select for one unknown column and the other three decisions
       * must keep working wherever this migration has not run.
       */
      if (enabled && (notifyClient === false || notifyOwner === false)) {
        const { data: audience, error: audienceError } = await supabaseServer
          .from('business_profiles')
          .select('meeting_reminder_notify_client, meeting_reminder_notify_owner')
          .eq('user_id', user.id)
          .maybeSingle();

        // Unreadable means the columns are not there yet, and the stored
        // audience is therefore the default: both on.
        const stored = audienceError ? null : audience;

        const toClient = notifyClient ?? stored?.meeting_reminder_notify_client !== false;
        const toOwner = notifyOwner ?? stored?.meeting_reminder_notify_owner !== false;

        if (!toClient && !toOwner) {
          return NextResponse.json(
            { success: false, error: 'Choose at least one person to remind' },
            { status: 400 }
          );
        }
      }
    }

    const decision = {
      [automation.column]: enabled,
      automations_declined: nextDeclined,
      updated_at: new Date().toISOString(),
    };

    /*
     * The answer first, the settings second.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * One update carrying both would take the ANSWER down with the settings on
     * a database where the reminder's columns have not been added yet: Postgres
     * rejects the whole statement for one unknown column, so an owner pressing
     * Approve on any automation would get a 500 and no record of having
     * answered.
     *
     * Split, the decision is always recorded. A settings write that cannot land
     * is reported as a warning and the automation runs on its defaults, which
     * is the behaviour of every business that has never opened these controls.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { error } = await supabaseServer
      .from('business_profiles')
      .update(decision)
      .eq('user_id', user.id);

    if (error) throw error;

    if (Object.keys(settings).length > 0) {
      const { error: settingsError } = await supabaseServer
        .from('business_profiles')
        .update(settings)
        .eq('user_id', user.id);

      if (settingsError) {
        requestLogger.warn(
          { err: settingsError, userId: user.id, automation: id },
          'Automation settings not saved; the automation runs on its defaults'
        );
      }
    }

    requestLogger.info({ userId: user.id, automation: id, enabled }, 'Automation permission set');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    requestLogger.error({ err: error }, 'Failed to set an automation permission');
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
