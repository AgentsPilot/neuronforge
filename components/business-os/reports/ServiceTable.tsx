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
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';

export interface ServiceRow {
  service_id: string;
  service_name: string;
  revenue: number;
  /** Money ROWS that produced this revenue: transactions plus unsettled invoices. */
  count: number;
}

export interface ServiceTableProps {
  services: ServiceRow[];
  money: (amount: number) => string;
}

export function ServiceTable({ services, money }: ServiceTableProps) {
  const { t } = useLanguage();

  if (services.length === 0) return null;

  const ordered = [...services].sort((a, b) => b.revenue - a.revenue);
  const widest = Math.max(1, ...ordered.map(s => s.revenue));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[420px]">
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
              {t('reports.col_payments')}
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
                  {row.service_name}
                </span>
              </td>
              <td className="px-[18px] py-[11px] text-end text-sm tabular-nums text-[var(--v2-text-primary)] whitespace-nowrap">
                {row.count}
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
