'use client';

/**
 * Three figures that do not overlap, so the owner can check them against
 * each other: collected arrived, owed has not arrived yet, written off never
 * will.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This replaced eleven tiles. Nothing was deleted — the other eight moved into
 * `FinancialDetail` behind a disclosure — but they stopped being the first thing
 * an owner had to read to find out how the month went.
 *
 * COLLECTED IS GROSS, with refunds and fees named beneath rather than silently
 * subtracted. A revenue figure that fell tells the owner nothing about WHY, and
 * selling less and refunding more are entirely different problems.
 *
 * WRITTEN OFF IS ALL TIME, unlike its two neighbours, and its own subtitle says
 * so. A loss does not stop being a loss on day 31. It cannot double-count the
 * refunds named on the first figure: the server nets refunds out of
 * `lost_potential_amount` (`cancelledMoneyOf`), so refunded money is reported
 * once, there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import { useLanguage } from '@/lib/business-os/LanguageContext';

export interface MoneyFiguresProps {
  collected: number;
  /** Named under `collected`, and only when non-zero. */
  refunded: number;
  fees: number;
  /**
   * `gross − refunds − fees`, FROM THE SERVER (`banked_revenue_30d`).
   *
   * Not recomputed here. This page subtracted the three itself, which is wrong
   * twice over: it subtracts already-rounded figures so the result can drift by
   * cents, and it duplicates a definition the stats route owns, so the two
   * would silently diverge the moment the server's changed.
   */
  banked: number;
  /**
   * How many of the period's payments have NO known fee.
   *
   * Fees are backfilled from Stripe. Above zero, `fees` is incomplete and
   * `banked` is therefore an over-estimate, so the line says it is partial
   * rather than presenting an exact figure it has not got.
   */
  feesUnknown: number;
  owed: number;
  pendingInvoices: number;
  overdueInvoices: number;
  /** Unpaid plan installments. Mentioned only by a business that has plans. */
  pendingInstallments: number;
  writtenOff: number;
  writtenOffCount: number;
  /**
   * The two halves of the write-off, named rather than summed into one count.
   *
   * `planPeriods` are cancelled plan periods carrying NO invoice of their own.
   * They are the only part of this figure the orders list cannot show, because
   * that list reads invoices — so a combined count left the two pages looking
   * like they should match when they never could.
   */
  writtenOffInvoices: number;
  writtenOffPlanPeriods: number;
  /** The page's currency-correct formatter. Never the language default. */
  money: (amount: number) => string;
  onOpenOrders: () => void;
}

export function MoneyFigures({
  collected,
  refunded,
  fees,
  banked,
  feesUnknown,
  owed,
  pendingInvoices,
  overdueInvoices,
  pendingInstallments,
  writtenOff,
  writtenOffCount,
  writtenOffInvoices,
  writtenOffPlanPeriods,
  money,
  onOpenOrders,
}: MoneyFiguresProps) {
  const { t } = useLanguage();

  /*
   * Each part appears only when it is non-zero.
   *
   * A business that has never refunded anything should not be shown a zero it
   * has to interpret, and one mid-backfill should not read a fee of 0 as "no
   * fees charged" when it means "not fetched yet".
   *
   * ── AND THE SUBTRACTION IS NAMED ──────────────────────────────────────────
   * The headline is GROSS, so "collected 15,145 / refunded 2,700" left the
   * reader unable to tell whether the 2,700 had already come off. Both readings
   * are plausible and they differ by 2,700. So the remainder is spelled out:
   *
   *     15,145   refunded 2,700 · fees 52 · 12,393 kept
   *
   * Every figure in that line is now checkable against its neighbours, which is
   * the only way a money figure earns trust. Shown only when something was
   * actually taken off — with no refunds and no fees, gross IS what was kept and
   * repeating it would imply a deduction happened.
   */
  const under: string[] = [];
  if (refunded > 0) under.push(`${t('reports.refunded_amount')}: ${money(refunded)}`);
  if (fees > 0) {
    // Say so when the fee total is still being backfilled, rather than letting
    // a partial figure read as the whole cost of collecting the money.
    under.push(
      feesUnknown > 0
        ? `${t('reports.fees')}: ${money(fees)} (${t('reports.fees_partial')})`
        : `${t('reports.fees')}: ${money(fees)}`
    );
  }
  if (under.length > 0) under.push(`${money(banked)} ${t('reports.kept')}`);

  /*
   * The overdue count sits INSIDE the invoice count, so it is bracketed.
   *
   * "8 invoices · 5 overdue · 11 installments" read as three parallel figures
   * that might sum, when the 5 are five of the 8 and the installments are a
   * different kind of thing entirely. Parentheses carry the containment with no
   * extra words, in every language.
   */
  const invoicePart =
    overdueInvoices > 0
      ? `${pendingInvoices} ${t('reports.invoices')} (${overdueInvoices} ${t('reports.overdue')})`
      : `${pendingInvoices} ${t('reports.invoices')}`;

  const owedUnder = [
    invoicePart,
    ...(pendingInstallments > 0 ? [`${pendingInstallments} ${t('reports.installments')}`] : []),
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[var(--v2-border)]">
      <Figure
        dot={REPORTS_COLORS.PRIMARY}
        label={t('reports.collected')}
        amount={money(collected)}
        under={under.join(' · ')}
        onClick={onOpenOrders}
        actionLabel={t('reports.view_money')}
      />
      <Figure
        dot={REPORTS_COLORS.WARNING}
        label={t('reports.still_owed')}
        amount={money(owed)}
        under={owedUnder.join(' · ')}
        onClick={onOpenOrders}
        actionLabel={t('reports.view_money')}
      />
      {/*
        * The one figure on this page that is a loss, and it is coloured like one.
        *
        * `LOST` (#B54708) rather than `DANGER` (#F04438), following the decision
        * recorded on the constant: a write-off is something the owner decided,
        * not money to chase, and alarm-red would put a permanent siren beside a
        * closed call. It is still unmistakably in the red family, which the
        * previous purple was not.
        *
        * ONLY WHEN THERE IS A LOSS. Nothing written off is a real success, so
        * zero stays in the ordinary ink — a red 0 would read as a problem that
        * is in fact the best possible outcome.
        */}
      <Figure
        dot={writtenOff > 0 ? REPORTS_COLORS.LOST : REPORTS_COLORS.UNATTRIBUTED}
        amountColor={writtenOff > 0 ? REPORTS_COLORS.LOST : undefined}
        label={t('reports.written_off')}
        amount={money(writtenOff)}
        under={(() => {
          /*
           * Each half only when it has something in it. A business with no
           * payment plans should read "5 invoices", not "5 invoices · 0 plan
           * payments", and one whose whole write-off is plan periods should not
           * be shown a zero invoice count to interpret.
           */
          const parts: string[] = [];
          if (writtenOffInvoices > 0) {
            parts.push(`${writtenOffInvoices} ${t('reports.lost_invoices')}`);
          }
          if (writtenOffPlanPeriods > 0) {
            parts.push(`${writtenOffPlanPeriods} ${t('reports.lost_periods')}`);
          }
          if (parts.length === 0) {
            parts.push(`${writtenOffCount} ${t('reports.cancelled_count')}`);
          }
          parts.push(t('reports.all_time'));
          return parts.join(' · ');
        })()}
      />
    </div>
  );
}

function Figure({
  dot,
  label,
  amount,
  under,
  amountColor,
  onClick,
  actionLabel,
}: {
  dot: string;
  label: string;
  amount: string;
  under: string;
  /** Overrides the figure's ink. Only the loss figure uses it. */
  amountColor?: string;
  onClick?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="bg-[var(--v2-surface)] px-[18px] pt-4 pb-[18px] flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-xs font-semibold text-[var(--v2-text-secondary)]">
        <i className="w-[7px] h-[7px] rounded-full flex-none" style={{ background: dot }} />
        {label}
      </span>
      <span
        className="text-[27px] font-bold tracking-[-0.025em] tabular-nums leading-tight text-[var(--v2-text-primary)]"
        style={amountColor ? { color: amountColor } : undefined}
      >
        {amount}
      </span>
      {/* The breakdown, or the link to the rows behind the figure. Never both:
          one line under a number is a caption, two is a paragraph. */}
      {/*
        * The breakdown AND the way through to the rows behind it.
        *
        * ───────────────────────────────────────────────────────────────────────
        * This was a ternary: `under ? breakdown : link`. Every figure that has a
        * breakdown therefore LOST its link, which is every interesting one — a
        * business with refunds or fees had no way to click from "15,145 came in"
        * to the payments that make it up. An owner asked how to see the money
        * they had already received, and the honest answer was that this card had
        * quietly removed the route to it.
        *
        * Both now. The breakdown explains the figure; the link goes to the rows.
        * They answer different questions and were never alternatives.
        * ───────────────────────────────────────────────────────────────────────
        */}
      {under && (
        <span className="text-xs text-[var(--v2-text-muted)] tabular-nums">{under}</span>
      )}
      {onClick && actionLabel && (
        <button
          type="button"
          onClick={onClick}
          className="self-start text-xs font-medium text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] underline decoration-dotted underline-offset-2"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
