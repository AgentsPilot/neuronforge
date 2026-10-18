/**
 * The one implementation of the RR-1 model-name rule, shared by every price
 * adapter (AI model price review slice 10; SA O-10, SC10-1). Pure.
 *
 * ── The rule (slice 5, unchanged) ──────────────────────────────────────────
 * Trim, drop ONE trailing parenthetical note, lowercase, spaces to hyphens.
 * Candidates: that text, and the same with dots turned into hyphens, deduped
 * and each passing `MODEL_ID_REGEX`. A candidate equal to a coverage id is an
 * exact match. The caller treats more than one match as manual entry (SC-10).
 *
 * ── Per-adapter options (default OFF, so OpenAI is byte-identical) ─────────
 *   linksToText      every markdown link `[text](url)` in the cell becomes its
 *                    text first, so a note holding a link can still be dropped
 *                    by the one-note rule (the note pattern refuses `(` `)`).
 *   snapshotSuffix   a coverage id equal to `<candidate>-` + exactly 8 digits
 *                    also matches: a provider's documented dated-snapshot id
 *                    FORMAT (`-YYYYMMDD`), never a model table (CLAUDE.md
 *                    rule 5). SC10-1: matches are the UNION of exact and
 *                    snapshot matches, not a fallback, so "dateless and dated
 *                    both in coverage" is two matches and goes to manual.
 */

import { MODEL_ID_REGEX } from './pendingLineSchema';

const TRAILING_NOTE = /^(.*?)[ ]*[(]([^()]*)[)]$/;
const MARKDOWN_LINK = /\[([^[\]]*)\]\(([^()\s]*)\)/g;
/** The dated-snapshot suffix: a hyphen and exactly eight digits after the candidate. */
export const SNAPSHOT_SUFFIX = /^-[0-9]{8}$/;

export interface ModelCellMatchOptions {
  linksToText?: boolean;
  snapshotSuffix?: boolean;
}

export interface ModelCellMatch {
  matches: string[];
  note: string | null;
}

/** Coverage ids a model cell names, and the dropped note (if any). */
export function matchModelCellWith(
  cell: string,
  coverage: ReadonlySet<string>,
  options: ModelCellMatchOptions = {}
): ModelCellMatch {
  let name = options.linksToText ? cell.replace(MARKDOWN_LINK, '$1') : cell;
  name = name.trim();
  let note: string | null = null;
  const noted = TRAILING_NOTE.exec(name);
  if (noted) {
    name = noted[1].trim();
    note = noted[2].trim();
  }
  name = name.toLowerCase().split(' ').filter(Boolean).join('-');
  const candidates = Array.from(new Set([name, name.split('.').join('-')])).filter((candidate) =>
    MODEL_ID_REGEX.test(candidate)
  );

  const matches = candidates.filter((candidate) => coverage.has(candidate));
  if (options.snapshotSuffix) {
    const snapshots = [...coverage].filter(
      (id) =>
        !matches.includes(id) &&
        candidates.some((candidate) => id.startsWith(`${candidate}-`) && SNAPSHOT_SUFFIX.test(id.slice(candidate.length)))
    );
    matches.push(...snapshots.sort());
  }
  return { matches, note };
}
