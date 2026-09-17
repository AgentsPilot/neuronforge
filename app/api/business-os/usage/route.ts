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
 * This is the user's OWN usage, always scoped to the caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANSWER, NOT THE EVIDENCE
 *
 * This read `getUsageAnalytics` — the admin analytics aggregation — which pages
 * every matching `token_usage` row into Node and sums it there. On the busiest
 * real account that was 1,991 rows, 1.77 MB and two sequential round trips,
 * about 1.2 seconds, for one number and five lines. And it grows with what it
 * reports: Business OS chat writes a row on every turn.
 *
 * `business_os_usage_summary` does the same sums in Postgres and returns a
 * handful of rows. The shape below is unchanged — the card, its ring and its
 * breakdown were not touched.
 *
 * The old path survives as a FALLBACK, narrowed to the three columns that are
 * actually read, for the window between this code deploying and the migration
 * running. It is not dead code waiting to rot: it is what keeps the card
 * working on an environment whose migration is still pending, and it says so in
 * the log when it runs.
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

/** What the card needs, however it was obtained. */
interface UsageSummary {
  totalTokens: number;
  totalCalls: number;
  /** feature name → its totals. */
  byFeature: Map<string, { tokens: number; calls: number }>;
  /** YYYY-MM-DD (UTC) → tokens that day. */
  byDay: Map<string, number>;
}

/**
 * The totals, summed in Postgres.
 *
 * Returns null — never throws and never a zeroed summary — when the function is
 * not there, so the caller can tell "no usage" apart from "not migrated yet".
 * Reporting a missing migration as zero consumption would draw a full gauge for
 * a business that has used its whole allowance.
 */
async function summaryFromDatabase(
  userId: string,
  since: Date,
  log: { warn: (ctx: Record<string, unknown>, msg: string) => void }
): Promise<UsageSummary | null> {
  const { data, error } = await supabaseServer.rpc('business_os_usage_summary', {
    p_user_id: userId,
    p_since: since.toISOString(),
  });

  if (error) {
    log.warn(
      { err: error },
      'business_os_usage_summary unavailable — falling back to reading the rows. Run supabase/migrations/20260929_usage_summary.sql'
    );
    return null;
  }

  const summary: UsageSummary = {
    totalTokens: 0,
    totalCalls: 0,
    byFeature: new Map(),
    byDay: new Map(),
  };

  for (const row of (data ?? []) as Array<{
    bucket: string;
    key: string;
    tokens: number | string;
    calls: number | string;
  }>) {
    // BIGINT arrives as a string from PostgREST once it is large enough, and
    // `'12' + 5` is '125'. Coerced on the way in rather than at each use.
    const tokens = Number(row.tokens) || 0;
    const calls = Number(row.calls) || 0;

    if (row.bucket === 'feature') {
      summary.byFeature.set(row.key, { tokens, calls });
      // Totalled from the FEATURE rows alone. Both buckets cover the same
      // rows, so adding the day rows as well would double everything.
      summary.totalTokens += tokens;
      summary.totalCalls += calls;
    } else if (row.bucket === 'day') {
      summary.byDay.set(row.key, tokens);
    }
  }

  return summary;
}

/**
 * The same totals, computed the old way, for an environment where the migration
 * has not run yet.
 *
 * Narrowed to the three columns the card reads. `select('*')` was 31 of them,
 * including `request_payload` and `response_metadata` — JSON blobs nothing here
 * has ever looked at and most of the 1.77 MB this used to move.
 *
 * The paging stays. PostgREST caps a page at 1,000 rows, and a query that
 * stopped there silently understated one real account by 52%.
 */
async function summaryFromRows(userId: string, since: Date): Promise<UsageSummary> {
  const summary: UsageSummary = {
    totalTokens: 0,
    totalCalls: 0,
    byFeature: new Map(),
    byDay: new Map(),
  };

  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseServer
      .from('token_usage')
      .select('feature, total_tokens, created_at')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw error;

    const rows = data ?? [];

    for (const row of rows) {
      const tokens = row.total_tokens || 0;
      const feature = row.feature || 'unknown';

      summary.totalTokens += tokens;
      summary.totalCalls += 1;

      const existing = summary.byFeature.get(feature) ?? { tokens: 0, calls: 0 };
      existing.tokens += tokens;
      existing.calls += 1;
      summary.byFeature.set(feature, existing);

      const day = new Date(row.created_at).toISOString().slice(0, 10);
      summary.byDay.set(day, (summary.byDay.get(day) ?? 0) + tokens);
    }

    if (rows.length < PAGE) break;
  }

  return summary;
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

/**
 * The monthly allowance, in Pilot Credits.
 *
 * Stored as dollars — that is the figure a human decides — and converted here
 * using `pilot_credit_cost_usd`, the same rate Stripe bills against. Deriving
 * rather than storing the credit figure keeps the two from forking the first
 * time the credit price moves.
 *
 * Both keys are read in ONE round trip. Two `.eq('config_key', ...)` queries
 * would be two, and this runs on every dashboard load.
 *
 * Returns null when no ceiling applies — the key absent, deliberately set to 0,
 * or a credit price of 0 that would make the division meaningless. The card
 * reads null as "show consumption, draw no gauge", which is what it did before
 * an allowance existed.
 */
async function readAllowanceCredits(): Promise<number | null> {
  try {
    const { data } = await supabaseServer
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', ['monthly_ai_allowance_usd', 'pilot_credit_cost_usd']);

    const byKey = new Map((data ?? []).map((r) => [r.config_key, r.config_value]));

    const allowanceUsd = parseFloat(String(byKey.get('monthly_ai_allowance_usd') ?? '10'));
    // Same documented fallback the Stripe routes use.
    const creditCostUsd = parseFloat(String(byKey.get('pilot_credit_cost_usd') ?? '')) || 0.00048;

    if (!Number.isFinite(allowanceUsd) || allowanceUsd <= 0) return null;
    if (!Number.isFinite(creditCostUsd) || creditCostUsd <= 0) return null;

    return Math.round(allowanceUsd / creditCostUsd);
  } catch {
    return null;
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

    /*
     * The window, computed once and shared.
     *
     * It used to be derived inside `getUsageAnalytics` from the range string.
     * Now the same Date goes to the database function and to the fallback, so
     * the two cannot disagree about where the 30 days start.
     */
    const since = new Date(
      Date.now() - (RANGE_DAYS[parsed.data.range] ?? 30) * 24 * 60 * 60 * 1000
    );

    const [summarised, tokensPerCredit, allowanceCredits] = await Promise.all([
      // userId is the caller's, never a parameter — there is no way to ask for
      // somebody else's usage.
      summaryFromDatabase(user.id, since, requestLogger),
      // The SAME key the admin analytics reads (`tokens_per_pilot_credit` in
      // ais_system_config), fetched here with the SERVER client.
      //
      // Not `getPilotCreditConfig()` from analyticsHelpers: that module imports
      // the BROWSER Supabase client, so calling it from a route throws a 500 —
      // which is exactly what happened.
      readTokensPerCredit(),
      readAllowanceCredits(),
    ]);

    const usage = summarised ?? (await summaryFromRows(user.id, since));

    const toCredits = (tokens: number) => Math.round(tokens / tokensPerCredit);

    const byCategory = new Map<string, { tokens: number; calls: number }>();

    for (const [feature, stats] of usage.byFeature) {
      const key = FEATURE_TO_CATEGORY.get(feature) ?? 'other';
      const existing = byCategory.get(key) ?? { tokens: 0, calls: 0 };

      existing.tokens += stats.tokens;
      existing.calls += stats.calls;
      byCategory.set(key, existing);
    }

    const breakdown = [...byCategory.entries()]
      .filter(([, v]) => v.tokens > 0)
      .map(([key, v]) => ({
        key,
        credits: toCredits(v.tokens),
        calls: v.calls,
        share: usage.totalTokens ? Number((v.tokens / usage.totalTokens).toFixed(4)) : 0,
      }))
      .sort((a, b) => b.credits - a.credits);

    requestLogger.info(
      {
        userId: user.id,
        range: parsed.data.range,
        credits: toCredits(usage.totalTokens),
        summedBy: summarised ? 'database' : 'rows',
      },
      'Usage reported'
    );

    // Daily series for the chart. Gaps are filled with zero rather than left
    // out: a line that skips quiet days compresses time and implies usage was
    // continuous when it was not.
    const daily = fillGaps(
      [...usage.byDay.entries()].map(([date, tokens]) => ({
        date,
        credits: toCredits(tokens),
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
        credits: toCredits(usage.totalTokens),
        /*
         * The ceiling the card counts down from, in Pilot Credits, or null
         * when no ceiling applies.
         *
         * `remaining` is computed here rather than in the card so that the
         * clamp lives in one place: consumption can exceed the allowance, and
         * a negative remainder would draw the gauge backwards.
         */
        allowance: allowanceCredits,
        remaining:
          allowanceCredits === null
            ? null
            : Math.max(0, allowanceCredits - toCredits(usage.totalTokens)),
        breakdown,
        daily,
        calls: usage.totalCalls,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to report usage');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
