'use client';

/**
 * "Test clock" block on the /test-business-os Billing tab (plan payments
 * P-6a.1, workplan §5.8, §12; SA C-5, C-7). TEST MODE ONLY.
 *
 * Calls POST /api/admin/business-os/test/plan-test-clock (admin only, both
 * payment switches on, a test-mode key):
 *   Attach   put the account on a fresh Stripe test clock (its test-mode
 *            customer is replaced and the subscription mirror cleared), so the
 *            next Plan checkout runs on that clock;
 *   Advance  move the clock forward (never back, at most 60 days per step);
 *   Status   read-only: the clock time, the billing failure fields and the
 *            lifecycle derived AT THE CLOCK'S TIME. A test clock moves only
 *            Stripe's time, so the admin Tiers page keeps reading `active`; the
 *            demo reads grace, paused and AC-F6.5 here instead (C-7).
 *
 * The account id is pre-filled with the signed-in account (the demo owners
 * are not admins, so an admin may type another account's id). The server
 * decides everything; this panel only shows its answers. It imports nothing
 * from the entitlements module and names no tier.
 */

import { useEffect, useState } from 'react';
import { harnessButton } from '@/components/test-business-os/harnessButton';

export const PLAN_TEST_CLOCK_PATH = '/api/admin/business-os/test/plan-test-clock';

type DebugLogType = 'info' | 'error' | 'success';
type Action = 'attach' | 'advance' | 'status';

export interface PlanTestClockPanelProps {
  sessionUserId: string | null;
  onLog?: (type: DebugLogType, message: string) => void;
  onResponse?: (payload: unknown) => void;
}

/** One refusal code → one plain sentence. */
const REFUSALS: Record<string, string> = {
  not_enabled: 'Not enabled: needs BUSINESS_OS_PLAN_CHECKOUT_ENABLED and BUSINESS_OS_PLAN_PRICES_ENABLED.',
  invalid_input: 'Check the account id and the target time (an ISO time with Z or an offset).',
  not_a_tenant: 'That account is not a Business OS account.',
  live_mode_refused: 'The server key is a live-mode key. Test clocks exist in test mode only.',
  subscription_live: 'The account still has a live test subscription. Cancel it in the Stripe dashboard first.',
  checkout_open: 'A plan checkout is open for this account. Close it or wait for it to expire.',
  no_test_clock: 'The account is not on a test clock yet. Attach one first.',
  foreign_clock: "The stored customer belongs to another account. Attach a new clock.",
  clock_not_ready: 'The clock is still advancing. Read the status again in a moment.',
  target_in_past: 'The target must be after the clock time.',
  target_too_far: 'At most 60 days per step.',
  advance_refused: 'Stripe refused the advance (it limits how far a clock can move with a subscription on it).',
  concurrent_change: 'The account changed meanwhile. Try again.',
};

interface StatusView {
  clock: { testClockId: string; frozenTime: string; status: string };
  billing: Record<string, unknown>;
  plan: Record<string, unknown> | null;
  lifecycle: { state: string; reason: string; accessEndsAt: string | null; graceEndsAt: string | null };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function PlanTestClockPanel({ sessionUserId, onLog, onResponse }: PlanTestClockPanelProps) {
  const [accountId, setAccountId] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [clockTime, setClockTime] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusView | null>(null);

  // Pre-fill once the session is known; never overwrite what the admin typed.
  useEffect(() => {
    if (sessionUserId && accountId === '') setAccountId(sessionUserId);
  }, [sessionUserId, accountId]);

  const send = async (action: Action) => {
    setBusy(true);
    setMessage(null);
    const body = action === 'advance' ? { action, accountId: accountId.trim(), to: target.trim() } : { action, accountId: accountId.trim() };
    onLog?.('info', `Test clock: ${action} for ${body.accountId}...`);
    try {
      const response = await fetch(PLAN_TEST_CLOCK_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as { success?: boolean; error?: string; data?: unknown } | null;
      onResponse?.(json);
      if (!response.ok || !json?.success) {
        const code = json?.error ?? `HTTP ${response.status}`;
        const text =
          response.status === 401 ? 'Sign in first.' : response.status === 403 ? 'Admins only.' : REFUSALS[code] ?? code;
        setMessage({ tone: 'error', text });
        onLog?.('error', `Test clock ${action} refused: HTTP ${response.status} ${code}`);
        return;
      }

      if (action === 'status') {
        const view = json.data as StatusView;
        setStatus(view);
        setClockTime(view.clock.frozenTime);
        setMessage({ tone: 'ok', text: `Clock ${view.clock.testClockId} at ${view.clock.frozenTime} (${view.clock.status}).` });
      } else {
        const data = json.data as { testClockId: string; frozenTime: string; status: string; recordPath?: string };
        setClockTime(data.frozenTime);
        setStatus(null);
        setMessage({
          tone: 'ok',
          text:
            action === 'attach'
              ? `Attached clock ${data.testClockId} at ${data.frozenTime} (${data.recordPath}). Now buy a plan with Plan checkout above.`
              : `Clock ${data.testClockId} moving to ${data.frozenTime} (${data.status}). Read the status once it is ready.`,
        });
      }
      onLog?.('success', `Test clock ${action} done`);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage({ tone: 'error', text: `Request failed: ${text}` });
      onLog?.('error', `Test clock ${action} failed: ${text}`);
    } finally {
      setBusy(false);
    }
  };

  /** Fill the target with the clock time plus some days. */
  const fillTarget = (days: number) => {
    const base = clockTime ? Date.parse(clockTime) : Date.now();
    setTarget(new Date(base + days * DAY_MS).toISOString());
  };

  return (
    <div data-testid="plan-test-clock-panel">
      <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
        Test mode only, admins only. <strong>Attach</strong> replaces the account&apos;s test-mode Stripe customer with a new
        one on a fresh test clock, so the next Plan checkout above runs on that clock. The account must have no live test
        subscription. <strong>Advance</strong> moves Stripe&apos;s time only: read the account&apos;s state with{' '}
        <strong>Status</strong>, which works it out at the clock&apos;s time. Delete the clock in the Stripe dashboard after
        the demo.
      </p>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
        <label htmlFor="plan-test-clock-account" style={{ fontSize: '13px' }}>
          Account id
        </label>
        <input
          id="plan-test-clock-account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          disabled={busy}
          style={{ padding: '6px', width: '330px', fontFamily: 'monospace' }}
        />
        <button type="button" onClick={() => void send('attach')} disabled={busy || !accountId} className={harnessButton('primary', 'md')}>
          Attach a new test clock
        </button>
        <button type="button" onClick={() => void send('status')} disabled={busy || !accountId} className={harnessButton('secondary', 'md')}>
          Status
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <label htmlFor="plan-test-clock-target" style={{ fontSize: '13px' }}>
          Advance to
        </label>
        <input
          id="plan-test-clock-target"
          value={target}
          placeholder="2026-11-01T00:00:00.000Z"
          onChange={(event) => setTarget(event.target.value)}
          disabled={busy}
          style={{ padding: '6px', width: '230px', fontFamily: 'monospace' }}
        />
        <button type="button" onClick={() => fillTarget(1)} disabled={busy} className={harnessButton('secondary', 'sm')}>
          +1 day
        </button>
        <button type="button" onClick={() => fillTarget(5)} disabled={busy} className={harnessButton('secondary', 'sm')}>
          +5 days
        </button>
        <button type="button" onClick={() => fillTarget(31)} disabled={busy} className={harnessButton('secondary', 'sm')}>
          +31 days
        </button>
        <button type="button" onClick={() => void send('advance')} disabled={busy || !accountId || !target} className={harnessButton('primary', 'md')}>
          Advance
        </button>
      </div>

      {message && (
        <div
          role={message.tone === 'error' ? 'alert' : 'status'}
          style={{ fontSize: '13px', marginBottom: '12px', color: message.tone === 'error' ? '#b91c1c' : '#166534' }}
        >
          {message.text}
        </div>
      )}

      {status && (
        <div style={{ fontSize: '13px', fontFamily: 'monospace' }} data-testid="plan-test-clock-status">
          <div>
            <strong>State at clock time:</strong> {status.lifecycle.state} ({status.lifecycle.reason})
          </div>
          <div>access ends: {status.lifecycle.accessEndsAt ?? '—'} · grace ends: {status.lifecycle.graceEndsAt ?? '—'}</div>
          <div>plan row: {JSON.stringify(status.plan)}</div>
          <div>billing record: {JSON.stringify(status.billing)}</div>
        </div>
      )}
    </div>
  );
}
