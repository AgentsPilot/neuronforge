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
 * It does not email anybody UNLESS ASKED. Extending is a decision about the
 * offer; whether the client hears about it is the owner's choice, made per
 * quote with the dialog's "let them know" toggle (`notify_client`). Without
 * it a quote is extended quietly, so an owner tidying up lapsed rows still
 * fires no emails they never asked for.
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
import { sendQuoteReminder } from '@/lib/services/ProposalSendService';

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
  /*
   * The owner's own choice, made per quote in the dialog. Absent means no:
   * an older client or any other caller keeps the quiet extend it always had.
   */
  notify_client: z.boolean().optional().default(false),
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
    /*
     * ── THE DATE IT USED TO LAPSE, READ BEFORE IT IS OVERWRITTEN ────────────
     *
     * `extended_from` is the old `valid_until`, and an UPDATE cannot reference a
     * column's previous value through PostgREST. So it is read first — which
     * does NOT reopen the race the conditional write below closes: that write
     * still carries `.eq('status', 'expired')`, so a second press matches no
     * row whatever this read returned, and only the extend path ever writes
     * `valid_until` on an expired quote.
     *
     * A read that finds nothing is not an error here. The UPDATE's own filter
     * is the authority on whether this quote can be extended, and it answers
     * with a 409 below.
     */
    const { data: before } = await supabaseServer
      .from('proposals')
      .select('valid_until')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    const extendedAt = new Date().toISOString();

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
        /*
         * The act, recorded on the row rather than only in the audit trail.
         *
         * Without these two the extension left no trace: afterwards the quote
         * was indistinguishable from one simply sent with a later date, so
         * every surface still described it by `sent_at` and an owner who had
         * just extended it saw the same card, dated three days earlier, and
         * concluded nothing had happened. Written as a pair, which the
         * `proposals_extension_is_whole` constraint requires.
         */
        extended_at: extendedAt,
        extended_from: (before?.valid_until as string | null) ?? null,
        updated_at: extendedAt,
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'expired')
      .select('id, contact_id, title, valid_until, extended_at, extended_from')
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

    /*
     * ── TELLING THE CLIENT, ONLY WHEN THE OWNER TICKED IT ───────────────────
     *
     * After the extend, never instead of it: the quote is open again whatever
     * happens to the email, so a failed send is reported beside a success
     * rather than turning the whole action into an error. Awaited so the
     * dialog can say "extended, but the email did not go" truthfully.
     */
    let notified: boolean | undefined;
    if (parsed.data.notify_client) {
      const outcome = await sendQuoteReminder(id, user.id, { variant: 'extended' });
      notified = outcome.ok;
      if (!outcome.ok) {
        requestLogger.warn(
          { proposalId: id, reason: outcome.reason },
          'Quote extended, but the client was not emailed'
        );
      }
    }

    return NextResponse.json({ success: true, data: { ...extended, notified } });
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
