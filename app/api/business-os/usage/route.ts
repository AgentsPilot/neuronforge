/**
 * What this business has used — one number, and what made it up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The unit is Pilot Credits, which the product already meters in
 * (`formatPilotCredits`, `tokensPerCredit` in system config). Deliberately NOT
 * dollars: that is our cost, not the user's, and every LLM call is only part of
 * the picture anyway — a plugin call consumes no LLM tokens at all and is
 * recorded with a synthetic token count precisely so that plugin work still
 * counts. Summing cost would value all of that at zero.
 *
 * This is the user's OWN usage. It reuses `getUsageAnalytics`, the same
 * aggregation the admin analytics page uses, scoped to the caller — rather than
 * a second aggregator over the same table that would drift from it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   GET /api/business-os/usage?range=last_30d
 *
 * @module app/api/business-os/usage
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { supabaseServer } from '@/lib/supabaseServer';


const logger = createLogger({ module: 'BusinessOsUsageAPI' });

const QuerySchema = z.object({
  range: z.enum(['last_24h', 'last_7d', 'last_30d', 'last_90d']).default('last_30d'),
});

/**
 * Internal feature tags → what the user would call it.
 *
 * The tags accumulated over time and are not user-facing language
 * (`ai_processing`, `agentkit_execution`, `prompt_enhancement`). Building an
 * automation and running one are kept apart on purpose: building is expensive
 * and happens once, running is cheap and repeats, and someone looking at a large
 * number needs to know which it was.
 *
 * Anything unmapped falls through to "Other" rather than being dropped, so a
 * feature added elsewhere in the product can never quietly disappear from a
 * total the user is shown. The parts always sum to the whole.
 */
const CATEGORIES: Array<{ key: string; features: string[] }> = [
  { key: 'chat', features: ['business-os-chat', 'chat-v3'] },
  { key: 'automations_built', features: [
      'agent_creation',
      'agent_generation',
      'intent_generation',
      'prompt_analysis',
      'prompt_enhancement',
      'clarification_questions',
      'calibration',
      'effort_estimator',
    ],
  },
  { key: 'automations_run', features: ['agentkit_execution', 'ai_processing', 'pilot', 'orchestration', 'memory_system'],
  },
  { key: 'website', features: ['landing-page-generation'] },
  { key: 'insights', features: ['health-summary-generation'] },
  { key: 'documents', features: ['document-extraction'] },
  { key: 'help', features: ['help_bot_v2', 'input_help_bot', 'helpbot', 'onboarding'],
  },
];

// The label is NOT resolved here. The client owns the translation dictionary,
// and a label written server-side ships in one language — which is how
// "Assistant" and "Website & pages" appeared untranslated on a Hebrew dashboard.
// Same rule as `choice` and `needs` in the chat route: the server sends facts.
const FEATURE_TO_CATEGORY = new Map<string, string>();
for (const category of CATEGORIES) {
  for (const feature of category.features) {
    FEATURE_TO_CATEGORY.set(feature, category.key);
  }
}

const RANGE_DAYS: Record<string, number> = {
  last_24h: 1,
  last_7d: 7,
  last_30d: 30,
  last_90d: 90,
};

/**
 * One point per day across the whole window, zero where nothing happened.
 *
 * Plotting only the days that have rows would draw a continuous line through
 * gaps — three scattered days of use would look like three days of steady use.
 */
function fillGaps(
  points: Array<{ date: string; credits: number }>,
  range: string
): Array<{ date: string; credits: number }> {
  const byDate = new Map(points.map((p) => [p.date, p.credits]));
  const days = RANGE_DAYS[range] ?? 30;
  const filled: Array<{ date: string; credits: number }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    filled.push({ date: day, credits: byDate.get(day) ?? 0 });
  }

  return filled;
}

/** Tokens per Pilot Credit, from system config. Falls back to the documented 10. */
async function readTokensPerCredit(): Promise<number> {
  try {
    const { data } = await supabaseServer
      .from('ais_system_config')
      .select('config_value')
      .eq('config_key', 'tokens_per_pilot_credit')
      .maybeSingle();

    const parsed = parseInt(String(data?.config_value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  } catch {
    return 10;
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = QuerySchema.safeParse({
      range: new URL(request.url).searchParams.get('range') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid range' }, { status: 400 });
    }

    const [report, tokensPerCredit] = await Promise.all([
      // userId is the caller's, never a parameter — there is no way to ask for
      // somebody else's usage.
      new AIAnalyticsService(supabaseServer).getUsageAnalytics({
        userId: user.id,
        dateRange: parsed.data.range,
      }),
      // The SAME key the admin analytics reads (`tokens_per_pilot_credit` in
      // ais_system_config), fetched here with the SERVER client.
      //
      // Not `getPilotCreditConfig()` from analyticsHelpers: that module imports
      // the BROWSER Supabase client, so calling it from a route throws a 500 —
      // which is exactly what happened.
      readTokensPerCredit(),
    ]);

    const toCredits = (tokens: number) => Math.round(tokens / tokensPerCredit);

    const byCategory = new Map<string, { tokens: number; calls: number }>();

    const featureStats = (report.featureBreakdown ?? {}) as Record<
      string,
      { tokens?: number; calls?: number }
    >;

    for (const [feature, stats] of Object.entries(featureStats)) {
      const key = FEATURE_TO_CATEGORY.get(feature) ?? 'other';
      const existing = byCategory.get(key) ?? { tokens: 0, calls: 0 };

      existing.tokens += stats.tokens ?? 0;
      existing.calls += stats.calls ?? 0;
      byCategory.set(key, existing);
    }

    const breakdown = [...byCategory.entries()]
      .filter(([, v]) => v.tokens > 0)
      .map(([key, v]) => ({
        key,
        credits: toCredits(v.tokens),
        calls: v.calls,
        share: report.totalTokens ? Number((v.tokens / report.totalTokens).toFixed(4)) : 0,
      }))
      .sort((a, b) => b.credits - a.credits);

    requestLogger.info(
      { userId: user.id, range: parsed.data.range, credits: toCredits(report.totalTokens) },
      'Usage reported'
    );

    // Daily series for the chart. Gaps are filled with zero rather than left
    // out: a line that skips quiet days compresses time and implies usage was
    // continuous when it was not.
    const daily = fillGaps(
      (report.dailyBreakdown ?? []).map((d) => ({
        date: d.date,
        credits: toCredits(d.tokens ?? 0),
      })),
      parsed.data.range
    );

    return NextResponse.json({
      success: true,
      data: {
        range: parsed.data.range,
        // THE number: what was actually consumed, from token_usage.
        //
        // Deliberately NOT user_subscriptions.balance/total_spent. That ledger is
        // only written by CreditService.deduct(), which is called from
        // /api/run-agent alone — so it misses the chat, landing pages, insights
        // and agent creation entirely. On a real account it was last touched
        // three months ago and understates lifetime consumption by 13x
        // (202,414 credits recorded against 2,637,147 actually consumed).
        //
        // token_usage is written by every AI call through the provider factory,
        // so it needs no per-feature wiring and cannot drift.
        credits: toCredits(report.totalTokens),
        breakdown,
        daily,
        calls: report.totalCalls,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to report usage');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
