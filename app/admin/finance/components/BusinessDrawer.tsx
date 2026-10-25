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

import { createContext, useCallback, useContext, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { AdminDrawer, DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { ADMIN_TD_OPEN, ADMIN_TH_OPEN, formatShortId } from '@/app/admin/components/layout/adminTable';
import { ROW_OPEN_TEST_ID, rowOpenTarget } from '@/app/admin/components/layout/rowOpenClick';
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

/** The page's one drawer: how to open it, and which account it shows now (the open-row highlight). */
interface BusinessDrawerState {
  open: OpenBusiness;
  openAccountId: string | null;
}

const BusinessDrawerContext = createContext<BusinessDrawerState | null>(null);

/** The opener for a row, or null when no drawer is mounted (the table then renders as before). */
export function useBusinessQuickLook(): OpenBusiness | null {
  return useContext(BusinessDrawerContext)?.open ?? null;
}

/** MK-10: the account the drawer shows now, or null (closed, or no drawer mounted). */
export function useOpenBusinessAccountId(): string | null {
  return useContext(BusinessDrawerContext)?.openAccountId ?? null;
}

/** The Businesses page's row classes (D-17): hover and pointer, and the open row highlighted. */
export function openableRowClass(isOpen: boolean): string {
  return `hover:bg-slate-700/30 transition-colors cursor-pointer ${isOpen ? 'bg-slate-700/20' : ''}`;
}

/** MK-10: the narrow Open column's header, exactly the Businesses page's (LF-8). */
export function BusinessOpenHeader() {
  return (
    <th scope="col" className={ADMIN_TH_OPEN}>
      <span className="sr-only">Details</span>
    </th>
  );
}

/**
 * Money MK-10 (user comment 2026-10-25; SA-Q-MK10-1, MK10-R1 to R3): a Finance
 * row opens like a Businesses row. The row's ONLY opener is the shared
 * `OpenRowButton` in the narrow last column, labelled "Open details for …" with
 * test id `row-open`, as on the Businesses page. A click anywhere else on the
 * row is a mouse extra through the shared `rowOpenTarget` (D-17): never on a
 * control or a link inside the row, never while selecting text, and always
 * through that row's button, so focus returns to it and the row click and the
 * button share ONE open (one request). The row gets no tabIndex, role or ARIA.
 *
 * Returns null when no drawer is mounted (a table rendered on its own is
 * unchanged). For a row that is not a business (`target` null: the platform
 * account, a deleted or unidentified account) the cell is empty and the row
 * has no click.
 */
export function useBusinessRowOpen(): {
  header: ReactNode;
  rowProps: (target: BusinessDrawerTarget | null) => { className?: string; onClick?: (event: MouseEvent<HTMLTableRowElement>) => void };
  cell: (target: BusinessDrawerTarget | null, label: string) => ReactNode;
} | null {
  const state = useContext(BusinessDrawerContext);
  if (!state) return null;
  return {
    header: <BusinessOpenHeader />,
    rowProps: (target) =>
      target === null
        ? {}
        : {
            className: openableRowClass(state.openAccountId === target.accountId),
            onClick: (event) => {
              const button = rowOpenTarget(event);
              if (button) state.open(target, button);
            },
          },
    cell: (target, label) => (
      <td className={ADMIN_TD_OPEN}>
        {target !== null && (
          <OpenRowButton label={BUSINESS_DRAWER.openDetails(label)} onOpen={(button) => state.open(target, button)} testId={ROW_OPEN_TEST_ID} />
        )}
      </td>
    ),
  };
}

/** The drawer target of a row, or null when the row is not a business (platform, deleted, unidentified). */
export function businessTargetOf(row: { accountId: string | null; name: string | null; nameStatus: string }): BusinessDrawerTarget | null {
  if (row.accountId === null || row.nameStatus === 'platform' || row.nameStatus === 'unknown_business') return null;
  return { accountId: row.accountId, name: { name: row.nameStatus === 'found' ? row.name : null, platform: false } };
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
  const value = useMemo(() => ({ open, openAccountId: target?.accountId ?? null }), [open, target]);

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
