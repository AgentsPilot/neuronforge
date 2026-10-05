// components/public/PortalRail.tsx

import { Mail, User } from 'lucide-react';

import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { PortalMeetings, type PortalMeeting } from '@/components/public/PortalMeetings';
import { publicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';

export type { PortalMeeting } from '@/components/public/PortalMeetings';

interface PortalRailProps {
  brand: PublicBrand;
  clientName: string | null;
  clientEmail: string | null;
  /** The business's zone, so "open today" is the business's today. */
  timeZone: string | null;
  /**
   * Every other appointment this client has with this business, newest first.
   * Empty on a first booking, which is the ordinary case.
   */
  meetings: PortalMeeting[];
}

/**
 * Everything the portal shows on every screen and no screen owns.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A COMPONENT OF ITS OWN
 *
 * The client's details, the business's details, the opening hours and the past
 * appointments are identical whether someone is looking at their booking,
 * cancelling it or moving it. Rendered by each page they were fetched, built
 * and thrown away three times for one visit, and the column visibly redrew on
 * every navigation.
 *
 * The layout renders this ONCE for the whole `/book/manage/[token]` section,
 * from data it resolves on the server. Moving between the screens leaves it
 * untouched: only the main column changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PortalRail({
  brand,
  clientName,
  clientEmail,
  timeZone,
  meetings,
}: PortalRailProps) {
  const t = (key: string) => publicT(brand.locale, key);

  const cardStyle = {
    background: 'var(--ap-surface)',
    border: '1px solid var(--ap-border)',
    borderRadius: 'var(--ap-radius-lg)',
  } as const;

  const labelStyle = {
    color: 'var(--ap-text-muted)',
    // Hebrew has no case; uppercase only adds unnatural letter-spacing to it.
    letterSpacing: brand.locale === 'he' ? 'normal' : '0.05em',
    textTransform: brand.locale === 'he' ? ('none' as const) : ('uppercase' as const),
  };

  return (
    <>
      {(clientName || clientEmail) && (
        <section className="p-5" style={cardStyle}>
          <h2 className="mb-3 text-xs font-semibold" style={labelStyle}>
            {t('yourDetails')}
          </h2>
          <dl className="space-y-2.5">
            {clientName && (
              <div className="flex items-center gap-2.5">
                <User className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                <dd className="text-sm" style={{ color: 'var(--ap-text)' }}>
                  <bdi>{clientName}</bdi>
                </dd>
              </div>
            )}
            {clientEmail && (
              <div className="flex items-center gap-2.5">
                <Mail className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-brand)' }} aria-hidden />
                <dd className="break-all text-sm" style={{ color: 'var(--ap-text)' }}>
                  <bdi>{clientEmail}</bdi>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/*
        What makes this a portal rather than a page: every appointment the
        client has with this business, not only the one whose link they happened
        to open — and each row is the way into that one.
      */}
      <PortalMeetings brand={brand} meetings={meetings} />

      {/*
        Where to go, how to call, and when they are open — the last of which is
        what a client checks on the morning of the appointment. Renders nothing
        at all when the business has filled none of it in.
      */}
      <BusinessInfoPanel
        brand={brand}
        variant="card"
        show={['contact', 'address', 'hours', 'links']}
        /* Open or closed TODAY, then the days that share hours as one run,
           with all seven a tap away. */
        hoursStyle="folded"
        timeZone={timeZone}
      />

    </>
  );
}
