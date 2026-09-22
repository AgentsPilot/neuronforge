// app/api/system/health/route.ts

import { NextResponse } from 'next/server'

/**
 * GET /api/system/health — static liveness probe.
 *
 * It answers one question: is the app serving requests? It deliberately does
 * no more (SA Q6, finding F5):
 *   - No DB query. The previous version ran a service-role `agents` select for
 *     anonymous callers, returned the raw DB error text and reported which env
 *     vars were set. It also returned 200 even when that check failed, so no
 *     status-code monitor ever got a DB signal from it.
 *   - No input, so there is nothing to validate with Zod.
 *   - No logging, so there is no correlationId either. Nothing here can fail,
 *     and logging every probe would only be noise (SA Q-C). This is intentional;
 *     please don't "fix" it.
 *
 * The body uses the standard `{ success, data }` envelope (SA Q-B), which also
 * keeps the top-level `success: true` key the old body had.
 */

// Without this, Next 14 renders a request-independent GET once at build time
// and `timestamp` would be frozen, so the probe would lie about liveness.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
  })
}
