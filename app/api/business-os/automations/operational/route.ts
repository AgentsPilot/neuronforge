/**
 * What the platform has permission to do for this business.
 *
 * GET  — every operational automation, whether it is approved, and how many
 *        things are waiting on it right now.
 * PUT  — approve or decline one of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COUNT IS THE POINT
 *
 * The advisor asks "three invoices are past due — shall I chase them from now
 * on?" rather than "enable invoice chasing". The first is a decision somebody
 * can make; the second is a checkbox they skip. That sentence needs the gap
 * registry, which is why this route reads it rather than returning three
 * booleans.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { OPERATIONAL_AUTOMATIONS, automationById } from '@/lib/business-os/gaps/automations';
import { findGaps } from '@/lib/business-os/gaps/findGaps';
import { z } from 'zod';

const logger = createLogger({ module: 'OperationalAutomationsAPI' });

/*
 * An id from the registry and a boolean. Nothing else.
 *
 * The COLUMN is never taken from the request — it is looked up from the id
 * against the registry, so a caller cannot name a column and have it written.
 */
const DecisionSchema = z.object({
  id: z.enum(['reply_to_enquiries', 'chase_invoices', 'chase_intake']),
  enabled: z.boolean(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const columns = [...OPERATIONAL_AUTOMATIONS.map(a => a.column), 'automations_declined'].join(', ');

    /*
     * Its own read, tolerant of a missing column.
     *
     * Postgres rejects the whole select for one unknown column, so folding
     * these into a wider profile read would take the advisor down everywhere
     * the migration has not run. Unreadable means "not approved", which is the
     * safe direction: it fails to NOT acting on somebody's behalf.
     */
    let approvals: Record<string, unknown> = {};
    try {
      const { data, error } = await supabaseServer
        .from('business_profiles')
        .select(columns)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      approvals = (data ?? {}) as unknown as Record<string, unknown>;
    } catch (err) {
      requestLogger.warn({ err }, 'Automation permissions unreadable; reporting all as not approved');
    }

    const gaps = await findGaps(user.id, { named: 0 });
    const waitingByGap = new Map(gaps.map(gap => [gap.id, gap.count]));

    /*
     * Three states, not two.
     *
     * A boolean cannot tell "said no" from "never asked", so a decline is kept
     * in its own list. The advisor asks about anything in neither — approved
     * ones are a setting now, declined ones were answered.
     */
    const declined = new Set(
      Array.isArray(approvals.automations_declined)
        ? (approvals.automations_declined as string[])
        : []
    );

    const automations = OPERATIONAL_AUTOMATIONS.map(automation => ({
      id: automation.id,
      enabled: Boolean(approvals[automation.column]),
      declined: declined.has(automation.id),
      waiting: waitingByGap.get(automation.gapId) ?? 0,
      labelKey: automation.labelKey,
      hintKey: automation.hintKey,
    }));

    return NextResponse.json({ success: true, automations });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read operational automations');
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, enabled } = DecisionSchema.parse(body);

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

    const { error } = await supabaseServer
      .from('business_profiles')
      .update({
        [automation.column]: enabled,
        automations_declined: nextDeclined,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (error) throw error;

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
