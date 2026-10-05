/**
 * The count line (FR-B10). The count is the FILTERED one, from the same query
 * as the rows. When it could not be read, no number is shown: no count beats
 * a wrong one. A capped list names its order, because "the top 100" means
 * nothing without it.
 */

import { formatCount } from '../../costFormat';
import { COUNT_LINE, COUNT_LINE_CAPPED, COUNT_LINE_UNKNOWN_CAPPED } from '../../activityCopy';
import type { ActivityPayload } from '../../activityTypes';

export function ActivityCountLine({ payload }: { payload: ActivityPayload }) {
  const shown = payload.rows.length;
  let text: string | null;
  if (payload.total === null) {
    text = payload.capped ? COUNT_LINE_UNKNOWN_CAPPED(formatCount(shown), payload.sort) : null;
  } else if (payload.capped) {
    text = COUNT_LINE_CAPPED(formatCount(shown), formatCount(payload.total), payload.sort);
  } else {
    text = COUNT_LINE(formatCount(payload.total));
  }
  if (text === null) return null;
  return (
    <p className="text-xs text-slate-400" data-testid="activity-count">
      {text}
    </p>
  );
}
