'use client';

/**
 * `/admin/finance/charges` — Charge checks (Money M-5, finance health §11H.4
 * CC-1 to CC-5).
 *
 * The operator cost report and its Leak check, moved out of the Business OS AI
 * page's "Costs & credits" tab and mounted here AS THEY ARE: the components
 * stay in `app/admin/business-os-llm/components/costs/` (SA-Q59), so the
 * report and Leak check requests are unchanged (pinned by
 * `__tests__/chargeChecksRequest.pin.render.test.tsx`, AC-188). Old
 * `?tab=costs` links reach this page through the temporary redirect in
 * `next.config.js` (R-1).
 *
 * A CLIENT component with no data of its own, like `/admin/finance`: the
 * report and Leak check reads go to admin routes that run `requireAdmin` first,
 * and the page sits under `app/admin/layout.tsx`, whose `requireAdminPage`
 * runs before it renders. Client, per the admin authz surface guard's R8.
 *
 * No tab coordination (CR SA-Q-4): the report is the only filter owner on this
 * route, so `CostsTab`'s `active` keeps its default `true`. Its filter hook
 * reads `useSearchParams`, which needs a Suspense boundary in Next 14.
 */

import { Suspense } from 'react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { CostsTab } from '@/app/admin/business-os-llm/components/costs/CostsTab';
import { CHARGE_CHECKS_TITLE, COSTS_INTRO } from '@/app/admin/business-os-llm/costCopy';

export default function ChargeChecksPage() {
  return (
    <Suspense fallback={null}>
      <div className="space-y-6">
        <AdminPageHeader title={CHARGE_CHECKS_TITLE} purpose={COSTS_INTRO} badge={{ label: 'Read-only' }} />
        <CostsTab />
      </div>
    </Suspense>
  );
}
