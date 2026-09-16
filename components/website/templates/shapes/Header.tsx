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

import type { MouseEvent } from 'react';

import type { BlockRendererProps } from '@/components/website/blocks/types';
import { resolveBookingAction, bookingIsDead } from '@/components/website/blocks/bookingAction';

interface MenuItem {
  label?: string;
  text?: string;
  /**
   * The section this item jumps to, as a selector — `#services`, `#contact`.
   *
   * This is the field the editor writes and `HeaderBlock` has always read. The
   * shape read `link`/`href` instead, which the menu item does not carry, so
   * every entry fell back to `'#'` and the nav stopped navigating: it looked
   * right, and jumped nowhere. `link` and `href` stay as fallbacks for any
   * content authored against them.
   */
  anchor?: string;
  link?: string;
  href?: string;
}

interface HeaderShape {
  logo_text?: string;
  logo_url?: string;
  menu_items?: MenuItem[];
  cta_button?: { text?: string; link?: string } | null;
}

/**
 * Jump to a section, in the published page AND in the editor's preview.
 *
 * `HeaderBlock` does this with `window.scrollTo`, which is right on a published
 * page and inert in the preview: the page renders inside an iframe that does
 * not scroll — the editor's canvas around it does — so scrolling the iframe's
 * own window moves nothing.
 *
 * `scrollIntoView` walks up to whichever ancestor is actually scrollable, so
 * one call serves both. The href is left on the anchor so the item still works
 * without JavaScript and still shows its target in the status bar.
 */
function jumpToSection(event: MouseEvent<HTMLAnchorElement>, anchor?: string) {
  if (!anchor?.startsWith('#') || anchor === '#') return;

  const target = document.querySelector(anchor);
  if (!target) return;

  event.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A LINK TO A SECTION IS A LINK TO A SECTION.
   *
   * This button called `resolveBookingAction` unconditionally, so it opened the
   * booking dialog no matter where its link pointed. A header saying "Contact
   * Us" over `#contact` opened a booking flow — the owner's own configuration
   * ignored, and the one thing a visitor who wants to ASK something rather than
   * BUY something is looking for.
   *
   * The rule: an in-page anchor that is not the booking section is the owner
   * saying where to go, and it is obeyed. `#booking` still means booking, and
   * an absent link still falls through to the booking action, which is what
   * makes the generated "Book Now" button work without naming a target.
   *
   * Set on the header alone. Hero and CTA buttons are conversion controls whose
   * job IS to start a booking; this one sits in the navigation, beside the menu
   * items, and reads as navigation.
   */
  const ctaAnchor = c.cta_button?.link?.trim();
  const jumpsToSection =
    Boolean(ctaAnchor) && ctaAnchor!.startsWith('#') && ctaAnchor !== '#' && ctaAnchor !== '#booking';

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
              <a
                key={index}
                href={item.anchor ?? item.link ?? item.href ?? '#'}
                onClick={event => jumpToSection(event, item.anchor ?? item.link ?? item.href)}
                className="apc-menu-item"
              >
                {/* The label alone.
                    A two-digit index used to be printed before every link —
                    "01 About", "02 Services" — which is a device from the step
                    list, not from a navigation bar. Five of the six templates
                    styled it and only one hid it, so most sites shipped with a
                    numbered menu nobody asked for. */}
                <span>{item.label ?? item.text}</span>
              </a>
            ))}
          </nav>
        )}

        {c.cta_button?.text &&
          (jumpsToSection ? (
            <a
              href={ctaAnchor}
              onClick={event => jumpToSection(event, ctaAnchor)}
              className="apc-btn apc-btn--solid"
            >
              {c.cta_button.text}
            </a>
          ) : bookingIsDead(content) ? (
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
