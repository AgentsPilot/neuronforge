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
  id: z.enum(['reply_to_enquiries', 'chase_invoices', 'chase_intake']),
  enabled: z.boolean(),
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
