'use client';

/**
 * Environment: how this deployment is configured. Read-only.
 *
 * Admin environment view EC-2 (requirement FR-9 to FR-16; workplan §2; SA
 * rulings OQ-1, OQ-10, SA-C11, SA-C14, Q2-1 to Q2-4, E2-1 to E2-4).
 *
 * The only request is `GET /api/admin/environment`, with no query string (the
 * route refuses any parameter) and `cache: 'no-store'`. Masking happened on the
 * server: the page renders the closed display shapes it is given and never
 * holds a raw value.
 *
 * Admin Layout Standard, as Admin users (L-12) does it: the shared header with
 * the Read-only badge, Refresh in the Refresh-only bar with "Read at", the
 * shared loading and error states (Try again), the body read through
 * `readAdminResponse`, the standard card shell, an always-mounted `aria-busy`
 * area. A failed read clears everything, "Read at" included (FR-16), so no
 * configuration stays on screen looking current.
 *
 * Server-guarded by `app/admin/layout.tsx` (`requireAdminPage`), like every
 * `/admin` page.
 *
 * EC-4 (workplan §4.4; FR-17 to FR-21): the KPI strip under the header, and a
 * filter bar with a page-held name search and a `group` filter in the page URL.
 * Neither filter ever reaches the API request (SA-C9, SA E4-4).
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminFilterBar, ADMIN_FIELD_CONTROL, ADMIN_FIELD_LABEL } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, adminReadFallback, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import type { EnvironmentViewPayload } from '@/lib/admin/environment-types';
import { clientLogger } from '@/lib/logger/client';

import { EnvironmentKpis } from './components/EnvironmentKpis';
import { EnvironmentView } from './components/EnvironmentView';
import { GROUP_FILTER_IDS, isEnvironmentViewPayload, visibleView } from './environmentDisplay';
import { ENVIRONMENT_FILTER_SPEC } from './environmentFilters';

const logger = clientLogger.child({ module: 'AdminEnvironmentPage' });

const ENVIRONMENT_URL = '/api/admin/environment';

/** Noun phrase for the shared states and the Refresh name. */
const WHAT = 'the environment settings';

/** A 2xx `success: true` whose payload is not the expected shape: the shared fallback words. */
const UNUSABLE = adminReadFallback(WHAT);

type Status = 'loading' | 'ready' | 'error';

export default function AdminEnvironmentPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<EnvironmentViewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  // Only the latest request may set state, so a slow earlier response cannot overwrite a newer one.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setStatus('loading');

    const fail = (message: string) => {
      setData(null);
      setReadAt(null);
      setError(message);
      setStatus('error');
    };

    let response: Response;
    try {
      response = await fetch(ENVIRONMENT_URL, { method: 'GET', cache: 'no-store' });
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      logger.warn({ err }, 'Environment request failed');
      fail(ADMIN_NETWORK_ERROR);
      return;
    }

    // Never throws: an unreadable body becomes the fixed fallback.
    const result = await readAdminResponse<EnvironmentViewPayload>(response, { what: WHAT, sessionEndedCopy: true });
    if (requestId !== latestRequest.current) return;

    if (result.ok && isEnvironmentViewPayload(result.data)) {
      setData(result.data);
      setReadAt(new Date().toISOString());
      setError(null);
      setStatus('ready');
      return;
    }

    // The HTTP status only: never the body.
    logger.warn({ status: response.status }, 'Environment request failed');
    fail(result.ok ? UNUSABLE : result.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // FR-21: `group` in the URL, `search` held by the page (never written). Neither reaches the fetch above.
  const { filters, setFilters, clear, isDefault } = useAdminFilters(ENVIRONMENT_FILTER_SPEC);
  const searchId = useId();
  const groupId = useId();

  const shown = data && status !== 'error' ? data : null;
  const view = useMemo(() => (shown ? visibleView(shown, filters) : null), [shown, filters]);

  // Group labels come from the payload; before the first read, the ids stand in so a linked
  // `?group=` value is still a selectable option.
  const groupOptions = shown
    ? shown.groups.map((g) => ({ id: g.id as string, label: g.label }))
    : GROUP_FILTER_IDS.filter((id) => id !== 'uncategorised').map((id) => ({ id: id as string, label: id }));

  const isLoading = status === 'loading';

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Environment"
        purpose="How this deployment is configured: every setting the app reads, with secrets shown only as Set or Not set."
        badge={{ label: 'Read-only', testId: 'read-only-badge' }}
      />

      <EnvironmentKpis data={shown} loading={isLoading} view={view} />

      <AdminFilterBar
        onRefresh={() => void load()}
        busy={isLoading}
        what={WHAT}
        readAt={readAt}
        onClear={clear}
        canClear={!isDefault}
      >
        <div className="w-full sm:w-64">
          <label htmlFor={searchId} className={ADMIN_FIELD_LABEL}>
            Name
          </label>
          <input
            id={searchId}
            type="search"
            placeholder="Search by variable name"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            className={`${ADMIN_FIELD_CONTROL} w-full`}
          />
        </div>
        <div>
          <label htmlFor={groupId} className={ADMIN_FIELD_LABEL}>
            Group
          </label>
          <select
            id={groupId}
            value={filters.group}
            onChange={(e) => setFilters({ group: e.target.value })}
            className={ADMIN_FIELD_CONTROL}
          >
            <option value="">All groups</option>
            {groupOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value="uncategorised">Uncategorised</option>
          </select>
        </div>
      </AdminFilterBar>

      {/* Always mounted, so a refresh keeps the tables on screen while it reads. */}
      <div data-testid="environment-content" aria-busy={isLoading} className="space-y-6">
        {status === 'error' && error && (
          <AdminError message={error} testId="environment-error" onRetry={() => void load()} />
        )}

        {status === 'loading' && !data && <AdminLoading what={WHAT} />}

        {shown && view && (
          <EnvironmentView data={shown} view={view} searching={filters.search.trim() !== ''} onClear={clear} />
        )}
      </div>
    </div>
  );
}
