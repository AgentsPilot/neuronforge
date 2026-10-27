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
 *
 * Client payments in approximate dollars (FIN BD-56, slice 1b; requirement
 * ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md §5, §7.2; SA-RR-CPU SA-Q-5; workplan
 * docs/workplans/CLIENT_PAYMENTS_USD_1B_WORKPLAN.md §2). When the server sends
 * `takings.usd`, the block gets a second headline, "Client payments processed
 * ≈ $…" (lagging, with the note "Our customers' revenue, not ours"), a line
 * with the counts, what was not converted and the Exchange rates link, and the
 * "Converted to $" table. Every figure arrives from the server: this file
 * formats `totalUsd` and each row's `usd`, and adds nothing (R-9). The chip
 * "Uses a stale rate" is words, not a link; the link sits beside it (SA-Q-5).
 * With no `usd`, the block is exactly what it was (SA-Q-1B-1). The existing
 * per-currency tables are untouched and never converted (§6.4).
 */

import type { ReactNode } from 'react';

import type { FinanceTakingsFigures, FinanceTakingsLine, FinanceTakingsRow, FinanceTakingsSection } from '@/lib/business-os/finance/financeTypes';
import type { FinancePaymentProblemsSection } from '@/lib/business-os/finance/financeTypes';
import type { FinanceClientPaymentsUsd, FinanceClientPaymentsUsdRow } from '@/lib/business-os/finance/financeTypes';
import { BASE_CURRENCY, roundRateForDisplay } from '@/lib/admin/exchangeRates/exchangeRateRules';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
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
  CLIENT_PAYMENTS_USD,
  EXCHANGE_RATES_TAB_HREF,
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
import { atLeast, formatApproxDollars, formatApproxWholeDollars, formatMoney } from '../financeFormat';
import { BlockKpi } from '@/app/admin/components/layout/BlockKpi';
import { KpiStrip } from '@/app/admin/components/layout/KpiStrip';
import { FinanceSection } from './FinanceSection';
import { ClientPaymentProblems } from './PaymentProblemsSection';
import { businessTargetOf, useBusinessRowOpen } from './BusinessDrawer';

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
  problems,
}: {
  takings: FinanceTakingsSection;
  windowLabel: string;
  onRetry: () => void;
  /**
   * Money MK-6 (§6 item 15): "Client payment problems", moved here from the old
   * Payment problems section: the same owner as the client payments, the
   * businesses. Its own reads, so it also shows when the takings could not load.
   * Absent: not rendered.
   */
  problems?: FinancePaymentProblemsSection;
}) {
  const clientProblems = problems ? <ClientPaymentProblems problems={problems} windowLabel={windowLabel} /> : null;
  return (
    <FinanceSection
      id="takings"
      title={TAKINGS_TITLE}
      subtitle={TAKINGS_SUBTITLE(windowLabel)}
      status={takings.status}
      onRetry={onRetry}
      badge={{ tone: 'neutral', label: TAKINGS_CHIP }}
      alsoWhenUnknown={clientProblems}
    >
      {takings.figures && <TakingsBody f={takings.figures} usd={takings.usd} />}
      {clientProblems}
    </FinanceSection>
  );
}

function TakingsBody({ f, usd }: { f: FinanceTakingsFigures; usd?: FinanceClientPaymentsUsd }) {
  // Money MK-10: the rows open like the Businesses rows (D-17), when the drawer is mounted.
  const opener = useBusinessRowOpen();
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

  // Money MK-1: the block KPI is the headline (§3.2), leading (§5), with its icon (LL-1).
  const businessesKpi = (
    <BlockKpi
      label={BLOCK_KPI_CLIENT_PAYMENTS_LABEL}
      value={count(f.businesses)}
      indicator={{ kind: 'leading', definition: BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION }}
      testId="takings-businesses"
    />
  );

  return (
    <div className="space-y-4" data-testid="takings-body">
      {/* BD-56 (slice 1b): with the approximate-dollar figure, two headlines side by side; without it, today's block.
          Either way on the page-top strip's five-column grid (user, 2026-10-27): each headline is one tile of five. */}
      {usd ? (
        <ClientPaymentsUsd usd={usd} f={f} businessesKpi={businessesKpi} count={count} currencyLabel={currencyLabel} />
      ) : (
        <KpiStrip>{businessesKpi}</KpiStrip>
      )}
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
                  {opener?.header}
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {f.rows.map((row) => (
                  <tr
                    key={`${row.accountId ?? 'unknown'}:${row.currency ?? 'unknown'}`}
                    data-testid={`takings-row-${row.accountId ?? 'unknown'}-${row.currency ?? 'unknown'}`}
                    {...opener?.rowProps(businessTargetOf(row))}
                  >
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>{businessName(row)}</th>
                    <td className={ADMIN_TD}>{currencyLabel(row.currency)}</td>
                    <td className={ADMIN_TD_NUM}>{count(row.payments)}</td>
                    <td className={ADMIN_TD_NUM} data-money="gross">{gross(row.gross, row.currency, row.unreadablePayments)}</td>
                    <td className={ADMIN_TD_NUM} data-money="refunded">{refunded(row.refunded, row.currency)}</td>
                    <td className={ADMIN_TD_NUM} data-money="net">{net(row.net, row.currency)}</td>
                    {opener?.cell(businessTargetOf(row), businessName(row))}
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

// ── FIN BD-56 (slice 1b): client payments in approximate dollars ───────────

/** The headline (§2.3, SA-WP-CPU1B B-1): never "≈ $0" for no data, never "At least ≈ $0" when nothing converted. */
function usdHeadline(usd: FinanceClientPaymentsUsd): string {
  if (usd.status === 'unknown' || usd.totalUsd === null) return TAKINGS_UNKNOWN;
  if (usd.converted.payments === 0) {
    return usd.notConverted.payments === 0 ? CLIENT_PAYMENTS_USD.none : CLIENT_PAYMENTS_USD.notConverted;
  }
  // QA B-1 (1b): under one dollar, whole dollars would print "≈ $0" for real money. Show the cents
  // instead ("≈ $0.30"); a converted total of exactly zero reads "≈ $0.00", never "None" (payments exist).
  const figure = usd.totalUsd < 1 ? formatApproxDollars(usd.totalUsd) : formatApproxWholeDollars(usd.totalUsd);
  return atLeast(figure, usd.status === 'ok');
}

/** The "≈ Total" row: the headline to the cent, "At least" whenever the headline says it (SA-Q-1B-8). */
function usdTotal(usd: FinanceClientPaymentsUsd): string {
  if (usd.totalUsd === null) return TAKINGS_UNKNOWN;
  if (usd.converted.payments === 0) return CLIENT_PAYMENTS_USD.notConverted;
  return atLeast(formatApproxDollars(usd.totalUsd), usd.status === 'ok');
}

const isBase = (row: FinanceClientPaymentsUsdRow): boolean => row.currency === BASE_CURRENCY;

function rateCell(row: FinanceClientPaymentsUsdRow): string {
  // SA-Q-1B-4: US dollars need no rate, so none is shown. QA L-1 (1b): a rate the converter refused
  // ("Not usable") is never printed as stored, since it may be junk text ("abc per $1").
  if (isBase(row) || row.rate === null || row.state === 'unusable') return '—';
  return CLIENT_PAYMENTS_USD.ratePer(roundRateForDisplay(row.rate));
}

function ClientPaymentsUsd({
  usd,
  f,
  businessesKpi,
  count,
  currencyLabel,
}: {
  usd: FinanceClientPaymentsUsd;
  f: FinanceTakingsFigures;
  businessesKpi: ReactNode;
  count: (value: number) => string;
  currencyLabel: (currency: string | null) => string;
}) {
  const unreadableOn = (currency: string | null) => f.lines.find((line) => line.currency === currency)?.unreadablePayments ?? 0;
  const ratesLink = (testId: string) => (
    <a href={EXCHANGE_RATES_TAB_HREF} className="text-purple-300 underline hover:text-purple-200" data-testid={testId}>
      {CLIENT_PAYMENTS_USD.ratesLink}
    </a>
  );
  const notConvertedNote =
    usd.notConverted.payments === 0
      ? null
      : usd.ratesRead === 'failed'
        ? CLIENT_PAYMENTS_USD.ratesFailed(usd.notConverted.payments)
        : CLIENT_PAYMENTS_USD.notConvertedNoRate(usd.notConverted.payments);

  return (
    <div className="space-y-3" data-testid="takings-usd-block">
      <div data-testid="takings-headlines">
        <KpiStrip>
          {businessesKpi}
          <BlockKpi
            label={CLIENT_PAYMENTS_USD.label}
            value={usdHeadline(usd)}
            indicator={{ kind: 'lagging', definition: CLIENT_PAYMENTS_USD.definition }}
            note={CLIENT_PAYMENTS_USD.note}
            chip={usd.stale ? { tone: 'warn', label: CLIENT_PAYMENTS_USD.staleChip } : null}
            testId="takings-usd"
          />
        </KpiStrip>
      </div>
      <p className="text-xs text-slate-400" data-testid="takings-usd-line">
        {CLIENT_PAYMENTS_USD.convertedLine(usd.converted.payments, usd.converted.currencies)}
        {notConvertedNote && <span data-testid="takings-usd-not-converted"> · {notConvertedNote}</span>}
        {' · '}
        {ratesLink('takings-usd-rates-link')}
      </p>

      {usd.rows.length > 0 && (
        <div className="space-y-2" data-testid="takings-usd-breakdown">
          <h3 className={SUBHEAD}>{CLIENT_PAYMENTS_USD.table}</h3>
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} aria-label={CLIENT_PAYMENTS_USD.table} data-testid="takings-usd-table">
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{CLIENT_PAYMENTS_USD.columns.currency}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{CLIENT_PAYMENTS_USD.columns.payments}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{CLIENT_PAYMENTS_USD.columns.paid}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{CLIENT_PAYMENTS_USD.columns.rate}</th>
                  <th scope="col" className={ADMIN_TH}>{CLIENT_PAYMENTS_USD.columns.updated}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{CLIENT_PAYMENTS_USD.columns.usd}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {usd.rows.map((row) => (
                  <tr key={row.currency ?? 'unknown'} data-testid={`takings-usd-row-${row.currency ?? 'unknown'}`}>
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>{currencyLabel(row.currency)}</th>
                    <td className={ADMIN_TD_NUM}>{count(row.payments)}</td>
                    <td className={ADMIN_TD_NUM} data-money="gross">
                      {atLeast(formatMoney(row.gross, row.currency), f.paymentsExact && unreadableOn(row.currency) === 0)}
                    </td>
                    <td className={ADMIN_TD_NUM}>{rateCell(row)}</td>
                    <td className={ADMIN_TD}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{isBase(row) ? '—' : formatUtc(row.rateUpdatedAt)}</span>
                        {row.state !== 'converted' && (
                          <StatusChip tone={row.state === 'stale' ? 'warn' : 'neutral'} testId={`takings-usd-state-${row.currency ?? 'unknown'}`}>
                            {CLIENT_PAYMENTS_USD.states[row.state]}
                          </StatusChip>
                        )}
                      </span>
                    </td>
                    <td className={ADMIN_TD_NUM} data-testid={`takings-usd-amount-${row.currency ?? 'unknown'}`}>
                      {row.usd !== null ? formatApproxDollars(row.usd) : CLIENT_PAYMENTS_USD.notConverted}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="takings-usd-total">
                  <th scope="row" colSpan={5} className={`${ADMIN_TD} text-right font-medium`}>{CLIENT_PAYMENTS_USD.total}</th>
                  <td className={`${ADMIN_TD_NUM} font-medium`}>{usdTotal(usd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className={NOTE} data-testid="takings-usd-footer">
            {CLIENT_PAYMENTS_USD.footer} {ratesLink('takings-usd-footer-link')}
          </p>
        </div>
      )}
    </div>
  );
}
