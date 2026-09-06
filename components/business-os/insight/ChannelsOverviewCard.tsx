'use client';

import { useState, useCallback } from 'react';
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
  /**
   * The surfaces the business already owns. Passed straight through to the
   * connections column, which lists them alongside the connected accounts —
   * a website and a smart link are channels whether or not anything is linked.
   */
  owned?: {
    website: number;
    landing: number;
    smartLinks: number;
    websiteDrafts: number;
    landingDrafts: number;
  };
  /** Publish a site, create a link. The dashboard owns what those do. */
  onAction?: (action: string) => void;
}

export function ChannelsOverviewCard({ performance, onChanged, owned, onAction }: ChannelsOverviewCardProps) {
  const { isRTL, t } = useLanguage();

  /*
   * Folded away on every load, and deliberately NOT remembered.
   *
   * The dashboard's question is "where are my customers coming from", and that
   * is the sources column. Connecting an account is occasional and deliberate,
   * so the column that does it waits behind one click.
   *
   * The choice used to persist in `localStorage`, and that is what this
   * removes. Opening the column once — to check a connection, to publish a
   * draft — meant it opened on every dashboard load from then on, halving the
   * sources column for good on the strength of a single visit weeks earlier.
   * A browser that had stored `true` could not be talked out of it by changing
   * the default, because the stored value is exactly what a default is for
   * overriding.
   *
   * One click still opens it, for as long as the page is open. It just does not
   * follow the reader into tomorrow.
   */
  const [showConnections, setShowConnections] = useState(false);

  const toggleConnections = () => setShowConnections(previous => !previous);

  /*
   * The card is one column until the connections have arrived.
   *
   * `ChannelsCard` renders nothing while it fetches, but the grid was already
   * two columns from the first paint — so its half sat empty and bordered (the
   * RIGHT half in Hebrew) while the sources column beside it was squeezed to
   * fit a column with nothing in it. Then the content landed and everything
   * moved.
   *
   * Waiting costs nothing: the sources column has the width it would have had
   * anyway, and gains a neighbour only when there is a neighbour to gain.
   */
  const [connectionsReady, setConnectionsReady] = useState(false);
  const handleConnectionsReady = useCallback(() => setConnectionsReady(true), []);

  /** Open, wanted by the reader, AND with something to draw. */
  const splitColumns = showConnections && connectionsReady;

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
      {/* Always offered while the column is closed — it is the only way to open
          it. The "hide" form waits for the column to actually appear, since
          offering to hide something still loading is a control with nothing
          behind it. */}
      <div className="flex px-4 pt-3" style={{ minHeight: '28px' }}>
        {(!showConnections || connectionsReady) && (
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
        )}
      </div>

      <div className={`grid grid-cols-1 ${splitColumns ? 'md:grid-cols-2' : ''}`}>
        {/* Mounted only once asked for — the column is closed by default, and a
            card that is not on screen should not be fetching its connections on
            every dashboard load.

            Once mounted it is `hidden` rather than unmounted until it has
            loaded: it renders nothing while fetching, and giving it a column
            before then left an empty bordered half (the RIGHT half in Hebrew)
            squeezing the sources column beside it. */}
        {showConnections && (
          <div className={splitColumns ? 'p-4' : 'hidden'}>
            <ChannelsCard
              embedded
              onChanged={onChanged}
              owned={owned}
              onAction={onAction}
              onReady={handleConnectionsReady}
            />
          </div>
        )}

        <div
          className={splitColumns
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
