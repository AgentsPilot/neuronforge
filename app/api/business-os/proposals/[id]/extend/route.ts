/**
 * POST /api/business-os/proposals/[id]/extend — put a lapsed quote back on the table.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY MOVE LEFT ON AN EXPIRED QUOTE
 *
 * Once a quote's date has passed the client cannot act at all — their page
 * refuses the acceptance, correctly. Until now the business could not act
 * either: `valid_until` is settable only when a quote is written, and the
 * create route rejects a date "already in the past", so there was no way to
 * give an offer more time. The only route back was writing a second quote.
 *
 * Meanwhile My Day went on telling the owner to CHASE it, which sent the
 * client to the page that turns them away. This endpoint is the honest action
 * that card should have had: name a new date, and the same offer stands again.
 *
 * ── WHY IT TAKES A DATE RATHER THAN ADDING A FIXED PERIOD ───────────────────
 *
 * How long to hold a price is a commercial decision, not a default. A fortnight
 * suits a consultancy and is far too long for a venue holding a Saturday. The
 * dialog proposes two weeks because something must be in the field; the owner
 * is the one who answers.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 * It does not email anybody. Extending is a decision about the offer, and
 * whether the client hears about it is a separate choice the owner makes with
 * the reminder they already have. Sending here would mean a quote could not be
 * quietly extended, and an owner tidying up three lapsed rows would fire three
 * emails they never asked for.
 *
 * It moves ONLY `expired` rows. A quote somebody has answered — accepted,
 * declined, stopped — is not re-opened by a new date, and a live one needs no
 * extending; both are refused with a reason the card can say out loud.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'API', service: 'ProposalExtend' });
const auditTrail = AuditTrailService.getInstance();

/** A calendar day, read in the business's own reckoning — not an instant. */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const bodySchema = z.object({
  /*
   * Bounded at both ends. In the past is the thing being fixed, so a date
   * that is already gone would leave the quote exactly where it started; two
   * years out is not an offer, it is a forgotten row, and the create route
   * refuses the same shape for the same reason.
   */
  valid_until: dateKey
    .refine(value => !Number.isNaN(Date.parse(`${value}T23:59:59Z`)), 'Not a real date')
    .refine(
      value => new Date(`${value}T23:59:59Z`).getTime() > Date.now(),
      'That date has already passed'
    )
    .refine(
      value =>
        new Date(`${value}T23:59:59Z`).getTime() <
        Date.now() + 2 * 365 * 24 * 60 * 60 * 1000,
      'That date is implausibly far ahead'
    ),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid date' },
        { status: 400 }
      );
    }

    /*
     * ── ONE CONDITIONAL WRITE, NOT A READ THEN A WRITE ──────────────────────
     *
     * The status filter is part of the UPDATE rather than a check before it, so
     * two cards pressed at once cannot both extend — the second matches no row.
     * It also means a quote the client accepted in the same minute is never
     * dragged back to `sent`: the row has moved on and no longer matches.
     *
     * `.eq('user_id')` because this is a caller-supplied id (CLAUDE.md rule 4);
     * the service role would otherwise reach any business's quote.
     */
    const { data: extended, error } = await supabaseServer
      .from('proposals')
      .update({
        valid_until: parsed.data.valid_until,
        /*
         * Back to `sent`, not `viewed`. The client's earlier look was at an
         * offer that has since lapsed; this is a fresh window, and whether
         * they have seen THIS one is a question only their next visit answers.
         */
        status: 'sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'expired')
      .select('id, contact_id, title, valid_until')
      .maybeSingle();

    if (error) {
      requestLogger.error({ err: error, proposalId: id }, 'Could not extend the quote');
      return NextResponse.json(
        { success: false, error: 'Could not extend the quote' },
        { status: 500 }
      );
    }

    if (!extended) {
      /*
       * One answer for two cases, deliberately: the quote is not this
       * business's, or it is not expired. Telling the caller which would say
       * whether a given id exists on another account.
       */
      return NextResponse.json(
        {
          success: false,
          code: 'not_expired',
          error: 'That quote is not waiting to be extended',
        },
        { status: 409 }
      );
    }

    auditTrail
      .log({
        action: 'PROPOSAL_EXTENDED',
        entityType: 'proposal',
        entityId: id,
        userId: user.id,
        severity: 'info',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { proposalId: id, validUntil: parsed.data.valid_until },
      'Expired quote put back on the table'
    );

    return NextResponse.json({ success: true, data: extended });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
