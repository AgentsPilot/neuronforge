'use client';

/**
 * "Our revenue" (S1-FR-25 to S1-FR-27; slice 4a, S4-FR-1 to S4-FR-13; slice
 * 5a, M2-FR-1 to M2-FR-13): a section with its own status (SA-W52). Our own
 * money: the plan payments received in the window (`PlanRevenuePart`, slice
 * 5a), then the credit boosts paid in the window, per currency, by package, and
 * from deleted accounts. The two parts are never one figure here (M2-FR-1):
 * their per-currency total is K-5's and the account summary's.
 *
 * MONEY: every figure arrives per currency, already divided by 100 once from
 * an exact integer sum. This component never adds or subtracts money (SA-WR-18;
 * net comes from the server) and never shows a total across currencies
 * (BD-12). Every money cell names its currency (`formatMoney`).
 *
 * HONESTY: "At least" when the read stopped at its limit or an amount was
 * left out; net "Unknown" when it cannot be exact, never a lower bound.
 *
 * SLICE 4b.2 (BD-17): refunded and lost are the amounts RECORDED in the
 * window (from the reversal events), "Unknown" when that read failed, with no
 * purchase-month fallback. Held in open disputes is a NOW figure, its own
 * small table beside the lines (E-104), never in a net. A negative net shows
 * its minus sign (`formatMoney`). No mode wording anywhere (BD-14). Shared layout parts
 * through the alias (S4-FR-12); every string from `financeCopy.ts`.
 */

import type { FinanceBoostEventsNote, FinanceBoostHeldNowLine, FinanceBoostLine, FinanceBoostNotes, FinanceBoostPackageRow, FinanceBoostRevenue, FinanceRevenueSection } from '@/lib/business-os/finance/financeTypes';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import {
  REVENUE_BOOSTS,
  REVENUE_BOOSTS_FAILED,
  REVENUE_BY_PACKAGE,
  REVENUE_CANNOT,
  REVENUE_CANNOT_TITLE,
  REVENUE_CREDITS_SOLD,
  REVENUE_CURRENCY,
  REVENUE_CUT_OFF,
  REVENUE_DELETED_NONE,
  REVENUE_EXCLUDES_UNREADABLE,
  REVENUE_GROSS,
  REVENUE_EVENTS_FAILED,
  REVENUE_EVENTS_NOT_AVAILABLE,
  REVENUE_EVENTS_OVER_TOTAL,
  REVENUE_EVENTS_UNREADABLE,
  REVENUE_HELD,
  REVENUE_HELD_DISPUTES,
  REVENUE_HELD_FAILED,
  REVENUE_HELD_NONE,
  REVENUE_LOST,
  REVENUE_NET,
  REVENUE_NET_SHORT,
  REVENUE_NO_BOOSTS,
  REVENUE_NOTICE_CUT,
  REVENUE_NOTICE_UNREADABLE,
  REVENUE_NOTICE_UNREADABLE_CREDITS,
  REVENUE_OTHER_STATUS,
  REVENUE_PACKAGE,
  REVENUE_BOOSTS_HEADING,
  REVENUE_PACKAGE_NOT_RECORDED,
  REVENUE_PLANS_HEADING,
  REVENUE_PURCHASES,
  REVENUE_REFUND_TIMING_NOTE,
  REVENUE_REFUNDED,
  REVENUE_SUBTITLE_ALL,
  REVENUE_SUBTITLE_ONE,
  REVENUE_TAX,
  REVENUE_TITLE,
  REVENUE_UNKNOWN,
  revenueDeletedLine,
  revenuePackageLabel,
  TAKINGS_UNKNOWN_CURRENCY,
} from '../financeCopy';
import { atLeast, formatCredits, formatMoney } from '../financeFormat';
import { FinanceSection } from './FinanceSection';
import { PlanRevenuePart } from './PlanRevenuePart';

const SUBHEAD = 'text-sm font-medium text-slate-200';
const NOTE = 'text-[11px] text-slate-400';

const currencyLabel = (currency: string | null) => currency ?? TAKINGS_UNKNOWN_CURRENCY;

/** Money that cannot be exact: "Unknown (a read was cut off)" at the ceiling, plain "Unknown" otherwise. */
const unknownText = (exact: boolean): string => (exact ? REVENUE_UNKNOWN : REVENUE_CUT_OFF);

export function RevenuePanel({
  revenue,
  windowLabel,
  onRetry,
}: {
  revenue: FinanceRevenueSection;
  windowLabel: string;
  onRetry: () => void;
}) {
  const scope = revenue.boosts.scope;
  return (
    <FinanceSection
      id="revenue"
      title={REVENUE_TITLE}
      subtitle={scope === 'one' ? REVENUE_SUBTITLE_ONE(windowLabel) : REVENUE_SUBTITLE_ALL(windowLabel)}
      status={revenue.status}
      onRetry={onRetry}
    >
      <div className="space-y-4" data-testid="revenue-body" data-state={revenue.state}>
        <div className="space-y-2" data-testid="revenue-plans-part">
          <h3 className={SUBHEAD}>{REVENUE_PLANS_HEADING}</h3>
          <PlanRevenuePart plans={revenue.plans} />
        </div>
        <div className="space-y-2" data-testid="revenue-boosts-part">
          <h3 className={SUBHEAD}>{REVENUE_BOOSTS_HEADING}</h3>
          <BoostsPart boosts={revenue.boosts} />
        </div>
        <div data-testid="revenue-cannot">
          <p className={NOTE}>{REVENUE_CANNOT_TITLE}</p>
          <ul className={`list-disc pl-5 ${NOTE}`}>
            {REVENUE_CANNOT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </FinanceSection>
  );
}

function BoostsPart({ boosts }: { boosts: FinanceBoostRevenue }) {
  if (boosts.status === 'unknown' || !boosts.lines || !boosts.packages || !boosts.notes) {
    return (
      <p className="text-sm text-slate-300" data-testid="revenue-boosts-failed">
        {REVENUE_BOOSTS_FAILED}
      </p>
    );
  }
  const notes = boosts.notes;
  // Slice 4b.2: absent only in fixtures written before it (E-103); the builder always sets both.
  const events = boosts.events ?? null;
  const heldNow = boosts.heldNow;
  if (notes.empty) {
    return (
      <div className="space-y-2" data-testid="revenue-boosts">
        {!notes.exact && <AdminNotice testId="revenue-notice-cut">{REVENUE_NOTICE_CUT}</AdminNotice>}
        {events && <EventNotices events={events} />}
        <AdminEmpty testId="revenue-no-boosts" message={REVENUE_NO_BOOSTS} />
        {notes.otherStatusPurchases > 0 && (
          <p className={NOTE} data-testid="revenue-other-status">{REVENUE_OTHER_STATUS(notes.otherStatusPurchases)}</p>
        )}
        {heldNow !== undefined && <HeldNowTable heldNow={heldNow} />}
        {notes.refundOrDispute && (
          <p className={NOTE} data-testid="revenue-refund-note">{REVENUE_REFUND_TIMING_NOTE}</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="revenue-boosts">
      <BoostNotices notes={notes} lines={boosts.lines} />
      {events && <EventNotices events={events} />}
      <LinesTable lines={boosts.lines} exact={notes.exact} />
      {heldNow !== undefined && <HeldNowTable heldNow={heldNow} />}
      {notes.otherStatusPurchases > 0 && (
        <p className={NOTE} data-testid="revenue-other-status">{REVENUE_OTHER_STATUS(notes.otherStatusPurchases)}</p>
      )}
      {notes.refundOrDispute && (
        <p className={NOTE} data-testid="revenue-refund-note">{REVENUE_REFUND_TIMING_NOTE}</p>
      )}
      <PackagesTable packages={boosts.packages} exact={notes.exact} />
      {boosts.deletedAccounts !== null && (
        <div data-testid="revenue-deleted">
          {boosts.deletedAccounts.length === 0 ? (
            <p className={NOTE}>{REVENUE_DELETED_NONE}</p>
          ) : (
            boosts.deletedAccounts.map((line) => (
              <p key={line.currency ?? 'unknown'} className="text-sm text-slate-300" data-testid={`revenue-deleted-${line.currency ?? 'unknown'}`}>
                {revenueDeletedLine(
                  line.purchases,
                  line.net !== null ? formatMoney(line.net, line.currency) : unknownText(notes.exact)
                )}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BoostNotices({ notes, lines }: { notes: FinanceBoostNotes; lines: FinanceBoostLine[] }) {
  // A count of purchases, not money.
  const unreadableCredits = lines.reduce((count, line) => count + line.unreadableCredits, 0);
  return (
    <>
      {!notes.exact && <AdminNotice testId="revenue-notice-cut">{REVENUE_NOTICE_CUT}</AdminNotice>}
      {notes.unreadablePurchases > 0 && (
        <AdminNotice testId="revenue-notice-unreadable">{REVENUE_NOTICE_UNREADABLE(notes.unreadablePurchases)}</AdminNotice>
      )}
      {unreadableCredits > 0 && (
        <AdminNotice testId="revenue-notice-unreadable-credits">{REVENUE_NOTICE_UNREADABLE_CREDITS(unreadableCredits)}</AdminNotice>
      )}
    </>
  );
}

/** FR-4B-9 / FR-4B-16 / SA-Q74: how the refund and dispute dates were read. */
function EventNotices({ events }: { events: FinanceBoostEventsNote }) {
  return (
    <>
      {events.state === 'failed' && <AdminNotice testId="revenue-notice-events-failed">{REVENUE_EVENTS_FAILED}</AdminNotice>}
      {events.state === 'not_available' && (
        <AdminNotice testId="revenue-notice-events-not-available">{REVENUE_EVENTS_NOT_AVAILABLE}</AdminNotice>
      )}
      {events.unreadable > 0 && (
        <AdminNotice testId="revenue-notice-events-unreadable">{REVENUE_EVENTS_UNREADABLE(events.unreadable)}</AdminNotice>
      )}
      {events.overTotal > 0 && (
        <p className={NOTE} data-testid="revenue-events-over-total">{REVENUE_EVENTS_OVER_TOTAL(events.overTotal)}</p>
      )}
    </>
  );
}

/** FR-4B-4 / E-104: held in open disputes NOW, per currency; never taken off any month. */
function HeldNowTable({ heldNow }: { heldNow: FinanceBoostHeldNowLine[] | null }) {
  if (heldNow === null) {
    return <p className={NOTE} data-testid="revenue-held-now-failed">{REVENUE_HELD_FAILED}</p>;
  }
  if (heldNow.length === 0) {
    return <p className={NOTE} data-testid="revenue-held-now-none">{REVENUE_HELD_NONE}</p>;
  }
  return (
    <div className="space-y-2" data-testid="revenue-held-now">
      <p className={SUBHEAD}>{REVENUE_HELD}</p>
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label={REVENUE_HELD}>
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>{REVENUE_CURRENCY}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_HELD_DISPUTES}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_HELD}</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {heldNow.map((line) => (
              <tr key={line.currency ?? 'unknown'} data-testid={`revenue-held-now-${line.currency ?? 'unknown'}`}>
                <th scope="row" className={`${ADMIN_TD} font-normal`}>{currencyLabel(line.currency)}</th>
                <td className={ADMIN_TD_NUM}>{formatCount(line.disputes)}</td>
                <td className={ADMIN_TD_NUM} data-money="held">
                  {line.amount === null ? REVENUE_UNKNOWN : formatMoney(line.amount, line.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinesTable({ lines, exact }: { lines: FinanceBoostLine[]; exact: boolean }) {
  const exactMoney = (amount: number | null, currency: string | null) =>
    amount === null ? unknownText(exact) : formatMoney(amount, currency);
  return (
    <div className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} aria-label={REVENUE_BOOSTS} data-testid="revenue-lines">
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>{REVENUE_CURRENCY}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PURCHASES}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_GROSS}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_TAX}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_REFUNDED}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_LOST}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_NET}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_CREDITS_SOLD}</th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {lines.map((line) => {
            // A lower bound when the read was cut off, or a purchase on this line was left out.
            const moneyExact = exact && line.unreadable === 0;
            const lowerBound = (amount: number) => atLeast(formatMoney(amount, line.currency), moneyExact);
            // Slice 4b.2: refunded and lost are Unknown when the event read failed; "at least" when an event was left out.
            const eventsExact = exact && line.unreadableEvents === 0;
            const eventMoney = (amount: number | null) =>
              amount === null ? REVENUE_UNKNOWN : atLeast(formatMoney(amount, line.currency), eventsExact);
            return (
              <tr key={line.currency ?? 'unknown'} data-testid={`revenue-line-${line.currency ?? 'unknown'}`}>
                <th scope="row" className={`${ADMIN_TD} font-normal`}>
                  {currencyLabel(line.currency)}
                  {line.unreadable > 0 && <span className={`ml-1 ${NOTE}`}>({REVENUE_EXCLUDES_UNREADABLE(line.unreadable)})</span>}
                </th>
                <td className={ADMIN_TD_NUM}>{atLeast(formatCount(line.purchases), exact)}</td>
                <td className={ADMIN_TD_NUM} data-money="gross">{lowerBound(line.gross)}</td>
                <td className={ADMIN_TD_NUM} data-money="tax">{lowerBound(line.tax)}</td>
                <td className={ADMIN_TD_NUM} data-money="refunded">{eventMoney(line.refunded)}</td>
                <td className={ADMIN_TD_NUM} data-money="lost">{eventMoney(line.lost)}</td>
                <td className={ADMIN_TD_NUM} data-money="net">{exactMoney(line.net, line.currency)}</td>
                <td className={ADMIN_TD_NUM}>{atLeast(formatCredits(line.creditsSold), exact && line.unreadableCredits === 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PackagesTable({ packages, exact }: { packages: FinanceBoostPackageRow[]; exact: boolean }) {
  return (
    <div className="space-y-2">
      <p className={SUBHEAD}>{REVENUE_BY_PACKAGE}</p>
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label={REVENUE_BY_PACKAGE} data-testid="revenue-packages">
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>{REVENUE_CURRENCY}</th>
              <th scope="col" className={ADMIN_TH}>{REVENUE_PACKAGE}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PURCHASES}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_GROSS}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_REFUNDED}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_NET_SHORT}</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {packages.map((row) => {
              const label =
                row.packageId !== null && row.packageVersion !== null
                  ? revenuePackageLabel(row.packageId, row.packageVersion)
                  : REVENUE_PACKAGE_NOT_RECORDED;
              const moneyExact = exact && row.unreadable === 0;
              return (
                <tr key={`${row.currency ?? 'unknown'}:${label}`} data-testid={`revenue-package-${label}`}>
                  <td className={ADMIN_TD}>{currencyLabel(row.currency)}</td>
                  <th scope="row" className={`${ADMIN_TD} font-normal`}>{label}</th>
                  <td className={ADMIN_TD_NUM}>{atLeast(formatCount(row.purchases), exact)}</td>
                  <td className={ADMIN_TD_NUM} data-money="gross">{atLeast(formatMoney(row.gross, row.currency), moneyExact)}</td>
                  <td className={ADMIN_TD_NUM} data-money="refunded">
                    {row.refunded === null ? REVENUE_UNKNOWN : atLeast(formatMoney(row.refunded, row.currency), moneyExact)}
                  </td>
                  <td className={ADMIN_TD_NUM} data-money="net">
                    {row.net !== null ? formatMoney(row.net, row.currency) : unknownText(exact)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
