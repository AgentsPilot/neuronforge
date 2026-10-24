'use client';

/**
 * The checkout / upgrade status lines (B5 / B6): "You're on {plan}",
 * "Upgrading…", "Payment processing", "This is taking longer than usual".
 *
 * Moved verbatim out of `PlanSection.tsx` (upgrade modal UM-2, workplan §5.3,
 * SA Q-4): the drawer renders it from its own `usePlanFlow` instance, and the
 * plan comparison window opened from anywhere renders it from ITS instance after
 * an upgrade. One rendering of each line, as `usePlanFlow` holds one copy of
 * each predicate (C-2). Test ids, keys and conditions are unchanged; every
 * value here is the hook's, never re-derived.
 */

import { Loader2 } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';

import { SETTINGS_PLAN_PATH } from './planPurchaseCopy';
import { fill } from './planText';
import type { PlanFlow } from './usePlanFlow';

export type PlanFlowStatusValues = Pick<
  PlanFlow,
  'marker' | 'succeeded' | 'upgradeSucceeded' | 'upgradeProcessing' | 'checkoutProcessing' | 'processing' | 'exhausted'
>;

export function PlanFlowStatus({ flow, planName }: { flow: PlanFlowStatusValues; planName: string | null }) {
  const { t } = useLanguage();
  const { marker, succeeded, upgradeSucceeded, upgradeProcessing, checkoutProcessing, processing, exhausted } = flow;

  return (
    <>
      {/* After checkout (M-6): the server's answer, or "processing" until it comes. */}
      {marker !== null && succeeded && planName && (
        <p role="status" className="text-sm text-[var(--v2-text-primary)]" data-testid="plan-purchase-done">
          {fill(t('plan.purchase.done'), { plan: planName })}
        </p>
      )}
      {upgradeSucceeded && planName && (
        <p role="status" className="text-sm text-[var(--v2-text-primary)]" data-testid="plan-upgrade-done">
          {fill(t('plan.upgrade.done'), { plan: planName })}
        </p>
      )}
      {upgradeProcessing && !checkoutProcessing && !exhausted && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--v2-text-muted)]" data-testid="plan-upgrade-upgrading">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('plan.upgrade.upgrading')}</span>
        </p>
      )}
      {checkoutProcessing && !exhausted && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--v2-text-muted)]" data-testid="plan-purchase-processing">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('plan.purchase.processing')}</span>
        </p>
      )}
      {processing && exhausted && (
        <div className="space-y-1" data-testid="plan-purchase-slow">
          <p className="text-sm text-[var(--v2-text-muted)]">{t('plan.purchase.slow')}</p>
          {/* Without the marker: Choose shows again if nothing is live, so a stale
              or bookmarked marker cannot trap the owner here. */}
          <a href={SETTINGS_PLAN_PATH} className="text-sm text-[var(--v2-primary)] underline" data-testid="plan-purchase-check-again">
            {t('plan.purchase.check_again')}
          </a>
        </div>
      )}
    </>
  );
}
