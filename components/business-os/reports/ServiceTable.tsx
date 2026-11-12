'use client';

/**
 * What people actually buy, by bookings and by money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COUNT IS PAYMENTS, NOT BOOKINGS, AND THE HEADER SAYS SO.
 *
 * `service_revenue[].count` is incremented once per succeeded TRANSACTION and
 * once per unsettled INVOICE in `serviceRevenueMap` — it counts money rows. It
 * was headed "Bookings", which put it beside band 4's genuine booking count and
 * invited the obvious subtraction: 29 bookings there against 22 here, two
 * figures that were never the same quantity. An owner spotted it.
 *
 * A service billed in three instalments shows 3; a service booked three times
 * and paid once shows 1. That is a useful number — how many times this service
 * produced money — but it is not attendance.
 *
 * Sorted by revenue, because that is the question most owners open this with,
 * and the payment count sits beside it so a cheap service that bills often is
 * visible rather than buried at the bottom.
 *
 * The bar is scaled to REVENUE, matching the sort, so the longest bar is always
 * the top row. A bar scaled to one column beside a sort on another is the kind
 * of chart that quietly lies.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { REPORTS_COLORS, UNATTRIBUTED_SERVICE_ID } from '@/lib/business-os/reports/constants';

export interface ServiceRow {
  service_id: string;
  service_name: string;
  revenue: number;
  /**
   * Money ROWS that produced this revenue: transactions plus unsettled
   * invoices. Still sent by the stats route; NO LONGER SHOWN — a service paid
   * in three instalments counted three times, which is the right number for a
   * money column and the wrong answer to "how many people bought this".
   */
  count: number;
  /**
   * How many times this service was BOOKED in the period, cancellations
   * excluded, so it agrees with the revenue beside it.
   *
   * Optional because a stored summary from before this existed has no such
   * field. Unlike `lost`, a missing one reads as 0 rather than as "not known":
   * the column is a count of rows the reader can see, not a money figure whose
   * absence would be a claim.
   */
  booked?: number;
  /**
   * Written off against this service in the period. NO LONGER SHOWN: the table
   * now carries the top line only, service / orders / revenue.
   *
   * Optional because a stored summary from before this existed has no such
   * field, and a missing one must read as "not known" rather than as zero —
   * the same discipline `HealthRows` keeps about absent figures.
   */
  lost?: number;
  /**
   * Money that came BACK out of this service in the period. NO LONGER SHOWN,
   * as `lost` above.
   *
   * Optional for the same reason `lost` is: a stored summary written before
   * this existed carries no such field, and a missing figure must read as
   * "not known" rather than as a confident zero.
   *
   * ALREADY NETTED OFF `revenue` by `serviceRevenueMap`, so the two are never
   * added together. It is reported because the netted figure cannot be read
   * backwards: a service that earned 2,000 and refunded 1,000 looks exactly
   * like one that earned 1,000 and refunded nothing, and those are different
   * businesses.
   */
  refunded?: number;
}

export interface ServiceTableProps {
  services: ServiceRow[];
  money: (amount: number) => string;
}

export function ServiceTable({ services, money }: ServiceTableProps) {
  const { t } = useLanguage();

  if (services.length === 0) return null;

  /*
    THE TWO NAMES THE SERVER INVENTS, SAID IN THE READER'S LANGUAGE.
    ───────────────────────────────────────────────────────────────────────────
    Every other row here is the owner's own text and must never be touched. But
    `serviceRevenueMap` writes two names itself, in English, and they reached a
    Hebrew table untranslated:

      'Other'            the unattributed remainder, keyed by the sentinel id
      'Unknown Service'  a service that has since been deleted, which "keeps
                         its money but loses its name"

    The route's own comment says "the client localizes the unattributed row" —
    this is the client, and it was not doing it.

    The deleted case is matched on the literal because the name IS the only
    signal: the row carries a real service id, and nothing else distinguishes
    it from a service genuinely called that.
  */
  const rowName = (row: ServiceRow) => {
    if (row.service_id === UNATTRIBUTED_SERVICE_ID) {
      return t('reports.service_other') || 'Other';
    }
    if (row.service_name === 'Unknown Service') {
      return t('reports.service_deleted') || 'Deleted service';
    }
    return row.service_name;
  };

  const ordered = [...services].sort((a, b) => b.revenue - a.revenue);
  const widest = Math.max(1, ...ordered.map(s => s.revenue));

  /* Summed from the rows the reader can see, so the total and the breakdown
     cannot disagree. `booked` is optional: a stored summary written before the
     order count existed has no such field, and `?? 0` is right here because
     the total is of what IS on screen. */
  const totals = {
    booked: ordered.reduce((sum, s) => sum + (s.booked ?? 0), 0),
    revenue: ordered.reduce((sum, s) => sum + s.revenue, 0),
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[500px]">
        <thead>
          <tr>
            <th
              scope="col"
              className="px-[18px] py-2.5 text-start text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--v2-text-muted)] border-b border-[var(--v2-border)]"
            >
              {t('reports.col_service')}
            </th>
            <th
              scope="col"
              className="px-[18px] py-2.5 text-end text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--v2-text-muted)] border-b border-[var(--v2-border)] whitespace-nowrap"
            >
              {t('reports.col_bookings')}
            </th>
            <th
              scope="col"
              className="px-[18px] py-2.5 text-end text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--v2-text-muted)] border-b border-[var(--v2-border)] whitespace-nowrap"
            >
              {t('reports.col_revenue')}
            </th>
          </tr>
        </thead>
        <tbody>
          {/*
            THE TOTALS LEAD, THEY DO NOT TRAIL.
            ───────────────────────────────────────────────────────────────
            A sum at the foot of a table is found by scrolling past every row,
            which is the wrong way round: "how much altogether" is the question
            asked FIRST and the rows are the breakdown of the answer.

            Summed from the rows on screen, so the reader can check it by
            adding the column up. A figure fetched separately could differ from
            the rows beneath it, and that is exactly the kind of disagreement
            this table has already produced once.

            `lost` is OPTIONAL: an older stored summary has no such field, and
            a missing one means "not known", not zero. So the cell prints a
            dash unless at least one row actually carries the figure, rather
            than inventing a confident 0.
          */}
          <tr className="border-b-2 border-[var(--v2-border)] bg-[var(--v2-bg)]">
            <td className="px-[18px] py-[11px] text-sm font-bold text-[var(--v2-text-primary)]">
              {t('reports.col_total') || 'Total'}
            </td>
            <td className="px-[18px] py-[11px] text-end text-sm font-bold tabular-nums text-[var(--v2-text-primary)] whitespace-nowrap">
              {totals.booked}
            </td>
            <td className="px-[18px] py-[11px] text-end text-sm font-bold tabular-nums text-[var(--v2-text-primary)] whitespace-nowrap">
              {money(totals.revenue)}
            </td>
          </tr>

          {ordered.map(row => (
            <tr
              key={row.service_id || row.service_name}
              className="border-b border-[var(--v2-border)] last:border-b-0"
            >
              <td className="px-[18px] py-[11px] text-sm font-medium text-[var(--v2-text-primary)]">
                <span className="inline-flex items-center gap-2.5">
                  <i
                    className="block h-[5px] rounded-full flex-none"
                    style={{
                      width: `${Math.max(3, Math.round((row.revenue / widest) * 38))}px`,
                      background: REPORTS_COLORS.PRIMARY,
                    }}
                  />
                  {rowName(row)}
                </span>
              </td>
              {/* Orders, not payments: `count` is payment ROWS, so a service
                  paid in three instalments counted three times there. See the
                  note on `booked` in the stats route. */}
              <td className="px-[18px] py-[11px] text-end text-sm tabular-nums text-[var(--v2-text-primary)] whitespace-nowrap">
                {row.booked ?? 0}
              </td>
              <td className="px-[18px] py-[11px] text-end text-sm tabular-nums text-[var(--v2-text-primary)] whitespace-nowrap">
                {money(row.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
