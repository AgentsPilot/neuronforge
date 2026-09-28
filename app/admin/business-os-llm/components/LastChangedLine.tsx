/**
 * FR-14 — "last changed by X at Y", in exactly one of THREE states.
 *
 * One component, rendered both on the collapsed card and in the stored-row
 * panel, so the two can never drift apart.
 *
 * ── Why three states and not two ─────────────────────────────────────────
 *   no_row        no line at all. There is nothing to attribute; the card
 *                 already says the area runs on code defaults (FR-7).
 *   not_recorded  a row exists, nobody is recorded against it. This is what
 *                 EVERY area renders today: all eight seeded rows carry
 *                 `updated_by = null`. It is correct, not a bug.
 *   admin /       an id we matched to an active admin, or one we did not —
 *   unresolved    shown raw and labelled, never "unknown" and never blank,
 *                 both of which read as "nobody" when somebody did do it.
 *
 * ── What the `not_recorded` copy must NOT say ────────────────────────────
 * An earlier draft sent the reader to the audit trail. The seeded rows predate
 * the audit helpers, so the trail holds nothing for them, and pointing at an
 * empty drawer is worse than saying nothing (SA comment 14 / S2-T7b). It also
 * must not claim the change came from the command line: once slice 3's
 * unattributed-save fallback exists, a screen save can land in this state too.
 *
 * ── `at` can be null ─────────────────────────────────────────────────────
 * `updated_at` is TYPED `string`, but that type is hand-written rather than
 * generated from the schema, so this renderer does not rely on it (QA DEF-6 /
 * F-10 — the repo cannot establish what the column really permits, and every
 * seeded row does carry a timestamp, so the sub-state is defensive). Every
 * branch goes through `formatInstant`, which returns `null` rather than the
 * epoch: `new Date(null)` is 1970, a wrong answer that looks like a right one.
 */

import { formatInstant } from '../format';
import type { LastChangedBy } from '../types';

interface Props {
  lastChangedBy: LastChangedBy;
}

export function LastChangedLine({ lastChangedBy }: Props) {
  if (lastChangedBy.kind === 'no_row') return null;

  const at = formatInstant(lastChangedBy.at);
  const when = at ? `at ${at}` : '(time not recorded)';

  if (lastChangedBy.kind === 'admin') {
    return (
      <p data-testid="last-changed" className="text-xs text-slate-400">
        Last changed by <span className="text-slate-200">{lastChangedBy.email}</span> {when}
      </p>
    );
  }

  if (lastChangedBy.kind === 'unresolved') {
    return (
      <p data-testid="last-changed" className="text-xs text-slate-400">
        Last changed {when} by{' '}
        <span className="font-mono text-slate-200">{lastChangedBy.userId}</span>{' '}
        <span className="text-amber-300/90">
          — that id matches no active admin account, so it is shown as stored
        </span>
      </p>
    );
  }

  return (
    <p data-testid="last-changed" className="text-xs text-slate-400">
      Last changed {when} — <span className="text-slate-200">actor not recorded</span>. A change
      made before this screen existed, or from the command line, carries no name.
    </p>
  );
}
