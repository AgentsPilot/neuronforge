/**
 * Ask the model what to look at, then look.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The model is given a profile of SHAPES -- row counts, metric series, how
 * often the owner did things -- and asked for questions worth settling. Each
 * question arrives as a BizQL `compute` query plus the condition that would
 * answer it. This file runs them. `verify.ts` judges them.
 *
 * WHAT THE MODEL IS NOT ALLOWED TO DO
 *
 *   report a figure      every number comes from a query result; a claim
 *                        carrying a digit is rejected by `claimCarriesFigure`
 *   name a column        BizQL validates `entity` and fields against the
 *                        catalog, so a phantom column is discarded unrun
 *   decide what counts   `confirm_when` is a closed set evaluated by code
 *   supply a denominator `deriveDenominator` builds it from the measure query
 *
 * Which leaves it one job: notice something worth asking about. That is the
 * job no detector in the catalogue can do, and the only one it is trusted with.
 *
 * COST AND SILENCE
 *
 * One call per business per week, behind `worthAsking` so a young account costs
 * nothing, and behind `settings.enabled` so the whole thing can be switched off
 * without a deploy. Most weeks on most accounts this returns nothing, which is
 * the correct outcome rather than a failure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { runBusinessQuery } from '../../bizql';
import type { ComputeQuery, ComputeResult } from '../../bizql/types';
import { buildProfile, worthAsking, type BusinessProfile } from './buildProfile';
import {
  CONFIRM_WHEN_KINDS,
  deriveDenominator,
  evaluate,
  type Proposal,
  type Verdict,
} from './verify';

const logger = createLogger({ module: 'HypothesisService' });

/**
 * How many proposals are considered in one run.
 *
 * The model is asked for a few and the rest are dropped. Each surviving one
 * costs two database queries, so an unbounded list is an unbounded run -- and a
 * model asked for "as many as you can" produces a long tail of increasingly
 * strained ideas. What was dropped is logged, because a silent truncation reads
 * as "we looked at everything".
 */
const MAX_PROPOSALS = 6;

export interface Finding {
  claim: string;
  query: ComputeQuery;
  confirmWhen: Proposal['confirmWhen'];
  verdict: Verdict;
}

export interface HypothesisRun {
  /** Confirmed findings, each with the numbers behind it. */
  findings: Finding[];
  /** Why the others were turned away: the useful output early on. */
  rejected: Array<{ claim: string; reason: string }>;
  proposed: number;
  /** Absent when no call was made, with the reason in `skipped`. */
  modelUsed?: string;
  skipped?: 'disabled' | 'not_enough_data' | 'no_proposals';
}

function buildPrompt(profile: BusinessProfile): string {
  return `You are looking at one small business's own records and your job is to
notice something worth asking about that a fixed set of rules would miss.

You do NOT report findings. You propose a QUESTION and the query that settles
it. Someone else runs the query and decides. This matters: you have no access to
the answer, so a claim with a number in it is guaranteed wrong and is discarded.

WHAT THIS BUSINESS HAS (last ${profile.windowDays} days for behaviour)

Row counts: ${JSON.stringify(profile.counts)}

Metric history, oldest value first:
${profile.metrics.map(m => `  ${m.key} (${m.periodType}): ${JSON.stringify(m.values)}`).join('\n')}

What the owner did by hand (action, times, on how many separate days):
${profile.behaviour.slice(0, 20).map(b => `  ${b.action}: ${b.count} on ${b.days} days`).join('\n')}

THE DATA YOU MAY QUERY

${profile.catalog}

WHAT TO LOOK FOR

A shape, not a total. The useful questions are about one group behaving unlike
the others: a service, a weekday, a source, a price band, a stage. "Revenue is
low" is useless. "One of these services behaves unlike the rest" is a question.

Look especially at a metric series that is erratic rather than merely low. A
series like [0,0,0,0,0,100,100] is not a bad average, it is two different
behaviours sharing one number, and asking which rows fall on each side is
exactly the kind of question nobody wrote a rule for.

WHAT TO RETURN

JSON only. An array of at most ${MAX_PROPOSALS} objects, fewest is fine, empty
is a perfectly good answer when nothing stands out:

[{
  "claim": "one sentence, plain language, NO NUMBERS AT ALL",
  "query": {
    "op": "compute",
    "entity": "<from the catalog>",
    "group_by": "<field or relation>",
    "where": [{ "field": "<field>", "op": "eq", "value": "<value>" }],
    "agg": { "fn": "count|sum|avg", "field": "<field, omit for count>" }
  },
  "confirm_when": { "kind": "group_differs", "min_rows_per_group": 5, "min_ratio": 2 }
}]

A filter is { "field": ..., "op": ..., "value": ... }. The key is "op", NOT
"operator" -- "operator" makes the whole query invalid and the proposal is
discarded. "where" is optional; leave it out entirely if you are not filtering.

"confirm_when" must be one of exactly these two shapes:
  { "kind": "group_differs", "min_rows_per_group": N, "min_ratio": R }
      the best group beats the worst by at least R times
  { "kind": "group_is_zero", "min_rows_per_group": N, "min_other_groups": N }
      one group is zero while at least that many others are not

RULES
- "group_by" is required. A question with no groups cannot be settled.
- NEVER group by a raw id column. "group_by": "service_id" produces groups
  named "5be8fe70-daac-4e55-..." and the finding is discarded as unreadable.
  Group by the RELATION name instead -- "group_by": "service" -- and the groups
  come back named after the services.
- Use "over" when a group with NOTHING in it still matters:

    { "op": "compute", "entity": "services", "over": "bookings",
      "agg": { "fn": "count" } }

  This starts from services, so a service with NO bookings appears at zero.
  Grouping bookings by service leaves that service out of the result entirely,
  so "which service sells least" is only answerable with "over". Any "where"
  then applies to the RELATED rows (the bookings), not the parents.
- The claim must describe EXACTLY what the query measures. If the claim says
  "completed bookings", the query needs a filter for completed. A claim that
  describes a narrower thing than the query counted is wrong even when the
  arithmetic is right.
- Only entities and fields from the catalog above. Anything else is discarded.
- min_rows_per_group is how many rows a group needs before you would believe
  it. Choose honestly: one client is never a pattern, and a floor is enforced
  regardless.
- No numbers in "claim". The query supplies them.`;
}

/**
 * Parse the model's reply into proposals, discarding anything malformed.
 *
 * Deliberately forgiving about shape and strict about content: a missing field
 * drops that one proposal rather than the run. A `confirm_when` kind outside
 * the closed set is dropped here as well as in the verifier, so a bad kind
 * never reaches a query.
 */
function parseProposals(raw: string): Proposal[] {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    /*
     * A JSON SyntaxError QUOTES the text it failed on, and that text is the
     * model's output about this owner's business. Standard 5: the name and a
     * length at error, the error itself only at debug.
     */
    logger.error(
      { errName: (err as Error).name, length: text.length },
      'Hypothesis reply was not JSON'
    );
    logger.debug({ err }, 'Hypothesis parse failure detail');
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const proposals: Proposal[] = [];

  for (const item of parsed) {
    const row = item as Record<string, unknown>;
    const claim = typeof row.claim === 'string' ? row.claim.trim() : '';
    const query = row.query as ComputeQuery | undefined;
    const confirm = row.confirm_when as Record<string, unknown> | undefined;

    if (!claim || !query || !confirm) continue;
    /*
     * EITHER grouping mechanism. BizQL has two and they are not interchangeable:
     * `group_by` buckets the rows themselves (status, weekday), while `over`
     * aggregates across a relation so every parent gets a group -- including
     * the ones with no related rows, which is the only way "which service sells
     * least" is answerable.
     *
     * This required `group_by` alone for one revision, which silently dropped
     * every correct `over` proposal the prompt had just started asking for. Two
     * live runs returned "no usable proposals" with the model doing nothing
     * wrong.
     */
    if (query.op !== 'compute' || !query.entity) continue;
    if (!query.group_by && !query.over) continue;
    if (!CONFIRM_WHEN_KINDS.includes(confirm.kind as never)) continue;

    // snake_case on the wire (what a model writes), camelCase inside.
    const confirmWhen =
      confirm.kind === 'group_differs'
        ? {
            kind: 'group_differs' as const,
            minRowsPerGroup: Number(confirm.min_rows_per_group) || 0,
            minRatio: Number(confirm.min_ratio) || 0,
          }
        : {
            kind: 'group_is_zero' as const,
            minRowsPerGroup: Number(confirm.min_rows_per_group) || 0,
            minOtherGroups: Number(confirm.min_other_groups) || 0,
          };

    proposals.push({ claim, query, confirmWhen });
  }

  return proposals;
}

/**
 * Run one proposal: the measure, the derived denominator, then the judgement.
 *
 * `consumer: 'detector'` so the BizQL telemetry can tell this apart from a
 * question an owner typed. A query the compiler refuses never reaches the
 * database, which is what makes a phantom column impossible rather than
 * guarded.
 */
async function settle(
  supabase: SupabaseClient,
  userId: string,
  proposal: Proposal
): Promise<Verdict | null> {
  try {
    const ctx = { userId, consumer: 'detector' as const };

    const [measure, denominator] = await Promise.all([
      runBusinessQuery(proposal.query as never, ctx, supabase),
      runBusinessQuery(deriveDenominator(proposal.query) as never, ctx, supabase),
    ]);

    if (measure.op !== 'compute' || denominator.op !== 'compute') return null;

    return evaluate(proposal, measure as ComputeResult, denominator as ComputeResult);
  } catch (err) {
    /*
     * An invalid query is the EXPECTED failure here, not an exception worth
     * raising: the model proposed something the catalog does not support and
     * the proposal is simply dropped. Logged at debug with the entity only --
     * never the claim, which is model output about the owner's business.
     */
    logger.debug(
      { err, userId, entity: proposal.query.entity },
      'Proposal could not be settled; discarded'
    );
    return null;
  }
}

/**
 * One week's pass over one business.
 *
 * The caller owns the `groupId` (one per business per run) and the
 * `runAiAction` wrapper, per Standard 3 and Standard 6.
 */
export async function generateHypotheses(
  supabase: SupabaseClient,
  userId: string,
  groupId: string
): Promise<HypothesisRun> {
  const settings = await resolveBosLlmSettings('insights', 'hypothesis');
  if (!settings.enabled) {
    logger.info({ userId }, 'Hypothesis generation is switched off; no call made');
    return { findings: [], rejected: [], proposed: 0, skipped: 'disabled' };
  }

  const profile = await buildProfile(supabase, userId);

  if (!worthAsking(profile)) {
    /*
     * Checked before paying for a call. Every proposal would fail the
     * verifier's row floor, so the model has nothing to work with and the
     * answer is already known.
     */
    logger.info(
      { userId, counts: profile.counts, metricSeries: profile.metrics.length },
      'Not enough behind this business yet to ask; no call made'
    );
    return { findings: [], rejected: [], proposed: 0, skipped: 'not_enough_data' };
  }

  const provider = ProviderFactory.getProvider('openai');

  // Built inside the attempt so a retry carries the model that ran (FR-11).
  const { result: completion, modelUsed } = await withModelFallback(settings, model =>
    provider.chatCompletion(
      {
        model,
        messages: [{ role: 'user', content: buildPrompt(profile) }],
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
        max_tokens: 1200,
      },
      buildBosCallContext(
        { userId, area: 'insights', callName: 'hypothesis', groupId },
        { activity_type: 'hypothesis' }
      )
    )
  );

  const proposals = parseProposals(completion.choices[0]?.message?.content ?? '');

  if (proposals.length === 0) {
    logger.info({ userId, modelUsed }, 'No usable proposals returned');
    return { findings: [], rejected: [], proposed: 0, modelUsed, skipped: 'no_proposals' };
  }

  const considered = proposals.slice(0, MAX_PROPOSALS);
  if (proposals.length > considered.length) {
    // Named, not dropped quietly: a truncation nobody sees reads as coverage.
    logger.info(
      { userId, returned: proposals.length, considered: considered.length },
      'More proposals than the per-run cap; the surplus was dropped'
    );
  }

  const findings: Finding[] = [];
  const rejected: HypothesisRun['rejected'] = [];

  for (const proposal of considered) {
    // eslint-disable-next-line no-await-in-loop -- each query is cheap and a
    // run is weekly; serial keeps one business's load predictable.
    const verdict = await settle(supabase, userId, proposal);

    if (!verdict) {
      rejected.push({ claim: proposal.claim, reason: 'query_invalid' });
      continue;
    }

    if (verdict.confirmed) {
      findings.push({ claim: proposal.claim, query: proposal.query, confirmWhen: proposal.confirmWhen, verdict });
    } else {
      rejected.push({ claim: proposal.claim, reason: verdict.reason ?? 'condition_not_met' });
    }
  }

  logger.info(
    {
      userId,
      modelUsed,
      proposed: considered.length,
      confirmed: findings.length,
      rejectedReasons: rejected.map(r => r.reason),
    },
    'Hypothesis run complete'
  );

  return { findings, rejected, proposed: considered.length, modelUsed };
}
