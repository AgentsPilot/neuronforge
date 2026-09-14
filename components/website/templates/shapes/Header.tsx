/**
 * The bar across the top: wordmark, links, one control.
 *
 * Stone and Warm number their links — `01 אודות  02 התוכניות` — which is the
 * same counting their offer lists use and is most of why those designs read as
 * ordered rather than decorated. Bold does not number and sets its bar on the
 * ink ground instead. The index is always rendered; a template that does not
 * want it does not draw it.
 *
 * @module components/website/templates/shapes/Header
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';
import { resolveBookingAction, bookingIsDead } from '@/components/website/blocks/bookingAction';

interface MenuItem {
  label?: string;
  text?: string;
  link?: string;
  href?: string;
}

interface HeaderShape {
  logo_text?: string;
  logo_url?: string;
  menu_items?: MenuItem[];
  cta_button?: { text?: string; link?: string } | null;
}

export function HeaderSection({
  content,
  isRTL,
  className,
  isPreview,
  onOpenBooking,
  bookingUrl,
}: BlockRendererProps) {
  const c = content as HeaderShape;
  const items = c.menu_items ?? [];

/*
 * The control has to be able to START a booking.
 *
 * A shape draws the section, but the section's button is the conversion path:
 * in the editor's preview it opens the in-page booking dialog, on a published
 * site it goes to the booking page, and on a page that can take no booking at
 * all it falls back to its own link. Rendering a plain anchor here made the
 * dialog unreachable from the three sections most likely to convert — which is
 * invisible in a screenshot and total in effect.
 */
  const booking = resolveBookingAction({
    isPreview,
    onOpenBooking,
    bookingUrl,
    fallbackHref: c.cta_button?.link ?? '#contact',
  });

  return (
    <header dir={isRTL ? 'rtl' : 'ltr'} className={`apc-bar ${className ?? ''}`}>
      <div className="apc-nav">
        <a href="#" className="apc-wm">
          {c.logo_url ? (
            <img src={c.logo_url} alt={c.logo_text ?? ''} className="apc-wm-img" />
          ) : (
            c.logo_text
          )}
        </a>

        {items.length > 0 && (
          <nav className="apc-menu">
            {items.map((item, index) => (
              <a key={index} href={item.link ?? item.href ?? '#'} className="apc-menu-item">
                <i className="apc-menu-idx" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </i>
                <span>{item.label ?? item.text}</span>
              </a>
            ))}
          </nav>
        )}

        {c.cta_button?.text &&
          (bookingIsDead(content) ? (
            <button type="button" disabled className="apc-btn apc-btn--solid">
              {c.cta_button.text}
            </button>
          ) : booking.kind === 'open' ? (
            <button type="button" onClick={booking.onClick} className="apc-btn apc-btn--solid">
              {c.cta_button.text}
            </button>
          ) : (
            <a href={booking.href} className="apc-btn apc-btn--solid">
              {c.cta_button.text}
            </a>
          ))}
      </div>
    </header>
  );
}
