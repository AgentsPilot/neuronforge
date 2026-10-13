'use client';

/**
 * "Plan checkout (test)" panel for /test-business-os (plan payments P-3a,
 * workplan §3.9, SA Q-11). The local demo's trigger.
 *
 * Calls POST /api/business-os/billing/plan/checkout as the signed-in session
 * with `returnTo: 'test_harness'`, then mounts Stripe's EMBEDDED checkout on
 * the returned client secret. Card only, so Stripe normally does not redirect
 * (`redirect_on_completion: 'if_required'`): completion arrives through
 * `onComplete`.
 *
 * Since P-3b.2, paying here SWITCHES the account's plan: the webhook applies
 * the paid plan invoice (see the P-3b workplan's demo runbook). Test mode only,
 * but the database is shared, so use a test account and cancel the sandbox
 * subscription afterwards.
 *
 * The tier list is `TIER_ORDER` from the entitlements config, so this file
 * holds no tier name. It imports nothing else from that module and decides
 * nothing by plan (a recorded non-gate).
 *
 * P-5a.2 (workplan §3.4): the Stripe.js loader, the POST to the route, the
 * session state and the embedded mount moved to the shared
 * `PlanEmbeddedCheckout` (which the holding screen and P-4 reuse). This panel
 * keeps its UI: the tier select, the status line, Close, and the debug log.
 * The client secret never reaches this file: the shared component hands
 * `onResponse` a body with the secret replaced by a marker.
 */

import { useState } from 'react';

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { harnessButton } from '@/components/test-business-os/harnessButton';
import { PlanEmbeddedCheckout } from '@/components/business-os/billing/PlanEmbeddedCheckout';

type DebugLogType = 'info' | 'error' | 'success';

export interface PlanCheckoutPanelProps {
  onLog?: (type: DebugLogType, message: string) => void;
  onResponse?: (payload: unknown) => void;
}

export function PlanCheckoutPanel({ onLog, onResponse }: PlanCheckoutPanelProps) {
  const [tier, setTier] = useState<string>(TIER_ORDER[0]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Bumped by Close: a fresh shared component, so the old session is unmounted.
  const [instance, setInstance] = useState(0);

  const reset = () => {
    setInstance((current) => current + 1);
    setSessionId(null);
    setStatus(null);
  };

  return (
    <div>
      <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
        Opens a Business OS plan checkout for the signed-in account (Stripe test mode only).
        Paying <strong>switches the account&apos;s plan</strong>. The database is shared, so use a test account only,
        and cancel the sandbox subscription in Stripe afterwards. Test card: 4242 4242 4242 4242, any future
        date, any CVC. Needs <code>BUSINESS_OS_PLAN_CHECKOUT_ENABLED</code> and{' '}
        <code>BUSINESS_OS_PLAN_PRICES_ENABLED</code> in your local environment.
      </p>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
        <label htmlFor="plan-checkout-tier" style={{ fontSize: '13px' }}>
          Tier
        </label>
        <select
          id="plan-checkout-tier"
          value={tier}
          onChange={(event) => setTier(event.target.value)}
          disabled={loading || sessionId !== null}
          style={{ padding: '6px' }}
        >
          {TIER_ORDER.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        {sessionId !== null && (
          <button type="button" onClick={reset} className={harnessButton('secondary', 'md')}>
            Close checkout
          </button>
        )}
      </div>

      {status && <div style={{ fontSize: '13px', marginBottom: '12px', fontFamily: 'monospace' }}>{status}</div>}

      <PlanEmbeddedCheckout
        key={instance}
        tier={tier}
        returnTo="test_harness"
        labels={{
          start: 'Start checkout',
          starting: 'Starting...',
          notConfigured: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set, so the embedded checkout cannot be shown.',
        }}
        buttonClassName={harnessButton('primary', 'md')}
        frameClassName="rounded-md border border-gray-300 p-2.5"
        testId="plan-checkout-panel"
        onResponse={onResponse}
        onRequest={() => {
          setLoading(true);
          setStatus(null);
          setSessionId(null);
          onLog?.('info', `Plan checkout: requesting a session for tier "${tier}"...`);
        }}
        onStarted={({ sessionId: opened, expiresAt }) => {
          setLoading(false);
          setSessionId(opened);
          setStatus(`Session ${opened} open until ${expiresAt}`);
          onLog?.('success', `Plan checkout session ${opened} opened`);
        }}
        onRefused={({ httpStatus, code, expiresAt, serverMessage }) => {
          setLoading(false);
          const line = `HTTP ${httpStatus} ${code ?? ''} ${serverMessage ?? ''}`.trim();
          setStatus(`Refused: ${line}${expiresAt ? ` (open until ${expiresAt})` : ''}`);
          onLog?.('error', `Plan checkout refused: ${line}`);
        }}
        onRequestFailed={(message) => {
          setLoading(false);
          setStatus(`Request failed: ${message}`);
          onLog?.('error', `Plan checkout request failed: ${message}`);
        }}
        onComplete={(completed) => {
          setStatus(`Session ${completed} completed. The plan switches once the paid invoice reaches the webhook.`);
          onLog?.('success', `Plan checkout ${completed} completed (plan switches on the paid invoice)`);
        }}
      />
    </div>
  );
}
