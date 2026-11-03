'use client';

/**
 * `/business-os/money` — the money story, and what the Money tab now opens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE ORDERS PAGE, REDESIGNED
 *
 * It was built beside `/business-os/orders` so the two could run side by side
 * while it was judged. The tab now points here.
 *
 * The old page is still there and still works, deliberately. Its URL is in the
 * wild in places this repo does not control: the Stripe Connect callback sends
 * people back to it after onboarding, the assistant links to it, and
 * `/business-os/payments` redirects to it in `next.config.js`. Breaking those
 * to tidy up a route would strand somebody mid-payment-setup.
 *
 * WHAT THIS PAGE ANSWERS FROM THE URL
 *
 *   ?action=create   open the invoice composer, which is how the dashboard's
 *                    "create invoice" and the assistant's reply both arrive.
 *
 * `?invoice=` and `?transaction=` are NOT answered here yet: the orders page
 * uses them to highlight one row in a list this page keeps behind a door, so
 * honouring them means deciding what "highlight" means in this design. Until
 * then those links keep going to the orders page, where they still work.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { MoneyFlowPage } from '@/components/business-os/money/MoneyFlowPage';

function MoneyPageContent() {
  const searchParams = useSearchParams();

  return <MoneyFlowPage openCreate={searchParams.get('action') === 'create'} />;
}

export default function MoneyPage() {
  return (
    <div className="min-h-full bg-[var(--v2-bg)]">
      {/* `useSearchParams` opts the tree into client rendering, and Next
          requires a Suspense boundary for it or the whole route deopts at
          build time. The same reason the orders page has one. */}
      <Suspense fallback={<div className="min-h-full bg-[var(--v2-bg)]" />}>
        <MoneyPageContent />
      </Suspense>
    </div>
  );
}
