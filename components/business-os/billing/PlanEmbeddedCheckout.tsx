'use client';

/**
 * The shared Business OS PLAN embedded checkout (plan payments P-5a.2;
 * workplan §3.4; SA P5-3: one shared component, one Stripe.js loader).
 *
 * Extracted from the /test-business-os `PlanCheckoutPanel`. Used today by that
 * harness panel and by the holding screen's Pay button
 * (`app/invite/awaiting-payment/HeldPaymentCheckout.tsx`); P-4's Settings
 * button reuses it.
 *
 * It owns:
 *   - the start button, and the POST to `/api/business-os/billing/plan/checkout`
 *     with exactly `{ tier, returnTo }` (the route's strict schema; the
 *     account, email and price come from the server, never from here);
 *   - the session state, and the mount of Stripe's `EmbeddedCheckoutProvider`
 *     + `EmbeddedCheckout`, keyed by session id. Card only, so Stripe normally
 *     does not redirect (`redirect_on_completion: 'if_required'`): completion
 *     arrives through `onComplete`.
 *
 * THE CLIENT SECRET NEVER LEAVES THIS COMPONENT. No callback receives it:
 * `onStarted` gets the session id and expiry, and `onResponse` (the harness's
 * response viewer) gets the body with the secret replaced by a marker.
 *
 * A refusal surfaces the route's `code` and `expiresAt` through `onRefused`.
 * The server's English `error` is passed along for the internal harness only;
 * customer screens localize by `code` and never show it (SA Q-8).
 *
 * It takes the tier as a plain string and imports nothing from the
 * entitlements module (SA P5-C11), and it decides nothing by plan.
 */

import { useMemo, useState } from 'react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';

import { getStripePromise } from '@/lib/client/stripeJs';

/** The return surfaces the route accepts (`PLAN_CHECKOUT_RETURN_SURFACES`). Never a URL. */
export type PlanEmbeddedCheckoutReturnTo = 'settings_plan' | 'awaiting_payment' | 'test_harness';

/** What the route says when it refuses, as the caller needs it. */
export interface PlanCheckoutRefusal {
  httpStatus: number;
  /** The route's refusal code, or null when the body had none (e.g. a 500). */
  code: string | null;
  /** The open checkout's expiry, on `checkout_open`. */
  expiresAt: string | null;
  /** The server's English message. Internal screens only: customer screens localize by `code`. */
  serverMessage: string | null;
}

export interface PlanEmbeddedCheckoutProps {
  tier: string;
  returnTo: PlanEmbeddedCheckoutReturnTo;
  labels: {
    /** The start button. */
    start: string;
    /** The start button while the request runs. */
    starting: string;
    /** Shown instead of the frame when no publishable key is configured. */
    notConfigured: string;
  };
  buttonClassName?: string;
  frameClassName?: string;
  /** Extra condition that disables the start button (the harness's own state). */
  disabled?: boolean;
  testId?: string;
  onRequest?: () => void;
  onStarted?: (session: { sessionId: string; expiresAt: string }) => void;
  onRefused?: (refusal: PlanCheckoutRefusal) => void;
  /** The request itself failed (network, unreadable body). */
  onRequestFailed?: (message: string) => void;
  onComplete?: (sessionId: string) => void;
  /** The response body with the client secret REDACTED, for the harness viewer. */
  onResponse?: (payload: unknown) => void;
}

interface CheckoutResponse {
  success: boolean;
  error?: string;
  code?: string;
  expiresAt?: string;
  data?: { clientSecret: string; sessionId: string; expiresAt: string; tier: string };
}

/** What replaces the client secret in anything handed to a callback. */
export const REDACTED_CLIENT_SECRET = '[redacted: mounted below]';

export const PLAN_CHECKOUT_ENDPOINT = '/api/business-os/billing/plan/checkout';

export function PlanEmbeddedCheckout({
  tier,
  returnTo,
  labels,
  buttonClassName,
  frameClassName,
  disabled = false,
  testId = 'plan-embedded-checkout',
  onRequest,
  onStarted,
  onRefused,
  onRequestFailed,
  onComplete,
  onResponse,
}: PlanEmbeddedCheckoutProps) {
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<{ sessionId: string; clientSecret: string } | null>(null);
  const stripe = useMemo(() => getStripePromise(), []);

  const start = async () => {
    setLoading(true);
    setSession(null);
    onRequest?.();
    try {
      const response = await fetch(PLAN_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, returnTo }),
      });
      const json = (await response.json().catch(() => ({ success: false, error: 'Unreadable response' }))) as CheckoutResponse;
      // Never put the client secret in anything a callback receives.
      onResponse?.({
        httpStatus: response.status,
        ...json,
        ...(json.data ? { data: { ...json.data, clientSecret: REDACTED_CLIENT_SECRET } } : {}),
      });

      if (!response.ok || !json.success || !json.data) {
        onRefused?.({
          httpStatus: response.status,
          code: typeof json.code === 'string' ? json.code : null,
          expiresAt: typeof json.expiresAt === 'string' ? json.expiresAt : null,
          serverMessage: typeof json.error === 'string' ? json.error : null,
        });
        return;
      }

      setSession({ sessionId: json.data.sessionId, clientSecret: json.data.clientSecret });
      onStarted?.({ sessionId: json.data.sessionId, expiresAt: json.data.expiresAt });
    } catch (error) {
      onRequestFailed?.(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid={testId}>
      {session === null ? (
        <button
          type="button"
          data-testid={`${testId}-start`}
          onClick={start}
          disabled={loading || disabled}
          className={buttonClassName}
        >
          {loading ? labels.starting : labels.start}
        </button>
      ) : null}

      {session !== null && stripe === null ? (
        <p role="alert" data-testid={`${testId}-not-configured`} className="text-sm text-red-700">
          {labels.notConfigured}
        </p>
      ) : null}

      {session !== null && stripe !== null ? (
        <div data-testid={`${testId}-frame`} className={frameClassName}>
          <EmbeddedCheckoutProvider
            key={session.sessionId}
            stripe={stripe}
            options={{
              clientSecret: session.clientSecret,
              onComplete: () => onComplete?.(session.sessionId),
            }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      ) : null}
    </div>
  );
}
