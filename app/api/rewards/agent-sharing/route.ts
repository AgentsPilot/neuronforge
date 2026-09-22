// app/api/rewards/agent-sharing/route.ts
//
// The customer-readable projection of ONE fact: is the agent-sharing reward
// currently active?
//
// ── Why this route exists ──────────────────────────────────────────────────
// Both agent-detail pages used to read `GET /api/admin/reward-config` to decide
// whether to show the share-reward prompt. That route was ANONYMOUSLY readable
// and returns the entire reward ruleset — amounts, eligibility thresholds,
// minimum success rates, per-month and lifetime anti-abuse caps. Gating it
// (slice 3) would have taken the share-reward indicator dark for every customer,
// so the gate and this replacement ship in the SAME commit.
//
// ── Why a route rather than the two rejected alternatives ─────────────────
//   * NOT a mirrored value in `system_settings_config`. That is a second store
//     for a fact that already has one — the exact shape this programme exists
//     to delete, and `agent_sharing_reward_amount` already demonstrates the
//     drift it causes.
//   * NOT routed through `GET /api/system-config`. That endpoint is itself an
//     unauthenticated, service-role-backed read oracle over arbitrary keys
//     (OI-15); putting reward data behind it would widen a known hole and leak
//     every future rewards key.
//
// One source of truth (`reward_config`), read through the repository layer, and
// a response containing exactly one boolean.

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { configRepository } from '@/lib/repositories/ConfigRepository';

const logger = createLogger({ module: 'AgentSharingRewardAPI' });

export const dynamic = 'force-dynamic';

/** The only reward this route will ever speak for. Not caller-supplied — a key
 *  parameter here would turn a single-fact read back into an enumeration oracle. */
const REWARD_KEY = 'agent_sharing';

/**
 * GET /api/rewards/agent-sharing
 *
 * Customer-readable. Returns `{ success: true, data: { isActive: boolean } }`
 * and nothing else — no amount, no thresholds, no caps.
 *
 * Fails closed: any error yields `isActive: false`, matching the pages' own
 * fallback, so a failure hides the prompt rather than promising a reward that
 * may not be payable.
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const isActive = await configRepository.isRewardActive(REWARD_KEY);
    return NextResponse.json({ success: true, data: { isActive } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Agent-sharing reward lookup failed');
    // Deliberately a 200 with `false` rather than a 500: the caller is a page
    // deciding whether to render a prompt, and "no prompt" is the correct,
    // safe answer to "I could not find out".
    return NextResponse.json({ success: true, data: { isActive: false } });
  }
}
