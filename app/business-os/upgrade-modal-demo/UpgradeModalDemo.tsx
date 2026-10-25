'use client';

/**
 * The demo's buttons (TEST ONLY, upgrade modal UM-2, workplan §7). Rendered
 * only by `page.tsx`, after the server switch said yes.
 *
 * Every button calls the real `openUpgradeModal`. The `locked_feature` plan is
 * picked from the session account's own payload (`plans`), filled by ONE
 * `readMyPlan()` on mount, never on a timer (SA X-7): no plan id is typed here
 * (C-7). English-only test UI, as the harness convention is.
 *
 * TEST ONLY: remove with the demo, at the latest when UM-F2 wires a real caller.
 */

import { useEffect, useRef, useState } from 'react';

import { readMyPlan } from '@/components/business-os/settings/planDrawerReads';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { useUpgradeModal } from '@/components/business-os/settings/UpgradeModalProvider';
import { planFrom } from '@/components/business-os/settings/usePlanFlow';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BusinessOsUpgradeModalDemo' });

const BUTTON =
  'px-4 py-2 text-sm font-medium text-white bg-[var(--v2-primary-dark)] rounded-[var(--v2-radius-button)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)] disabled:opacity-50';

/** What the server offers this account, as plain facts from the payload. */
function offerSummary(plan: PlanPayload): string {
  const purchase = plan.purchase;
  if (!purchase) return 'No purchase view (purchase is null or missing).';
  const choose = purchase.offer.kind === 'choose' ? purchase.offer.tiers.join(', ') || 'none' : 'none';
  const upgrade = purchase.upgrade?.tiers.join(', ') || 'none';
  return `On: ${plan.name ?? 'no plan'} (${plan.kind ?? 'no kind'}). Offered to choose: ${choose}. Offered as an upgrade: ${upgrade}. Ends free access on purchase: ${purchase.endsFreeAccessOnPurchase ?? 'no'}.`;
}

export function UpgradeModalDemo() {
  const { openUpgradeModal } = useUpgradeModal();
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [lockedPlanId, setLockedPlanId] = useState('');

  // X-7: the demo's only read, once per mount (StrictMode's second run starts nothing).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void readMyPlan().then((answer) => {
      if (answer.kind === 'threw') {
        logger.warn({ err: answer.err }, 'Upgrade modal demo could not read the plan');
        setFailed(true);
        return;
      }
      const data = planFrom(answer.body);
      if (!data) {
        setFailed(true);
        return;
      }
      setPlan(data);
      setLockedPlanId(data.plans?.[data.plans.length - 1]?.planId ?? '');
    });
  }, []);

  const plans = plan?.plans ?? [];

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8" data-testid="upgrade-modal-demo">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--v2-text-primary)]">Upgrade modal demo (test only)</h1>
        <p className="text-sm text-[var(--v2-text-muted)]">
          Opens the real plan comparison window from a page other than Settings. Switched off unless
          BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED is set in .env.local.
        </p>
      </header>

      <p className="text-sm text-[var(--v2-text-secondary)]" data-testid="upgrade-modal-demo-offer">
        {failed ? 'Could not read this account’s plan.' : plan ? offerSummary(plan) : 'Reading this account’s plan…'}
      </p>

      <section className="space-y-3">
        <button type="button" className={BUTTON} data-testid="upgrade-modal-demo-settings" onClick={() => openUpgradeModal({ kind: 'settings' })}>
          Open: settings
        </button>
      </section>

      <section className="space-y-3">
        <button
          type="button"
          className={BUTTON}
          data-testid="upgrade-modal-demo-founding-partner"
          onClick={() => openUpgradeModal({ kind: 'founding_partner' })}
        >
          Open: founding_partner
        </button>
      </section>

      <section className="space-y-3">
        <label className="block text-sm text-[var(--v2-text-primary)]">
          Plan the locked action needs (from this account’s plans)
          <select
            className="mt-1 block w-full rounded-[var(--v2-radius-button)] border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)]"
            data-testid="upgrade-modal-demo-plan"
            value={lockedPlanId}
            onChange={(event) => setLockedPlanId(event.target.value)}
            disabled={plans.length === 0}
          >
            {plans.map((choice) => (
              <option key={choice.planId} value={choice.planId}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={BUTTON}
          data-testid="upgrade-modal-demo-locked"
          disabled={lockedPlanId === ''}
          onClick={() => openUpgradeModal({ kind: 'locked_feature', planId: lockedPlanId })}
        >
          Open: locked_feature
        </button>
      </section>
    </main>
  );
}
