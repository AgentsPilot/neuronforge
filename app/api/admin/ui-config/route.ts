/**
 * GET / POST /api/admin/ui-config — the platform UI version and custom design
 * tokens edited at `/admin/ui-config`.
 *
 * ADMIN ONLY, gated here in the route (middleware does not protect `/api`)
 * through `requireAdmin`, the first statement of each handler. Nothing reads a
 * body or touches the database before it.
 *
 * Data access goes through `systemConfigRepository`, whose default client is the
 * service role. That RLS bypass is intentional: `system_settings_config` is a
 * global, admin-only table with no `user_id` column, and every key written here
 * is a module constant, never caller-supplied (CLAUDE.md rule 4, documented).
 *
 * Write validation (slice F-1): the tokens are checked by
 * `lib/validation/admin-ui-config-schema.ts`, built from the same allow-list and
 * grammar as TH-1's read sanitizer (`lib/design-system-v2/customTokens.ts`), so
 * the save refuses exactly what every page would ignore. The read sanitizer is
 * still the security boundary for what reaches the inlined `<style>`. Token
 * VALUES are never logged, audited or echoed back; only their names are.
 *
 * GET returns the sanitized tokens (SA ruling Q-2 (c)): the editor shows what
 * pages render, and the next save cleans any stored value that no longer passes.
 *
 * `ui_version` has no reader left (the middleware rewrite was removed). The
 * toggle is kept, validated, until a follow-up removes it (SA ruling Q-3).
 *
 * @module app/api/admin/ui-config
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  V2_CUSTOM_TOKENS_CONFIG_KEY,
  sanitizeV2CustomTokensDetailed,
  type V2CustomTokens,
} from '@/lib/design-system-v2/customTokens';
import {
  UI_VERSIONS,
  invalidTokenKeys,
  invalidTokensMessage,
  uiConfigPostSchema,
  type UiVersion,
} from '@/lib/validation/admin-ui-config-schema';

const logger = createLogger({ module: 'UiConfigAdminAPI' });

// Repository + Pino are Node-only, and an admin- and cookie-dependent handler
// must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UI_VERSION_KEY = 'ui_version';
const CATEGORY = 'ui';
const UI_VERSION_DESCRIPTION = 'Active UI version (v1 or v2)';
const TOKENS_DESCRIPTION = 'Custom design tokens for V2 theme';

/** The one level the helpers below use; a structural type avoids Pino's generic variance. */
type RequestLogger = { error: (context: Record<string, unknown>, message: string) => void };

/** Internal error text is for the server log and for development only. */
function devDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}

function isUiVersion(value: unknown): value is UiVersion {
  return typeof value === 'string' && (UI_VERSIONS as readonly string[]).includes(value);
}

/** `group.key` names of the saved tokens, for logs and the audit row. */
function tokenNames(tokens: V2CustomTokens): string[] {
  return Object.entries(tokens).flatMap(([group, values]) =>
    Object.keys(values ?? {}).map((key) => `${group}.${key}`)
  );
}

// GET - current UI version and custom tokens (sanitized)
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    const { data: rows, error } = await systemConfigRepository.getByKeys([
      UI_VERSION_KEY,
      V2_CUSTOM_TOKENS_CONFIG_KEY,
    ]);
    if (error) throw error;

    const valueOf = (key: string): unknown => rows?.find((row) => row.key === key)?.value;
    const storedVersion = valueOf(UI_VERSION_KEY);
    const uiVersion: UiVersion = isUiVersion(storedVersion) ? storedVersion : 'v1';

    const { tokens: customTokens, droppedKeys } = sanitizeV2CustomTokensDetailed(
      valueOf(V2_CUSTOM_TOKENS_CONFIG_KEY)
    );
    if (droppedKeys.length > 0) {
      // Names only: a stored value may be hostile.
      requestLogger.warn(
        { userId: gate.user.id, droppedKeys },
        'Stored custom tokens contain values that pages ignore; omitted from the editor'
      );
    }

    return NextResponse.json({ success: true, data: { uiVersion, customTokens } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching UI config');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch UI configuration', details: devDetails(error) },
      { status: 500 }
    );
  }
}

// POST - update the UI version, save tokens, or reset tokens
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;
    const adminId = gate.user.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = uiConfigPostSchema.safeParse(body);
    if (!parsed.success) {
      const tokenIssues = invalidTokenKeys(parsed.error);
      if (tokenIssues) {
        // Names of allow-listed keys and a count of unknown ones. Never a value,
        // never a caller-supplied key name (SA R-3).
        requestLogger.warn(
          { userId: adminId, invalidKeys: tokenIssues.invalidKeys, unknownKeyCount: tokenIssues.unknownCount },
          'Refused a custom-token save with invalid values'
        );
        return NextResponse.json(
          {
            success: false,
            error: invalidTokensMessage(tokenIssues),
            invalidKeys: tokenIssues.invalidKeys,
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const input = parsed.data;

    if (input.action === 'update_version') {
      const { version } = input.data;
      const { error } = await systemConfigRepository.set(
        UI_VERSION_KEY,
        version,
        CATEGORY,
        UI_VERSION_DESCRIPTION,
        { actorId: adminId }
      );
      if (error) return writeFailed(requestLogger, error, input.action);

      requestLogger.info({ userId: adminId, operation: input.action, version }, 'UI version updated');
      audit(request, requestLogger, adminId, UI_VERSION_KEY, { operation: input.action, version });

      return NextResponse.json({
        success: true,
        message: `Successfully switched to ${version.toUpperCase()}`,
      });
    }

    if (input.action === 'save_tokens') {
      const { tokens } = input.data;
      const names = tokenNames(tokens);
      const { error } = await systemConfigRepository.set(
        V2_CUSTOM_TOKENS_CONFIG_KEY,
        tokens,
        CATEGORY,
        TOKENS_DESCRIPTION,
        { actorId: adminId }
      );
      if (error) return writeFailed(requestLogger, error, input.action);

      requestLogger.info(
        { userId: adminId, operation: input.action, tokenKeyCount: names.length },
        'Custom tokens saved'
      );
      audit(request, requestLogger, adminId, V2_CUSTOM_TOKENS_CONFIG_KEY, {
        operation: input.action,
        tokenKeys: names,
      });

      return NextResponse.json({ success: true, message: 'Custom tokens saved successfully' });
    }

    // reset_tokens: the discriminated union admits nothing else.
    const { error } = await systemConfigRepository.delete(V2_CUSTOM_TOKENS_CONFIG_KEY);
    if (error) return writeFailed(requestLogger, error, input.action);

    requestLogger.info({ userId: adminId, operation: input.action }, 'Custom tokens reset');
    audit(request, requestLogger, adminId, V2_CUSTOM_TOKENS_CONFIG_KEY, { operation: input.action });

    return NextResponse.json({ success: true, message: 'Tokens reset to defaults successfully' });
  } catch (error) {
    requestLogger.error({ err: error }, 'Error in UI config API');
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: devDetails(error) },
      { status: 500 }
    );
  }
}

function writeFailed(requestLogger: RequestLogger, error: unknown, operation: string) {
  requestLogger.error({ err: error, operation }, 'Failed to write UI configuration');
  return NextResponse.json(
    { success: false, error: 'Failed to save UI configuration', details: devDetails(error) },
    { status: 500 }
  );
}

/**
 * Non-blocking: a cosmetic platform setting is not a WC-7 write (money, access,
 * entitlement, price), so the row is queued and the response does not wait on a
 * flush (SA ruling Q-4). `details` carries names only, never token values.
 */
function audit(
  request: NextRequest,
  requestLogger: RequestLogger,
  adminId: string,
  configKey: string,
  details: { operation: string; version?: UiVersion; tokenKeys?: string[] }
): void {
  AuditTrailService.getInstance()
    .log({
      action: AUDIT_EVENTS.SYSTEM_CONFIG_CHANGED,
      entityType: 'settings',
      entityId: configKey,
      userId: adminId,
      actorId: adminId,
      resourceName: 'UI configuration',
      details,
      severity: 'info',
      request,
    })
    .catch((err: unknown) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
}
