/**
 * One marker: `*` or `c`, in the field's LABEL run (FR-6).
 *
 * ── Never adjacent to the value (RC-1, binding) ──────────────────────────
 * `0.7*` reads as part of a number; `TEMPERATURE *` does not. The marker is a
 * prop of `Field`'s LABEL, not of its value, so the density slice — which
 * wants markers "inline" in a table — inherits the constraint structurally
 * rather than by remembering it.
 *
 * ── The glyph is never the carrier ───────────────────────────────────────
 * The glyph is `aria-hidden` and an adjacent `sr-only` span carries the whole
 * phrase, so assistive technology announces the MEANING once rather than
 * "star". The `title` adds the consequence for a sighted reader who hovers,
 * and the legend under the `Calls` heading states both meanings independently:
 * the hover is enrichment and is never the only place a meaning lives.
 * Nothing here distinguishes the two markers by colour.
 *
 * ── Not a `Chip` ─────────────────────────────────────────────────────────
 * Chips are word labels with a tone. A marker is a single monospace glyph in a
 * label run; giving it a border and a background would make the exception
 * louder than the value it qualifies.
 */

import { MARKER_GLYPH, MARKER_SR, MARKER_TITLE } from '../copy';
import type { MarkerKind } from '../markers';

export function Marker({ kind }: { kind: MarkerKind }) {
  return (
    <span data-testid={`marker-${kind}`} title={MARKER_TITLE[kind]}>
      <span aria-hidden="true" className="font-mono text-slate-400">
        {MARKER_GLYPH[kind]}
      </span>
      <span className="sr-only">{MARKER_SR[kind]}</span>
    </span>
  );
}
