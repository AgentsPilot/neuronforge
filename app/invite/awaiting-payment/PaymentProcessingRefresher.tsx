'use client';

/**
 * "Payment processing": a bounded refresh of the server page (plan payments
 * P-5a.2; workplan §3.3; SA S5-6, W-7, Q-5; risk R-6).
 *
 * Calls `router.refresh()` every `PROCESSING_REFRESH_INTERVAL_MS` (4 s), at
 * most `PROCESSING_REFRESH_LIMIT` (15) times, about one minute. Each refresh
 * re-renders the server page, which re-reads the hold: once the webhook has
 * stamped the first payment, the page redirects to onboarding. THIS COMPONENT
 * NEVER RELEASES ANYONE; it only asks the server again (P5-C6).
 *
 * After the last refresh it shows "This is taking longer than usual". With
 * `delay` other than `none` (the server saw a live subscription older than 5
 * minutes), it shows that line at once and does not refresh at all, so one
 * manual load of a stuck account logs one alert, not fifteen (Q-5).
 *
 * When the processing came from the URL marker alone (`markerOnly`), the
 * line links to the screen WITHOUT the marker (W-7 c): that page shows Pay
 * again if nothing is live, so a stale or bookmarked marker cannot trap the
 * friend here.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export const PROCESSING_REFRESH_INTERVAL_MS = 4000;
export const PROCESSING_REFRESH_LIMIT = 15;

export function PaymentProcessingRefresher({
  delay,
  markerOnly,
  slowLabel,
  checkAgainLabel,
  checkAgainHref,
}: {
  delay: 'none' | 'slow' | 'stuck';
  markerOnly: boolean;
  slowLabel: string;
  checkAgainLabel: string;
  /** The holding screen's path, without the return marker. */
  checkAgainHref: string;
}) {
  const router = useRouter();
  const polling = delay === 'none';
  const [refreshes, setRefreshes] = useState(0);
  const exhausted = !polling || refreshes >= PROCESSING_REFRESH_LIMIT;

  useEffect(() => {
    if (exhausted) return undefined;
    const timer = setTimeout(() => {
      setRefreshes((count) => count + 1);
      router.refresh();
    }, PROCESSING_REFRESH_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [exhausted, refreshes, router]);

  if (!exhausted) return null;

  return (
    <div data-testid="awaiting-payment-processing-slow" className="space-y-3">
      <p className="text-base leading-relaxed text-slate-700">{slowLabel}</p>
      {markerOnly ? (
        <a data-testid="awaiting-payment-check-again" href={checkAgainHref} className="text-sm font-semibold text-indigo-700 underline">
          {checkAgainLabel}
        </a>
      ) : null}
    </div>
  );
}
