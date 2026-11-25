/**
 * How one client has behaved, for the badge in their drawer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READS THE SNAPSHOT, FALLS BACK TO COMPUTING.
 *
 * The nightly job already took today's picture, and reading it is one indexed
 * row against five table scans. A band is a judgement over 180 days — a few
 * hours do not move it — so the stored answer is the right one to show.
 *
 * The fallback matters for the case the table cannot cover: a business whose
 * first client arrived after last night's run, where "no row" means "not yet
 * looked at", never "nothing to say". It computes once, and the next run
 * records it.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT RETURN ──────────────────────────────────
 * No sentence, no label, no adjective. A band and the counts behind it: the
 * surface writes the words, in the reader's own language, and can always show
 * its workings. This is the one screen that makes a claim about a PERSON, and
 * it may be read with that person in the room.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { computeClientStandings } from '@/lib/business-os/clients/clientStandingStore';
import { displayScore } from '@/lib/business-os/clients/clientScore';
import { earlierOf, trendFrom } from '@/lib/business-os/clients/clientTrend';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'ClientStandingAPI' });

const ParamsSchema = z.object({ id: z.string().uuid() });

/*
 * `profileFromRow` and `standingFor` used to rebuild a client's record from the
 * stored row. Both are gone: the badge now reads the SAME live computation the
 * Needs-You card does, so a client cannot be described one way beside their
 * name and another way on the dashboard. The snapshots keep the one job only
 * they can do — the history behind the trend.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid contact' }, { status: 400 });
    }
    const contactId = parsed.data.id;

    /* Scoped to the caller: these rows describe a third party, and one missing
       scope would show one business another's people (CLAUDE.md rule 4). */
    /*
     * Every picture of this client, not just the latest.
     *
     * There are only ever a handful — a row is written when the band moves, and
     * otherwise at most weekly — and the older ones are what make the direction
     * knowable. Reading them in one query is cheaper than the second round trip
     * it would take to ask for them separately.
     */
    const { data: rows, error } = await supabaseServer
      .from('crm_client_standing')
      .select('*')
      .eq('user_id', user.id)
      .eq('contact_id', contactId)
      .order('as_of', { ascending: false });

    if (error) throw error;

    /*
     * ── THE BAND AND THE FIGURE COME FROM ONE LIVE READING ────────────────
     *
     * The stored row carries a band but no score, and the Needs-You card
     * computes both fresh. Serving a stored word beside a computed figure is
     * how the two surfaces drift apart — and this is the one screen that makes
     * a claim about a person, so they must agree.
     *
     * The snapshots keep their job: the history behind the trend, which is the
     * only thing a live computation cannot produce.
     */
    const live = await computeClientStandings(supabaseServer, user.id);
    const current = live.find(entry => entry.contactId === contactId);

    const stored = rows?.[0];
    if (stored && current) {
      const standing = current.standing;
      const history = (rows ?? []).map(row => ({ band: String(row.band), as_of: String(row.as_of) }));

      return NextResponse.json({
        success: true,
        data: {
          ...standing,
          /* The counts come from the live reading too, so the figure and the
             facts under it are the same reading. */
          profile: current.profile,
          score: displayScore(current.score),
          asOf: stored.as_of,
          /* Null until there is a picture old enough to compare against — the
             first weeks after this ships have none, and an invented direction
             is the most consequential thing this badge could get wrong. */
          trend: trendFrom({
            current: { band: standing.band, asOf: String(stored.as_of) },
            earlier: earlierOf(history.slice(1), String(stored.as_of)),
          }),
          source: 'snapshot',
        },
      });
    }

    if (!current) {
      /* No activity in the window at all. `new` is the honest answer and the
         badge renders nothing for it. */
      return NextResponse.json({
        success: true,
        data: { band: 'new', reasons: [], missRate: null, lateRate: null, score: 0, trend: null, source: 'none' },
      });
    }

    /* Measured, but never yet recorded — so there is no history to read a
       direction from. The next nightly run gives it one. */
    return NextResponse.json({
      success: true,
      data: {
        ...current.standing,
        profile: current.profile,
        score: displayScore(current.score),
        trend: null,
        source: 'computed',
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not read client standing');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read this client record',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
