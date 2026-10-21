/**
 * POST /api/admin/model-pricing/dismiss: an admin dismisses one or more pending
 * prices with a reason (AI model price review slice 8; MP-FR-8 "dismissing a
 * pending price is the per-row equivalent of reject"; UF-3: the reason is
 * required and never pre-filled).
 *
 * Changes no price. The function `ai_price_dismiss_lines` takes the same lock
 * order as submit and apply (SA RC-5), refuses a line that is not pending, and
 * repeats the admin_users check. Authorisation: platform admin or not, as for
 * Apply; the admin id comes from the session, the body carries ids and the
 * reason only.
 *
 * Answers: 400 invalid body · 401/403 gate · 403 no admin_users row · 404
 * unknown line · 409 not_pending / busy · 500 anything else. One
 * AI_PRICE_LINE_DISMISSED entry per line, in one logAndFlush call.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { DismissBodySchema } from '@/lib/ai/pricing-research/applySchema';
import { answerForDatabaseError, decisionAnswer, type DecisionAnswer } from '@/lib/ai/pricing-research/decisionErrors';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import { createLogger } from '@/lib/logger';
import { aiPriceProposalRepository } from '@/lib/repositories/AiPriceProposalRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'ModelPricingDismissAPI' });
const ROUTE = '/api/admin/model-pricing/dismiss';

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

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement: nothing above it reads the body or touches the database.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = DismissBodySchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ adminUserId: adminId, issues: parsed.error.issues.length }, 'Rejected a dismissal with invalid input');
      return refused(
        decisionAnswer('invalid_input'),
        parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      );
    }
    const { lineIds, reason } = parsed.data;

    const { data: lines, error: readError } = await aiPriceProposalRepository.findLinesForDecision(lineIds);
    if (readError || !lines) {
      requestLogger.error({ err: readError, adminUserId: adminId }, 'Dismiss could not read its lines');
      return NextResponse.json(
        { success: false, error: 'The prices could not be dismissed.', details: devDetails(readError) },
        { status: 500 }
      );
    }
    const byId = new Map(lines.map((line) => [line.id, line]));
    const missing = lineIds.filter((id) => !byId.has(id));
    if (missing.length > 0) return refused(decisionAnswer('not_found', missing));
    const notPending = lineIds.filter((id) => byId.get(id)?.state !== 'pending');
    if (notPending.length > 0) return refused(decisionAnswer('not_pending', notPending));

    const { data: dismissed, error } = await aiPriceProposalRepository.dismissLines({ adminUserId: adminId, lineIds, reason });
    if (error || !dismissed || dismissed.length === 0) {
      const answer = answerForDatabaseError(error as { code?: string; details?: string } | null);
      if (answer) {
        requestLogger.warn({ adminUserId: adminId, code: answer.code }, 'Dismiss refused by the database');
        return refused(answer);
      }
      requestLogger.error({ err: error, adminUserId: adminId }, 'Dismiss failed');
      return NextResponse.json(
        { success: false, error: 'The prices could not be dismissed. Nothing was changed.', details: devDetails(error) },
        { status: 500 }
      );
    }

    const entries: AuditLogInput[] = lineIds.map((id) => {
      const line = byId.get(id);
      return {
        action: AUDIT_EVENTS.AI_PRICE_LINE_DISMISSED,
        entityType: 'ai_pricing',
        entityId: id,
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        resourceName: `Pending AI model price ${line?.provider ?? ''}/${line?.model_name ?? ''}`,
        details: {
          entity_kind: 'price_line',
          correlationId,
          line_id: id,
          proposal_id: line?.proposal_id ?? null,
          provider: line?.provider ?? null,
          model_name: line?.model_name ?? null,
          kind: line?.kind ?? null,
          image_size: line?.image_size ?? null,
          image_quality: line?.image_quality ?? null,
          source_url: line?.source_url ?? null,
          reason,
          submitted_by: line?.created_by ?? null,
          dismissed_by: adminId,
        },
        request,
      };
    });
    await logAndFlush(entries, requestLogger, { reason: 'price dismissal', continues: 'the price is dismissed' }).catch((err) =>
      requestLogger.error({ err }, 'Dismiss audit failed; the line state remains the record')
    );

    requestLogger.info({ adminUserId: adminId, lineCount: dismissed.length }, 'Pending prices dismissed');
    return NextResponse.json({ success: true, data: { lines: dismissed } });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Dismiss failed');
    return NextResponse.json(
      { success: false, error: 'The prices could not be dismissed.', details: devDetails(error) },
      { status: 500 }
    );
  }
}
