'use client';

import { Mail, User } from 'lucide-react';

import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { PortalMeetings } from '@/components/public/PortalMeetings';
import { usePortalContext } from '@/components/public/PortalContextProvider';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { publicT } from '@/lib/i18n/public-pages';

/**
 * The cards a client has on every screen of the portal, as a group.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A GROUP AND NOT THE LAYOUT
 *
 * These lived in the segment layout, which put them on every screen — and
 * underneath a calendar, a client's whole appointment history is noise, so
 * they were taken out. Then the task screens read as unfinished: a picker, a
 * confirm bar, and nothing else on the page.
 *
 * Both were right about their own screen, which is why neither place works for
 * all of them. The index places these four itself, individually, because its
 * two columns interleave them with the booking and the money. A task screen
 * wants them as one block after the task, which is this.
 *
 * Same components either way, so there is one implementation of each card and
 * only the arrangement differs.
 *
 * Renders nothing outside the portal section, where there is no context to
 * read — a legitimate state, not a fault.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PortalCards() {
  const brand = useOptionalPublicBrand();
  const portal = usePortalContext();

  if (!brand || !portal) return null;

  const t = (key: string) => publicT(brand.locale, key);

  return (
    /*
      `items-start`. Without it the grid stretches every card to the tallest in
      its row, so "your details" — a name and an email — was drawn the full
      height of the meeting list beside it, as a mostly empty box. This is the
      third place that has happened; the guard now checks every card grid, not
      just the index's.
    */
    <div className="grid items-start gap-3 lg:grid-cols-2">
      {(portal.clientName || portal.clientEmail) && (
        <section className="apc-panel p-5">
          <h3 className="mb-3 text-xs font-semibold" style={{ color: 'var(--ap-text-muted)' }}>
            {t('yourDetails')}
          </h3>
          <dl className="space-y-2.5">
            {portal.clientName && (
              <div className="flex items-center gap-2.5">
                <User className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                <dd className="text-sm">
                  <bdi>{portal.clientName}</bdi>
                </dd>
              </div>
            )}
            {portal.clientEmail && (
              <div className="flex items-center gap-2.5">
                <Mail className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                <dd className="break-all text-sm">
                  <bdi>{portal.clientEmail}</bdi>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <PortalMeetings brand={brand} meetings={portal.meetings} timeZone={portal.timeZone} />

      <BusinessInfoPanel brand={brand} variant="card" show={['contact', 'address', 'links']} />

      {/* Last, as on the index: the thing a client checks on the morning of
          the appointment, not while they are arranging it. */}
      <BusinessInfoPanel
        brand={brand}
        variant="card"
        show={['hours']}
        hoursStyle="folded"
        timeZone={portal.timeZone}
      />
    </div>
  );
}
