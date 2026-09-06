'use client';

import { useEffect, useRef } from 'react';

/**
 * Records one page view, from the browser.
 *
 * Tracking used to happen server-side inside the route that renders the site.
 * Because the page component fetched its own API server-to-server, that code
 * read the headers of the INTERNAL request — so every visitor was recorded with
 * a null referrer, Node's user-agent and the app server's IP.
 *
 * From here we get what actually identifies a channel:
 *   - `document.referrer`, which survives https->http, privacy modes and
 *     in-app browsers that drop the Referer header
 *   - the landing URL's own `utm_*`, which a referrer can never carry because
 *     it describes the PREVIOUS page
 *
 * Fire-and-forget: analytics must never delay or break the page a customer
 * came to read.
 */

interface PageViewTrackerProps {
  subdomain: string;
}

export function PageViewTracker({ subdomain }: PageViewTrackerProps) {
  // React 18 StrictMode mounts effects twice in development. Without this the
  // dev database fills with doubled views.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    const params = new URLSearchParams(window.location.search);

    const payload = {
      subdomain,
      referrer: document.referrer || undefined,
      utm_source: params.get('utm_source') || undefined,
      utm_medium: params.get('utm_medium') || undefined,
      utm_campaign: params.get('utm_campaign') || undefined,
      source: 'public',
    };

    const body = JSON.stringify(payload);

    // sendBeacon survives the page being closed mid-request, which a plain
    // fetch does not — a visitor who bounces immediately still gets counted.
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        '/api/website/analytics/track',
        new Blob([body], { type: 'application/json' })
      );
      if (ok) return;
    }

    fetch('/api/website/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // A failed analytics call is not worth surfacing to a visitor.
    });
  }, [subdomain]);

  return null;
}
