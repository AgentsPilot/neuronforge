/**
 * A client's refund requests, for the contact drawer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ ONLY, AND IT EXISTS FOR WHAT THE LEDGER CANNOT SAY.
 *
 * `payment_transactions` records that ₪20 went back. It cannot record that the
 * client asked for ₪300, that they said the session never happened, or what
 * the owner decided about the rest. The card that carried all of that
 * disappears the moment the request is settled — by design, because a settled
 * request is not work — and without this the asking disappears with it.
 *
 * So a partial refund reads as a decision nobody explained, three weeks later,
 * to the person who made it.
 *
 * Every status is returned, terminal ones included: a settled request is
 * precisely what somebody opening the drawer is trying to understand.
 *
 * It moves no money and cannot be made to. The refund itself is
 * `RefundService`, reached through `/api/payments/refunds`, and the owner's
 * yes/no is `./decide`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { refundRequestRepository } from '@/lib/repositories/RefundRequestRepository';

const logger = createLogger({ module: 'RefundRequestsAPI' });

const querySchema = z.object({
  contact_id: z.string().uuid(),
  /* Twenty is already far more than any one client produces; the parameter
     exists so a future caller is not forced to add one. */
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * Read from `request.url` rather than `nextUrl`. Several suites build a
     * plain `Request`, which has no `nextUrl` at all — the same reason the
     * portal's manage route reads it this way.
     */
    const params = new URL(request.url).searchParams;
    const parsed = querySchema.parse({
      contact_id: params.get('contact_id'),
      ...(params.get('limit') ? { limit: params.get('limit') } : {}),
    });

    const { data, error } = await refundRequestRepository.listForContact(
      parsed.contact_id,
      /* The account comes from the session and nowhere else. A contact id in
         a query string says which client, never whose business. */
      user.id,
      parsed.limit
    );

    if (error) {
      requestLogger.error(
        { err: error, userId: user.id, contactId: parsed.contact_id },
        "Could not read a client's refund requests"
      );
      return NextResponse.json(
        { success: false, error: 'Failed to load refund requests' },
        { status: 500 }
      );
    }

    /*
     * No audit entry: this is a read of the owner's own data by the owner, the
     * same as the invoice and transaction lists this sits beside. Auditing it
     * would bury the writes that matter.
     */
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Refund requests request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
