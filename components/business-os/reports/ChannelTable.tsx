'use client';

/**
 * Where the people who became clients actually came from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Four columns, deliberately fewer than the data has.
 *
 * `ChannelSourcesSection` on the dashboard shows six: it adds "Saw you" (reach
 * from a connected account) and "Billed" (asked for, paid or not). Both are
 * real and both stay on the dashboard, because that surface is where an owner
 * goes to work on a channel. This page answers one question — who sent the
 * people — and a sixth column makes the row scroll on a phone to show a figure
 * nobody came here for.
 *
 * THERE IS NO SEPARATE "UNTRACKED" ROW, and there must never be one again.
 *
 * `ChannelPerformance.untracked` is literally `buckets.get('direct')` — the very
 * same bucket that `CHANNEL_ORDER` already puts in `rows` as the "Direct /
 * unknown" channel. Rendering both printed the same leads and the same money
 * twice, one row above the other, and an owner spotted it immediately: the two
 * rows carried identical totals.
 *
 * The dashboard never had this bug because it renders `untracked` as a FOOTNOTE
 * about the direct row rather than as a row of its own. This table does the
 * same: the figure appears once, in the row, and the caption explains what that
 * row means.
 *
 * Channel names come from `CHANNEL_LABELS`, which is already translated for the
 * dashboard. A second set of names would eventually disagree with the first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { CHANNEL_LABELS, type ChannelRow } from '@/components/business-os/insight/ChannelSourcesSection';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';

export interface ChannelTableProps {
  /**
   * Every channel, the 'direct' one included — it is already in `CHANNEL_ORDER`
   * and carries the leads the platform could not attribute.
   */
  rows: ChannelRow[];
  money: (amount: number) => string;
}

/** Bar colours, in the order the rows are drawn. The fifth onward reuse grey. */
const BAR = [REPORTS_COLORS.PRIMARY, REPORTS_COLORS.ACCENT, REPORTS_COLORS.WARNING, REPORTS_COLORS.UNATTRIBUTED];

export function ChannelTable({ rows, money }: ChannelTableProps) {
  const { t, language } = useLanguage();

  const label = (row: ChannelRow) =>
    CHANNEL_LABELS[row.channel]?.[language] || CHANNEL_LABELS[row.channel]?.en || row.channel;

  /*
   * Largest first, so the row carrying the people is the row read first — but
   * 'direct' is pinned last whatever its size. It is the row that says "we do
   * not know", and on many accounts it is the biggest; at the top it reads as
   * the business's best channel.
   */
  const ordered = [...rows].sort((a, b) => {
    if (a.channel === 'direct') return 1;
    if (b.channel === 'direct') return -1;
    return b.leads - a.leads;
  });
  const widest = Math.max(1, ...ordered.map(r => r.leads));

  if (ordered.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[480px]">
        <thead>
          <tr>
            <Th start>{t('reports.col_channel')}</Th>
            <Th>{t('reports.col_people')}</Th>
            <Th>{t('reports.col_bookings')}</Th>
            <Th>{t('reports.col_revenue')}</Th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row, i) => (
            <tr
              key={row.channel}
              className="border-b border-[var(--v2-border)] last:border-b-0"
            >
              <Td start muted={row.channel === 'direct'}>
                <span className="inline-flex items-center gap-2.5">
                  <i
                    className="block h-[5px] rounded-full flex-none"
                    style={{
                      width: `${Math.max(3, Math.round((row.leads / widest) * 38))}px`,
                      background: BAR[i] ?? REPORTS_COLORS.UNATTRIBUTED,
                    }}
                  />
                  {label(row)}
                </span>
              </Td>
              <Td muted={row.channel === 'direct'}>{row.leads}</Td>
              <Td muted={row.channel === 'direct'}>{row.bookings}</Td>
              <Td muted={row.channel === 'direct'}>{money(row.revenue)}</Td>
            </tr>
          ))}

        </tbody>
      </table>
    </div>
  );
}

function Th({ children, start }: { children: React.ReactNode; start?: boolean }) {
  return (
    <th
      scope="col"
      className={`px-[18px] py-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--v2-text-muted)] whitespace-nowrap border-b border-[var(--v2-border)] ${
        start ? 'text-start' : 'text-end'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  start,
  muted,
}: {
  children: React.ReactNode;
  start?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-[18px] py-[11px] text-sm tabular-nums whitespace-nowrap ${
        start ? 'text-start' : 'text-end'
      } ${muted ? 'font-normal' : start ? 'font-medium' : ''} ${
        muted ? 'text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-primary)]'
      }`}
    >
      {children}
    </td>
  );
}
