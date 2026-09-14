/**
 * The third layer: saying something about the numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND CALL, WHEN THE PLANNER ALREADY WRITES THE SENTENCE
 *
 * Because some wording cannot be chosen until the figures exist.
 *
 * Asked "how much did my revenue drop from last week" the planner writes its
 * sentence BEFORE anything is fetched, so "dropped" is a guess about which way
 * the numbers went. It showed: two runs of the same question produced
 * "ירדו ב-8.33$" and "ירדו ב--8.33$" — dropped by minus eight, which is not a
 * sentence anyone means. Instructing it to make the sign come out right is
 * asking it to predict the answer.
 *
 * Once both numbers are in hand that is trivial. This layer runs after
 * execution, so "fell" is a fact it can check rather than a direction it has to
 * assume — which is also why the judgement rule can be enforced here and not
 * upstream: a comparison is only honest when there is something to compare with,
 * and by this point we know whether there is.
 *
 * WHAT IT STILL MAY NOT DO
 *
 * Compute. It composes `{= ... }` and the server evaluates it, so a figure can
 * be wrong only if the arithmetic is — and the arithmetic is ours, exact, and
 * property-tested. The model chooses what is worth saying; it never does sums.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/analyse
 */

import { createLogger } from '@/lib/logger';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { supabaseServer } from '@/lib/supabaseServer';
import { buildAnalysisPayload, type AnalysisPayload } from './payload';
import type { QueryResult } from '../types';

const logger = createLogger({ module: 'BizQLAnalysis' });

const SYSTEM_PROMPT = `You are given the RESULT of a business question — numbers only — and you write the one sentence that answers it.

RULES

1. Never write a number yourself. You have the values so you could, and you must not: state
   every figure as a placeholder and the server resolves it exactly.
     {s1.value}                        a step's figure, formatted for its unit
     {=  EXPR }                        a computed number
     {=% EXPR }                        a percentage — EXPR IS A RATIO
     {=$ EXPR }                        computed money
     {s1.groups.g1.label}              what a group is called
     {s1.groups.g1.value}              that group's figure
   EXPR may use numbers, + - * / , parentheses, and sN.value / sN.count. Nothing else.

   {=% } TAKES A RATIO AND FORMATS IT AS A PERCENTAGE. Write {=% s1.value / s2.value }.
   Do NOT multiply by 100 — it is applied for you, and doing it yourself reports 12,808%
   where the answer is 128%. Do NOT write a % sign after it either.

   NEVER put a unit next to a placeholder. {s1.value} already renders "$158.33", so
   "{s1.value} dollars" reads "$158.33 dollars". Same for %, ₪ and any currency word.

   EVERY GROUP HAS A NAME YOU CANNOT SEE. You are given "g1", "g2" with their figures and
   deliberately not their labels — write {s1.groups.g1.label} and the name is filled in for
   you. Do not conclude from its absence that there is none: "the most profitable service
   earned {s1.groups.g1.value}" tells the reader nothing they did not already know, where
   "{s1.groups.g1.label} earned {s1.groups.g1.value}" answers the question. Groups arrive in
   the step's own order, so g1 is the top one when it was sorted.
   A step with groups usually has a null value, because the figures live in the groups.
   That is not a missing number — read the groups.

2. You may say which way something went — "fell", "rose", "dropped", "more than" — ONLY when
   there are TWO steps to compare. With a single figure you have nothing to measure against,
   so state it: "revenue is {s1.value}", never "revenue dropped to {s1.value}". A drop needs
   the thing it dropped from, and if that was not fetched you cannot claim one.
   Never call a figure high, low, good or unusual: nothing here tells you what normal is.

3. Answer in the language given. One sentence, or two if the question genuinely asked two
   things. No preamble, no advice, no "let me know if".

4. Say the figures the answer rests on, not only the conclusion. "523 of 408.33, which is 128%"
   lets the reader catch a wrong denominator; "128%" hides it.

5. A group's name is only available as {sN.groups.gK.label}. You were not given names and must
   not invent one.

Reply with the sentence alone.`;

/** Off is instant and needs no deploy — the same retreat L2 semantic caching took. */
async function enabled(): Promise<boolean> {
  return SystemConfigService.getBoolean(supabaseServer, 'bizchat_analysis_enabled', true);
}

async function resolveModel(): Promise<string> {
  return SystemConfigService.getString(supabaseServer, 'bizchat_analysis_model', 'gpt-4o-mini');
}

export interface AnalysisRequest {
  question: string;
  language: string;
  currency: string;
  userId: string;
  steps: Array<{ id?: string }>;
  results: QueryResult[];
  /** Groups this call's cost with the rest of the turn. */
  turnId?: string;
}

/**
 * A sentence for the renderer, or null to keep the planner's own.
 *
 * Never throws. This layer is an improvement on an answer that already exists,
 * so any failure — the model, the config, a malformed reply — must leave the
 * turn exactly as it would have been without it.
 */
export async function analyse(request: AnalysisRequest): Promise<string | null> {
  try {
    if (!(await enabled())) return null;

    const payload = buildAnalysisPayload(request);
    if (payload.steps.length === 0) return null;

    const model = await resolveModel();

    const response = await ProviderFactory.getProvider('openai').chatCompletion(
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        temperature: 0,
        // The planner's repetition collapse under greedy decoding applies to any
        // call with a long instruction prompt. See Planner.ts for the measurement.
        frequency_penalty: 0.3,
        max_tokens: 300,
      } as never,
      {
        userId: request.userId,
        feature: 'business-os-chat',
        // Separable from planning, the way repair calls already are.
        component: 'BizQLAnalysis',
        sessionId: request.turnId,
      } as never
    );

    const text = (
      response as { choices?: Array<{ message?: { content?: string } }> }
    ).choices?.[0]?.message?.content?.trim();

    if (!text) return null;

    const problem = problemWith(text, payload);
    if (problem) {
      // Not repaired in place: the planner's sentence is already a correct
      // answer, so falling back to it costs the user nothing, while a second
      // round trip costs them a visible wait.
      logger.warn({ problem, text: text.slice(0, 120) }, 'Discarding analysis sentence');
      return null;
    }

    return text;
  } catch (err) {
    logger.warn({ err }, 'Analysis unavailable; keeping the planner sentence');
    return null;
  }
}

/**
 * Why a sentence cannot be used, or undefined if it can.
 *
 * The digit check is the one that matters. Every figure must arrive through a
 * placeholder, so a bare number is the model having done arithmetic itself —
 * exactly the thing this design exists to prevent, and invisible in the output
 * because a wrong number looks like a right one.
 */
function problemWith(text: string, payload: AnalysisPayload): string | undefined {
  const withoutPlaceholders = text.replace(/\{[^}]*\}/g, '');

  // Digits the user themselves wrote are fine to echo — a threshold, a year.
  const fromQuestion = new Set(payload.question.match(/\d+/g) ?? []);
  const invented = (withoutPlaceholders.match(/\d+/g) ?? []).filter((n) => !fromQuestion.has(n));

  if (invented.length > 0) return `states ${invented.join(', ')} outside a placeholder`;

  const known = new Set(payload.steps.map((step) => step.id));
  for (const [, stepId] of text.matchAll(/\{=?[%$]?\s*(?:.*?)(s\d+)\./g)) {
    if (!known.has(stepId)) return `references unknown step ${stepId}`;
  }

  if (!/\{/.test(text)) return 'contains no placeholder, so it states nothing measured';

  /*
   * A comparison needs something compared.
   *
   * Rule 2 asks for this; asking is not enough. Given one figure and a question
   * phrased as a change, the model wrote "The revenue dropped to $208.33" —
   * fluent, confident, and about a drop nothing in the payload could establish.
   * With a single step there is no baseline, so any claim of direction is
   * invented and the planner's own sentence is the safer answer.
   *
   * Deliberately shallow: it counts steps rather than parsing prose. Detecting
   * "compares" across languages would need a word list per language, which is
   * the kind of table that does not scale and is not what this checks anyway —
   * the question is whether a comparison COULD be true, and that is structural.
   */
  if (payload.steps.length < 2) {
    const placeholders = text.match(/\{[^}]*\}/g) ?? [];
    const referenced = new Set(
      placeholders.flatMap((token) => [...token.matchAll(/s(\d+)\./g)].map((m) => m[1]))
    );

    if (referenced.size < 2 && /\{=/.test(text)) {
      return 'computes a relationship from a single figure, which cannot be one';
    }
  }

  return undefined;
}
