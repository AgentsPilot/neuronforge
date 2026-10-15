import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { sanitizeV2CustomTokens } from '@/lib/design-system-v2/customTokens';
import {
  V2_CUSTOM_TOKENS_ROUTE_WAIT_MS,
  readV2CustomTokensWithStatus,
} from '@/lib/design-system-v2/server/readV2CustomTokens';

/**
 * GET /api/design-system/v2-custom-tokens
 *
 * The platform's custom design tokens, for ONE purpose: correcting a page whose
 * server render did not know them (performance slice TH-1, SA RC-16). That
 * happens only on a cold instance whose first token read missed the 1000 ms page
 * deadline; the page then rendered the defaults, and `V2ThemeProvider` asks
 * here once and applies the answer. Every other page already has the tokens in
 * its HTML and never calls this.
 *
 * ── Deliberate deviations from the `new-api-route` skill ─────────────────────
 * - PUBLIC, GET only, no `getUser`. The values are cosmetic, global and not
 *   secret, and they are already anon-readable today through RLS. Signed-out
 *   owner pages (`/onboarding-*`) need the correction too.
 * - NO INPUT, so no request schema. Zod's place is taken by the OUTPUT check:
 *   the response passes through `sanitizeV2CustomTokens` (allow-list plus value
 *   grammars), which is stricter than any shape check.
 * - The skill's "a public route verifies a signature or secret" item is for
 *   webhooks that act. This route only reads one constant key.
 * - No audit: a cosmetic read.
 *
 * ── Data access (CLAUDE.md rules 1 and 4) ───────────────────────────────────
 * Through `readV2CustomTokensWithStatus` → `systemConfigRepository.getByKey`
 * (service role). INTENTIONAL RLS BYPASS: global platform setting, no `user_id`
 * column, constant key, nothing user-specific read or returned. It shares the
 * reader's process cache and single flight; it only waits longer
 * (`V2_CUSTOM_TOKENS_ROUTE_WAIT_MS`), because it holds no page.
 *
 * ── Responses ───────────────────────────────────────────────────────────────
 * 200 `{ success: true, data }` only when the tokens are KNOWN (including a
 * known-empty reset). 503 otherwise, so the browser never applies an unknown
 * `{}`. Both `Cache-Control: no-store`, so no cache can pin a cold answer.
 */

export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'V2CustomTokensAPI' });

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { tokens, known } = await readV2CustomTokensWithStatus({ waitMs: V2_CUSTOM_TOKENS_ROUTE_WAIT_MS });

    if (!known) {
      requestLogger.warn({}, 'Custom tokens still unknown; the page keeps the defaults');
      return NextResponse.json({ success: false, error: 'Theme unavailable' }, { status: 503, headers: NO_STORE });
    }

    const data = sanitizeV2CustomTokens(tokens);
    requestLogger.info({ keys: Object.keys(data).length }, 'Custom tokens served for a client correction');
    return NextResponse.json({ success: true, data }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Custom tokens route failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Theme unavailable',
        details: process.env.NODE_ENV === 'development'
          ? (error instanceof Error ? error.message : String(error))
          : undefined,
      },
      { status: 503, headers: NO_STORE }
    );
  }
}
