// app/api/cron/check-free-tier-expiration/route.ts
//
// PERMANENTLY DISABLED (plan payments P-10, TK-3; decided by BQ-P8 on 2026-10-02).
//
// This job used to freeze every account whose `free_tier_expires_at` had passed
// and that had never bought credits, and set its balance to zero. A paying
// Business OS customer never buys credits, so the day it ran it would have
// frozen paying customers (RD-9, F-17). BQ-P8 chose to keep it off for good
// rather than redefine the field, so the freezing body is deleted (it is in git
// history) and nothing in the codebase can freeze an account any more
// (`lib/__tests__/accountFrozenWriters.guard.test.ts`).
//
// The file stays so whoever looks for the job at its path finds the decision
// here (SA Q-5). Any caller that holds the secret gets 410 and an alert line,
// because a call means someone scheduled it: remove it from `vercel.json`.
// The decision is also recorded in `PERMANENTLY_UNSCHEDULED_CRONS`
// (`lib/cron/bosCronJobs.ts`), which `vercelCrons.test.ts` enforces.

import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'cron-check-free-tier-expiration' });

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Fail closed: no configured secret means no caller is authorised. */
function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  // Equal-length digests, so timingSafeEqual cannot throw on a length mismatch.
  return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
}

function refuse(request: NextRequest, method: string): NextResponse {
  if (!hasCronSecret(request)) {
    logger.warn({ method }, 'Unauthorized call to the disabled free-tier expiration job');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // No database client is created: nothing is read or written.
  logger.error(
    { event: 'free_tier_expiration_disabled', method, alert: true },
    'Disabled free-tier expiration job was called with the cron secret; it must not be scheduled (BQ-P8)'
  );
  return NextResponse.json({ success: false, error: 'Permanently disabled' }, { status: 410 });
}

// GET is the only method this route ever exported (SA P10-C6: every exported
// method takes the same secret-check-then-410 path; the route test pins that).
export async function GET(request: NextRequest) {
  return refuse(request, 'GET');
}
