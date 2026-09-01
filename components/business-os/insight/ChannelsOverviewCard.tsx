'use client';

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

export function ChannelsOverviewCard({ performance, onChanged }: ChannelsOverviewCardProps) {
  const { isRTL } = useLanguage();

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
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="p-4">
          <ChannelsCard embedded onChanged={onChanged} />
        </div>

        <div
          className="border-t border-[#EEF0F5] p-4 md:border-t-0 md:border-s"
          /* `border-s` is inline-start, so in Hebrew the hairline lands on the
             column's right edge and still sits BETWEEN the two — a left/right
             border would jump to the outside of the card when the page flips. */
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
