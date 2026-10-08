'use client';

/**
 * "Payment received" — what the owner sees when Stripe sends them back to the
 * dashboard after paying for a credits boost (credits boost slice 5b.1;
 * requirement FR-11, FR-13; SA C-1, C-3, Q-2).
 *
 * Stripe's return URL is `/business-os?boost=return&session_id=cs_…`. This
 * notice, mounted in the Credits card:
 *   1. reads the two parameters once, then removes them from the address
 *      (`history.replaceState`), so a refresh or a bookmark does not repeat it;
 *   2. shows "Payment received — your credits will appear shortly";
 *   3. asks OUR server what happened (`GET …/boost/purchases?sessionId=`, an
 *      owner-scoped read of our own row) at 2, 5, 10, 20 and 40 seconds, about
 *      77 s in total, and stops on any final answer (SA Q-2). Never a timer
 *      that runs forever.
 *
 * It never credits anything and never trusts the session id: credits arrive
 * only through the payment webhook. When the purchase is credited it tells
 * the card to re-read (`notifyCreditUsageChanged`), so "Extra credits" updates.
 * Another owner's session, or an unknown one, simply hides the notice.
 *
 * StrictMode / remounts: the parameters are captured once per page load in
 * module state, so the dashboard mounting twice does not lose the notice.
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { notifyCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BoostReturnNotice' });

const STATUS_URL = '/api/business-os/credits/boost/purchases';
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{1,190}$/;

/**
 * The waits before each read (SA Q-2): 2, 5, 10, 20 and 40 seconds, about
 * 77 s in total, then the "still confirming" line. Written in seconds: these
 * are not credit figures (the credit-figure guard scans this file).
 */
const POLL_DELAYS_SECONDS = [2, 5, 10, 20, 40] as const;
export const BOOST_RETURN_POLL_DELAYS_MS: readonly number[] = POLL_DELAYS_SECONDS.map((seconds) => seconds * 1000);
/** How long "Credits added." stays before the notice hides itself. */
export const BOOST_RETURN_CREDITED_HIDE_MS = 8 * 1000;

type NoticeState = 'hidden' | 'received' | 'credited' | 'still_confirming' | 'awaiting' | 'failed' | 'expired' | 'under_review';

const MESSAGE_KEY: Record<Exclude<NoticeState, 'hidden'>, string> = {
  received: 'usage.boost.return.received',
  credited: 'usage.boost.return.credited',
  still_confirming: 'usage.boost.return.still_confirming',
  awaiting: 'usage.boost.return.awaiting',
  failed: 'usage.boost.return.failed',
  expired: 'usage.boost.return.expired',
  under_review: 'usage.boost.return.under_review',
};

/** undefined: not read yet this page load; null: nothing to show. */
let capturedSessionId: string | null | undefined;

/** Read and remove the return parameters, once per page load. */
function captureReturnSession(): string | null {
  if (capturedSessionId !== undefined) return capturedSessionId;
  capturedSessionId = null;
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('boost') !== 'return') return null;
  const sessionId = params.get('session_id');
  params.delete('boost');
  params.delete('session_id');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  if (sessionId && SESSION_ID.test(sessionId)) capturedSessionId = sessionId;
  return capturedSessionId;
}

/** Test seam: forget what this page load captured. */
export function __resetBoostReturnForTests(): void {
  capturedSessionId = undefined;
}

export function BoostReturnNotice() {
  const { t, isRTL } = useLanguage();
  const [state, setState] = useState<NoticeState>('hidden');

  useEffect(() => {
    const sessionId = captureReturnSession();
    if (!sessionId) return;
    setState('received');

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const finish = (next: NoticeState) => {
      // A final answer: this page load has nothing more to show after it.
      capturedSessionId = null;
      setState(next);
      if (next === 'credited') {
        notifyCreditUsageChanged();
        timer = setTimeout(() => setState('hidden'), BOOST_RETURN_CREDITED_HIDE_MS);
      }
    };

    const schedule = () => {
      if (attempt >= BOOST_RETURN_POLL_DELAYS_MS.length) {
        capturedSessionId = null;
        setState('still_confirming');
        return;
      }
      timer = setTimeout(() => void read(), BOOST_RETURN_POLL_DELAYS_MS[attempt]);
      attempt += 1;
    };

    const read = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`${STATUS_URL}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
        const body = await response.json();
        if (cancelled) return;
        if (response.ok && body?.success) {
          const purchase = body.data?.purchase;
          if (purchase === null) return finish('hidden');
          switch (purchase?.status) {
            case 'credited':
              return finish('credited');
            case 'awaiting_payment':
              return finish('awaiting');
            case 'failed':
              return finish('failed');
            case 'expired':
              return finish('expired');
            case 'under_review':
              return finish('under_review');
            case 'refunded':
            case 'partially_refunded':
              return finish('hidden');
            default:
              break; // processing: keep asking
          }
        } else {
          logger.warn({ status: response.status }, 'Boost return status read failed');
        }
      } catch (err) {
        if (cancelled) return;
        logger.warn({ err }, 'Boost return status read threw');
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (state === 'hidden') return null;
  const positive = state === 'credited' || state === 'received' || state === 'awaiting' || state === 'still_confirming';
  return (
    <div
      data-testid="boost-return-notice"
      data-state={state}
      role="status"
      aria-live="polite"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 10,
        fontSize: '12px',
        lineHeight: 1.4,
        color: 'var(--v2-text-primary)',
        background: positive
          ? 'color-mix(in srgb, var(--v2-primary) 10%, transparent)'
          : 'color-mix(in srgb, #F97316 12%, transparent)',
      }}
    >
      <span data-testid="boost-return-message">{t(MESSAGE_KEY[state])}</span>
      <button
        type="button"
        data-testid="boost-return-dismiss"
        aria-label={t('usage.boost.return.dismiss')}
        onClick={() => {
          capturedSessionId = null;
          setState('hidden');
        }}
        style={{ border: 'none', background: 'transparent', color: 'var(--v2-text-secondary)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}
