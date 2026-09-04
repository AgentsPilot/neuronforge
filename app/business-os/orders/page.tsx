'use client';

/**
 * /business-os/orders — every order, and the money that settles it.
 *
 * Money used to be the second half of the Reports page, reached at
 * `?tab=invoices|transactions|money`. Those links still work: Reports redirects
 * here and carries the parameters across, which matters because one of them is
 * built by the Stripe Connect callback and is where somebody lands on returning
 * from payment onboarding.
 *
 * This lived at `/business-os/payments` until the tab was renamed. That path
 * redirects here in next.config.js rather than 404ing, because the assistant has
 * already sent people links to it.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PaymentsView } from '@/components/payments/PaymentsView';

function PaymentsPageContent() {
  const searchParams = useSearchParams();

  // One list holds both, so either id highlights the same way — whichever the
  // caller happened to know about.
  const highlightId = searchParams.get('invoice') ?? searchParams.get('transaction');

  return (
    <PaymentsView
      highlightId={highlightId}
      openCreate={searchParams.get('action') === 'create'}
    />
  );
}

export default function PaymentsPage() {
  // `useSearchParams` opts the tree into client rendering, and Next requires a
  // Suspense boundary for it or the whole route deopts at build time.
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--v2-bg)]" />}>
      <PaymentsPageContent />
    </Suspense>
  );
}
