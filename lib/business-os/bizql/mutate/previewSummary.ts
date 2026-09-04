/**
 * What a bulk send is about to do, in the reader's language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This sentence is the last thing a person sees before approving a send, and it
 * was built in English by two routes independently — so a Hebrew conversation
 * asked for confirmation with "1 recipient — 2013643030" sitting between a
 * Hebrew message and Hebrew buttons.
 *
 * One producer, because the two copies had already drifted apart in how they
 * assembled the sample list, and a confirmation prompt is the worst place for
 * two surfaces to describe the same action differently.
 *
 * The count is `attempted`, never `rows.length`: the executor dedupes by
 * recipient, so seven invoices can be four emails, and showing the row count
 * would have someone approve a number that never happens.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate/previewSummary
 */

/** How many people, phrased for one or for many. */
const RECIPIENTS: Record<string, (count: number) => string> = {
  en: (count) => `${count} recipient${count === 1 ? '' : 's'}`,
  he: (count) => `${count} ${count === 1 ? 'נמען' : 'נמענים'}`,
  es: (count) => `${count} ${count === 1 ? 'destinatario' : 'destinatarios'}`,
};

/** How many are listed before the rest are elided. */
const SAMPLE_LIMIT = 5;

export function recipientSummary(
  attempted: number,
  targets: string[],
  language: string
): string {
  const phrase = (RECIPIENTS[language] ?? RECIPIENTS.en)(attempted);
  const sample = targets.slice(0, SAMPLE_LIMIT).join(', ');

  if (!sample) return phrase;

  // The ellipsis is driven by `attempted`, not by the sample length: the sample
  // is capped at five, so comparing it to itself would never elide anything.
  return `${phrase} — ${sample}${attempted > SAMPLE_LIMIT ? ', …' : ''}`;
}
