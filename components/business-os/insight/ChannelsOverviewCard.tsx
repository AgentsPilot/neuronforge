'use client';

import { useState, useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { ChannelsCard } from './ChannelsCard';
import { ChannelSourcesSection, type ChannelRow, type VisitSurface } from './ChannelSourcesSection';

/**
 * Channels, on one card: what is connected, and what it produced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE card, not two inside a tray.
 *
 * This used to be a tinted tray holding two white cards, which put three nested
 * surfaces and three borders on screen to express a single idea. Every boundary
 * a reader has to interpret costs them something, and none of those two extra
 * ones carried meaning — the two halves are not separate subjects, they are the
 * two halves of "is this channel working for me?".
 *
 * So: one border, one surface, and a single hairline where the columns meet. The
 * halves keep their own headings, because they do answer different questions;
 * what they lose is the packaging around each.
 *
 * The two sides keep the positions they already had — connections first, results
 * second — because this change is about the packaging, not about relearning
 * where things are.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Where the Meta and Google readiness steps send you.
 *
 * Exported so the dashboard cannot scroll to a string that drifts away from the
 * element it names.
 */
export const CHANNELS_CARD_ID = 'channels-card';

interface ChannelsOverviewCardProps {
  performance?: {
    rows: ChannelRow[];
    totals: { leads: number; bookings: number; revenue: number };
    untracked: { leads: number; bookings: number; revenue: number };
    /** Arrivals split by the page they landed on. */
    visits?: { total: number; bySurface: { surface: VisitSurface; visits: number }[] };
  };
  onChanged?: () => void;
}

/** Remembered per browser, so the choice is not remade on every visit. */
const SHOW_CONNECTIONS_KEY = 'business-os.channels.showConnections';

export function ChannelsOverviewCard({ performance, onChanged }: ChannelsOverviewCardProps) {
  const { isRTL, t } = useLanguage();

  /*
   * Either half can have the card to itself.
   *
   * The two columns answer different questions, and a business reads them at
   * different times: the connections side matters while setting channels up and
   * then rarely again, while "where are my customers coming from" is the part
   * worth looking at every week. So it starts folded away and the sources
   * column has the whole card; opening it is one click, and is remembered.
   *
   * Read after mount rather than during render: the server has no
   * `localStorage`, and seeding state from it directly makes the first client
   * render disagree with the HTML.
   */
  const [showConnections, setShowConnections] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SHOW_CONNECTIONS_KEY);
      if (stored === 'true') setShowConnections(true);
    } catch {
      // A browser that refuses storage keeps the default.
    }
  }, []);

  const toggleConnections = () => {
    setShowConnections(previous => {
      const next = !previous;
      try {
        window.localStorage.setItem(SHOW_CONNECTIONS_KEY, String(next));
      } catch {
        // Not remembering the choice is better than not honouring it.
      }
      return next;
    });
  };

  const empty: NonNullable<ChannelsOverviewCardProps['performance']> = {
    rows: [],
    totals: { leads: 0, bookings: 0, revenue: 0 },
    untracked: { leads: 0, bookings: 0, revenue: 0 },
  };
  const data = performance ?? empty;

  return (
    <div
      // The readiness steps for Meta and Google scroll here rather than opening
      // a dialog. They are only ever shown when this card is on the page, so
      // the target always exists.
      id={CHANNELS_CARD_ID}
      dir={isRTL ? 'rtl' : 'ltr'}
      style={{
        marginTop: '20px',
        marginBottom: '20px',
        borderRadius: '18px',
        background: '#FFFFFF',
        border: '1px solid #E7E9F1',
        overflow: 'hidden',
      }}
    >
      {/* Two columns rather than a stack: stacking would make this the tallest
          card on the dashboard, and the two halves are read together, not one
          after the other.

          Below md they stack anyway — two dense columns on a phone would make
          both unreadable — and the divider turns with them, which is why it is
          a border on the second child and not a rule of its own. */}
      {/* The control that folds the connections column away.

          Aligned to the inline-end so it sits at the card's leading edge in
          Hebrew and its trailing edge in English, rather than being pinned to
          one physical side. */}
      <div className="flex px-4 pt-3">
        <button
          type="button"
          onClick={toggleConnections}
          aria-expanded={showConnections}
          className="ms-auto inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111827] transition-colors"
        >
          {showConnections
            ? <PanelLeftClose className="w-3.5 h-3.5" />
            : <PanelLeftOpen className="w-3.5 h-3.5" />}
          {showConnections
            ? (t('channels.hideConnections') || 'Hide connections')
            : (t('channels.showConnections') || 'Show connections')}
        </button>
      </div>

      <div className={`grid grid-cols-1 ${showConnections ? 'md:grid-cols-2' : ''}`}>
        {showConnections && (
          <div className="p-4">
            <ChannelsCard embedded onChanged={onChanged} />
          </div>
        )}

        <div
          className={showConnections
            ? 'border-t border-[#EEF0F5] p-4 md:border-t-0 md:border-s'
            : 'p-4'}
          /* `border-s` is inline-start, so in Hebrew the hairline lands on the
             column's right edge and still sits BETWEEN the two — a left/right
             border would jump to the outside of the card when the page flips.
             With one column there is nothing to divide, so it goes. */
        >
          <ChannelSourcesSection
            embedded
            rows={data.rows}
            totals={data.totals}
            untracked={data.untracked}
            visits={data.visits}
          />
        </div>
      </div>
    </div>
  );
}
