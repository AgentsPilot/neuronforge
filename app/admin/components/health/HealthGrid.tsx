'use client';

/**
 * The Health landing's body (admin reorganisation slice 4): fetches the summary
 * and lays out the tiles.
 *
 * Refresh is manual (an automatic refresh would multiply the load of reads that
 * scan the ledger). It uses `cache: 'no-store'` and never a cache-busting query
 * parameter: the route rejects every parameter (F-9).
 *
 * Admin Layout Standard L-1a pilot: the header, Refresh bar, loading and error
 * states, the read helper and the UTC formatter all come from the shared
 * folder, imported through the alias (§6.1 S-1).
 */

import { useCallback, useEffect, useState } from 'react';

import { clientLogger } from '@/lib/logger/client';
import type { HealthSummary } from '@/lib/admin/health/healthTypes';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { HealthTile } from './HealthTile';

const logger = clientLogger.child({ module: 'AdminHealthGrid' });

const WHAT = 'the health summary';

const PURPOSE =
  'Is anything wrong in Business OS? Red needs action, amber needs a look, and the green label Healthy ' +
  'means checked and clear. Grey means not measured yet, could not check, or for information only.';

/**
 * The "As of" line through the shared formatter (F-58: converted through Date,
 * never sliced). "As of" takes the "HH:mm UTC" tail of the full value, as Jobs
 * does; when the formatter answers with the em dash, the em dash is shown
 * whole (SA W-4), never an empty "As of .".
 */
function asOfLine(summary: HealthSummary): string {
  const end = formatUtc(summary.windows.end);
  const endTime = end === '—' ? end : end.slice(11);
  return (
    `As of ${endTime}. Last 24 h = ${formatUtc(summary.windows.last24hStart)} to ${end}; ` +
    `last 7 days from ${formatUtc(summary.windows.last7dStart)}.`
  );
}

export function HealthGrid() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only the fetch sits inside this try (SA W-5): a rejection here is a
      // network failure; anything else must never be labelled as one.
      let response: Response;
      try {
        response = await fetch('/api/admin/health-summary', { cache: 'no-store' });
      } catch (err) {
        logger.error({ err }, 'Could not reach the health summary route');
        setError(ADMIN_NETWORK_ERROR);
        return;
      }
      const result = await readAdminResponse<HealthSummary>(response, { what: WHAT });
      if (!result.ok) {
        logger.error({ status: result.status }, 'Failed to load the health summary');
        // On failure the previous summary stays on screen.
        setError(result.message);
        return;
      }
      setSummary(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Health" purpose={PURPOSE} asOf={summary ? asOfLine(summary) : null} />

      <AdminFilterBar what={WHAT} busy={loading} onRefresh={() => void load()} />

      {error && <AdminError message={error} testId="health-error" onRetry={() => void load()} />}

      {!summary && loading && <AdminLoading what={WHAT} />}

      {summary && (
        <div aria-busy={loading} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {summary.tiles.map((tile) => (
            <HealthTile key={tile.id} tile={tile} />
          ))}
        </div>
      )}
    </div>
  );
}
