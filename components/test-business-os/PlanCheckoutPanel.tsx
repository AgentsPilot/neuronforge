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
 * Paying here changes NO plan until P-3b ships: the webhook recognises the
 * plan invoice and answers 500 by design (see the workplan's demo runbook).
 *
 * The tier list is `TIER_ORDER` from the entitlements config, so this file
 * holds no tier name. It imports nothing else from that module and decides
 * nothing by plan (a recorded non-gate). The client secret is never shown in
 * the shared response viewer: it is replaced by a marker before `onResponse`.
 */

import { useMemo, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

type DebugLogType = 'info' | 'error' | 'success';

export interface PlanCheckoutPanelProps {
  onLog?: (type: DebugLogType, message: string) => void;
  onResponse?: (payload: unknown) => void;
}

interface CheckoutResponse {
  success: boolean;
  error?: string;
  code?: string;
  expiresAt?: string;
  data?: { clientSecret: string; sessionId: string; expiresAt: string; tier: string };
}

let stripePromise: Promise<Stripe | null> | null = null;

/** One Stripe.js instance per page; `null` when no publishable key is configured. */
function getStripePromise(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}

export function PlanCheckoutPanel({ onLog, onResponse }: PlanCheckoutPanelProps) {
  const [tier, setTier] = useState<string>(TIER_ORDER[0]);
  const [loading, setLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const stripe = useMemo(() => getStripePromise(), []);

  const start = async () => {
    setLoading(true);
    setStatus(null);
    setClientSecret(null);
    setSessionId(null);
    onLog?.('info', `Plan checkout: requesting a session for tier "${tier}"...`);
    try {
      const response = await fetch('/api/business-os/billing/plan/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, returnTo: 'test_harness' }),
      });
      const json = (await response.json().catch(() => ({ success: false, error: 'Unreadable response' }))) as CheckoutResponse;
      // Never put the client secret in the shared viewer.
      onResponse?.({
        httpStatus: response.status,
        ...json,
        ...(json.data ? { data: { ...json.data, clientSecret: '[redacted: mounted below]' } } : {}),
      });

      if (!response.ok || !json.success || !json.data) {
        const line = `HTTP ${response.status} ${json.code ?? ''} ${json.error ?? ''}`.trim();
        setStatus(`Refused: ${line}${json.expiresAt ? ` (open until ${json.expiresAt})` : ''}`);
        onLog?.('error', `Plan checkout refused: ${line}`);
        return;
      }

      setSessionId(json.data.sessionId);
      setClientSecret(json.data.clientSecret);
      setStatus(`Session ${json.data.sessionId} open until ${json.data.expiresAt}`);
      onLog?.('success', `Plan checkout session ${json.data.sessionId} opened`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Request failed: ${message}`);
      onLog?.('error', `Plan checkout request failed: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setClientSecret(null);
    setSessionId(null);
    setStatus(null);
  };

  return (
    <div>
      <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
        Opens a Business OS plan checkout for the signed-in account (Stripe test mode only).
        Paying does <strong>not</strong> change the plan until P-3b. Test card: 4242 4242 4242 4242, any future
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
          disabled={loading || clientSecret !== null}
          style={{ padding: '6px' }}
        >
          {TIER_ORDER.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={start}
          disabled={loading || clientSecret !== null}
          style={{
            padding: '8px 16px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: loading || clientSecret !== null ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Starting...' : 'Start checkout'}
        </button>
        {clientSecret !== null && (
          <button type="button" onClick={reset} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Close checkout
          </button>
        )}
      </div>

      {status && <div style={{ fontSize: '13px', marginBottom: '12px', fontFamily: 'monospace' }}>{status}</div>}

      {clientSecret !== null && stripe === null && (
        <div style={{ color: '#dc3545', fontSize: '13px' }}>
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set, so the embedded checkout cannot be shown.
        </div>
      )}

      {clientSecret !== null && stripe !== null && (
        <div style={{ border: '1px solid #ddd', borderRadius: '5px', padding: '10px' }}>
          <EmbeddedCheckoutProvider
            key={sessionId ?? 'none'}
            stripe={stripe}
            options={{
              clientSecret,
              onComplete: () => {
                setStatus(`Session ${sessionId} completed. The plan is unchanged until P-3b.`);
                onLog?.('success', `Plan checkout ${sessionId} completed (no plan change until P-3b)`);
              },
            }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      )}
    </div>
  );
}
