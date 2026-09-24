/**
 * The ledger check behind the admin screen's "did calls actually stop?" panel.
 *
 * ── What this endpoint is careful NOT to be ──────────────────────────────
 * `isBosLlmAreaEnabled` FAILS OPEN: a settings-read failure on a newly started
 * instance silently re-enables a switched-off area. So nothing here — not one
 * string — asserts that an area is off. It reports what the ledger recorded,
 * with the two reasons that is only corroboration (`LEDGER_CHECK_CAVEAT`).
 *
 * ── Three readings, and only one of them means anything ──────────────────
 * "No calls observed" is MEANINGLESS on a quiet area: `briefing` is daily,
 * `insights` is cron-driven, `onboarding` is sporadic. Without a before-window
 * baseline the panel would print its most reassuring sentence exactly where it
 * proves least. So the route reads the same-length window before the change
 * and returns a third reading that says the ledger cannot answer.
 *
 * ── The window starts 60 seconds late, on purpose ────────────────────────
 * `token_usage` is written AFTER the provider call resolves, and instances
 * cache settings for `BOS_LLM_SETTINGS_CACHE_MS`. A call that began before the
 * switch therefore lands in the ledger after it. Counting from the save moment
 * would show "calls still arriving" for a switch that held perfectly.
 *
 * ── Chat is answered before any read ─────────────────────────────────────
 * `AIDataLayerService` calls the provider directly and writes no ledger row,
 * so for chat the ledger is blind. That is decided HERE, before the repository
 * is touched: the readings are never produced (not merely hidden by the
 * client), and a chat request issues no cross-tenant read at all.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §3.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { BOS_LLM_AREAS, bosFeature } from '@/lib/business-os/llm/callCatalog';
import {
  LEDGER_CHECK_CAVEAT,
  LEDGER_READING_TEXT,
  type LedgerReadingKind,
} from '@/lib/business-os/llm/ledgerCheckCopy';
import { BOS_LLM_SETTINGS_CACHE_MS } from '@/lib/business-os/llm/modelSettings';
import { createLogger } from '@/lib/logger';
import { tokenUsageRepository } from '@/lib/repositories/TokenUsageRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosLlmSettingsLedgerAPI' });

/**
 * How far back a `since` may reach.
 *
 * The observation window is `now − (since + 60 s)` and the baseline is the
 * same length again, so an UNBOUNDED `since` turns one URL into two
 * `count: 'exact'` scans over the whole of `token_usage` — the largest table
 * in the system. `assertWindow` only checks `start <= end`, so the bound has
 * to live here. Admin-gated, so this is not a security hole; it is an
 * unbounded scan reachable from a query string.
 *
 * A day is far beyond the question this panel answers ("did calls stop after I
 * saved?"), and it is REFUSED rather than silently clamped. A clamp would be
 * worse than a refusal here: the counts would still be captioned "since your
 * change" while covering a different period — the overclaim this panel exists
 * to avoid, with the wrong part being the caption rather than the number.
 *
 * NOTE what this bounds: the AGE OF THE CHANGE, not the span the two reads
 * cover. With `since` at the limit the baseline reaches the same length again
 * before it, so the pair can look back about 48 hours in total. The refusal
 * text says so (QA DEF-5).
 */
const MAX_SINCE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How far into the FUTURE a `since` may sit.
 *
 * `since` is a save timestamp, so a future one is nonsense — but the app
 * server and the database can disagree by a second or two, and `too_soon`
 * already covers "saved a moment ago". Beyond that tolerance it is refused
 * rather than answered: without this, `2099-01-01` returned 200 `too_soon`
 * saying *"about 60 seconds"* — false by 73 years (QA DEF-1).
 *
 * No database read was reachable that way, so it was contained; but the
 * route's principle is refuse-never-guess, and it has to hold in BOTH
 * directions or it is not a principle.
 */
const MAX_SINCE_SKEW_MS = 2 * 60 * 1000;

/**
 * `since` is a caller-supplied timestamp that feeds a cross-tenant read, so it
 * is validated before it reaches anything. The area is a closed enum — the
 * `feature` is DERIVED from it and is never accepted from the request.
 */
const querySchema = z.object({
  area: z.enum(BOS_LLM_AREAS),
  since: z
    .string()
    .datetime({ offset: true })
    .refine((value) => !Number.isNaN(Date.parse(value)), 'since must be a valid timestamp'),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      area: url.searchParams.get('area'),
      since: url.searchParams.get('since'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'An area and a since timestamp are required' },
        { status: 400 }
      );
    }

    const { area, since } = parsed.data;

    // Chat, before any read. See the header.
    if (area === 'chat') {
      const kind: LedgerReadingKind = 'ledger_cannot_answer';
      return NextResponse.json({
        success: true,
        data: {
          area,
          kind,
          reading: LEDGER_READING_TEXT[kind],
          caveat: LEDGER_CHECK_CAVEAT,
          // No counts at all — there is nothing honest to put here.
          after: null,
          before: null,
        },
      });
    }

    const savedAt = new Date(since);
    const now = new Date();

    // Bounded in BOTH directions, before the windows are computed — the
    // window length is derived from `since`, so an old one sizes the scan and
    // a future one makes every reading meaningless.
    const ageMs = now.getTime() - savedAt.getTime();

    if (ageMs > MAX_SINCE_AGE_MS) {
      requestLogger.warn(
        { userId: user.id, area, since },
        'Ledger check refused: the change is older than the maximum window'
      );
      return NextResponse.json(
        {
          success: false,
          // A MACHINE-READABLE reason beside the sentence. The screen must
          // render this refusal as "too long ago to check" and NOT as an
          // error (RC-D): every seeded row is days old, so this is the branch
          // the panel takes on load for every area. Inferring it from the
          // message text would make a copy edit a UI bug.
          reason: 'too_long_ago',
          error:
            'The ledger check only works for a change made in the last 24 hours. (It also reads the same length of time before the change, so the two reads together look back about 48 hours.) For an older change, use the audit trail instead.',
        },
        { status: 400 }
      );
    }

    if (-ageMs > MAX_SINCE_SKEW_MS) {
      requestLogger.warn(
        { userId: user.id, area, since },
        'Ledger check refused: the change time is in the future'
      );
      return NextResponse.json(
        {
          success: false,
          reason: 'since_in_future',
          error: 'That change time is in the future, so there is nothing to check yet.',
        },
        { status: 400 }
      );
    }

    const observationStart = new Date(savedAt.getTime() + BOS_LLM_SETTINGS_CACHE_MS);

    if (observationStart >= now) {
      const kind: LedgerReadingKind = 'too_soon';
      return NextResponse.json({
        success: true,
        data: {
          area,
          kind,
          reading: LEDGER_READING_TEXT[kind],
          caveat: LEDGER_CHECK_CAVEAT,
          observationStartsAt: observationStart.toISOString(),
          after: null,
          before: null,
        },
      });
    }

    const feature = bosFeature(area);
    const windowMs = now.getTime() - observationStart.getTime();

    const [afterResult, beforeResult] = await Promise.all([
      tokenUsageRepository.summariseFeatureAllAccountsInWindow(
        { start: observationStart, end: now },
        feature
      ),
      // The same length, ending at the change — so "quiet area" and "switch
      // held" are told apart by comparable numbers, not by a guess.
      tokenUsageRepository.summariseFeatureAllAccountsInWindow(
        { start: new Date(savedAt.getTime() - windowMs), end: savedAt },
        feature
      ),
    ]);

    // `data` is asserted through a guard rather than `!`: a
    // `{ data: null, error: null }` result would otherwise throw inside the
    // happy path and surface as a bare 500 instead of a classified failure.
    const after = afterResult.data;
    const before = beforeResult.data;
    if (afterResult.error || beforeResult.error || !after || !before) {
      throw afterResult.error ?? beforeResult.error ?? new Error('Ledger check returned no data');
    }

    const kind: LedgerReadingKind =
      after.count > 0
        ? 'still_arriving'
        : before.count > 0
          ? 'stopped_with_before'
          : 'no_traffic_either';

    requestLogger.info(
      { userId: user.id, area, kind, afterCount: after.count, beforeCount: before.count },
      'Business OS LLM ledger check read'
    );

    return NextResponse.json({
      success: true,
      data: {
        area,
        kind,
        reading: LEDGER_READING_TEXT[kind],
        caveat: LEDGER_CHECK_CAVEAT,
        observationStartsAt: observationStart.toISOString(),
        after,
        before,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error, userId: user.id }, 'Ledger check failed');
    return NextResponse.json(
      { success: false, error: 'Could not read the ledger check' },
      { status: 500 }
    );
  }
}
