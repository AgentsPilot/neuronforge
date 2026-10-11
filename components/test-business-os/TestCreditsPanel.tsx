'use client';

/**
 * "Test credits" tab on /test-business-os (TEST ONLY, slice TC-1; remove with
 * POST /api/admin/business-os/test/take-credits).
 *
 * An admin picks any Business OS account (the LLM Usage `BusinessPicker`,
 * reused) and takes N PLAN credits from it, to test low, zero and over-plan
 * states. The account's position is read before and after through the
 * existing read-only GET /api/admin/business-os/credits/accounts/[accountId].
 *
 * The server decides everything: the business list doubles as the admin probe
 * (403 → "Admins only"), and an empty POST doubles as the switch probe (the
 * route answers 404 `not_enabled` before reading the body, and 400 otherwise:
 * nothing is ever written by it). Imports only TYPES from server modules.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ApiEnvelope, BusinessListResponse } from '@/lib/business-os/usage/llmUsageReportTypes';
import type { AdminCreditPosition } from '@/lib/business-os/credits/adminCreditPositionTypes';
import { BusinessPicker } from './llm-usage/BusinessPicker';
import { LLM_USAGE_BUSINESSES_PATH } from './llm-usage/LlmUsageVerification';

export const TAKE_CREDITS_PATH = '/api/admin/business-os/test/take-credits';
const POSITION_PATH = '/api/admin/business-os/credits/accounts';
const SEARCH_DEBOUNCE_MS = 300;

type DebugLogType = 'info' | 'error' | 'success';
type Access = 'checking' | 'admin' | 'forbidden' | 'unauthenticated' | 'error';
type Switch = 'checking' | 'on' | 'off';

export interface TestCreditsPanelProps {
  sessionUserId: string | null;
  authLoading: boolean;
  onLog?: (type: DebugLogType, message: string) => void;
  onResponse?: (payload: unknown) => void;
}

/** One refusal code → one plain sentence. */
const REFUSALS: Record<string, string> = {
  not_enabled: 'Not enabled on this deployment.',
  not_a_tenant: 'That account is not a Business OS account.',
  own_account: 'You cannot take credits from your own account. Use a separate test account.',
  platform_account: 'That is the platform account. Choose a business account.',
  invalid_input: 'Check the amount (a whole number) and the reason.',
};

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString());

function PositionView({ label, position }: { label: string; position: AdminCreditPosition | null }) {
  if (!position) return null;
  const { usage, extra } = position;
  return (
    <div style={{ fontSize: '13px', fontFamily: 'monospace' }} data-testid={`test-credits-position-${label.toLowerCase()}`}>
      <strong>{label}:</strong>{' '}
      {usage.status === 'ok' ? (
        <>
          allowance {usage.allowance ? fmt(usage.allowance.amount) : 'none'} · used {fmt(usage.used)} · plan left{' '}
          {fmt(usage.planLeft)}
          {usage.overPlan !== null && usage.overPlan > 0 ? ` · over plan ${fmt(usage.overPlan)}` : ''}
        </>
      ) : (
        'plan figures unavailable'
      )}{' '}
      · extra credits {extra.status === 'ok' ? fmt(extra.extraCredits) : 'unavailable'}
    </div>
  );
}

export function TestCreditsPanel({ sessionUserId, authLoading, onLog, onResponse }: TestCreditsPanelProps) {
  const [access, setAccess] = useState<Access>('checking');
  const [switchState, setSwitchState] = useState<Switch>('checking');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<BusinessListResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState('50');
  const [reason, setReason] = useState('');
  // Minted once per opening of the form (a new pick or a recorded take), so a double click records once.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [before, setBefore] = useState<AdminCreditPosition | null>(null);
  const [after, setAfter] = useState<AdminCreditPosition | null>(null);

  const loadBusinesses = useCallback(async (term: string, signal: AbortSignal) => {
    setListLoading(true);
    try {
      const qs = term ? `?${new URLSearchParams({ search: term }).toString()}` : '';
      const response = await fetch(`${LLM_USAGE_BUSINESSES_PATH}${qs}`, { signal });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<BusinessListResponse> | null;
      if (signal.aborted) return;
      if (response.status === 403) return setAccess('forbidden');
      if (response.status === 401) return setAccess('unauthenticated');
      if (response.ok && body?.success) {
        setAccess('admin');
        setList(body.data);
        setListError(null);
        return;
      }
      setListError(`Could not load businesses: ${body && !body.success ? body.error : `HTTP ${response.status}`}`);
      setAccess((prev) => (prev === 'checking' ? 'error' : prev));
    } catch (err) {
      if (signal.aborted) return;
      setListError(`Could not load businesses: ${err instanceof Error ? err.message : String(err)}`);
      setAccess((prev) => (prev === 'checking' ? 'error' : prev));
    } finally {
      if (!signal.aborted) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !sessionUserId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void loadBusinesses(search.trim(), controller.signal), search ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [authLoading, sessionUserId, search, loadBusinesses]);

  // The switch probe: an empty body is refused 400 when on, 404 `not_enabled` when off.
  useEffect(() => {
    if (access !== 'admin' || switchState !== 'checking') return;
    void (async () => {
      try {
        const response = await fetch(TAKE_CREDITS_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
          body: '{}',
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setSwitchState(response.status === 404 && body?.error === 'not_enabled' ? 'off' : 'on');
      } catch {
        setSwitchState('on');
      }
    })();
  }, [access, switchState]);

  const readPosition = useCallback(async (id: string): Promise<AdminCreditPosition | null> => {
    try {
      const response = await fetch(`${POSITION_PATH}/${encodeURIComponent(id)}`, {
        headers: { 'x-correlation-id': crypto.randomUUID() },
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<AdminCreditPosition> | null;
      if (response.ok && body?.success) return body.data;
      onLog?.('error', `Credit position → ${body && !body.success ? body.error : `HTTP ${response.status}`}`);
      return null;
    } catch (err) {
      onLog?.('error', `Credit position failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }, [onLog]);

  const select = (id: string) => {
    setAccountId(id);
    setConfirming(false);
    setMessage(null);
    setAfter(null);
    setRequestId(crypto.randomUUID());
    setBefore(null);
    void readPosition(id).then(setBefore);
  };

  // The bounds come from the server (the position read's `limits`), never a copy;
  // the route checks them again. Until the read answers, the server decides alone.
  const limits = before?.limits ?? null;
  const parsedAmount = Number(amount);
  const amountOk =
    Number.isInteger(parsedAmount) && parsedAmount > 0 && (limits === null || parsedAmount <= limits.grantCeiling);
  const trimmedReason = reason.trim().length;
  const reasonOk = trimmedReason > 0 && (limits === null || (trimmedReason >= limits.reasonMin && trimmedReason <= limits.reasonMax));
  const companyName = list?.businesses.find((b) => b.userId === accountId)?.companyName ?? null;

  const take = async () => {
    if (!accountId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(TAKE_CREDITS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
        body: JSON.stringify({ accountId, amount: parsedAmount, reason: reason.trim(), requestId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { success: true; data: { recorded: boolean; credits: number | null } }
        | { success: false; error: string }
        | null;
      onResponse?.(body);
      if (response.ok && body?.success) {
        const text = body.data.recorded
          ? `Took ${fmt(body.data.credits)} credits.`
          : 'Already recorded: this request was sent before. Nothing new was taken.';
        setMessage({ tone: 'ok', text });
        onLog?.('success', `Test credits → ${text}`);
        setRequestId(crypto.randomUUID());
        setAfter(await readPosition(accountId));
      } else {
        const code = body && !body.success ? body.error : `HTTP ${response.status}`;
        if (code === 'not_enabled') setSwitchState('off');
        setMessage({ tone: 'error', text: REFUSALS[code] ?? `Refused: ${code}` });
        onLog?.('error', `Test credits → ${response.status} ${code}`);
      }
    } catch (err) {
      setMessage({ tone: 'error', text: `Request failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (authLoading) return <div style={{ color: '#666' }}>Loading session…</div>;
  if (!sessionUserId || access === 'unauthenticated') {
    return <div style={{ color: '#dc3545' }}>Not signed in. Log in to the app first.</div>;
  }
  if (access === 'forbidden') {
    return (
      <div role="alert" data-testid="test-credits-admins-only" style={{ color: '#721c24', fontWeight: 'bold' }}>
        Admins only.
      </div>
    );
  }
  if (access === 'checking' || switchState === 'checking') return <div style={{ color: '#666' }}>Checking access…</div>;
  if (access === 'error') return <div role="alert" style={{ color: '#721c24' }}>{listError ?? 'Could not load the tab.'}</div>;
  if (switchState === 'off') {
    return (
      <div role="alert" data-testid="test-credits-not-enabled" style={{ color: '#856404', background: '#fff3cd', padding: '6px 10px' }}>
        Not enabled on this deployment. Set <code>BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED=true</code> in your{' '}
        <code>.env.local</code> (never on Vercel).
      </div>
    );
  }

  const inputStyle: React.CSSProperties = { padding: '6px 8px', fontSize: '13px' };

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <p style={{ fontSize: '13px', color: '#555', margin: 0 }}>
        <strong>Test only, admin only.</strong> Takes PLAN credits from the account you pick by recording one test charge
        on the live credit ledger. It shows in the credit report (<code>test_harness</code>), in Finance health credits
        (not USD) and as &quot;Other activity&quot; in the owner&apos;s history. Extra credits are not touched: use Take back
        on /admin/users. <strong>There is no undo.</strong>
      </p>

      <BusinessPicker
        sessionUserId={sessionUserId}
        businesses={list?.businesses ?? []}
        listLimit={list?.limit ?? 50}
        loading={listLoading}
        listError={listError}
        search={search}
        onSearchChange={setSearch}
        selectedAccountId={accountId}
        onSelect={select}
        platformAccountIds={list?.platformAccountIds ?? []}
      />

      {accountId && (
        <div style={{ display: 'grid', gap: '10px' }}>
          <PositionView label="Before" position={before} />

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="testCreditsAmount">Credits to take:</label>
            <input
              id="testCreditsAmount"
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setConfirming(false);
              }}
              style={{ ...inputStyle, width: '120px' }}
            />
            <label htmlFor="testCreditsReason">Reason:</label>
            <input
              id="testCreditsReason"
              type="text"
              maxLength={limits?.reasonMax}
              value={reason}
              placeholder={limits ? `${limits.reasonMin}–${limits.reasonMax} characters` : 'Why (for the audit trail)'}
              onChange={(e) => {
                setReason(e.target.value);
                setConfirming(false);
              }}
              style={{ ...inputStyle, width: '280px' }}
            />
            <button
              type="button"
              disabled={!amountOk || !reasonOk || busy}
              onClick={() => setConfirming(true)}
              style={{ padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
            >
              Take credits
            </button>
          </div>

          {confirming && (
            <div
              role="alertdialog"
              data-testid="test-credits-confirm"
              style={{ background: '#f8d7da', color: '#721c24', padding: '8px 10px', fontSize: '13px', display: 'grid', gap: '6px' }}
            >
              <div>
                Take <strong>{fmt(parsedAmount)}</strong> plan credits from <strong>{companyName ?? 'an unknown company'}</strong>{' '}
                <code>{accountId}</code>? This cannot be undone.
              </div>
              {companyName === null && (
                <div data-testid="test-credits-confirm-unknown">
                  <strong>Company name unknown</strong> — this account is not in the loaded list. Check the account id
                  before you take credits.
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" disabled={busy} onClick={() => void take()} style={{ padding: '4px 10px' }}>
                  {busy ? 'Taking…' : 'Yes, take credits'}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} style={{ padding: '4px 10px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {message && (
            <div role="status" style={{ fontSize: '13px', color: message.tone === 'ok' ? '#155724' : '#721c24' }}>
              {message.text}
            </div>
          )}

          <PositionView label="After" position={after} />
        </div>
      )}
    </div>
  );
}
