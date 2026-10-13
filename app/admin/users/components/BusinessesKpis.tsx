/**
 * The Businesses KPI strip (Admin Layout Standard §5.4, §7.7; L-4a).
 *
 * Three neutral tiles from the `stats` the list route already returns; no new
 * read and no new arithmetic. The labels keep the existing words (`countLabels`,
 * SA C-15 (a); L-4a SA Q-10): `stats.totalUsers` is the FILTERED count, so it
 * says "shown" unless the status is "all".
 *
 *   1. The shown count: a same-page filter tile to "All users".
 *   2. Active users (last 30 days): a same-page filter tile to "Active", the
 *      default, so it carries the ring on load.
 *   3. New today: no target (there is no working "joined" filter; F-2).
 *
 * Under the default Active filter tiles 1 and 2 show the same number (F-26,
 * kept by D-11 (a)).
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import { countLabels, type StatusFilter } from '../userName';

export interface BusinessesStats {
  totalUsers: number;
  activeUsers: number;
  newUsersToday: number;
}

export interface BusinessesKpisProps {
  stats: BusinessesStats | null;
  status: StatusFilter;
  /** The first read is in flight (or the last one failed): placeholders, no tiles (K-10). */
  firstLoad: boolean;
  /** A status tile's real link and its in-place apply (the page builds both from `useAdminFilters`). */
  statusTile: (status: StatusFilter) => { href: string; apply: () => void };
}

export function BusinessesKpis({ stats, status, firstLoad, statusTile }: BusinessesKpisProps) {
  if (firstLoad || !stats) return <KpiStrip loading placeholderCount={3} />;
  return (
    <KpiStrip>
      <KpiTile
        testId="kpi-shown"
        label={countLabels(status).card}
        value={formatCount(stats.totalUsers)}
        filter={{ ...statusTile('all'), current: status === 'all' }}
      />
      <KpiTile
        testId="kpi-active"
        label="Active users"
        value={formatCount(stats.activeUsers)}
        sub="Last 30 days"
        filter={{ ...statusTile('active'), current: status === 'active' }}
      />
      <KpiTile testId="kpi-new-today" label="New today" value={formatCount(stats.newUsersToday)} />
    </KpiStrip>
  );
}
