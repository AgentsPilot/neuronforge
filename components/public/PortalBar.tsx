// components/public/PortalBar.tsx

import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';
import { publicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';

interface PortalBarProps {
  brand: PublicBrand;
  /** The client, so the bar can show whose portal this is. */
  clientName?: string | null;
}

/**
 * The bar at the top of every booking-management screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * `PublicHeader` announces a business to a stranger: a centred mark, the name
 * under it, a subtitle under that. That is right for a quote or an invoice,
 * which a client opens once. It is wrong for the booking screens, which a
 * client moves BETWEEN — view, then reschedule, then back — and where the same
 * centred announcement on each one makes every step feel like arriving at
 * another website.
 *
 * This says the same things on one line and then stops changing. The mark, the
 * name and "my bookings" stay put across all three screens, so what moves is
 * only the content under them.
 *
 * THE BUSINESS IS NAMED EXACTLY ONCE PER SCREEN. The hero below used to repeat
 * it, which read as two stacked headers; the logo's `alt` was the name as well,
 * so a screen reader heard it a third time. The mark is decoration beside a
 * name already written, so it is `alt=""` and hidden.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PortalBar({ brand, clientName }: PortalBarProps) {
  const t = (key: string) => publicT(brand.locale, key);

  /*
   * The client's initial. A dot rather than an empty circle when there is no
   * name: a contact without one is ordinary (a booking taken over the phone),
   * and a blank avatar reads as something that failed to load.
   */
  const initial = clientName?.trim().charAt(0).toUpperCase() || '•';

  return (
    <header
      style={{
        background: 'var(--ap-surface)',
        borderBottom: '1px solid var(--ap-border)',
      }}
    >
      {/* The bar spans the window; its CONTENT lands on the same line as the
          page body below it, which is what `PAGE_CONTAINER` is for. */}
      <div className={`flex w-full items-center gap-3 py-3 ${PAGE_CONTAINER}`}>
        {brand.logoUrl ? (
          /*
           * A business logo is an arbitrary remote URL, so `next/image` would
           * need every customer's host allow-listed.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt=""
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-xl object-contain"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center text-base font-bold"
            style={{
              background: 'var(--ap-brand-tint)',
              color: 'var(--ap-brand)',
              borderRadius: 'var(--ap-radius-md)',
            }}
          >
            {brand.businessName.trim().charAt(0).toUpperCase() || '•'}
          </div>
        )}

        <div className="min-w-0">
          <div
            className="truncate text-sm font-bold leading-tight"
            style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
          >
            <bdi>{brand.businessName}</bdi>
          </div>
          <div className="text-xs" style={{ color: 'var(--ap-text-muted)' }}>
            {t('portal.my_bookings')}
          </div>
        </div>

        {/*
          Whose portal this is, said rather than initialled.
          The name is the point; the disc is what is left of it when there is no
          room, so the name hides first on a narrow phone and the disc stays.
        */}
        <div className="ms-auto flex min-w-0 items-center gap-2.5">
          {clientName && (
            <span
              className="hidden max-w-[12rem] truncate text-sm font-semibold sm:inline"
              style={{ color: 'var(--ap-text)' }}
            >
              <bdi>{clientName}</bdi>
            </span>
          )}

          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            style={{ background: 'var(--ap-brand)', color: 'var(--ap-on-brand)' }}
          >
            {initial}
          </span>
        </div>
      </div>
    </header>
  );
}
