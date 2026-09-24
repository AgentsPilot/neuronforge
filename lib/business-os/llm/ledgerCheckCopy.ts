/**
 * The ledger check's vocabulary and its standing caveat.
 *
 * Deliberately a plain module: no `server-only`, no catalog import, no
 * repository. Both the admin route and the client panel import it, which is
 * the point — the caveat sentence must be ONE string. Duplicating it would
 * let a future copy edit soften the panel's wording while the API kept saying
 * something else, and the whole purpose of this panel is that it does not
 * overclaim.
 *
 * @module lib/business-os/llm/ledgerCheckCopy
 */

/**
 * Which of the three readings applies, decided server-side.
 *
 *  - `still_arriving`      — calls completed after the change; the switch is
 *                            not holding on every instance.
 *  - `stopped_with_before` — none since, and there WAS traffic before. The
 *                            only reading that corroborates a switch-off.
 *  - `no_traffic_either`   — none since, and none before either. Proves
 *                            nothing, and says so.
 *  - `ledger_cannot_answer`— chat: the ledger cannot see this area's spend.
 *  - `too_soon`            — the observation window has not opened yet.
 *
 * `too_soon` is a first-class reading, not an edge case. A change made less
 * than `BOS_LLM_SETTINGS_CACHE_MS` ago has not reached every instance, so
 * there is nothing to count: rendering `no_traffic_either` would be a false
 * negative, and rendering nothing would look broken. It lives HERE with the
 * others because the panel switches on this union — a kind whose sentence is
 * written inline at the route is a kind the panel has no branch for.
 */
export type LedgerReadingKind =
  | 'still_arriving'
  | 'stopped_with_before'
  | 'no_traffic_either'
  | 'ledger_cannot_answer'
  | 'too_soon';

/**
 * Why this check can only ever corroborate.
 *
 * Two independent reasons, both true: `token_usage` is written AFTER the
 * provider call resolves (so a call in flight at switch time lands in the
 * ledger after it — which the window's 60-second offset handles), and the
 * insert failure path is logged and swallowed (which nothing can handle, so
 * an under-count is silent).
 */
export const LEDGER_CHECK_CAVEAT =
  'This is corroboration, not proof. A ledger write can fail silently, so an ' +
  'under-count is invisible — and nothing here can tell you an area is off, ' +
  'only what the ledger recorded.';

/** The sentence for each reading. The panel renders these; the route picks one. */
export const LEDGER_READING_TEXT: Record<LedgerReadingKind, string> = {
  still_arriving: 'Calls are still arriving — the switch is not holding on every instance.',
  stopped_with_before:
    'No calls completed since the change, and this area was making calls before it.',
  no_traffic_either:
    'This area had no traffic before the change either — the ledger cannot tell you whether the switch is holding.',
  ledger_cannot_answer:
    'The ledger cannot answer for chat: the chat data layer calls the provider directly and writes no usage row. ' +
    'Check the chat entry gate and the server log line "Business OS LLM settings changed" instead.',
  too_soon:
    'Running instances can take about 60 seconds to pick the change up, so there is nothing to count yet. ' +
    'The ledger check starts counting after that.',
};

/**
 * Readings that carry counts. The other two answer without reading the ledger
 * at all — chat because it cannot, `too_soon` because there is nothing there
 * yet — and both return `after: null, before: null`.
 */
export const LEDGER_READINGS_WITH_COUNTS: readonly LedgerReadingKind[] = [
  'still_arriving',
  'stopped_with_before',
  'no_traffic_either',
];
