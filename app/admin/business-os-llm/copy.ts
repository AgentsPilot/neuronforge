/**
 * The screen's own words.
 *
 * Two rules govern what may live here:
 *
 *  1. **Nothing the server already says.** The three ledger readings and the
 *     "corroboration, not proof" caveat come from
 *     `lib/business-os/llm/ledgerCheckCopy.ts` and are rendered verbatim. A
 *     second copy of a sentence is a second chance to soften it.
 *  2. **Glosses only.** The lock notes below are plain-English readings of
 *     booleans the payload sends (`switchable`, `temperatureNotApplicable`).
 *     They explain a fact; they never decide one. The route is the gate.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §5
 */

/**
 * FR-17. The one thing an operator must know before they trust this page.
 *
 * It is split in three because it has to survive being skimmed: the headline
 * alone is the whole warning, the body says why, and the last line says what
 * to do instead. Undismissible — see `FailOpenNotice`.
 */
export const FAIL_OPEN_HEADLINE = 'Switching an area off is not a guarantee.';

/*
 * "on startup" is load-bearing (SA F-8). Runbook §5 distinguishes two cases and
 * only one of them re-enables an area: an instance that has read these settings
 * before keeps serving the LAST GOOD values, so a switched-off area stays off
 * there. Compressing both into "a read failure turns it back on" is alarming in
 * the wrong direction, and an operator who later read the runbook would find
 * the screen had overstated it.
 */
export const FAIL_OPEN_BODY =
  'Every instance reads these settings when it starts. One that cannot read them on startup falls ' +
  'back to the code defaults, where every area is ON — so an area you switched off comes back on, ' +
  'on that instance, with no error and nothing on this page to show it. (An instance that had ' +
  'already read them keeps serving the last good values, so it stays off there.) A card that reads ' +
  '"Configured: off" is describing the stored row, not what the fleet is doing.';

/*
 * The evidence claim is SCOPED, not enumerated (SA F-3).
 *
 * An earlier draft said "no new calls for the area is the only evidence" — and
 * that is FALSE for any area the ledger cannot see at all. Chat's data layer
 * calls the provider directly and writes no usage row, so an empty ledger there
 * is vacuously empty and proves nothing. An operator who read that sentence,
 * switched chat off, saw an empty ledger and walked away would have drawn
 * exactly the conclusion this screen exists to prevent.
 *
 * Naming chat here would put a per-area fact in the browser bundle (FR-6) and
 * would rot the day another area stops being catalogued. So the sentence states
 * the condition and sends the reader to the per-area answer, which only the
 * route knows.
 *
 * ── And it has to be true TODAY, not just in principle (QA DEF-S2-3) ─────
 * The previous version sent the operator to "each card's ledger check", which
 * answers the reach question in exactly ONE of its eight states. The state
 * every card is in on load is "Too long ago to check" — the check is bounded to
 * a change made in the last 24 hours and every stored row is older than that.
 * So the copy promised a verification path that shrugs, and the operator was
 * left with nowhere to go.
 *
 * The limit is therefore stated UP FRONT (so a refusal is the expected answer
 * rather than a dead end) and the fallback is named. Both are area-agnostic,
 * so FR-6 holds.
 *
 * ── The fallback is described from the CODE, not from a doc summary (SA R-2)
 * The first version of this fix said the LLM Usage tab "shows the calls per
 * area for any period", summarising runbook §5. It does not, and the runbook
 * never claimed it: `lib/business-os/usage/llmUsageVerification.ts` REQUIRES an
 * `accountId` (`:86-90` — one business, and it refuses the platform account)
 * and bounds `since` to `MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000` (`:61`),
 * REFUSING rather than clamping (`:96-101`). So it is per-business and 7 days,
 * while the switch it is meant to corroborate is fleet-wide and the change may
 * be older.
 *
 * That made the page name an unusable path in the fallback an operator reaches
 * for precisely when the 24-hour check has turned them away — the same defect
 * DEF-S2-3 raised, one layer down. The fleet-wide path is the runbook's own
 * read-only SQL; the tab is offered for what it actually is.
 */
export const FAIL_OPEN_ACTION =
  'Confirm at the ledger rather than at this switch: where the ledger can see the area, no new calls ' +
  'is the only evidence you will get. Expect to be turned away often — the check on each card only ' +
  'covers a change made in the last 24 hours, and it cannot see every area. When it cannot answer, ' +
  'use runbook §5 (docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md): the three log lines to ' +
  'search for, and its read-only SQL over token_usage, which is the only fleet-wide view of calls ' +
  'per area. (The LLM Usage tab on /test-business-os is quicker but narrower — one business at a ' +
  'time, and the last 7 days only.)';

/** The short form beside the switch state. Same claim, same scope, same day-one truth. */
export const FAIL_OPEN_INLINE =
  '"Off" is the stored configuration, not a guarantee — an instance that cannot read these settings ' +
  'on startup starts with every area on. The ledger check below can corroborate a switch-off only ' +
  'for a change made in the last 24 hours, and only where the ledger sees this area at all; when it ' +
  'cannot answer, use runbook §5 — its three log lines and its read-only token_usage query.';

/**
 * The area that can never be switched off gets its own line instead of the
 * notice above (QA DEF-S2-4).
 *
 * Rendering "a switch-off is not a guarantee" one line above "this area can
 * never be switched off" is a flat contradiction, and it was the most prominent
 * text on the single card where the switch warning cannot apply. The fail-open
 * behaviour still matters here, but about a different field: with no stored row
 * to read, this area's calls fall back to their code-default model — which, for
 * an area whose only cost lever IS the model, is the thing worth knowing.
 */
export const LOCK_AREA_FAIL_OPEN =
  'There is no switch to fail open here. A settings-read failure on startup does still put this ' +
  'area’s calls back on their code-default provider and model, which for this area is the only ' +
  'lever there is — so a model change is subject to the same 60-second propagation and the same ' +
  'silent fallback (runbook §5).';

/** FR-7. A missing row is a normal state, not a failure. */
export const NO_STORED_ROW =
  'No stored row — every call in this area is running on its code default.';

/** FR-4. `temperature: null` is "we send none", which is not the same as zero. */
export const TEMPERATURE_NOT_SET = 'not set — the provider default applies';

/** Provenance badge labels (FR-4). */
export const PROVENANCE_LABEL = {
  call: 'call override',
  area: 'area',
  default: 'code default',
} as const;

export const PROVENANCE_TITLE = {
  call: 'Set on this call, in the stored row',
  area: 'Set once for the whole area, in the stored row',
  default: 'Not configured anywhere — this is the value in code',
} as const;

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

/** Lock glosses (FR-12), over the payload's booleans. */
export const LOCK_AREA_NOT_SWITCHABLE =
  'This area can never be switched off — the code refuses it at every level.';
export const LOCK_CALL_NOT_SWITCHABLE =
  'This call cannot be switched off on its own.';
export const LOCK_TEMPERATURE_FIXED = 'Temperature is fixed in code for this call.';
export const LOCK_TEMPERATURE_NOT_APPLICABLE =
  'This call sends no temperature at all, so there is nothing to set.';

/**
 * FR-20. True on a read-only page too: it is why the ledger check windows
 * from the change time plus a minute rather than from the change itself.
 */
export const PROPAGATION_NOTE =
  'Running instances pick a change up within about 60 seconds. The ledger check only starts ' +
  'counting after that, so a check run sooner has nothing to count yet.';

/**
 * This slice reads; it does not write. Saying so beside the values is the
 * honest thing — an operator who came here to stop a cost runaway needs the
 * command, not a disabled control and a guess.
 */
export const READ_ONLY_NOTE =
  'This screen is read-only for now. To change a value, use npm run bos:llm-settings ' +
  '(runbook §3), or switch an area off with runbook §4.';
