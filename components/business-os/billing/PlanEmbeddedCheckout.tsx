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
 * M-2 (plan payments P-4.1): the publishable key is checked FIRST. With no
 * usable key (`getStripePromise()` is `null`), the component shows
 * `labels.notConfigured` in place of the start button and never calls the
 * route, so no session is opened and no checkout lock is taken for a frame
 * that could not mount (SA O-1).
 *
 * A refusal surfaces the route's `code` and `expiresAt` through `onRefused`.
 * The server's English `error` is passed along for the internal harness only;
 * customer screens localize by `code` and never show it (SA Q-8).
 *
 * It takes the tier as a plain string and imports nothing from the
 * entitlements module (SA P5-C11), and it decides nothing by plan.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Start the checkout once, on mount, as if the start button had been pressed
   * (upgrade modal UM-1b, SA Q-2). The plan comparison modal's column buttons
   * are the owner's press: they mount this component for one plan, so a second
   * press on a second "Choose" would only repeat the first. Read ONCE through a
   * ref, so StrictMode's second effect run posts nothing; never re-fires on a
   * prop change or after a refusal (the retry is the start button, which comes
   * back). With no usable key it does nothing (M-2). Default off: the holding
   * screen and the harness never pass it.
   */
  autoStart?: boolean;
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
  autoStart = false,
}: PlanEmbeddedCheckoutProps) {
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<{ sessionId: string; clientSecret: string } | null>(null);
  const stripe = useMemo(() => getStripePromise(), []);
  /** UM-1b: the mount-time value, read once; a later prop change starts nothing. */
  const autoStartOnMount = useRef(autoStart);
  const autoStarted = useRef(false);
  /*
   * Stripe's provider refuses a changed `onComplete` once set (it warns and keeps
   * the first). A host that re-renders while the frame is open (the plan
   * comparison modal does, UM-1b) would trip that, so the options are fixed per
   * session and call the LATEST `onComplete` through a ref.
   */
  const latestOnComplete = useRef(onComplete);
  latestOnComplete.current = onComplete;
  const providerOptions = useMemo(
    () =>
      session === null
        ? null
        : { clientSecret: session.clientSecret, onComplete: () => latestOnComplete.current?.(session.sessionId) },
    [session]
  );

  const start = async () => {
    // M-2: never open a session (and take the SR-5 lock) that cannot be shown.
    if (stripe === null) return;
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

  useEffect(() => {
    if (!autoStartOnMount.current || autoStarted.current || stripe === null) return;
    autoStarted.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: one start per mount (SA Q-2)
  }, []);

  // M-2: no usable publishable key → say so, and offer no start at all.
  if (stripe === null) {
    return (
      <div data-testid={testId}>
        <p role="alert" data-testid={`${testId}-not-configured`} className="text-sm text-red-700">
          {labels.notConfigured}
        </p>
      </div>
    );
  }

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

      {session !== null && providerOptions !== null ? (
        <div data-testid={`${testId}-frame`} className={frameClassName}>
          <EmbeddedCheckoutProvider key={session.sessionId} stripe={stripe} options={providerOptions}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      ) : null}
    </div>
  );
}
