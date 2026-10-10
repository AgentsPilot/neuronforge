'use client';

/**
 * `/admin/finance` — Finance & business health (slice 1a).
 *
 * A CLIENT component with no data of its own: everything is fetched by the
 * view from the admin route, which runs `requireAdmin` first. The page sits
 * under `app/admin/layout.tsx`, whose `requireAdminPage` runs before it
 * renders (SEC-2). Client, not server-rendered, per the admin authz surface
 * guard's R8 (OI-21): no /admin render entry point may be server-rendered
 * unguarded (the audit trail page's shape).
 *
 * `useSearchParams` needs a Suspense boundary in Next 14 (L-4 condition 2).
 */

import { Suspense } from 'react';

import { FinanceView } from './components/FinanceView';

export default function AdminFinancePage() {
  return (
    <Suspense fallback={null}>
      <FinanceView />
    </Suspense>
  );
}
