/**
 * Business OS LLM model settings — the admin screen's read endpoint.
 *
 * ── Why this route exists instead of the generic one ─────────────────────
 * `PUT /api/admin/system-config` REFUSES every `bos_llm_area_*` key, and that
 * refusal is kept permanently (requirement D-1). Its key is a free-text input
 * over a 50-key batch with no dry-run and no per-key audit, which is why it
 * needs NFKC folding, zero-width stripping and prototype-pollution defences
 * just to be safe.
 *
 * Here the key is not an input at all: the caller names an AREA from a closed
 * enum and the key is derived with `bosLlmAreaKey`, which is total over
 * `BOS_LLM_AREAS`. Key forgery becomes unreachable rather than defended.
 *
 * ── The gate ─────────────────────────────────────────────────────────────
 * `requireAdmin` is the FIRST statement. The nearest neighbour,
 * `app/api/admin/business-os/llm-usage/route.ts`, hand-rolls an
 * `AdminAccessService` call inside the handler — it is one of the seven parked
 * inline handlers, and copying it would FAIL the required
 * `Admin authz surface guard` CI check. It is not the pattern.
 *
 * ── The literal gate ─────────────────────────────────────────────────────
 * This file does NOT import the call catalog directly — it reaches it through
 * `adminSettingsView` — and `literalScope()` selects DIRECT importers only.
 * So the rule would have left it OUT, on the one file serving the model
 * picker.
 *
 * It is therefore named into `LITERAL_SCOPE_INCLUSIONS`
 * (`scripts/lib/bos-llm-scope.ts`), and `--list` marks it `included`. That is
 * an inclusion, not an exemption: the gate's own header prescribes "a narrow
 * rule change, never a new file exemption", and a transitive scope was
 * rejected because it would turn 43 files into hundreds.
 *
 * It contains no model-id union, no `z.enum` of model ids, no `switch` on a
 * model name and no price-index key: the only enum is of AREA names, and the
 * options are built in `lib/business-os/llm/modelOptions.ts` from pricing at
 * request time.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §4
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { buildAdminSettingsView } from '@/lib/business-os/llm/adminSettingsView';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosLlmSettingsAdminAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // FIRST statement. Nothing above it parses a body, reads the database or
  // writes — the gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  try {
    const view = await buildAdminSettingsView();

    requestLogger.info(
      { userId: user.id, areas: view.areas.length },
      'Business OS LLM settings read for the admin screen'
    );

    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    requestLogger.error({ err: error, userId: user.id }, 'Failed to read Business OS LLM settings');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read the Business OS AI settings',
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
