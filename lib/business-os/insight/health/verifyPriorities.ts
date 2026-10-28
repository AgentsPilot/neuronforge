/**
 * The week's "do this first" list, checked before it is stored.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A CHECK AND NOT A BETTER PROMPT
 *
 * The prompt was already strict about numbers, and the narrative it produced
 * was correct: "there are 29 empty hours" in one paragraph, "send reminders to
 * clients who did not show up" in another, with no figure. The PRIORITY then
 * fused the two into "send reminders to 29 clients who missed meetings" — a
 * sentence assembled from two true halves, about a practice with six clients.
 *
 * A prompt cannot be relied on to never do that again: the same account got a
 * correctly worded version of the same figure a fortnight earlier, from the
 * same instructions. One call, one sample, no second opinion. So the line is
 * checked against the facts it was given, deterministically, in code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS ALLOWED TO SAY
 *
 * A priority may carry a figure ONLY if:
 *   1. it names the insight it came from, and that insight was really offered;
 *   2. every figure in it is one of that insight's own figures, or a measured
 *      rate from the same summary;
 *   3. it does not pin a non-people count onto people.
 *
 * A line with no figures at all passes untouched. "Call the three people who
 * have not paid" is the shape this feature exists to produce, and most of the
 * value is in sentences like it; the rules above only police the arithmetic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHAT HAPPENS WHEN EVERYTHING IS DROPPED
 *
 * Never an empty card. Each insight already carries a `recommendation` written
 * in the owner's language, one actionable sentence, generated beside the title
 * it belongs to. `fallbackPriorities` promotes those. They are blunter than the
 * model's prose and they are true, which is the right trade for the one line an
 * owner is most likely to act on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { isPeopleCount, mentionsPeople } from './countNouns';

/** One issue the narrator was shown, and the only figures it may be quoted with. */
export interface PriorityFact {
  insightId: string;
  /** `affected_entity_type` on the insight row. */
  entityType?: string | null;
  /** Figures this insight owns: its count, its money, its percentage. */
  figures: number[];
  /** The insight's own one-line action, in the owner's language. */
  recommendation?: string | null;
  /** For the fallback's ordering and for logging. */
  category: string;
  detectorId: string;
}

export interface CandidatePriority {
  rank?: number;
  category?: string;
  title?: string;
  insight_id?: string;
}

export interface VerifiedPriority {
  rank: number;
  category: string;
  title: string;
  insight_id?: string;
}

export interface VerifyResult {
  kept: VerifiedPriority[];
  /** Why each rejected line was rejected, for the run log. */
  dropped: Array<{ title: string; reason: string }>;
}

/**
 * Every number in a sentence, as integers.
 *
 * Thousands separators are stripped first, so "₪11,600" is one figure and not
 * two. A decimal is floored to its whole part, because the figures it is
 * compared against are rounded on the way into the prompt and a rate of 48.4
 * must still match "48%".
 */
function figuresIn(text: string): number[] {
  const normalised = text.replace(/(\d)[,\s\u00A0\u202F](?=\d{3})/g, '$1');

  return (normalised.match(/\d+(?:\.\d+)?/g) ?? []).map(n => Math.floor(Number(n)));
}

/** Tolerant comparison: the prompt rounds, the model rounds again. */
function matchesAnyFigure(value: number, allowed: number[]): boolean {
  return allowed.some(a => {
    const whole = Math.floor(a);
    if (whole === value) return true;

    /*
     * Money is the one quantity a model legitimately re-renders: ₪11,600 said
     * as "11.6 thousand", or rounded to 12,000 in a short line. Within 2% of a
     * four-figure sum is the same claim; a different figure entirely is not.
     */
    return whole >= 1000 && Math.abs(whole - value) <= whole * 0.02;
  });
}

/**
 * Keep the priorities that the facts support.
 *
 * `allowedRates` are the measured percentages from the same summary row (48.4%
 * of invoices paid on time, and so on). They are legal in a priority because
 * they are the one set of figures the prompt hands over with their own
 * comparison attached.
 */
export function verifyPriorities(input: {
  priorities: CandidatePriority[];
  facts: PriorityFact[];
  allowedRates: number[];
  language: string;
}): VerifyResult {
  const byId = new Map(input.facts.map(f => [f.insightId, f]));
  const kept: VerifiedPriority[] = [];
  const dropped: Array<{ title: string; reason: string }> = [];

  for (const candidate of input.priorities) {
    const title = (candidate.title ?? '').trim();

    if (!title) {
      dropped.push({ title: '(empty)', reason: 'no title' });
      continue;
    }

    const numbers = figuresIn(title);
    const fact = candidate.insight_id ? byId.get(candidate.insight_id) : undefined;

    /*
     * A figure with no source. This is the exact shape of the live fault: the
     * model wrote "29" and cited nothing, so there was nothing to check it
     * against and no way for the reader to click through to what it meant.
     */
    if (numbers.length > 0 && !fact) {
      dropped.push({
        title,
        reason: candidate.insight_id
          ? `cites an unknown issue (${candidate.insight_id})`
          : 'carries a number but names no issue it came from',
      });
      continue;
    }

    if (fact) {
      const unsupported = numbers.filter(
        n => !matchesAnyFigure(n, [...fact.figures, ...input.allowedRates])
      );

      if (unsupported.length > 0) {
        dropped.push({
          title,
          reason: `figure ${unsupported.join(', ')} is not one of this issue's own numbers`,
        });
        continue;
      }

      /*
       * The subject check. A count of hours, invoices or pages must not be
       * handed to people — that single substitution is what turned 29 empty
       * hours into 29 clients.
       *
       * Only applied when the line actually carries a figure: "ask clients how
       * they heard about you", filed under an insight about enquiry sources, is
       * a fine sentence about people with no count to misplace.
       */
      if (
        numbers.length > 0 &&
        !isPeopleCount(fact.entityType) &&
        mentionsPeople(title, input.language)
      ) {
        dropped.push({
          title,
          reason: `attaches a count of ${fact.entityType ?? 'something else'} to people`,
        });
        continue;
      }
    }

    kept.push({
      rank: kept.length + 1,
      category: candidate.category || fact?.category || 'operations',
      title,
      // Only ever the id that was verified against the facts.
      ...(fact ? { insight_id: fact.insightId } : {}),
    });
  }

  return { kept, dropped };
}

/**
 * The priorities to show when the model's did not survive, built from the
 * insights' own recommendations.
 *
 * In the order the facts were given, which is the order the detectors were
 * prioritised in, so the first line is still the most important thing.
 */
export function fallbackPriorities(facts: PriorityFact[], limit = 3): VerifiedPriority[] {
  return facts
    .filter(f => (f.recommendation ?? '').trim().length > 0)
    .slice(0, limit)
    .map((f, index) => ({
      rank: index + 1,
      category: f.category,
      title: f.recommendation!.trim(),
      insight_id: f.insightId,
    }));
}
