'use client';

/**
 * `/admin/ai-cost` — AI cost (Money MK-3, KPI restructure review §4; SA-6).
 *
 * Merges Charge checks (`/admin/finance/charges`, Money M-5) and, in MK-3b,
 * AI calls & usage into one page. MK-3a builds the Summary & checks content:
 * the header, the fixed Charged vs Recorded legend, then the report as it was
 * on Charge checks (`CostsTab`): the strip A-K1 to A-K5, the bar, the charged
 * breakdown, the period check, the fallback list, the recorded AI cost block
 * (C-7) and the Leak check with its block KPI. The Calls tab, and with it the
 * tab list, arrive in MK-3b; until then `tab=checks` (the address the
 * redirects send) is the only content, and the hook keeps the key it does not
 * own, untouched.
 *
 * A CLIENT component with no data of its own, like Charge checks was: the
 * report and Leak check reads go to admin routes that run `requireAdmin`
 * first, and the page sits under `app/admin/layout.tsx`, whose
 * `requireAdminPage` runs before it renders (the admin authz surface guard's
 * R8). The report's filter hook reads `useSearchParams`, which needs a
 * Suspense boundary in Next 14.
 */

import { Suspense } from 'react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { CostsTab } from '@/app/admin/business-os-llm/components/costs/CostsTab';

import { AI_COST_LEGEND, AI_COST_PURPOSE, AI_COST_TITLE } from './aiCostCopy';

export default function AiCostPage() {
  return (
    <Suspense fallback={null}>
      <div className="space-y-6">
        <AdminPageHeader title={AI_COST_TITLE} purpose={AI_COST_PURPOSE} badge={{ label: 'Read-only' }} />
        {/* §4: one vocabulary, fixed at the top of the page, on every tab. */}
        <dl data-testid="ai-cost-legend" className="space-y-1 rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3 text-xs text-slate-300">
          <div>
            <dt className="inline font-semibold text-white">{AI_COST_LEGEND.charged.term}</dt>{' '}
            <dd className="inline">{AI_COST_LEGEND.charged.text}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-white">{AI_COST_LEGEND.recorded.term}</dt>{' '}
            <dd className="inline">{AI_COST_LEGEND.recorded.text}</dd>
          </div>
        </dl>
        <CostsTab />
      </div>
    </Suspense>
  );
}
