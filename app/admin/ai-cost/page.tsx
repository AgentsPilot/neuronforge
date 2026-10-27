'use client';

/**
 * `/admin/ai-cost` — AI cost (Money MK-3, KPI restructure review §4; SA-6).
 *
 * One page for what AI usage costs us, with two tabs: Summary & checks (the
 * old Charge checks, `/admin/finance/charges`) and Calls (the old AI calls &
 * usage, `/admin/analytics`). Both old addresses redirect here, to their tab,
 * with their query (`next.config.js`). The view is `components/AiCostView.tsx`.
 *
 * A CLIENT component with no data of its own: the reads go to admin routes
 * that run `requireAdmin` first, and the page sits under
 * `app/admin/layout.tsx`, whose `requireAdminPage` runs before it renders (the
 * admin authz surface guard's R8). The URL hook reads `useSearchParams`, which
 * needs a Suspense boundary in Next 14.
 */

import { Suspense } from 'react';

import { AiCostView } from './components/AiCostView';

export default function AiCostPage() {
  return (
    <Suspense fallback={null}>
      <AiCostView />
    </Suspense>
  );
}
