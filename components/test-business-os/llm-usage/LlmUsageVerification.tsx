'use client';

/**
 * LLM Usage tab on /test-business-os (Layer 1.1 FR-7 to FR-11).
 *
 * An admin picks a business and a start time and sees whether that business's
 * Business OS AI calls were recorded with the right account, area, call names
 * and grouping ids. Read-only.
 *
 * Client/server boundary (RC-8): imports only TYPES from server modules. Every
 * label, status and flag is computed on the server and arrives as data.
 *
 * Admin gate: the server decides. The first business-list request doubles as
 * the probe — a 403 shows "Admins only" and nothing else.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope, BusinessListResponse } from '@/lib/business-os/usage/llmUsageReportTypes';
import { useLlmUsageAutoRefresh, type DebugLogType } from '@/hooks/useLlmUsageAutoRefresh';
import { BusinessPicker } from './BusinessPicker';
import { CheckPanels } from './CheckPanels';
import { StatusSummary } from './StatusSummary';
import { WindowControls } from './WindowControls';

export const LLM_USAGE_BUSINESSES_PATH = '/api/admin/business-os/llm-usage/businesses';

const ONE_HOUR_MS = 60 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 300;

type Access = 'checking' | 'admin' | 'forbidden' | 'unauthenticated' | 'error';

export interface LlmUsageVerificationProps {
  sessionUserId: string | null;
  authLoading: boolean;
  onLog?: (type: DebugLogType, message: string) => void;
  onResponse?: (payload: unknown) => void;
}

export function LlmUsageVerification({ sessionUserId, authLoading, onLog, onResponse }: LlmUsageVerificationProps) {
  const [access, setAccess] = useState<Access>('checking');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<BusinessListResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [initialStartIso] = useState(() => new Date(Date.now() - ONE_HOUR_MS).toISOString());

  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  const { state, selectAccount, setStart, refresh, setAutoRefresh, setIntervalSec } = useLlmUsageAutoRefresh({
    initialStartIso,
    onLog,
    onResponse,
  });

  const loadBusinesses = useCallback(async (term: string, signal: AbortSignal) => {
    setListLoading(true);
    try {
      const qs = term ? `?${new URLSearchParams({ search: term }).toString()}` : '';
      const response = await fetch(`${LLM_USAGE_BUSINESSES_PATH}${qs}`, {
        method: 'GET',
        headers: { 'x-correlation-id': crypto.randomUUID() },
        signal,
      });
      let body: ApiEnvelope<BusinessListResponse> | null = null;
      try {
        body = (await response.json()) as ApiEnvelope<BusinessListResponse>;
      } catch {
        body = null;
      }
      if (signal.aborted) return;

      if (response.status === 403) {
        setAccess('forbidden');
        onLogRef.current?.('error', 'LLM usage: admins only (403)');
        return;
      }
      if (response.status === 401) {
        setAccess('unauthenticated');
        return;
      }
      if (response.ok && body?.success) {
        setAccess('admin');
        setList(body.data);
        setListError(null);
        return;
      }
      const message = body && !body.success ? body.error : `HTTP ${response.status}`;
      setListError(`Could not load businesses: ${message}`);
      setAccess((prev) => (prev === 'checking' ? 'error' : prev));
      onLogRef.current?.('error', `LLM usage business list → ${message}`);
    } catch (err) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setListError(`Could not load businesses: ${message}`);
      setAccess((prev) => (prev === 'checking' ? 'error' : prev));
      onLogRef.current?.('error', `LLM usage business list failed: ${message}`);
    } finally {
      if (!signal.aborted) setListLoading(false);
    }
  }, []);

  // Initial probe + debounced search (once signed in).
  useEffect(() => {
    if (authLoading || !sessionUserId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void loadBusinesses(search.trim(), controller.signal), search ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [authLoading, sessionUserId, search, loadBusinesses]);

  if (authLoading) {
    return <div style={{ color: '#666' }}>Loading session…</div>;
  }

  if (!sessionUserId || access === 'unauthenticated' || state.phase === 'unauthenticated') {
    return (
      <div style={{ color: '#dc3545' }}>
        Not signed in. Log in to the app first — Business OS APIs require an authenticated session.
      </div>
    );
  }

  if (access === 'forbidden' || state.phase === 'forbidden') {
    return (
      <div role="alert" data-testid="llm-usage-admins-only" style={{ color: '#721c24', fontWeight: 'bold' }}>
        Admins only. This tab reads another business&apos;s usage and requires platform admin rights.
      </div>
    );
  }

  if (access === 'checking') {
    return <div style={{ color: '#666' }}>Checking access…</div>;
  }

  if (access === 'error') {
    return (
      <div role="alert" style={{ color: '#721c24' }}>
        {listError ?? 'Could not load the LLM Usage tab.'}
      </div>
    );
  }

  const platformIds = list?.platformAccountIds ?? [];
  const selectedIsPlatform =
    !!state.accountId && platformIds.some((id) => id.toLowerCase() === state.accountId?.toLowerCase());
  const loading = state.phase === 'loading';

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <p data-testid="llm-usage-exception-note" style={{ fontSize: '13px', color: '#555', margin: 0 }}>
        <strong>Admin-only, read-only.</strong> Unlike the rest of this page (which acts as your session user), this tab
        reads the usage ledger of the business you select. That exception is allowed because it only reads call metadata
        (no prompts, payloads or emails) and the server checks admin rights on every request.
      </p>

      {list?.platformAccountEnvIgnored && (
        <div role="alert" style={{ color: '#856404', background: '#fff3cd', padding: '6px 10px', fontSize: '13px' }}>
          SYSTEM_ADMIN_USER_ID is set but is not a UUID; only the all-zero id was checked
        </div>
      )}

      <BusinessPicker
        sessionUserId={sessionUserId}
        businesses={list?.businesses ?? []}
        listLimit={list?.limit ?? 50}
        loading={listLoading}
        listError={listError}
        search={search}
        onSearchChange={setSearch}
        selectedAccountId={state.accountId}
        onSelect={selectAccount}
        platformAccountIds={platformIds}
      />

      <WindowControls
        startIso={state.startIso}
        onStartChange={setStart}
        onStartNow={() => setStart(new Date().toISOString())}
        onRefresh={refresh}
        refreshDisabled={!state.accountId || loading || selectedIsPlatform}
        hasAccount={!!state.accountId && !selectedIsPlatform}
        loading={loading}
        autoStatus={state.auto.status}
        intervalSec={state.auto.intervalSec}
        onToggleAuto={setAutoRefresh}
        onIntervalChange={setIntervalSec}
      />

      {state.phase === 'error' && state.error && (
        <div role="alert" data-testid="llm-usage-error" style={{ color: '#721c24', background: '#f8d7da', padding: '6px 10px' }}>
          {state.error}
        </div>
      )}

      <StatusSummary accountId={state.accountId} companyName={state.companyName} report={state.report} />

      {state.report && <CheckPanels report={state.report} />}
    </div>
  );
}
