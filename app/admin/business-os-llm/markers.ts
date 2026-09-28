/**
 * Which fields a call row renders, which of them may carry a marker, and which
 * marker each one carries.
 *
 * ── One list, used twice (R-C / D-1) ─────────────────────────────────────
 * `CallRow` used to render four named fields and then filter its catch-all
 * against a SECOND, hand-written copy of those four names. Removing `enabled`
 * and `provider` from the render without also editing the filter would have
 * deleted `provider_not_allowed`, `call_not_switchable`, `area_not_switchable`
 * and `enabled_not_a_boolean` from the page entirely — a refusal that is
 * invisible is worse than no page at all (F-6).
 *
 * So the row takes ONE list from `renderedFieldsFor()` and uses it for both
 * jobs, in the same scope. `CallRow.tsx` contains no array literal of field
 * names at all, and `__tests__/source.guard.test.ts` asserts that against a
 * planted violation — because a rule that cannot match looks exactly like a
 * rule that found nothing (RC-9).
 *
 * @see docs/workplans/BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_WORKPLAN.md D-1, D-3, D-4
 */

import type { AreaView, CallView, SettingField } from './types';

/**
 * The fields that may carry a marker (FR-6).
 *
 * ⚠️ Named for the STRONGER of its two jobs. This constant is:
 *   1. the set of fields `markerFor` will consider — anything added here can
 *      be marked, and is marked the moment its provenance says so;
 *   2. the base of the per-render field list (`renderedFieldsFor`).
 *
 * `provider` is rendered on the `varies by call` path and must NEVER take a
 * marker (FR-8 / AC-6: it is not configurable at any level, so a `c` would
 * invite an operator to try). That is why it is added by `renderedFieldsFor`
 * rather than living here. **A rendered-but-unmarkable field goes beside
 * `UNMARKED_RENDERED_FIELD`, never in this array.**
 */
export const MARKED_FIELDS = ['model', 'temperature'] as const;
export type MarkedField = (typeof MARKED_FIELDS)[number];

/** Rendered on the FR-8 `varies by call` path only, and never marked (AC-6). */
export const UNMARKED_RENDERED_FIELD = 'provider' as const;

/** Every field a call row can render: the marked set, plus the unmarked one. */
export type RenderedField = MarkedField | typeof UNMARKED_RENDERED_FIELD;

/** `*` — set on this call. `c` — no stored value is in force. */
export type MarkerKind = 'call' | 'code';

/**
 * The fields one call row renders, in order.
 *
 * `showProvider` is true only for an area whose calls resolve to more than one
 * provider (FR-8). Because the row derives BOTH its fields and its catch-all
 * filter from this one list, the per-call provider field and the per-call
 * provider ISSUES can only appear or disappear together — which is the single
 * property R-C is about.
 */
export function renderedFieldsFor(showProvider: boolean): readonly RenderedField[] {
  return showProvider ? [...MARKED_FIELDS, UNMARKED_RENDERED_FIELD] : MARKED_FIELDS;
}

/**
 * The one predicate that decides every marker on the screen (D-3).
 *
 * Used by the field label AND by the collapsed card's roll-up, so the chip and
 * the markers cannot disagree about what is set per call.
 *
 * ── The order is load-bearing ────────────────────────────────────────────
 * 1. **`provider` first** — it is rendered but never marked (AC-6).
 * 2. **Policy-owned temperature next** — a locked or not-applicable
 *    temperature resolves at `default`, but it is code-owned BY POLICY and can
 *    never be configured. A `c` there would be a permanent, uncleanable nag on
 *    two of the 22 calls (R-E). `LOCK_TEMPERATURE_FIXED` /
 *    `LOCK_TEMPERATURE_NOT_APPLICABLE` already say it as TEXT, and C-6 makes
 *    that text the sole carrier of "code-owned by policy" — so this branch is
 *    what makes AC-12 load-bearing rather than cosmetic.
 * 3. `call` → `*`, the one genuinely actionable case: an operator who changes
 *    the AREA value (runbook §3) and expects this to move will be wrong.
 * 4. `default` → `c`, the real migration signal. Zero on today's data.
 */
export function markerFor(call: CallView, field: RenderedField): MarkerKind | null {
  if (field === UNMARKED_RENDERED_FIELD) return null;

  if (
    field === 'temperature' &&
    (call.locks.lockedTemperature !== null || call.locks.temperatureNotApplicable)
  ) {
    return null;
  }

  const level = call.provenance[field as SettingField];
  if (level === 'call') return 'call';
  if (level === 'default') return 'code';
  return null;
}

/**
 * How many CALLS in this area carry at least one visible `*` (FR-6, Q-2).
 *
 * ── Calls, not fields (RC-2) ─────────────────────────────────────────────
 * The chip sits directly beside `N calls`, so counting fields there would put
 * two different counts of two different things side by side.
 *
 * ── Marked fields, not all four (W-2, Q-SA-1 — SA overruled RC-2's literal
 * wording) ───────────────────────────────────────────────────────────────
 * The superseded `overrideCount()` counted `enabled` and `provider` provenance
 * too, neither of which renders a marker any more. That is not theoretical:
 * `bos:llm-settings set <area> --enabled false --include-calls` writes an
 * `enabled` override into EVERY call, after which the old definition would
 * report "8 set per call" on a card showing no `*` at all — a count with no
 * visible referent, on the one page this round exists to quieten.
 *
 * Excluded calls (FR-9) are not in `area.calls`, carry no markers, and cannot
 * be counted here.
 */
export function callsSetPerCall(area: AreaView): number {
  return area.calls.filter((call) =>
    MARKED_FIELDS.some((field) => markerFor(call, field) === 'call')
  ).length;
}
