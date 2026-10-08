/**
 * One line, from text written for somewhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A service description is an owner's own notes about what they sell: on the
 * reporting account it runs to eleven lines, covering diagnosis rates, the
 * neurology of the condition and what it is like to parent a child who has it.
 * All true, none of it a hero line.
 *
 * It was being used WHOLE in two places on a generated landing page — as the
 * hero subheadline when generation fell back, and as the pricing card's
 * description — so the page opened with a paragraph where a promise belongs and
 * repeated the same paragraph beside the price.
 *
 * This takes the first sentence, and only when it is short enough to read as
 * one. A description that opens with a 300-character paragraph has no usable
 * lead in it, and nothing is better than a wall of text in a slot built for a
 * sentence.
 *
 * Deliberately NOT a truncation with an ellipsis: a sentence cut mid-clause
 * reads as a rendering fault, and on a sales page it reads as a careless one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/leadSentence
 */

/** How long a lead may be and still read as one line. */
const MAX_LEAD = 180;

export function leadSentence(text: string | null | undefined, maxLength = MAX_LEAD): string | null {
  const flat = (text || '').trim().replace(/\s+/g, ' ');
  if (!flat) return null;

  /*
   * Hebrew, Spanish and English all close a sentence with one of these, and all
   * three put a space after it. The `|[.!?]$` tail catches a description that
   * is exactly one sentence with nothing following it.
   */
  const end = flat.search(/[.!?]\s|[.!?]$/);
  const lead = end > 0 ? flat.slice(0, end + 1) : flat;

  return lead.length <= maxLength ? lead : null;
}
