'use client';

/**
 * Section 2 block B, "Client payments (the businesses' money, not ours)", the
 * last block of the Overview since Money MK-1 (formerly "Takings through the
 * platform"; finance & business health
 * slice 2a, S2-FR-1 to S2-FR-14). What clients paid the businesses through
 * AgentPilot: NOT our revenue (BD-1), so it carries a neutral "Not our
 * revenue" chip and never feeds a tile.
 *
 * MONEY: every figure arrives per currency, already divided by 100 once from
 * an exact integer sum (SA-W26). This component never adds or subtracts money
 * (SA-WR-18; net comes from the server) and never shows a total across
 * currencies (BD-12). Every money cell names its currency (`formatMoney`).
 *
 * HONESTY: "At least" when a read stopped at its limit; net "Unknown" when it
 * cannot be exact; a missing value says "Unknown" or "—", never blank. No
 * test-mode wording anywhere (BD-13). Shared layout parts through the alias
 * (S2-FR-13); every string from `financeCopy.ts` (S2-FR-14).
 */

import type { FinanceTakingsFigures, FinanceTakingsLine, FinanceTakingsRow, FinanceTakingsSection } from '@/lib/business-os/finance/financeTypes';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_COUNT_LINE,
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
  BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION,
  BLOCK_KPI_CLIENT_PAYMENTS_LABEL,
  NAME_MISSING,
  NAME_PLATFORM,
  NAME_UNAVAILABLE,
  NAME_UNKNOWN_BUSINESS,
  PROCESSOR_LABELS,
  PROCESSOR_NOT_RECORDED,
  TAKINGS_AMOUNT_REFUNDED,
  TAKINGS_BUSINESS,
  TAKINGS_BUSINESSES_COLUMN,
  TAKINGS_BY_BUSINESS,
  TAKINGS_CANNOT,
  TAKINGS_CANNOT_TITLE,
  TAKINGS_CHIP,
  TAKINGS_CURRENCY,
  TAKINGS_EXCLUDES_UNREADABLE,
  TAKINGS_FEE_CURRENCY,
  TAKINGS_FEE_NOTE,
  TAKINGS_FEES,
  TAKINGS_FEES_COLUMN,
  TAKINGS_FEES_RECORDED_ON,
  TAKINGS_GROSS,
  TAKINGS_NET,
  TAKINGS_NET_CUT_OFF,
  TAKINGS_NET_SHORT,
  TAKINGS_NO_FEES,
  TAKINGS_NO_PAYMENTS,
  TAKINGS_NO_REFUNDS,
  TAKINGS_NOTICE_PAYMENTS_CUT,
  TAKINGS_NOTICE_REFUNDS_CUT,
  TAKINGS_NOTICE_UNREADABLE,
  TAKINGS_NOTICE_UNREADABLE_FEES,
  TAKINGS_OTHER_STATUS,
  TAKINGS_PAYMENTS,
  TAKINGS_PER_CURRENCY,
  TAKINGS_PROCESSOR,
  TAKINGS_PROCESSORS,
  TAKINGS_REFUND_NOTE,
  TAKINGS_REFUNDED,
  TAKINGS_REFUNDS,
  TAKINGS_REFUNDS_COUNT,
  TAKINGS_REFUNDS_FAILED,
  TAKINGS_REFUNDS_NOT_COMPLETED,
  TAKINGS_SHOWING,
  TAKINGS_SUBTITLE,
  TAKINGS_TITLE,
  TAKINGS_UNKNOWN,
  TAKINGS_UNKNOWN_CURRENCY,
} from '../financeCopy';
import { atLeast, formatMoney } from '../financeFormat';
import { BlockKpi } from './BlockKpi';
import { FinanceSection } from './FinanceSection';

const SUBHEAD = 'text-sm font-medium text-slate-200';
const NOTE = 'text-[11px] text-slate-400';

function processorLabel(processorType: string | null): string {
  if (processorType === null) return PROCESSOR_NOT_RECORDED;
  return PROCESSOR_LABELS[processorType] ?? processorType;
}

function businessName(row: FinanceTakingsRow): string {
  switch (row.nameStatus) {
    case 'found':
      return row.name ?? NAME_MISSING;
    case 'platform':
      return NAME_PLATFORM;
    case 'unknown_business':
      return NAME_UNKNOWN_BUSINESS;
    case 'unavailable':
      return `${NAME_UNAVAILABLE} (${(row.accountId ?? '').slice(0, 8)}…)`;
    default:
      return `${NAME_MISSING} (${(row.accountId ?? '').slice(0, 8)}…)`;
  }
}

export function TakingsSection({
  takings,
  windowLabel,
  onRetry,
}: {
  takings: FinanceTakingsSection;
  windowLabel: string;
  onRetry: () => void;
}) {
  return (
    <FinanceSection
      id="takings"
      title={TAKINGS_TITLE}
      subtitle={TAKINGS_SUBTITLE(windowLabel)}
      status={takings.status}
      onRetry={onRetry}
      badge={{ tone: 'neutral', label: TAKINGS_CHIP }}
    >
      {takings.figures && <TakingsBody f={takings.figures} />}
    </FinanceSection>
  );
}

function TakingsBody({ f }: { f: FinanceTakingsFigures }) {
  const refundsExact = f.refundsState === 'ok';
  // A net is null because a read stopped at its limit (the ceiling: "a read was cut off"), or because the
  // refunds read FAILED or an amount on its line was unreadable (plain "Unknown", SA-1).
  const readCutOff = !f.paymentsExact || f.refundsState === 'partial';
  // Gross is a lower bound when the payments read was cut off OR a payment amount on that line or row
  // could not be read (QA-2): never a plain figure that silently leaves an amount out.
  const gross = (amount: number, currency: string | null, unreadablePayments: number) =>
    atLeast(formatMoney(amount, currency), f.paymentsExact && unreadablePayments === 0);
  const refunded = (amount: number | null, currency: string | null) =>
    amount === null ? TAKINGS_UNKNOWN : atLeast(formatMoney(amount, currency), refundsExact);
  const net = (amount: number | null, currency: string | null) =>
    amount !== null ? formatMoney(amount, currency) : readCutOff ? TAKINGS_NET_CUT_OFF : TAKINGS_UNKNOWN;
  const count = (value: number) => atLeast(formatCount(value), f.paymentsExact);
  const currencyLabel = (currency: string | null) => currency ?? TAKINGS_UNKNOWN_CURRENCY;

  return (
    <div className="space-y-4" data-testid="takings-body">
      {/* Money MK-1: the block KPI is the headline (§3.2), leading (§5), with its icon (LL-1). */}
      <BlockKpi
        label={BLOCK_KPI_CLIENT_PAYMENTS_LABEL}
        value={count(f.businesses)}
        indicator={{ kind: 'leading', definition: BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION }}
        testId="takings-businesses"
      />
      {/* Each partial cause says so on its own (L-5, S2-FR-8). */}
      {!f.paymentsExact && <AdminNotice testId="takings-notice-payments-cut">{TAKINGS_NOTICE_PAYMENTS_CUT}</AdminNotice>}
      {f.refundsState === 'partial' && <AdminNotice testId="takings-notice-refunds-cut">{TAKINGS_NOTICE_REFUNDS_CUT}</AdminNotice>}
      {f.refundsState === 'unknown' && <AdminNotice testId="takings-notice-refunds-failed">{TAKINGS_REFUNDS_FAILED}</AdminNotice>}
      {f.unreadableAmounts > 0 && (
        <AdminNotice testId="takings-notice-unreadable">{TAKINGS_NOTICE_UNREADABLE(f.unreadableAmounts)}</AdminNotice>
      )}
      {f.unreadableFees > 0 && (
        <AdminNotice testId="takings-notice-unreadable-fees">{TAKINGS_NOTICE_UNREADABLE_FEES(f.unreadableFees)}</AdminNotice>
      )}

      {/* ── Takings per currency ── */}
      {f.countedPayments === 0 && <AdminEmpty testId="takings-no-payments" message={TAKINGS_NO_PAYMENTS} />}
      {f.lines.length > 0 && (
        <div className={ADMIN_TABLE_WRAP}>
          <table className={ADMIN_TABLE} aria-label={TAKINGS_PER_CURRENCY} data-testid="takings-lines">
            <thead className={ADMIN_THEAD}>
              <tr>
                <th scope="col" className={ADMIN_TH}>{TAKINGS_CURRENCY}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_PAYMENTS}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_GROSS}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_REFUNDED}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_NET}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_BUSINESSES_COLUMN}</th>
              </tr>
            </thead>
            <tbody className={ADMIN_TBODY}>
              {f.lines.map((line: FinanceTakingsLine) => (
                <tr key={line.currency ?? 'unknown'} data-testid={`takings-line-${line.currency ?? 'unknown'}`}>
                  <th scope="row" className={`${ADMIN_TD} font-normal`}>
                    {currencyLabel(line.currency)}
                    {line.unreadable > 0 && <span className={`ml-1 ${NOTE}`}>({TAKINGS_EXCLUDES_UNREADABLE(line.unreadable)})</span>}
                  </th>
                  <td className={ADMIN_TD_NUM}>{count(line.payments)}</td>
                  <td className={ADMIN_TD_NUM} data-money="gross">{gross(line.gross, line.currency, line.unreadablePayments)}</td>
                  <td className={ADMIN_TD_NUM} data-money="refunded">{refunded(line.refunded, line.currency)}</td>
                  <td className={ADMIN_TD_NUM} data-money="net">{net(line.net, line.currency)}</td>
                  <td className={ADMIN_TD_NUM}>{count(line.businesses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {f.otherStatusPayments > 0 && (
        <p className={NOTE} data-testid="takings-other-status">{TAKINGS_OTHER_STATUS(f.otherStatusPayments)}</p>
      )}

      {/* ── Refunds ── */}
      <div className="space-y-2" data-testid="takings-refunds">
        <h3 className={SUBHEAD}>{TAKINGS_REFUNDS}</h3>
        {f.refundLines === null ? (
          <p className="text-sm text-slate-300">{TAKINGS_UNKNOWN}</p>
        ) : f.refundLines.length === 0 ? (
          <AdminEmpty testId="takings-no-refunds" message={TAKINGS_NO_REFUNDS} />
        ) : (
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} aria-label={TAKINGS_REFUNDS}>
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{TAKINGS_CURRENCY}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_REFUNDS_COUNT}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_AMOUNT_REFUNDED}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {f.refundLines.map((line) => (
                  <tr key={line.currency ?? 'unknown'}>
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>{currencyLabel(line.currency)}</th>
                    <td className={ADMIN_TD_NUM}>{atLeast(formatCount(line.refunds), refundsExact)}</td>
                    <td className={ADMIN_TD_NUM} data-money="refunded">{refunded(line.refunded, line.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {f.refundsNotCompleted !== null && f.refundsNotCompleted > 0 && (
          <p className={NOTE}>{TAKINGS_REFUNDS_NOT_COMPLETED(f.refundsNotCompleted)}</p>
        )}
        <p className={NOTE}>{TAKINGS_REFUND_NOTE}</p>
      </div>

      {/* ── Recorded processor fees, by FEE currency ── */}
      <div className="space-y-2" data-testid="takings-fees">
        <h3 className={SUBHEAD}>{TAKINGS_FEES}</h3>
        {f.feeLines.length === 0 ? (
          <p className="text-sm text-slate-300">{TAKINGS_NO_FEES}</p>
        ) : (
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} aria-label={TAKINGS_FEES}>
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{TAKINGS_FEE_CURRENCY}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_FEES_COLUMN}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_PAYMENTS}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {f.feeLines.map((line) => (
                  <tr key={line.currency ?? 'unknown'} data-testid={`takings-fee-${line.currency ?? 'unknown'}`}>
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>{currencyLabel(line.currency)}</th>
                    <td className={ADMIN_TD_NUM} data-money="fees">{atLeast(formatMoney(line.fees, line.currency), f.paymentsExact && f.unreadableFees === 0)}</td>
                    <td className={ADMIN_TD_NUM}>{count(line.payments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400" data-testid="takings-fees-recorded">
          {atLeast(TAKINGS_FEES_RECORDED_ON(f.feesRecordedOn, f.countedPayments), f.paymentsExact)}
        </p>
        <p className={NOTE}>{TAKINGS_FEE_NOTE}</p>
      </div>

      {/* ── Payments by processor: counts only ── */}
      {f.processors.length > 0 && (
        <div className="space-y-2" data-testid="takings-processors">
          <h3 className={SUBHEAD}>{TAKINGS_PROCESSORS}</h3>
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} aria-label={TAKINGS_PROCESSORS}>
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{TAKINGS_PROCESSOR}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_PAYMENTS}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {f.processors.map((p) => (
                  <tr key={p.processorType ?? 'not-recorded'}>
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>{processorLabel(p.processorType)}</th>
                    <td className={ADMIN_TD_NUM}>{count(p.payments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Per business and currency ── */}
      {f.rows.length > 0 && (
        <div className="space-y-2" data-testid="takings-by-business">
          <h3 className={SUBHEAD}>{TAKINGS_BY_BUSINESS}</h3>
          {f.rows.length < f.rowsTotal && (
            <p className={ADMIN_COUNT_LINE} data-testid="takings-showing">{TAKINGS_SHOWING(f.rows.length, f.rowsTotal)}</p>
          )}
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} aria-label={TAKINGS_BY_BUSINESS} data-testid="takings-table">
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{TAKINGS_BUSINESS}</th>
                  <th scope="col" className={ADMIN_TH}>{TAKINGS_CURRENCY}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_PAYMENTS}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_GROSS}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_REFUNDED}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{TAKINGS_NET_SHORT}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {f.rows.map((row) => (
                  <tr key={`${row.accountId ?? 'unknown'}:${row.currency ?? 'unknown'}`} data-testid={`takings-row-${row.accountId ?? 'unknown'}-${row.currency ?? 'unknown'}`}>
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>{businessName(row)}</th>
                    <td className={ADMIN_TD}>{currencyLabel(row.currency)}</td>
                    <td className={ADMIN_TD_NUM}>{count(row.payments)}</td>
                    <td className={ADMIN_TD_NUM} data-money="gross">{gross(row.gross, row.currency, row.unreadablePayments)}</td>
                    <td className={ADMIN_TD_NUM} data-money="refunded">{refunded(row.refunded, row.currency)}</td>
                    <td className={ADMIN_TD_NUM} data-money="net">{net(row.net, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── What this block cannot show (S2-FR-10) ── */}
      <div data-testid="takings-cannot">
        <p className="text-xs text-slate-400">{TAKINGS_CANNOT_TITLE}</p>
        <ul className={`list-disc pl-5 ${NOTE}`}>
          {TAKINGS_CANNOT.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
