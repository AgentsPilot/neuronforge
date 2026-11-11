/**
 * Documents this owner has already had accepted, to start a new one from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO TEMPLATE TABLE, AND THAT IS THE DESIGN
 *
 * "Save as template" asks the owner to decide at the wrong moment: at save time
 * they do not yet know whether a job will recur. They know at CREATE time. It
 * is also an extra action on every quote to benefit a few, and a saved template
 * goes stale while the real quotes move on.
 *
 * So every proposal IS the template. The material is `proposals.content`, which
 * already exists, and this route is a read over it. Nothing is saved, named or
 * maintained.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ACCEPTED ONLY
 *
 * A document a client agreed to is proven. A sent-and-ignored one is the
 * owner's intention and nothing more, and offering it back would quietly
 * propagate whatever stopped it working.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CALLED WHEN THE BUILDER OPENS, NEVER BEFORE
 *
 * Not on the contact drawer, not on the booking tab, not on the quote dialog.
 * An owner who never opens the builder — the therapist, the consultant — pays
 * nothing for a feature they do not use, which is the rule the whole of this
 * work follows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { subtotalOf, type ProposalContent } from '@/lib/business-os/proposals/proposalContent';

const logger = createLogger({ module: 'proposals-reusable' });

const querySchema = z.object({
  /** Ranked first when it matches. The same job for the same service recurs. */
  service_id: z.string().uuid().nullable().optional(),
});

/** Three is a list a person reads. More is a search, and this is not one. */
const OFFERED = 3;

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    service_id: request.nextUrl.searchParams.get('service_id') || null,
  });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  try {
    /*
     * A small window, not the whole history.
     *
     * Twenty accepted quotes is far more than the three that get offered, and
     * it keeps the ranking below working on a bounded set rather than on
     * everything an established business has ever sold.
     */
    const { data: rows, error } = await supabaseServer
      .from('proposals')
      .select('id, title, total, currency, service_id, content, decided_at, created_at')
      .eq('user_id', user.id)
      .eq('status', 'accepted')
      .not('content', 'is', null)
      .order('decided_at', { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) throw error;

    const candidates = (rows ?? [])
      .filter(row => (row.content as ProposalContent | null)?.items?.length)
      /*
       * Same service first, then most recently accepted.
       *
       * `sort` is stable, so the query's ordering survives inside each group
       * and this only has to express the one preference the query could not.
       */
      .sort((a, b) => {
        const aMatch = parsed.data.service_id && a.service_id === parsed.data.service_id ? 0 : 1;
        const bMatch = parsed.data.service_id && b.service_id === parsed.data.service_id ? 0 : 1;
        return aMatch - bMatch;
      })
      .slice(0, OFFERED)
      .map(row => {
        const content = row.content as ProposalContent;
        return {
          id: row.id,
          title: row.title,
          total: row.total,
          currency: row.currency,
          /* So the owner recognises the job by its size as well as its name. */
          itemCount: content.items.length,
          subtotal: subtotalOf(content.items),
          acceptedAt: row.decided_at ?? row.created_at,
          sameService: Boolean(parsed.data.service_id && row.service_id === parsed.data.service_id),
          content,
        };
      });

    return NextResponse.json({ success: true, proposals: candidates });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not read reusable proposals');
    /*
     * An empty list, not a failure.
     *
     * This is an offer to save typing. If it cannot be made, the builder opens
     * blank — which is exactly what it does for an owner writing their first
     * quote, and a perfectly good outcome.
     */
    return NextResponse.json({ success: true, proposals: [] });
  }
}
