/**
 * POST /api/admin/model-pricing/apply: an admin applies one pending price (the
 * per-row Apply) or several (bulk), AI model price review slice 8 (MP-FR-8,
 * MP-FR-9, MP-FR-10, MP-FR-14; UF-3; SA RC-1..RC-16).
 *
 * THIS IS THE ONE IN-APP WRITER OF LIVE PRICES. The write itself happens in the
 * database function `ai_price_apply_lines`, all or nothing: it locks, checks
 * that each line is still pending and that the price charged today still
 * matches its snapshot, retires the old live row, inserts the new one with its
 * provenance, and records the apply batch. Charges pick the new price up on
 * every server within 1 hour; already recorded charges are never re-priced.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod (line ids and the admin's own reasons,
 *   nothing else) → read the lines → still pending? → today's prices,
 *   recomputed (the in-code half of the stale check, RC-6) → bounds and
 *   blocking flags re-run (RC-7) → override reasons match the stored flags →
 *   the margin prompt, computed here (B-1..B-3) → the function → the cache
 *   refresh on this server, bounded (F-5) → one audit entry per line, in ONE
 *   logAndFlush call before the response (RC-12) → result.
 *
 * ── Authorisation (tenant-isolation-guard) ──────────────────────────────
 *   The lines are platform reference data with no owner: the boundary is
 *   "platform admin or not". Any active admin may apply any pending line (Q2).
 *   The admin id comes from the session, never the body, and the function
 *   repeats the admin_users check. The body carries ids and reasons only; every
 *   price written is read by the function from the locked line.
 *
 * ── Answers ──────────────────────────────────────────────────────────────
 *   400 invalid body · 401/403 gate · 403 no admin_users row · 404 unknown line
 *   · 409 not_pending / stale / starts_later / busy · 422 refused /
 *   override_required / override_not_needed · 500 anything else.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { refreshPricingCache } from '@/lib/ai/pricing';
import { auditPricesOf, EFFECTIVE_WORDS, isLineStale, marginItemsFor, reviewLineForApply } from '@/lib/ai/pricing-research/applyDecision';
import { ApplyBodySchema } from '@/lib/ai/pricing-research/applySchema';
import { loadPricingSnapshot } from '@/lib/ai/pricing-research/comparisonModel';
import { answerForDatabaseError, decisionAnswer, type DecisionAnswer } from '@/lib/ai/pricing-research/decisionErrors';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import { createLogger } from '@/lib/logger';
import { aiPriceApplyRepository } from '@/lib/repositories/AiPriceApplyRepository';
import { aiPriceProposalRepository } from '@/lib/repositories/AiPriceProposalRepository';
import type { AiPriceDecisionLine } from '@/lib/repositories/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'ModelPricingApplyAPI' });
const ROUTE = '/api/admin/model-pricing/apply';

/**
 * F-5: the cache refresh after Apply is bounded. A hung shared read would hold
 * every async price lookup on this server; past this wait the Apply still
 * answers, because the claim is only "within 1 hour".
 */
const REFRESH_WAIT_MS = 2_000;

function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

function refused(answer: DecisionAnswer, problems?: Array<{ path: string; message: string }>) {
  return NextResponse.json(
    { success: false, error: answer.error, code: answer.code, lineIds: answer.lineIds, ...(problems ? { problems } : {}) },
    { status: answer.status }
  );
}

/** The refresh, bounded (F-5). Resolves to how it ended; never throws. */
async function refreshWithin(ms: number): Promise<'done' | 'timeout' | 'failed'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([refreshPricingCache().then(() => 'done' as const), timeout]);
  } catch {
    return 'failed';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement: nothing above it reads the body or touches the database.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;
  // QA edge case: once the function has committed, no later failure may answer "nothing was changed".
  let committed = false;

  try {
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = ApplyBodySchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ adminUserId: adminId, issues: parsed.error.issues.length }, 'Rejected an apply with invalid input');
      return refused(
        decisionAnswer('invalid_input'),
        parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      );
    }
    const requested = parsed.data.lines;
    const ids = requested.map((line) => line.lineId);

    const { data: lines, error: readError } = await aiPriceProposalRepository.findLinesForDecision(ids);
    if (readError || !lines) {
      requestLogger.error({ err: readError, adminUserId: adminId }, 'Apply could not read its lines');
      return NextResponse.json(
        { success: false, error: 'The prices could not be applied.', details: devDetails(readError) },
        { status: 500 }
      );
    }
    const byId = new Map(lines.map((line) => [line.id, line]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) return refused(decisionAnswer('not_found', missing));
    const notPending = ids.filter((id) => byId.get(id)?.state !== 'pending');
    if (notPending.length > 0) return refused(decisionAnswer('not_pending', notPending));

    const ordered = ids.map((id) => byId.get(id) as AiPriceDecisionLine);
    const snapshot = await loadPricingSnapshot();

    // RC-6 / RC-7: today's prices recomputed with the same code that recorded the line.
    const reviews = ordered.map((line) => ({ line, review: reviewLineForApply(snapshot, line) }));
    const stale = reviews
      .filter(({ line, review }) => isLineStale(snapshot, line) || review.blockingChanged)
      .map(({ line }) => line.id);
    if (stale.length > 0) {
      requestLogger.warn({ adminUserId: adminId, staleLines: stale.length }, 'Apply refused: the price charged today changed');
      return refused(decisionAnswer('stale', stale));
    }
    const refusedLines = reviews.filter(({ review }) => review.refusals.length > 0);
    if (refusedLines.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Nothing was applied. A price is outside the allowed bounds.',
          code: 'refused',
          lineIds: refusedLines.map(({ line }) => line.id),
          problems: refusedLines.flatMap(({ line, review }) => review.refusals.map((message) => ({ path: line.id, message }))),
        },
        { status: 422 }
      );
    }
    const overrideMissing = requested
      .filter((item) => reviews.find(({ line }) => line.id === item.lineId)?.review.blockingFlags.length && !item.overrideReason)
      .map((item) => item.lineId);
    if (overrideMissing.length > 0) return refused(decisionAnswer('override_required', overrideMissing));
    const overrideNeedless = requested
      .filter((item) => item.overrideReason && !reviews.find(({ line }) => line.id === item.lineId)?.review.blockingFlags.length)
      .map((item) => item.lineId);
    if (overrideNeedless.length > 0) return refused(decisionAnswer('override_not_needed', overrideNeedless));

    const margin = marginItemsFor(snapshot, ordered);

    // An explicit allow-list: ids and the admin's words only; the function reads every price itself.
    const { data: applied, error: applyError } = await aiPriceApplyRepository.applyLines({
      adminUserId: adminId,
      lines: requested.map((item) =>
        item.overrideReason === undefined
          ? { line_id: item.lineId, reason: item.reason }
          : { line_id: item.lineId, reason: item.reason, override_reason: item.overrideReason }
      ),
      margin: { needed: margin.needed, items: margin.items as unknown as Array<Record<string, unknown>> },
    });

    if (applyError || !applied || applied.length === 0) {
      const answer = answerForDatabaseError(applyError as { code?: string; details?: string } | null);
      if (answer) {
        requestLogger.warn({ adminUserId: adminId, code: answer.code }, 'Apply refused by the database');
        return refused(answer);
      }
      requestLogger.error({ err: applyError, adminUserId: adminId }, 'Apply failed');
      return NextResponse.json(
        { success: false, error: 'The prices could not be applied. Nothing was changed.', details: devDetails(applyError) },
        { status: 500 }
      );
    }

    committed = true;
    const refresh = await refreshWithin(REFRESH_WAIT_MS);
    if (refresh !== 'done') {
      requestLogger.warn({ adminUserId: adminId, refresh }, 'Price cache refresh after Apply did not finish; charges follow within 1 hour');
    }

    const batchId = applied[0].batchId;
    const appliedAt = applied[0].appliedAt;
    const rowByLine = new Map(applied.map((row) => [row.lineId, row]));
    const reasonByLine = new Map(requested.map((item) => [item.lineId, item]));

    const entries: AuditLogInput[] = ordered.map((line) => {
      const row = rowByLine.get(line.id);
      const item = reasonByLine.get(line.id);
      return {
        action: AUDIT_EVENTS.AI_PRICING_APPLIED_LINE,
        entityType: 'ai_pricing',
        entityId: line.id,
        userId: adminId,
        actorId: adminId,
        severity: 'warning',
        resourceName: `AI model price ${line.provider}/${line.model_name}`,
        details: {
          entity_kind: 'price_line',
          correlationId,
          line_id: line.id,
          proposal_id: line.proposal_id,
          batch_id: batchId,
          provider: line.provider,
          model_name: line.model_name,
          kind: line.kind,
          image_size: line.image_size,
          image_quality: line.image_quality,
          ...auditPricesOf(line),
          source_url: line.source_url,
          checked_on: line.checked_on,
          reason: item?.reason ?? null,
          override_reason: item?.overrideReason ?? null,
          flags: line.flags,
          submitted_by: line.created_by,
          applied_by: adminId,
          applied_at: appliedAt,
          new_row_id: row?.newRowId ?? null,
          retired_row_ids: row?.retiredRowIds ?? [],
          margin_review_needed: margin.needed,
        },
        request,
      };
    });
    // The prices are applied already: an audit failure is logged and never turns the answer into an error.
    await logAndFlush(entries, requestLogger, { reason: 'price apply', continues: 'the price is applied' }).catch((err) =>
      requestLogger.error({ err, batchId }, 'Apply audit failed; the database provenance remains the record')
    );

    requestLogger.info(
      { adminUserId: adminId, batchId, lineCount: applied.length, marginReviewNeeded: margin.needed, refresh },
      'Prices applied'
    );
    return NextResponse.json({
      success: true,
      data: {
        batchId,
        appliedAt,
        effective: EFFECTIVE_WORDS,
        lines: ordered.map((line) => ({ lineId: line.id, kind: line.kind, provider: line.provider, modelName: line.model_name })),
        marginReview: margin,
      },
    });
  } catch (error) {
    if (committed) {
      requestLogger.error({ err: error, adminUserId: adminId }, 'Apply committed, then a later step failed');
      return NextResponse.json(
        {
          success: false,
          code: 'applied_unconfirmed',
          error: 'The prices were applied, but the page could not confirm it. Reload the page to see them.',
          details: devDetails(error),
        },
        { status: 500 }
      );
    }
    requestLogger.error({ err: error, adminUserId: adminId }, 'Apply failed');
    return NextResponse.json(
      { success: false, error: 'The prices could not be applied. Nothing was changed.', details: devDetails(error) },
      { status: 500 }
    );
  }
}
