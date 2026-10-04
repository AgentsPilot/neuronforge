/**
 * The cut-over line (FR-B13, AC-B20). The ledger begins when charging went
 * live, so any window that starts earlier says so and points at where earlier
 * AI activity lives: the audit trail's AI action entries and Cost Analytics,
 * narrowed to the chosen business when there is one.
 *
 * When the whole window is before the cut-over, the tab renders this INSTEAD
 * of the table, so there is no empty "no results" that reads as "nothing ran".
 */

import { Info } from 'lucide-react';

import {
  CUTOVER_ANALYTICS_LINK,
  CUTOVER_AUDIT_DATE_TO,
  CUTOVER_AUDIT_LINK,
  CUTOVER_ENTIRELY_BEFORE,
  CUTOVER_LINE,
} from '../../activityCopy';
import type { ActivityCoverage } from '../../activityTypes';

export function cutoverLinks(accountId: string | null): { audit: string; analytics: string } {
  const audit = new URLSearchParams({ entity_type: 'ai_action', date_to: CUTOVER_AUDIT_DATE_TO });
  const analytics = new URLSearchParams({ scope: 'bos' });
  if (accountId) {
    audit.set('user_id', accountId);
    analytics.set('user', accountId);
  }
  return { audit: `/admin/audit-trail?${audit.toString()}`, analytics: `/admin/analytics?${analytics.toString()}` };
}

export function CutoverNotice({ coverage, accountId }: { coverage: ActivityCoverage; accountId: string | null }) {
  if (coverage === 'after_cutover') return null;
  const links = cutoverLinks(accountId);
  return (
    <div
      data-testid="activity-cutover"
      className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {coverage === 'entirely_before_cutover' && (
          <p className="font-medium" data-testid="activity-cutover-entirely">
            {CUTOVER_ENTIRELY_BEFORE}
          </p>
        )}
        <p>{CUTOVER_LINE}</p>
        <p className="flex flex-wrap gap-3">
          <a href={links.audit} className="underline hover:text-white" data-testid="activity-cutover-audit">
            {CUTOVER_AUDIT_LINK}
          </a>
          <a href={links.analytics} className="underline hover:text-white" data-testid="activity-cutover-analytics">
            {CUTOVER_ANALYTICS_LINK}
          </a>
        </p>
      </div>
    </div>
  );
}
