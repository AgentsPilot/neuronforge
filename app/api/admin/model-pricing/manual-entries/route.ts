/**
 * POST /api/admin/model-pricing/manual-entries: an admin records a provider's
 * new price by hand (AI model price review slice 3; MP-FR-12 fallback, SA RR-1,
 * RR-2, C-12).
 *
 * The price is stored as PENDING only. Nothing here writes `ai_model_pricing`
 * or `ai_model_image_pricing`, and no charge changes until an admin applies the
 * line (slice 8).
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod (the shared pending-line schema; prices are
 *   decimal STRINGS, the source is an https page on the provider's own site,
 *   never fetched) → one exact read of today's prices → server-computed
 *   refusals and flags → the submit RPC → audit (AI_PRICE_MANUAL_ENTRY,
 *   logAndFlush before the response) → result.
 *
 * ── Answers ──────────────────────────────────────────────────────────────
 *   400 invalid body · 422 a hard refusal on any line (nothing is stored, every
 *   problem is listed, SA O-7) · 409 another submit for the same model and unit
 *   ran at the same moment · 403 the caller has no active admin_users row (an
 *   ADMIN_EMAILS-only admin, SA O-15) · 500 anything else.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import { lineContextFor, loadPricingSnapshot } from '@/lib/ai/pricing-research/comparisonModel';
import { duplicateUnitKeys, evaluatePendingLine } from '@/lib/ai/pricing-research/lineFlags';
import { ManualEntryBodySchema, unitKeyOf } from '@/lib/ai/pricing-research/pendingLineSchema';
import { aiPriceProposalRepository } from '@/lib/repositories/AiPriceProposalRepository';
import type { AiPriceSubmitLine } from '@/lib/repositories/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'ModelPricingManualEntryAPI' });
const ROUTE = '/api/admin/model-pricing/manual-entries';

function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
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
    const parsed = ManualEntryBodySchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ adminUserId: adminId, issues: parsed.error.issues.length }, 'Rejected a manual price entry with invalid input');
      return NextResponse.json(
        {
          success: false,
          error: 'Some prices could not be read. Check each line.',
          code: 'invalid_input',
          problems: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
        { status: 400 }
      );
    }
    const { lines } = parsed.data;

    const duplicates = duplicateUnitKeys(lines.map((line) => unitKeyOf(line)));
    if (duplicates.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Each model and unit can appear only once in one entry.',
          code: 'duplicate_unit',
          problems: duplicates.map((key) => ({ path: 'lines', message: `Listed more than once: ${key}` })),
        },
        { status: 422 }
      );
    }

    const snapshot = await loadPricingSnapshot();

    const evaluated = lines.map((line, index) => {
      const { context, snapshotFields } = lineContextFor(snapshot, line);
      const evaluation = evaluatePendingLine(line, context);
      return { line, index, evaluation, snapshotFields };
    });

    const refused = evaluated.filter((item) => item.evaluation.refusals.length > 0);
    if (refused.length > 0) {
      requestLogger.warn({ adminUserId: adminId, refusedLines: refused.length }, 'Manual price entry refused by the bounds');
      return NextResponse.json(
        {
          success: false,
          error: 'Nothing was stored. Fix the lines below and submit again.',
          code: 'refused',
          problems: refused.flatMap((item) =>
            item.evaluation.refusals.map((message) => ({ path: `lines.${item.index}`, message }))
          ),
        },
        { status: 422 }
      );
    }

    // An explicit allow-list: only validated fields and the server's own
    // snapshot and flags reach the RPC (SA C-12).
    const submitLines: AiPriceSubmitLine[] = evaluated.map(({ line, evaluation, snapshotFields }) => ({
      ...snapshotFields,
      kind: line.kind,
      provider: line.provider,
      model_name: line.model_name,
      source_url: line.source_url,
      checked_on: line.checked_on,
      flags: evaluation.flags,
    }));

    const { data: stored, error } = await aiPriceProposalRepository.submitPending({
      adminUserId: adminId,
      sourceKind: 'manual',
      providerOutcomes: null,
      lines: submitLines,
    });

    if (error || !stored || stored.length === 0) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '23505') {
        requestLogger.warn({ adminUserId: adminId }, 'Manual price entry collided with another submit');
        return NextResponse.json(
          { success: false, error: 'Another price for the same model was saved at the same moment. Reload and try again.', code: 'conflict' },
          { status: 409 }
        );
      }
      if (code === '42501') {
        requestLogger.warn({ adminUserId: adminId }, 'Manual price entry refused: no active admin_users row for this admin');
        return NextResponse.json(
          { success: false, error: 'Your admin access is not recorded in the admin list, so prices cannot be saved.', code: 'not_admin_row' },
          { status: 403 }
        );
      }
      requestLogger.error({ err: error, adminUserId: adminId }, 'Manual price entry failed');
      return NextResponse.json(
        { success: false, error: 'The prices could not be saved.', details: devDetails(error) },
        { status: 500 }
      );
    }

    const proposalId = stored[0].proposalId;
    // `lineIndex` is the 1-based position in `submitLines` (WITH ORDINALITY).
    const ordered = stored.slice().sort((a, b) => a.lineIndex - b.lineIndex);
    const resultLines = ordered.map((row) => {
      const submitted = submitLines[row.lineIndex - 1];
      return {
        id: row.lineId,
        provider: submitted.provider,
        modelName: submitted.model_name,
        kind: submitted.kind,
        flags: submitted.flags,
        supersededLineId: row.supersededLineId,
      };
    });

    await logAndFlush(
      {
        action: AUDIT_EVENTS.AI_PRICE_MANUAL_ENTRY,
        entityType: 'ai_pricing',
        entityId: proposalId,
        userId: adminId,
        actorId: adminId,
        severity: 'info',
        resourceName: 'Pending AI model price',
        details: {
          entity_kind: 'price_proposal',
          proposal_id: proposalId,
          correlationId,
          lines: ordered.map((row) => {
            const submitted = submitLines[row.lineIndex - 1];
            return {
              line_id: row.lineId,
              provider: submitted.provider,
              model_name: submitted.model_name,
              kind: submitted.kind,
              image_size: submitted.image_size ?? null,
              image_quality: submitted.image_quality ?? null,
              input_per_1m: submitted.input_per_1m ?? null,
              output_per_1m: submitted.output_per_1m ?? null,
              cached_input_per_1m: submitted.cached_input_per_1m ?? null,
              price_per_image: submitted.price_per_image ?? null,
              source_url: submitted.source_url,
              checked_on: submitted.checked_on,
              flags: submitted.flags,
              superseded_line_id: row.supersededLineId,
            };
          }),
        },
        request,
      },
      requestLogger,
      { reason: 'manual price entry', continues: 'the pending price is stored' }
    );

    requestLogger.info({ adminUserId: adminId, proposalId, lineCount: resultLines.length }, 'Manual price entry stored as pending');
    return NextResponse.json({ success: true, data: { proposalId, lines: resultLines } });
  } catch (error) {
    requestLogger.error({ err: error, adminUserId: adminId }, 'Manual price entry failed');
    return NextResponse.json(
      { success: false, error: 'The prices could not be saved.', details: devDetails(error) },
      { status: 500 }
    );
  }
}
