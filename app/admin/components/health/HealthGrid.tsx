'use client';

/**
 * The Health landing's body (admin reorganisation slice 4): fetches the summary
 * and lays out the tiles.
 *
 * Refresh is manual (an automatic refresh would multiply the load of reads that
 * scan the ledger). It uses `cache: 'no-store'` and never a cache-busting query
 * parameter: the route rejects every parameter (F-9).
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { createLogger } from '@/lib/logger';
import type { HealthSummary } from '@/lib/admin/health/healthTypes';
import { HealthTile } from './HealthTile';

const logger = createLogger({ module: 'AdminHealthGrid' });

/** "HH:mm UTC" of an ISO timestamp. The page states UTC, as the windows are UTC. */
function utcTime(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}

function utcDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function HealthGrid() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/health-summary', { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as
        | { success: true; data: HealthSummary }
        | { success: false; error?: string }
        | null;
      if (!response.ok || !body || !body.success) {
        throw new Error((body && !body.success && body.error) || 'The health summary could not be loaded');
      }
      setSummary(body.data);
    } catch (err) {
      logger.error({ err }, 'Failed to load the health summary');
      setError(err instanceof Error ? err.message : 'The health summary could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Health</h1>
          <p className="text-sm text-slate-400 mt-1">
            Is anything wrong in Business OS? Red needs action, amber needs a look, grey is normal or not measured.
            Nothing here is ever green.
          </p>
          {summary && (
            <p data-testid="as-of" className="text-xs text-slate-500 mt-1">
              As of {utcTime(summary.windows.end)}. Last 24 h = {utcDateTime(summary.windows.last24hStart)} to{' '}
              {utcDateTime(summary.windows.end)} UTC; last 7 days from {utcDateTime(summary.windows.last7dStart)} UTC.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-busy={loading}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 text-slate-200 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </header>

      {error && (
        <p role="alert" data-testid="health-error" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {!summary && loading && <p className="text-sm text-slate-400">Loading…</p>}

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {summary.tiles.map((tile) => (
            <HealthTile key={tile.id} tile={tile} />
          ))}
        </div>
      )}
    </div>
  );
}
