/**
 * Merging a business's authored copy over a block's own content.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE RULE, PREVIOUSLY WRITTEN TWICE.
 *
 * The editor (`/api/website/pages/[id]/blocks-with-content`) and the public site
 * (`/api/website/public/[subdomain]`) both merge `website_content` over
 * `website_blocks.content`, and each carried its own copy of the loop. They
 * agreed, but nothing made them: the same column read by two routes with two
 * slightly different assumptions is exactly how the working-hours bug happened
 * — three readers, three guesses at one shape.
 *
 * A difference here would be worse than an inconsistency, because it would mean
 * the site a business PREVIEWS is not the site its clients GET.
 *
 * THE RULE: the block is the base, and a central value wins over it — that is
 * the point of the store, so swapping a template cannot wipe what somebody
 * typed. Which is precisely why an empty value must never win, and why the
 * table's column defaults are now `{}` rather than English placeholders: a
 * placeholder stored in this table is indistinguishable from a sentence the
 * business wrote, and used to beat generated copy on sight.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A value the business plainly has not filled in. */
function isBlank(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  // `{}` is what an unauthored section now looks like.
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
    return true;
  }
  return false;
}

/**
 * Block content with the business's authored copy laid over it.
 *
 * @param blockContent  the block's own content — the base, never discarded
 * @param sectionContent the matching `website_content` section, or null/undefined
 * @param sectionName   used for the one field-name difference between the two shapes
 */
export function mergeCentralContent(
  blockContent: Record<string, unknown> | null | undefined,
  sectionContent: Record<string, unknown> | null | undefined,
  sectionName?: string
): Record<string, unknown> {
  const base = blockContent ?? {};
  if (!sectionContent) return { ...base };

  const authored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sectionContent)) {
    if (isBlank(value)) continue;
    authored[key] = value;
  }

  // The two shapes disagree on one name: the store calls it `about_text`, the
  // block calls it `content`.
  if (sectionName === 'about' && authored.about_text) {
    authored.content = authored.about_text;
    delete authored.about_text;
  }

  return { ...base, ...authored };
}
