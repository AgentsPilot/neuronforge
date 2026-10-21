'use client';

/**
 * The Finance plan drawer (Money MK-8; KPI restructure review §3 Plans &
 * subscriptions: "Plan drawer: one plan's accounts, statuses and MRR").
 * READ-ONLY (FIN NG-1, §8): no action button.
 *
 * Its own read, only when open (`useDrawerResource`, SA-5, with
 * `readPlanDrawer`): `GET /api/admin/business-os/billing/plans/[planId]`,
 * built by the Subscriptions list's own builder narrowed to this plan, so the
 * drawer and the list cannot disagree. MRR is printed by the list's own
 * formatters (`plansMoney.ts`): one line per currency, `$` for US dollars,
 * never a total across currencies. The accounts are the list's own table,
 * without openers inside the drawer.
 */

import { AdminDrawer, DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import { useDrawerResource } from '@/app/admin/components/layout/useDrawerResource';
import { SUBSCRIPTION_STATUSES, type SubscriptionPlanName, type SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';

import { readPlanDrawer } from '../drawerReads';
import { PLAN_DRAWER } from '../financeCopy';
import { STATUS_LABEL } from '../plansCopy';
import { money, mrrParts } from '../plansMoney';
import { SubscriptionsTable } from './SubscriptionsTable';

function PlanDrawerBody({ data }: { data: SubscriptionsPayload }) {
  const { totals } = data;
  const statuses = SUBSCRIPTION_STATUSES.filter((status) => totals.byStatus[status] > 0);
  return (
    <div className="space-y-5" data-testid="plan-drawer-body">
      <DrawerSection title={PLAN_DRAWER.mrr} testId="plan-drawer-mrr">
        {totals.mrr.length === 0 ? (
          <p className="text-sm text-slate-200">{PLAN_DRAWER.mrrNone}</p>
        ) : (
          totals.mrr.map((line) => (
            <p key={line.currency ?? 'unknown'} className="text-sm text-slate-200" data-testid="plan-drawer-mrr-line">
              <span className="font-semibold tabular-nums">{money(line.totalHundredths, line.currency)}</span>{' '}
              <span className="text-xs text-slate-400">{mrrParts(line)}</span>
            </p>
          ))
        )}
      </DrawerSection>
      <DrawerSection title={PLAN_DRAWER.statuses} testId="plan-drawer-statuses">
        <DrawerFields>
          {statuses.map((status) => (
            <DrawerField key={status} label={STATUS_LABEL[status]} testId={`plan-drawer-status-${status}`}>
              {formatCount(totals.byStatus[status])}
            </DrawerField>
          ))}
        </DrawerFields>
      </DrawerSection>
      <DrawerSection title={PLAN_DRAWER.accounts} testId="plan-drawer-accounts">
        {data.rows.length === 0 ? (
          <AdminEmpty testId="plan-drawer-empty" message={PLAN_DRAWER.empty} />
        ) : (
          <>
            {data.rows.length < data.matching && (
              <p className="text-xs text-slate-400" data-testid="plan-drawer-showing">
                {PLAN_DRAWER.showing(formatCount(data.rows.length), formatCount(data.matching))}
              </p>
            )}
            <SubscriptionsTable rows={data.rows} />
          </>
        )}
      </DrawerSection>
    </div>
  );
}

export function PlanDrawer({
  plan,
  onClose,
  onReturnFocus,
}: {
  /** The plan shown, or null when closed. */
  plan: SubscriptionPlanName | null;
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  const state = useDrawerResource(plan?.id ?? null, readPlanDrawer);
  return (
    <AdminDrawer open={plan !== null} onClose={onClose} onReturnFocus={onReturnFocus} title={plan?.name ?? ''} testId="plan-drawer">
      {plan !== null && state.kind === 'loading' && <AdminLoading what={PLAN_DRAWER.what} />}
      {plan !== null && state.kind === 'error' && <AdminError message={state.message} testId="plan-drawer-error" />}
      {plan !== null && state.kind === 'ready' && <PlanDrawerBody data={state.data} />}
    </AdminDrawer>
  );
}
