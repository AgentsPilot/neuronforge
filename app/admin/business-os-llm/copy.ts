/**
 * The screen's own words.
 *
 * Three rules govern what may live here:
 *
 *  1. **Nothing the server already says.** The three ledger readings and the
 *     "corroboration, not proof" caveat come from
 *     `lib/business-os/llm/ledgerCheckCopy.ts` and are rendered verbatim. A
 *     second copy of a sentence is a second chance to soften it. The same rule
 *     is why FR-9's exclusion reason is NOT here: it is authored once, in
 *     `modelSettingsPolicy.ts`, and travels on the wire (FR-14).
 *  2. **Glosses only.** The lock notes below are plain-English readings of
 *     booleans the payload sends (`temperatureNotApplicable`). They explain a
 *     fact; they never decide one. The route is the gate.
 *  3. **Mark the exception, not the norm.** Every string below that describes a
 *     STATE renders only when that state is true — the off chips, the markers,
 *     the lock notes. The one standing sentence is `PAGE_STANDING_NOTE`, which
 *     is about the page itself rather than about any area.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_WORKPLAN.md §3
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §5
 */

/**
 * FR-11. What the page is, after the switch surface left it.
 *
 * The second sentence answers "where did the switch go?" for the one reader
 * who remembers it was there — the alternative is that they conclude the
 * switch itself was removed.
 */
export const PAGE_SUBTITLE =
  'The model and temperature every catalogued Business OS AI call will actually use, and where ' +
  'each value comes from. Provider is shown per area; the on/off switch is changed with the ' +
  'runbook, not here.';

/**
 * The propagation fact, in ONE place (R-D).
 *
 * `PROPAGATION_NOTE` and `PAGE_STANDING_NOTE` both compose this clause rather
 * than each stating it, because they are rendered in different parts of the
 * screen and the panel is currently parked (FR-3). The day slice 3 re-mounts
 * the panel, the two cannot already have drifted.
 *
 * Deliberately NOT exported: a third caller would be a third wording.
 */
const PROPAGATION_CLAUSE = 'Running instances pick a change up within about 60 seconds';

/**
 * FR-20. True on a read-only page too: it is why the ledger check windows
 * from the change time plus a minute rather than from the change itself.
 *
 * The rendered text is UNCHANGED, byte for byte, from the string the panel has
 * always rendered — `LedgerCheckPanel` and its tests are untouched by this
 * round, and the panel keeps this constant while it is parked (FR-3, R-D).
 */
export const PROPAGATION_NOTE =
  PROPAGATION_CLAUSE +
  '. The ledger check only starts counting after that, so a check run sooner has nothing to ' +
  'count yet.';

/**
 * FR-5. What replaced the ~180-word fail-open banner.
 *
 * ── Why a banner became a line ───────────────────────────────────────────
 * All four banner strings were framed around the on/off switch, and FR-17's
 * obligation was "one sentence beside every switch". With no switch on the
 * page that obligation is vacuous, not violated (SA R-A) — but the residual
 * truth is not about the switch at all: a settings-read failure on startup
 * puts provider, model AND temperature back on their code defaults, which is
 * the fact every value on this page depends on. Slice 3 restores the full
 * treatment in the same change that puts a control back on the page (FR-16).
 *
 * ── Ordering is load-bearing (RC-10) ─────────────────────────────────────
 * "These are the stored settings" leads, because it is the single claim the
 * line exists to make, and it is the clause the next copy edit would trim if
 * it were buried behind two clauses of propagation mechanics.
 *
 * Four elements must survive any copy edit — *stored*, *about 60 seconds*,
 * *falls back to … code*, *on startup* — and the line must END with the
 * `(runbook §5)` pointer (R-A condition 2): with the banner gone this is the
 * only route on the page to fleet-level truth, and FR-2's caveat, which also
 * carries it, renders zero times today (measured in production, 2026-09-24).
 */
export const PAGE_STANDING_NOTE =
  'These are the stored settings, not what the fleet is doing. ' +
  PROPAGATION_CLAUSE +
  ', and an instance that cannot read them on startup falls back to the values in code ' +
  '(runbook §5).';

/** FR-7. A missing row is a normal state, not a failure. */
export const NO_STORED_ROW =
  'No stored row — every call in this area is running on its code default.';

/** FR-4. `temperature: null` is "we send none", which is not the same as zero. */
export const TEMPERATURE_NOT_SET = 'not set — the provider default applies';

/**
 * FR-2. The two things this screen may say about an off state, at the two
 * levels it is reachable at.
 *
 * Both keep the reviewed wording of the chip itself — `Configured: off` —
 * because FR-16 forbids the page from asserting that an area IS off, and that
 * wording was reviewed for exactly that. The chip describes the ROW.
 */
export const AREA_OFF_CAVEAT =
  '"Off" is what the row says. An instance that cannot read these settings on startup starts with ' +
  'every area on (runbook §5).';

export const CALL_OFF_TITLE =
  'The stored row switches this call off. That is what the row says, not what the fleet is doing ' +
  '(runbook §5).';

/**
 * FR-6. The two markers, in four parts each: the glyph, the phrase assistive
 * technology hears, the hover, and the legend entry below.
 *
 * ── The glyph is never the carrier ───────────────────────────────────────
 * `Marker.tsx` renders the glyph `aria-hidden` beside an `sr-only` phrase, and
 * the legend states both meanings independently. Colour distinguishes nothing.
 */
export const MARKER_GLYPH = {
  call: '*',
  code: 'c',
} as const;

export const MARKER_SR = {
  call: 'set on this call — the area value does not apply to it',
  code: 'code default — no stored value is in force for this field',
} as const;

/**
 * Hover text says the CONSEQUENCE, never the label — the legend already
 * carries the label, and a hover that repeats it teaches nothing.
 *
 * ── `code` is worded for THREE states, not one (RC-3, RC-5) ──────────────
 * `provenance === 'default'` is reachable in three ways, and only one of them
 * is "nothing is stored":
 *   1. no value configured at any level;
 *   2. a configured value the guardrails REFUSED (`modelSettings.ts:608-636`),
 *      which leaves the provenance at `default` while the row still holds it;
 *   3. a configured temperature DROPPED after resolution because the resolved
 *      model rejects sampling parameters (`:730-739`) — pushed as an `adjusted`
 *      issue, which is not a refusal at all.
 * So the sentence says "not in force" rather than "nothing is stored", and it
 * points at the reason WITHOUT naming a mechanism that is wrong in state 3.
 *
 * ── The hover promises no VALUE, only a provenance (QA BUG-1, SA CR-5) ───
 * An earlier draft said "the call is running on the value written in code",
 * which is false in state 3: the temperature is dropped, so the call sends
 * NONE — while the code default for that field is a number it is not using.
 * The field's own value line says "not set — the provider default applies"
 * there, so the hover was also a second, different answer about one field.
 * It now states only what the marker can actually know — that the value is
 * not coming from the stored row — and leaves the value to the value line.
 *
 * The closing sentence is conditioned on "in force" for the same reason:
 * "a value the guardrails accept … takes precedence" is false in state 3
 * under the narrow reading of "guardrails" (`checkTemperature` DID accept it;
 * `rejectsSamplingParameters` dropped it afterwards). "As soon as it is in
 * force" re-uses the first sentence's noun and promises nothing else.
 */
export const MARKER_TITLE = {
  call:
    'This value is set on the call itself. Changing the area’s value (runbook §3) will not move ' +
    'it — this call has to be changed on its own.',
  code:
    'No stored value is in force for this field, so the value this call uses does not come from ' +
    'the stored row. If the row does set one, the reason it is not in force is shown on this ' +
    'field. A value set in the area row (runbook §3) takes precedence as soon as it is in force.',
} as const;

/**
 * FR-6 / FR-7. One muted line under the `Calls` heading of the EXPANDED card.
 *
 * At the point of use rather than in the page header: a legend far from the
 * marks is read once and then forgotten. Only one card expands at a time, so
 * exactly one legend is ever on screen.
 *
 * ── One noun for one thing (RC-2) ────────────────────────────────────────
 * *stored* in both entries, and nowhere the phrase "not in the database" —
 * pairing a "code" word with a "database" word is what produced the reading
 * this round exists to undo. The `*` entry names the area/call relationship
 * and says nothing about code at all (R-E constraint).
 *
 * ── "in force", not "nothing is stored" (RC-3) ───────────────────────────
 * True in all three of the states listed on `MARKER_TITLE` above, including
 * the two where the row DOES hold a value.
 *
 * The FR-7 clause is appended here, once per screen, rather than on 22 rows.
 */
export const MARKER_LEGEND =
  'No marker: set in the stored settings · ' +
  `${MARKER_GLYPH.call} ${MARKER_SR.call} · ` +
  `${MARKER_GLYPH.code} ${MARKER_SR.code} · ` +
  'Call names are the identifiers in code, and the component value in the usage ledger.';

/** FR-7. What kind of identifier `planner` is — never a prose description of what it does. */
export const CALL_NAME_CAPTION = 'LLM code call name';

/**
 * FR-6 / Q-2. The collapsed card's roll-up of the `*` markers inside it.
 *
 * `N` counts CALLS, not fields, and the hover says so — because `2 set per
 * call` sits directly beside `2 calls`, and without this sentence the two
 * numbers read as the same count.
 */
export function setPerCallTitle(count: number): string {
  return (
    `${count} ${count === 1 ? 'call has' : 'calls have'} a value set on the call itself. ` +
    'One call can have more than one.'
  );
}

/**
 * FR-5. A one-line gloss beside the guardrail's own `reason` string, never
 * instead of it. The reason says what the resolver decided; the gloss says
 * what that means for the value on screen.
 */
export const ISSUE_GLOSS = {
  rejected: 'This value was refused, so the resolver fell back to the level below it.',
  locked: 'This field is owned by the code and cannot be set in the row.',
  unknown: 'The row names something the catalogue does not have. It is ignored.',
  adjusted: 'The value was accepted after being corrected to a legal one.',
} as const;

/**
 * Lock glosses (FR-12), over the payload's booleans.
 *
 * ⚠️ Under FR-6 these two are the ONLY carrier of "this value is code-owned by
 * policy" — the markers deliberately stay away from a permanently locked field,
 * because a `c` there would be the uncleanable nag R-E rejected. C-6 therefore
 * makes these MORE load-bearing than they were, not less: they stay as TEXT,
 * here and in the density slice, never reduced to a tooltip.
 */
export const LOCK_TEMPERATURE_FIXED = 'Temperature is fixed in code for this call.';
export const LOCK_TEMPERATURE_NOT_APPLICABLE =
  'This call sends no temperature at all, so there is nothing to set.';

/**
 * This slice reads; it does not write. Saying so beside the values is the
 * honest thing — an operator who came here to stop a cost runaway needs the
 * command, not a disabled control and a guess.
 *
 * ⚠️ RC-8: this sentence shared a wrapper with the two notices FR-1/FR-5
 * deleted, and nothing asserted it. It survives verbatim, and it now ships
 * with its first render assertion so it cannot leave with the next wrapper.
 */
export const READ_ONLY_NOTE =
  'This screen is read-only for now. To change a value, use npm run bos:llm-settings ' +
  '(runbook §3), or switch an area off with runbook §4.';
