/**
 * How much chat a user gets, and what they are told about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE UNIT IS A QUESTION, NOT A TOKEN.
 *
 * Measured over 1,000 real calls, cost per turn is remarkably flat:
 *
 *     p50 $0.000594   p90 $0.000675   p99 $0.000747   max $0.001492
 *
 * The p99 is 1.26x the median. Almost all of the prompt is the catalog, which is
 * the same for every question, and the completion is a short plan. So what a
 * question costs barely depends on the question — the variance that matters is
 * how MANY questions a user asks.
 *
 * That has two consequences, and both shape this file:
 *
 *   1. Budgeting in turns is as accurate as budgeting in tokens, and a person can
 *      act on "you have 40 questions left today". Nobody can act on "you have
 *      82,000 tokens left", and if the model changes underneath them the token
 *      number silently means something different while the turn number does not.
 *
 *   2. A token ceiling is still needed as a BACKSTOP, because "almost all" is not
 *      "all". One Hebrew case in development produced 16,384 output tokens of
 *      invalid JSON — roughly 40x a normal turn. A turn cap alone would let a
 *      handful of those through unnoticed.
 *
 * So: turns are the budget the user sees; tokens are the ceiling that catches
 * what turns cannot.
 *
 * WHY THIS BLOCKS RATHER THAN BILLS
 *
 * There is no metering or overage in this product. An unbounded chat is
 * therefore an unbounded cost against a fixed price, and the only lever is to
 * stop. Stopping WELL is the design problem: a user who hits a wall with no
 * warning concludes the product is broken, so the warning matters as much as the
 * limit.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/telemetry
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { SystemConfigService } from '@/lib/services/SystemConfigService';

const logger = createLogger({ module: 'BizQLChatBudget' });

/** Fallbacks used when nothing is configured. Deliberately generous. */
const DEFAULT_DAILY_TURNS = 200;
const DEFAULT_DAILY_TOKENS = 2_000_000;

/** Warn from here, so the wall is never the first the user hears of it. */
const WARN_AT = 0.8;

export interface BudgetRow {
  session_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface BudgetLimits {
  turnsLimit: number;
  tokensLimit: number;
  resetsAt: string;
}

export interface BudgetState {
  /** False when the turn must be refused. */
  allowed: boolean;
  /** True once the user is close enough that they should be told. */
  warn: boolean;

  turnsUsed: number;
  turnsLimit: number;
  turnsRemaining: number;

  tokensUsed: number;
  tokensLimit: number;

  /** Which ceiling stopped it, when one did. */
  exceeded?: 'turns' | 'tokens';
  /** UTC midnight — when the allowance comes back. */
  resetsAt: string;
}

/**
 * Decide from today's rows. Pure, so the arithmetic can be tested — a budget
 * that is wrong by one either charges a user for a question they did not ask or
 * lets an unbounded number through.
 */
export function evaluateBudget(rows: BudgetRow[], limits: BudgetLimits): BudgetState {
  const { turnsLimit, tokensLimit, resetsAt } = limits;

  // DISTINCT turns, not rows. A question that needed a repair is one question,
  // and charging for the planner's own retry charges the user for our bug.
  const turnsUsed = new Set(rows.map((r) => r.session_id).filter(Boolean)).size;

  // Tokens count EVERY row, attributed or not. The turn id is for grouping; the
  // tokens were spent regardless, and a ceiling that ignored some of them would
  // not be a ceiling.
  const tokensUsed = rows.reduce(
    (sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0
  );

  const overTurns = turnsUsed >= turnsLimit;
  const overTokens = tokensUsed >= tokensLimit;

  return {
    allowed: !overTurns && !overTokens,
    warn: turnsUsed >= turnsLimit * WARN_AT || tokensUsed >= tokensLimit * WARN_AT,
    turnsUsed,
    turnsLimit,
    turnsRemaining: Math.max(0, turnsLimit - turnsUsed),
    tokensUsed,
    tokensLimit,
    // Turns first: it is the limit the user was shown, so it is the one to name
    // when both are breached.
    exceeded: overTurns ? 'turns' : overTokens ? 'tokens' : undefined,
    resetsAt,
  };
}

function nextUtcMidnight(): string {
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
}

function startOfUtcDay(): string {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

/**
 * What this user has spent today, and whether they may ask another question.
 *
 * Counts DISTINCT turns rather than rows: a question that needed a repair is one
 * question, and charging a user twice for the planner's own retry would be
 * charging them for our bug.
 *
 * Fails OPEN. If the usage table cannot be read we do not know what has been
 * spent, and refusing a paying user because telemetry is down is a worse outcome
 * than a day of uncapped use — which is bounded anyway by everything else in the
 * write path. The failure is logged loudly so it does not become permanent.
 */
export async function checkBudget(userId: string): Promise<BudgetState> {
  const [turnsLimit, tokensLimit] = await Promise.all([
    SystemConfigService.getNumber(supabaseServer, 'bizchat_daily_turns', DEFAULT_DAILY_TURNS),
    SystemConfigService.getNumber(supabaseServer, 'bizchat_daily_tokens', DEFAULT_DAILY_TOKENS),
  ]);

  const resetsAt = nextUtcMidnight();

  try {
    const { data, error } = await supabaseServer
      .from('token_usage')
      .select('session_id, input_tokens, output_tokens')
      .eq('feature', 'business-os-chat')
      .eq('user_id', userId)
      .gte('created_at', startOfUtcDay())
      .limit(20000);

    if (error) throw error;

    return evaluateBudget(
      (data ?? []) as BudgetRow[],
      { turnsLimit, tokensLimit, resetsAt }
    );
  } catch (err) {
    logger.error(
      { err, userId },
      'Could not read usage; allowing the turn rather than refusing on missing data'
    );

    return {
      allowed: true,
      warn: false,
      turnsUsed: 0,
      turnsLimit,
      turnsRemaining: turnsLimit,
      tokensUsed: 0,
      tokensLimit,
      resetsAt,
    };
  }
}
