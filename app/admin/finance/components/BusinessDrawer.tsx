'use client';

/**
 * The Finance business drawer (Money MK-8; KPI restructure review §3 drawer
 * column, Q-7 "a side drawer for a quick look from any list, with 'Open full
 * view' for today's full page"). READ-ONLY (FIN NG-1, §8): no action button;
 * actions stay in Businesses (BD-23).
 *
 * ONE PROVIDER, ONE DRAWER: `BusinessDrawerProvider` holds the drawer and
 * gives any row an `openBusiness(target, opener)` through context. A table
 * renders its opener only when the provider is present
 * (`useBusinessQuickLook()` is null otherwise), so a table rendered on its own
 * is unchanged.
 *
 * ITS OWN READ, ONLY WHEN OPEN: `useDrawerResource` (SA-5) with
 * `readBusinessDrawer`, which reads the finance page's own route with this
 * business picked, in the page's window: today's account summary payload, no
 * new route and no new payload key (AC-145). The page still sends one request
 * on load (AC-173).
 *
 * Contents (§3): the account header and summary (what it paid us, AI margin,
 * charged and recorded AI cost, credit position: the picked view's own
 * components, so the figures cannot differ), its client payments in ITS OWN
 * currency sign (USD-4, Q-10), its overdue items, and, opened from a
 * subscription row, the read-only Plan billing panel (P-8a.2), itself read
 * on demand. "Open full view" goes to today's picked-business page.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { AdminDrawer, DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { formatShortId } from '@/app/admin/components/layout/adminTable';
import { useDrawerResource } from '@/app/admin/components/layout/useDrawerResource';
import type { FinancePayload } from '@/lib/business-os/finance/financeTypes';
import { PlanBillingBlock } from '@/app/admin/users/components/PlanBillingBlock';

import { businessDrawerKey, readBusinessDrawer, type DrawerWindow } from '../drawerReads';
import type { AccountName } from '../financeAccount';
import { BUSINESS_DRAWER } from '../financeCopy';
import { atLeast, formatCount, formatOwnCurrency } from '../financeFormat';
import { accountViewHref } from '../financeLinks';
import { AccountHeader } from './AccountHeader';
import { AccountSummary } from './AccountSummary';

/** What a row hands the drawer: the business, its name as the row shows it, and whether to show plan billing. */
export interface BusinessDrawerTarget {
  accountId: string;
  name: AccountName;
  /** Opened from a subscription row: show the read-only Plan billing panel too (§3). */
  withBilling?: boolean;
}

type OpenBusiness = (target: BusinessDrawerTarget, opener: HTMLElement) => void;

const BusinessDrawerContext = createContext<OpenBusiness | null>(null);

/** The opener for a row, or null when no drawer is mounted (the table then renders as before). */
export function useBusinessQuickLook(): OpenBusiness | null {
  return useContext(BusinessDrawerContext);
}

/**
 * SA-CR-MK8 CR-2: a row's quick look, inside the row's business cell (no new
 * column, so each table's columns are unchanged; the icon adds no text). Only
 * for a real business: never the platform account, a deleted account or a
 * business that could not be identified, and only when the drawer is mounted.
 */
export function BusinessQuickLook({
  accountId,
  name,
  nameStatus,
  label,
  testId,
}: {
  accountId: string | null;
  name: string | null;
  nameStatus: string;
  /** The row's business text, for the opener's accessible name. */
  label: string;
  testId: string;
}) {
  const openBusiness = useBusinessQuickLook();
  if (!openBusiness || accountId === null || nameStatus === 'platform' || nameStatus === 'unknown_business') return null;
  return (
    <span className="ml-2 inline-block align-middle">
      <OpenRowButton
        label={BUSINESS_DRAWER.quickLook(label)}
        onOpen={(button) => openBusiness({ accountId, name: { name: nameStatus === 'found' ? name : null, platform: false } }, button)}
        testId={testId}
      />
    </span>
  );
}

function titleOf(target: BusinessDrawerTarget): string {
  return target.name.name ?? `${BUSINESS_DRAWER.titleFallback} ${formatShortId(target.accountId)}`;
}

/** Client payments, in the business's own currency sign (USD-4), and its overdue items (counts). */
function ClientPaymentsPart({ data }: { data: FinancePayload }) {
  const f = data.takings.figures;
  const invoices = data.paymentProblems?.overdueInvoices;
  const instalments = data.paymentProblems?.overdueInstalments;
  const dueCount = (part: typeof invoices) =>
    !part || part.status === 'unknown' || !part.figures ? BUSINESS_DRAWER.unknown : atLeast(formatCount(part.figures.total), part.figures.exact);
  return (
    <>
      <DrawerSection title={BUSINESS_DRAWER.clientPayments} testId="business-drawer-client-payments">
        <p className="text-xs text-slate-400">{BUSINESS_DRAWER.clientPaymentsNote}</p>
        {data.takings.status === 'unknown' || !f ? (
          <p className="text-sm text-slate-300">{BUSINESS_DRAWER.clientPaymentsUnknown}</p>
        ) : f.lines.length === 0 ? (
          <p className="text-sm text-slate-300" data-testid="business-drawer-client-payments-none">
            {BUSINESS_DRAWER.clientPaymentsNone}
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-200">
            {f.lines.map((line) => (
              <li key={line.currency ?? 'unknown'} data-testid={`business-drawer-client-line-${line.currency ?? 'unknown'}`}>
                {BUSINESS_DRAWER.clientPaymentsLine(
                  atLeast(formatCount(line.payments), f.paymentsExact),
                  atLeast(formatOwnCurrency(line.gross, line.currency), f.paymentsExact && line.unreadablePayments === 0),
                  line.net === null ? BUSINESS_DRAWER.unknown : formatOwnCurrency(line.net, line.currency)
                )}
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>
      <DrawerSection title={BUSINESS_DRAWER.overdue} testId="business-drawer-overdue">
        <DrawerFields>
          <DrawerField label={BUSINESS_DRAWER.overdueInvoices} testId="business-drawer-overdue-invoices">
            {dueCount(invoices)}
          </DrawerField>
          <DrawerField label={BUSINESS_DRAWER.overdueInstalments} testId="business-drawer-overdue-instalments">
            {dueCount(instalments)}
          </DrawerField>
        </DrawerFields>
      </DrawerSection>
    </>
  );
}

function BusinessDrawerBody({ target, data }: { target: BusinessDrawerTarget; data: FinancePayload }) {
  return (
    <div className="space-y-5" data-testid="business-drawer-body">
      <AccountHeader accountId={target.accountId} name={target.name} accounts={data.accounts} />
      <AccountSummary
        accountId={target.accountId}
        window={data.window}
        aiCost={data.aiCost}
        revenue={data.revenue}
        credits={data.credits}
        accounts={data.accounts}
        accountMargin={data.accountMargin ?? null}
      />
      <ClientPaymentsPart data={data} />
      {target.withBilling && <PlanBillingBlock accountId={target.accountId} />}
      <p>
        <a
          href={accountViewHref(target.accountId, data.window)}
          data-testid="business-drawer-open-full"
          className="text-sm text-purple-300 underline hover:text-purple-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
        >
          {BUSINESS_DRAWER.openFull}
        </a>
      </p>
    </div>
  );
}

export function BusinessDrawerProvider({ window, children }: { window: DrawerWindow | null; children: ReactNode }) {
  const [target, setTarget] = useState<BusinessDrawerTarget | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const key = target !== null && window !== null ? businessDrawerKey(target.accountId, window) : null;
  const state = useDrawerResource(key, readBusinessDrawer);

  const open = useCallback<OpenBusiness>((next, opener) => {
    openerRef.current = opener;
    setTarget(next);
  }, []);
  const value = useMemo(() => open, [open]);

  return (
    <BusinessDrawerContext.Provider value={window === null ? null : value}>
      {children}
      <AdminDrawer
        open={target !== null}
        onClose={() => setTarget(null)}
        onReturnFocus={() => openerRef.current?.focus()}
        title={target ? titleOf(target) : BUSINESS_DRAWER.titleFallback}
        testId="business-drawer"
      >
        {target !== null && state.kind === 'loading' && <AdminLoading what={BUSINESS_DRAWER.what} />}
        {target !== null && state.kind === 'error' && <AdminError message={state.message} testId="business-drawer-error" />}
        {target !== null && state.kind === 'ready' && <BusinessDrawerBody target={target} data={state.data} />}
      </AdminDrawer>
    </BusinessDrawerContext.Provider>
  );
}
