import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

/**
 * POST /api/plugins/test-audit
 *
 * ISOLATED per-execution audit endpoint for the Plugin API Tester (SA decision Q2 / CR2).
 * The tester client calls this AFTER each live Run so that every action taken through
 * the tester is traceable after the fact. It is deliberately a NEW, dedicated endpoint
 * so we do NOT edit the shared production `/api/plugins/execute` route (CR4 — that route
 * is left untouched as tracked security debt).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ACCEPTED LIMITATION (recorded per SA decision Q2):
 *   Because the /test-plugins-v2 surface is unauthenticated (F4 override, D6), this
 *   entry captures `targetUserId` — the account the action was run against — but does
 *   NOT capture a verified operator identity. That is a direct consequence of the
 *   consciously accepted cross-user-exposure risk. The entry still provides the
 *   "which account, what action, what outcome" traceability that matters. The
 *   server-side audit-in-execute-route remains the correct long-term home and rides
 *   the future F3 remediation cycle.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * F1/CR3 compliance: Zod-validated body, Pino createLogger + correlationId, standard
 * error envelope. AuditTrailService.log is non-blocking (.catch). No secrets stored —
 * only {targetUserId, plugin, action, outcome, durationMs}; no parameters/tokens.
 */

const logger = createLogger({ module: 'API', service: 'PluginTestAudit' });

const bodySchema = z.object({
  targetUserId: z.string().min(1, 'targetUserId is required'),
  plugin: z.string().min(1, 'plugin is required'),
  action: z.string().min(1, 'action is required'),
  outcome: z.enum(['success', 'error']),
  durationMs: z.number().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      requestLogger.warn({ issues: parsed.error.issues }, 'Invalid test-audit body');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details:
            process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const { targetUserId, plugin, action, outcome, durationMs } = parsed.data;

    const auditTrail = AuditTrailService.getInstance();
    // Non-blocking: never let audit failures affect the response (CLAUDE.md §Audit Trail).
    auditTrail
      .log({
        action: AUDIT_EVENTS.PLUGIN_TESTER_EXECUTE,
        entityType: 'plugin',
        entityId: plugin,
        // targetUserId = the account acted upon (no verified operator identity — see note above).
        userId: targetUserId,
        resourceName: `${plugin}.${action}`,
        severity: outcome === 'error' ? 'warning' : 'info',
        details: { plugin, action, outcome, durationMs, source: 'form-tester' },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Tester audit log failed (non-blocking)'));

    requestLogger.info({ targetUserId, plugin, action, outcome }, 'Tester execution audited');
    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to record tester execution audit');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to record audit',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
