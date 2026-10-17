/**
 * POST /api/admin/model-pricing/apply-batches/[batchId]/margin-review: an admin
 * marks the margin review of one Apply done, with a note (AI model price review
 * slice 8; MP-FR-14, Q7; user decision B-4: the admin who applied may do it).
 *
 * Changes nothing about plans, allowances, markup or credit value: it records
 * that someone looked. The function `ai_price_apply_batch_review_done` refuses
 * an Apply that needs no review or is already done, and repeats the
 * admin_users check. The batch id in the path is platform data with no owner;
 * any active admin may mark it (Q2).
 *
 * Answers: 400 invalid id or body · 401/403 gate · 403 no admin_users row · 404
 * unknown Apply · 409 already_done / not_needed · 500 anything else. One
 * AI_PRICE_MARGIN_REVIEW_DONE entry, flushed before the response.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { BatchIdSchema, MarginReviewBodySchema } from '@/lib/ai/pricing-research/applySchema';
import { answerForDatabaseError, decisionAnswer } from '@/lib/ai/pricing-research/decisionErrors';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import { aiPriceApplyRepository } from '@/lib/repositories/AiPriceApplyRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'ModelPricingMarginReviewAPI' });
const ROUTE = '/api/admin/model-pricing/apply-batches/[batchId]/margin-review';

function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest, context: { params: { batchId: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement: nothing above it reads the path, the body or the database.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    const batchId = BatchIdSchema.safeParse(context.params?.batchId);
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = MarginReviewBodySchema.safeParse(body);
    if (!batchId.success || !parsed.success) {
      const answer = decisionAnswer('invalid_input');
      return NextResponse.json(
        {
          success: false,
          error: answer.error,
          code: answer.code,
          problems: [
            ...(batchId.success ? [] : [{ path: 'batchId', message: 'Not a valid Apply id' }]),
            ...(parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))),
          ],
        },
        { status: 400 }
      );
    }

    const { data: done, error } = await aiPriceApplyRepository.markMarginReviewDone({
      adminUserId: adminId,
      batchId: batchId.data,
      note: parsed.data.note,
    });
    if (error || !done) {
      const answer = answerForDatabaseError(error as { code?: string; details?: string } | null);
      if (answer) {
        requestLogger.warn({ adminUserId: adminId, code: answer.code }, 'Margin review refused by the database');
        return NextResponse.json({ success: false, error: answer.error, code: answer.code }, { status: answer.status });
      }
      requestLogger.error({ err: error, adminUserId: adminId }, 'Margin review failed');
      return NextResponse.json(
        { success: false, error: 'The margin review could not be saved.', details: devDetails(error) },
        { status: 500 }
      );
    }

    await logAndFlush(
      {
        action: AUDIT_EVENTS.AI_PRICE_MARGIN_REVIEW_DONE,
        entityType: 'ai_pricing',
        entityId: done.batchId,
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        resourceName: 'Margin review after an AI model price change',
        details: { entity_kind: 'apply_batch', correlationId, batch_id: done.batchId, note: parsed.data.note, done_at: done.doneAt },
        request,
      },
      requestLogger,
      { reason: 'margin review', continues: 'the review is recorded' }
    ).catch((err) => requestLogger.error({ err, batchId: done.batchId }, 'Margin review audit failed; the batch row remains the record'));

    requestLogger.info({ adminUserId: adminId, batchId: done.batchId }, 'Margin review marked done');
    return NextResponse.json({ success: true, data: done });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Margin review failed');
    return NextResponse.json(
      { success: false, error: 'The margin review could not be saved.', details: devDetails(error) },
      { status: 500 }
    );
  }
}
