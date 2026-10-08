// components/public/PortalShell.tsx

import { PortalBar } from '@/components/public/PortalBar';
import { PAGE_CONTAINER, PORTAL_GRID } from '@/lib/business-os/pageContainer';
import { PublicFooter } from '@/components/public/PublicFooter';
import type { PublicBrand } from '@/lib/branding/publicBranding';

interface PortalShellProps {
  brand: PublicBrand;
  children: React.ReactNode;
  /** The client, for the bar. */
  clientName?: string | null;
  /**
   * The rail: what every screen in the section shows and none of them owns.
   *
   * Rendered here, as tiles BENEATH `children`, so it is mounted ONCE for the
   * whole section. Moving from the portal to cancel to reschedule leaves the
   * business details and the opening hours exactly where they are — they
   * neither flicker nor refetch, because nothing about them changed, and they
   * sit in the same place on every screen.
   */
  aside?: React.ReactNode;
}

/**
 * The frame the three booking-management screens share.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `PublicShell`
 *
 * `PublicShell` centres everything inside one `max-w-*` column with page
 * padding around it, which is right for a quote or an invoice: a document,
 * centred, read once. The portal needs the opposite at the edges — the bar and
 * the hero band run full width, and only the CONTENT is held to a column — and
 * `PublicShell` has five other callers that must not move while this changes.
 *
 * So this is a sibling rather than another prop on that one. It keeps the parts
 * that are genuinely shared (direction, language, the page background, the
 * footer) and differs only where the portal differs.
 *
 * `dir` and `lang` are set here as well as on the document, so the markup is
 * correct for crawlers and for the moment before the dir script runs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PortalShell({ brand, children, clientName, aside }: PortalShellProps) {
  return (
    <div
      dir={brand.dir}
      lang={brand.locale}
      className="apc-shell flex min-h-screen flex-col"
      style={{ background: 'var(--ap-bg)', color: 'var(--ap-text)' }}
    >
      {/*
        Sticky, and rendered by the LAYOUT rather than by each page.

        Two different things kept taking it off the screen. Scrolling was the
        obvious one. The other was navigation: every one of these pages is a
        client component that fetches its own booking, so moving from the
        portal to cancel unmounted the whole frame, showed a bare spinner, and
        drew it again — three times for a client who looks at one appointment.
        In the layout it is mounted once for the whole section and simply stays.
      */}
      <div className="sticky top-0 z-20">
        <PortalBar brand={brand} clientName={clientName} />
      </div>

      {/* `flex-1` so a short screen still pushes the footer to the bottom
          rather than leaving it floating halfway up a desktop window. */}
      {/*
        ───────────────────────────────────────────────────────────────────────
        ONE FRAME FOR EVERY SCREEN IN THE SECTION.

        This briefly chose its arrangement from the PATH — a grid on the index,
        a column everywhere else — and that was wrong in a way worth recording.
        The reminder and confirmation emails link to `/reschedule`, `/cancel`
        and `/intake` far more often than to the index, so most clients arrived
        on a screen the test did not match and got the old column layout. The
        portal appeared to change shape from one booking to the next, and the
        pathname is also null on the first render, which produced a third
        answer again.

        So there is no test. Every screen lays out the same way: the page's own
        content across the full width, and the rail's cards as tiles beneath it
        in a fixed order. A client moving from the portal to cancel and back
        finds every card where they left it.
        ───────────────────────────────────────────────────────────────────────
      */}
      <main className={`w-full flex-1 ${PAGE_CONTAINER} pb-6 pt-4`}>
        <div className={`${PORTAL_GRID} gap-3`}>
          {/* The page's own content, whatever shape it is. The index lays its
              tiles out in a grid of its own inside this; the other four stack
              one task, exactly as they always have. */}
          <div className="col-span-full min-w-0 space-y-3">{children}</div>
          {aside}
        </div>
      </main>

      {/*
        A rule and real space above it.
        Without them the "powered by" tail landed directly under whichever
        column happened to be longest — usually the rail — and read as one more
        row of that card rather than as the end of the page.
      */}
      <div className={`w-full ${PAGE_CONTAINER}`}>
        <div className="pb-8 pt-2" style={{ borderTop: '1px solid var(--ap-border)' }}>
          <PublicFooter brand={brand} showContact={false} />
        </div>
      </div>
    </div>
  );
}
