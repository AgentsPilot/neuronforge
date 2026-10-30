'use client';

/**
 * Who the clients are, as of now.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY FIGURE HERE IGNORES THE PERIOD SELECTOR, AND THE BAND SAYS SO.
 *
 * These are stage counts with no date filter: how many contacts sit at a client
 * stage, how many at a lead stage, how many in total. "Right now" is the only
 * honest reading, and switching the page to Week or Year does not change one of
 * them. The band's question carries that, because four figures that do not move
 * when the selector moves would otherwise look broken.
 *
 * `went_quiet` is the one with a window of its own: contacts at a lead or client
 * stage with no activity for 14 days. Fixed in the stats route, independent of
 * the selector too, and named on the figure rather than left to be guessed.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * `new_this_week` and `became_clients_this_week` are the two CRM counts an
 * overview would most want, and both are hardcoded to `sevenDaysAgo` in the
 * stats route. On a page set to Year they would still report seven days, beside
 * figures that do honour the selector. Showing them would reintroduce exactly
 * the mixed-basis confusion the captions on bands 4 and 5 exist to undo. They
 * belong here once the route takes the period for them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';

export interface ClientCountsProps {
  activeClients: number;
  activeLeads: number;
  /** At a lead or client stage with no activity for 14 days. */
  wentQuiet: number;
  /**
   * Started a booking, never finished, and have not booked since.
   *
   * Distinct PEOPLE, not attempts: one client retrying a card journey five
   * times is one person, and anyone who later booked is excluded — an
   * abandonment they came back from is a recovered client, not lost business.
   */
  abandonedContacts: number;
  totalContacts: number;
}

export function ClientCounts({
  activeClients,
  activeLeads,
  wentQuiet,
  abandonedContacts,
  totalContacts,
}: ClientCountsProps) {
  const { t } = useLanguage();

  const cells: { key: string; label: string; value: number; note?: string; dot: string; alarm?: boolean }[] = [
    {
      key: 'clients',
      label: t('reports.count_clients'),
      value: activeClients,
      dot: REPORTS_COLORS.PRIMARY,
    },
    {
      key: 'leads',
      label: t('reports.count_leads'),
      value: activeLeads,
      dot: REPORTS_COLORS.ACCENT,
    },
    {
      key: 'quiet',
      label: t('reports.count_quiet'),
      value: wentQuiet,
      note: t('reports.quiet_note'),
      dot: REPORTS_COLORS.WARNING,
      // People who stopped answering are the one thing here worth acting on,
      // and only when there are any. Nobody gone quiet is a good state, not an
      // amber one.
      alarm: wentQuiet > 0,
    },
    {
      key: 'abandoned',
      label: t('reports.count_abandoned'),
      value: abandonedContacts,
      note: t('reports.abandoned_note'),
      dot: REPORTS_COLORS.WARNING,
      /* Amber only when there are any, for the same reason `quiet` is: nobody
         who walked away is a good state, not something to chase. */
      alarm: abandonedContacts > 0,
    },
    {
      key: 'all',
      label: t('reports.count_all'),
      value: totalContacts,
      dot: REPORTS_COLORS.UNATTRIBUTED,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-[var(--v2-border)]">
      {cells.map(cell => (
        <div
          key={cell.key}
          className="bg-[var(--v2-surface)] px-[18px] pt-4 pb-[18px] flex flex-col gap-1.5"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-[var(--v2-text-secondary)]">
            <i className="w-[7px] h-[7px] rounded-full flex-none" style={{ background: cell.dot }} />
            {cell.label}
          </span>
          <span
            className="text-[27px] font-bold tracking-[-0.025em] tabular-nums leading-tight text-[var(--v2-text-primary)]"
            style={cell.alarm ? { color: REPORTS_COLORS.WARNING } : undefined}
          >
            {cell.value}
          </span>
          {cell.note && (
            <span className="text-xs text-[var(--v2-text-muted)]">{cell.note}</span>
          )}
        </div>
      ))}
    </div>
  );
}
