/**
 * The line printed under a plan category's heading, without repeating the heading.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (user decision, 2026-10-02 — credit deduction slice 6b)
 *
 * A category row prints its heading and then the server-built `summary`, which
 * joins each feature's name with its value: "Credits (19,750 per month)". When a
 * category holds ONE feature named exactly like the category, that reads as
 * "Credits" over "Credits (19,750 per month)" on the plan screen and as
 * "Credits: Credits (…)" on the invite page. The rule here drops the repeat:
 * the heading already names the thing, so the line is only the value.
 *
 * Generic on purpose. It names no capability, no category and no plan; it
 * compares two strings the reader is about to see. The capability's label is
 * NOT renamed to dodge the repeat, because admins read that label as the
 * capability's name.
 *
 * It runs on the SURFACE, not in the server builder, because only the surface
 * knows the heading's words: the plan screen words it from the platform
 * dictionary, the invite page from its own copy in the invite's language. The
 * server sends the features; this decides whether to print their summary.
 *
 * Plain data in, string out, no imports: it is used by a client component and
 * by the public invite page, which must not pull in `LanguageContext`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface PlanCategoryLineFeature {
  label: string;
  value: string;
}

export interface PlanCategoryLineRow {
  /**
   * The row's features, as the server formatted them. Optional because the
   * invite page renders an HTTP payload: a body without them falls back to the
   * summary, which is what the page printed before this rule existed.
   */
  features?: readonly PlanCategoryLineFeature[];
  summary: string;
}

/** Same wording as a reader would judge it: case, outer spaces and Unicode form ignored. */
function sameWording(left: string, right: string): boolean {
  const normalise = (text: string) => text.normalize('NFC').trim().toLocaleLowerCase();
  return normalise(left) === normalise(right);
}

/**
 * The line under `heading`, or `null` when there is nothing to add to it.
 *
 * - One feature, named like the heading, with a value → the value alone
 *   ("19,750 per month").
 * - One feature, named like the heading, whose value is `yes` → `null`: the
 *   heading already says the plan has it, and the summary would only repeat it.
 * - Anything else → the server's `summary`, unchanged.
 */
export function planCategoryLine(heading: string, row: PlanCategoryLineRow): string | null {
  const features = row.features ?? [];
  if (features.length !== 1 || !sameWording(features[0].label, heading)) return row.summary;

  const [only] = features;
  return only.value === 'yes' ? null : only.value;
}
